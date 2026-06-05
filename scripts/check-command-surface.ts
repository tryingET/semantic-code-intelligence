#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { alphaMvpToolNameSet } from '../src/core/tools/alpha-surface.js';

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
  remediation: string;
}

const violations: Violation[] = [];
const json = process.argv.includes('--json');
const alphaToolNames = alphaMvpToolNameSet();

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function add(file: string, line: number, rule: string, text: string, remediation: string): void {
  violations.push({ file, line, rule, text: text.trim(), remediation });
}

function lineHasNearbyWorkingDirectory(lines: string[], index: number): boolean {
  const start = Math.max(0, index - 3);
  return lines.slice(start, index).some((line) => /^\s*working-directory:\s*\S+/.test(line));
}

function workflowFiles(): string[] {
  const dir = '.github/workflows';
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => join(dir, name))
    .sort();
}

function claudeHookFiles(): string[] {
  const dir = '.claude/hooks';
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sh') || name.endsWith('.sh.old'))
    .map((name) => join(dir, name))
    .sort();
}

function workflowLineFor(text: string, needle: string): number {
  const index = text.indexOf(needle);
  if (index < 0) return 1;
  return text.slice(0, index).split(/\r?\n/).length;
}

interface ShellInvocation {
  line: string;
  executable: string;
  args: string[];
  pipeline: Array<{ executable: string; args: string[] }>;
}

function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaping = false;

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\' && quote !== 'single') {
      escaping = true;
      continue;
    }
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      continue;
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function normalizeExecutable(executable: string): string {
  return executable.replace(/^\.\//, '');
}

function commandFromSegment(segment: string): { executable: string; args: string[] } | null {
  const tokens = shellTokens(segment.trim());
  if (tokens.length === 0 || tokens[0].startsWith('#')) return null;

  let index = 0;
  if (tokens[index] === 'env') index += 1;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])) index += 1;
  if (index >= tokens.length) return null;

  const executable = normalizeExecutable(tokens[index]);
  const args = tokens.slice(index + 1);
  if ((executable === 'bash' || executable === 'sh') && args[0] && !args[0].startsWith('-')) {
    return { executable: normalizeExecutable(args[0]), args: args.slice(1) };
  }

  return { executable, args };
}

function shellInvocations(run: string): ShellInvocation[] {
  return run
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n|&&|;/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .flatMap((line) => {
      const pipeline = line
        .split('|')
        .map(commandFromSegment)
        .filter((command): command is { executable: string; args: string[] } => command !== null);
      const first = pipeline[0];
      return first ? [{ line, executable: first.executable, args: first.args, pipeline }] : [];
    });
}

function normalizedShellValue(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, '$1').replace(/\$/g, '');
}

function writesCiSliceLog(invocation: ShellInvocation): boolean {
  return invocation.pipeline.some(
    (segment) =>
      segment.executable === 'tee' &&
      segment.args.some((arg) => {
        const normalized = normalizedShellValue(arg);
        return normalized.includes('.test-results/slice-') && normalized.includes('SLICE') && normalized.endsWith('.log');
      })
  );
}

function hasExplicitCiSliceArg(invocation: ShellInvocation): boolean {
  const sliceIndex = invocation.args.indexOf('--slice');
  if (sliceIndex < 0) return false;
  const value = invocation.args[sliceIndex + 1];
  if (!value) return false;
  return normalizedShellValue(value) === 'SLICE/SLICES';
}

interface WorkflowRunBlock {
  run: string;
  env: Record<string, unknown>;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function workflowRunBlocks(value: unknown): WorkflowRunBlock[] {
  const root = recordValue(value);
  const workflowEnv = recordValue(root.env);
  const blocks: WorkflowRunBlock[] = [];
  for (const jobValue of Object.values(recordValue(root.jobs))) {
    const job = recordValue(jobValue);
    if (!Array.isArray(job.steps)) continue;
    const jobEnv = recordValue(job.env);
    for (const stepValue of job.steps) {
      const step = recordValue(stepValue);
      if (typeof step.run === 'string') {
        blocks.push({ run: step.run, env: { ...workflowEnv, ...jobEnv, ...recordValue(step.env) } });
      }
    }
  }
  return blocks;
}

function hasNormalSuiteSliceEnv(env: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(env, 'SLICES') &&
    Object.prototype.hasOwnProperty.call(env, 'SLICE') &&
    !Object.prototype.hasOwnProperty.call(env, 'SUITE_DIR') &&
    !Object.prototype.hasOwnProperty.call(env, 'E2E')
  );
}

function checkWorkflowNormalTestRunner(file: string): void {
  const text = readText(file);
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (error) {
    add(file, 1, 'workflow-yaml-parse-failed', String(error), 'Keep workflow YAML parseable so command-surface contracts can be checked structurally.');
    return;
  }

  for (const block of workflowRunBlocks(parsed)) {
    const line = workflowLineFor(text, block.run);
    for (const invocation of shellInvocations(block.run)) {
      const isCiNormalSlice = writesCiSliceLog(invocation) || hasNormalSuiteSliceEnv(block.env);
      if (invocation.executable === 'bin/test-slicer.sh' && isCiNormalSlice) {
        add(file, line, 'ci-normal-tests-use-canonical-runner', block.run, 'Use `scripts/run-normal-tests.sh` so CI matrix slices share the same guards as local `bun run test`/`just test`.');
      }

      if (invocation.executable === 'scripts/run-normal-tests.sh' && isCiNormalSlice && !hasExplicitCiSliceArg(invocation)) {
        add(file, line, 'ci-normal-tests-explicit-slice', block.run, 'Pass `--slice "$SLICE/$SLICES"`; the normal runner must not infer partial-suite mode from ambient env.');
      }
    }
  }
}

function scanTextSurface(file: string): void {
  if (!existsSync(file)) return;
  const lines = readText(file).split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const raw = line.trim();
    const surface = raw.replace(/^-\s+/, '').trim();
    const command = surface.replace(/^run:\s*/, '').trim();

    if (/^(?:bun|\{\{bun\}\})\s+test(?:\s+tests\/?|\s+tests\/)?$/.test(command)) {
      add(file, lineNo, 'no-broad-raw-bun-test', line, 'Use `bun run test` for the normal suite, or a focused `bun test tests/<file>.test.ts` command.');
    }

    if (/^(?:bun|\{\{bun\}\})\s+test\b.*\b--coverage\b/.test(command)) {
      add(file, lineNo, 'no-ad-hoc-raw-coverage', line, 'Use `bun run test:coverage` so coverage semantics stay centralized.');
    }

    if (/^bun\s+run\s+test:raw\b/.test(command)) {
      add(file, lineNo, 'no-workflow-raw-test-alias', line, 'Use `bun run test`; `test:raw` is a local debugging escape hatch only.');
    }

    if (line.includes('dist/cli/index.js')) {
      add(file, lineNo, 'no-stale-built-cli-path', line, 'Use the actual built CLI artifact: `dist/cli/cli.js`.');
    }

    if (line.includes('analyze --path')) {
      add(file, lineNo, 'no-unsupported-cli-analyze-command', line, 'Use supported SCI CLI commands such as `stats --json` or `get-snapshot --json`.');
    }

    if (/^run:\s*bun\s+install\s*$/.test(surface) && !lineHasNearbyWorkingDirectory(lines, index)) {
      add(file, lineNo, 'root-bun-install-must-be-frozen', line, 'Use `bun install --frozen-lockfile` for root workflow installs.');
    }

    if (line.includes('mcp-ontology-server')) {
      add(file, lineNo, 'no-stale-mcp-ontology-server-path', line, 'Use in-repo Semantic Code Intelligence server paths such as `src/servers/mcp-http.ts`.');
    }

    if (line.includes('src/api/http-server.ts')) {
      add(file, lineNo, 'no-stale-http-api-server-path', line, 'Use the current HTTP server path: `src/servers/http.ts`.');
    }

    const dogfoodToolCall = file === 'bin/dogfood-workflows.sh' ? line.match(/^\s*call\s+([A-Za-z0-9_]+)/) : null;
    const adapterToolCall = file === 'scripts/dogfood-mcp.ts' ? line.match(/handleToolCall\(['"]([A-Za-z0-9_]+)['"]/) : null;
    const toolCall = dogfoodToolCall?.[1] ?? adapterToolCall?.[1];
    if (toolCall && !alphaToolNames.has(toolCall)) {
      add(file, lineNo, 'dogfood-tool-must-be-alpha', line, `Use an Alpha MVP tool name; '${toolCall}' is not exposed on the default MCP/CLI alpha surface.`);
    }
  });
}

function isSemanticCodeIntelligenceRepo(): boolean {
  if (!existsSync('package.json')) return false;
  try {
    return JSON.parse(readText('package.json')).name === 'semantic-code-intelligence';
  } catch {
    return false;
  }
}

function checkAlphaDocToolParity(file: string): void {
  if (!existsSync(file)) {
    add(file, 1, 'alpha-tool-doc-missing', '<missing>', 'Keep Alpha MVP docs present and synchronized with the runtime Alpha membrane.');
    return;
  }
  const text = readText(file);
  for (const name of alphaToolNames) {
    if (!text.includes(`\`${name}\``)) {
      add(file, 1, 'alpha-tool-doc-drift', name, `Document Alpha MVP tool \`${name}\` or remove it from the runtime Alpha membrane.`);
    }
  }
}

function checkPackageScripts(): void {
  const file = 'package.json';
  const pkg = JSON.parse(readText(file)) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts || {};
  const required: Record<string, string> = {
    test: 'scripts/run-normal-tests.sh',
    'test:nonperf': 'scripts/run-normal-tests.sh',
    'test:coverage': 'scripts/run-coverage-tests.sh',
    'command-surface:check': 'bun run scripts/check-command-surface.ts',
  };

  for (const [name, expected] of Object.entries(required)) {
    if (scripts[name] !== expected) {
      add(file, 1, 'package-script-drift', `scripts.${name}=${scripts[name] ?? '<missing>'}`, `Set scripts.${name} to ${JSON.stringify(expected)}.`);
    }
  }

  if (scripts['test:raw'] !== 'bun test') {
    add(file, 1, 'raw-test-debug-alias-drift', `scripts.test:raw=${scripts['test:raw'] ?? '<missing>'}`, 'Keep `test:raw` as the explicit debug-only raw Bun test alias.');
  }

  for (const [name, value] of Object.entries(scripts)) {
    if ((name === 'test' || name === 'test:nonperf') && /^bun\s+test\b/.test(value)) {
      add(file, 1, 'normal-test-must-not-use-raw-bun', `scripts.${name}=${value}`, 'Route normal tests through `scripts/run-normal-tests.sh`.');
    }
    if (name !== 'test:raw' && /^bun\s+test$/.test(value)) {
      add(file, 1, 'bare-bun-test-script', `scripts.${name}=${value}`, 'Use a focused test command or a named runner script; reserve bare `bun test` for `test:raw`.');
    }
    if (name !== 'test:coverage' && /^bun\s+test\s+--coverage\b/.test(value)) {
      add(file, 1, 'ad-hoc-coverage-script', `scripts.${name}=${value}`, 'Route coverage through `scripts/run-coverage-tests.sh`.');
    }
  }
}

function main(): void {
  checkPackageScripts();

  for (const file of workflowFiles()) {
    scanTextSurface(file);
    checkWorkflowNormalTestRunner(file);
  }
  for (const file of claudeHookFiles()) scanTextSurface(file);
  for (const file of ['.github/pull_request_template.md', 'README.md', 'TESTING_STRATEGY.md', 'tests/README.md', 'justfile', 'CLAUDE_DESKTOP_SETUP.md', 'bin/dogfood-workflows.sh', 'scripts/dogfood-mcp.ts']) scanTextSurface(file);
  if (isSemanticCodeIntelligenceRepo()) {
    for (const file of ['docs/project/product-posture.md', 'docs/project/alpha-mvp-contract.md']) checkAlphaDocToolParity(file);
  }

  const report = { ok: violations.length === 0, violations };
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (violations.length === 0) {
    process.stdout.write('command-surface: ok\n');
  } else {
    process.stderr.write('command-surface: violations found\n');
    for (const v of violations) {
      process.stderr.write(`- ${v.file}:${v.line} [${v.rule}] ${v.text}\n  ${v.remediation}\n`);
    }
  }

  process.exit(violations.length === 0 ? 0 : 1);
}

main();
