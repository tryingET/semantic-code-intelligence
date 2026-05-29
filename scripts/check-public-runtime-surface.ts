#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

interface Violation {
  file: string;
  rule: string;
  detail: string;
  remediation: string;
}

const violations: Violation[] = [];

function add(file: string, rule: string, detail: string, remediation: string): void {
  violations.push({ file, rule, detail, remediation });
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function exists(path: string): boolean {
  return existsSync(path);
}

function requireExisting(path: string, rule: string, remediation: string): void {
  if (!exists(path)) add(path, rule, `${path} does not exist`, remediation);
}

function checkPackageEntrypoints(): void {
  const pkg = readJson('package.json') as {
    main?: string;
    bin?: Record<string, string>;
    files?: string[];
    scripts?: Record<string, string>;
    engines?: Record<string, string>;
  };

  if (pkg.main !== 'dist/core/index.js') {
    add('package.json', 'package-main-drift', `main=${pkg.main ?? '<missing>'}`, 'Set package.json main to the built core entrypoint dist/core/index.js.');
  } else {
    requireExisting(pkg.main, 'package-main-missing', 'Run bun run build:core or fix the package main path.');
  }

  if (pkg.main && exists(pkg.main)) {
    checkRuntimeImport('bun', ['--eval', `await import('./${pkg.main}')`], pkg.main, 'bun');
    if (pkg.engines?.node) {
      checkRuntimeImport('node', ['-e', `import('./${pkg.main}')`], pkg.main, 'node');
    }
  }

  const requiredFiles = ['bin/semantic-code-intelligence', 'bin/semantic-code-mcp', 'dist/', 'README.md', 'LICENSE'];
  for (const required of requiredFiles) {
    if (!pkg.files?.includes(required)) {
      add('package.json', 'package-files-missing-required-entry', `files lacks ${required}`, `Keep ${required} in package.json files.`);
    }
  }

  const requiredScripts: Record<string, string> = {
    'build:all': 'rimraf dist && bun run build:core && bun run build:lsp && bun run build:mcp-stdio && bun run build:mcp-http && bun run build:mcp-enhanced && bun run build:http && bun run build:cli',
    'build:core': 'bun run scripts/build-server.ts core',
    'public-surface:check': 'bun run build:all && bun run scripts/check-public-runtime-surface.ts',
    prepack: 'bun run public-surface:check',
  };
  for (const [name, expected] of Object.entries(requiredScripts)) {
    if (pkg.scripts?.[name] !== expected) {
      add('package.json', 'package-script-drift', `scripts.${name}=${pkg.scripts?.[name] ?? '<missing>'}`, `Set scripts.${name} to ${JSON.stringify(expected)}.`);
    }
  }

  for (const [name, rel] of Object.entries(pkg.bin || {})) {
    requireExisting(rel, 'package-bin-missing', `Restore the bin wrapper for ${name}.`);
    if (!exists(rel)) continue;

    const text = readFileSync(rel, 'utf8');
    const match = text.match(/^import\s+["']\.\.\/(dist\/[^"']+)["'];?$/m);
    if (!match) {
      add(rel, 'package-bin-target-unparseable', `${name} wrapper does not import a dist target`, 'Keep bin wrappers as thin imports of built dist artifacts.');
      continue;
    }
    requireExisting(match[1], 'package-bin-target-missing', `Run bun run build:all or fix the ${name} wrapper target.`);
  }
}

function checkRuntimeImport(command: string, args: string[], file: string, runtime: string): void {
  const proc = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
  if (proc.status !== 0) {
    const detail = [proc.stderr.trim(), proc.stdout.trim()].filter(Boolean).join('\n').slice(0, 1200);
    add(
      file,
      `package-main-${runtime}-import-failed`,
      detail || `${runtime} import exited with status ${proc.status}`,
      `Make ${file} importable under the advertised ${runtime} runtime or remove that runtime claim.`
    );
  }
}

function checkBuildOutputs(): void {
  const requiredOutputs = [
    'dist/core/index.js',
    'dist/lsp/lsp.js',
    'dist/mcp/mcp.js',
    'dist/mcp-http/mcp-http.js',
    'dist/mcp-enhanced/mcp-enhanced.js',
    'dist/http/http.js',
    'dist/cli/cli.js',
  ];

  for (const output of requiredOutputs) {
    requireExisting(output, 'build-output-missing', 'Run bun run build:all and ensure build-server targets still match package/runtime wrappers.');
  }
}

function checkCommandSurfaceScanCoverage(): void {
  const checker = readFileSync('scripts/check-command-surface.ts', 'utf8');
  for (const surface of ['.github/pull_request_template.md', 'README.md', 'TESTING_STRATEGY.md', 'tests/README.md', 'justfile']) {
    if (!checker.includes(`'${surface}'`)) {
      add('scripts/check-command-surface.ts', 'command-surface-scan-gap', `missing ${surface}`, 'Scan all public command documentation and Justfile surfaces.');
    }
  }
}

function checkRuntimeVersionSource(): void {
  const pkg = readJson('package.json') as { version?: string };
  const source = readFileSync('src/core/version.ts', 'utf8');
  const match = source.match(/SCI_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    add('src/core/version.ts', 'runtime-version-source-missing', 'SCI_VERSION export is missing or unparseable', 'Expose a shared SCI_VERSION constant for CLI/MCP runtime metadata.');
    return;
  }
  if (match[1] !== pkg.version) {
    add('src/core/version.ts', 'runtime-version-drift', `SCI_VERSION=${match[1]}, package.json version=${pkg.version ?? '<missing>'}`, 'Keep SCI_VERSION equal to package.json version.');
  }
}

function main(): void {
  checkPackageEntrypoints();
  checkBuildOutputs();
  checkCommandSurfaceScanCoverage();
  checkRuntimeVersionSource();

  if (violations.length === 0) {
    process.stdout.write('public-runtime-surface: ok\n');
    return;
  }

  process.stderr.write(`${JSON.stringify({ ok: false, violations }, null, 2)}\n`);
  process.exit(1);
}

main();
