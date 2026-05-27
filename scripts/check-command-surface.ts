#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
  remediation: string;
}

const violations: Violation[] = [];
const json = process.argv.includes('--json');

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
  });
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

  for (const file of workflowFiles()) scanTextSurface(file);
  for (const file of ['.github/pull_request_template.md', 'README.md', 'TESTING_STRATEGY.md', 'tests/README.md', 'justfile']) scanTextSurface(file);

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
