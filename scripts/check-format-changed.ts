#!/usr/bin/env bun

const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const ignoredPrefixes = [
    '.ontology/',
    '.test-results/',
    'coverage/',
    'dist/',
    'node_modules/',
    'tests/fixtures/.ontology/',
    'vscode-client/node_modules/',
];

function runGit(args: string[]): string[] {
    const proc = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
    if (proc.exitCode !== 0) {
        process.stderr.write(proc.stderr.toString());
        process.exit(proc.exitCode || 1);
    }
    return proc.stdout
        .toString()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function isSupportedPath(file: string): boolean {
    if (ignoredPrefixes.some((prefix) => file.startsWith(prefix))) return false;
    const dot = file.lastIndexOf('.');
    if (dot < 0) return false;
    return textExtensions.has(file.slice(dot));
}

const changed = new Set([
    ...runGit(['diff', '--name-only', '--diff-filter=ACMR', '--', '.']),
    ...runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--', '.']),
    ...runGit(['ls-files', '--others', '--exclude-standard', '--', '.']),
]);

const files = [...changed].filter(isSupportedPath).sort();
if (files.length === 0) {
    console.log('format-check: no changed supported files');
    process.exit(0);
}

const proc = Bun.spawnSync(['bunx', '@biomejs/biome', 'format', '--files-ignore-unknown=true', ...files], {
    stdout: 'inherit',
    stderr: 'inherit',
});
process.exit(proc.exitCode ?? 1);
