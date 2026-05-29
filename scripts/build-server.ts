#!/usr/bin/env bun

import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

type BuildTarget = {
    entry: string;
    outdir: string;
    outfile?: string;
};

const targets: Record<string, BuildTarget> = {
    core: { entry: './src/core/index.ts', outdir: 'dist/core' },
    lsp: { entry: './src/servers/lsp.ts', outdir: 'dist/lsp' },
    'mcp-stdio': { entry: './src/servers/mcp-stdio-entry.ts', outdir: 'dist/mcp', outfile: 'dist/mcp/mcp.js' },
    'mcp-http': { entry: './src/servers/mcp-http.ts', outdir: 'dist/mcp-http' },
    'mcp-enhanced': {
        entry: './src/servers/mcp-enhanced-entry.ts',
        outdir: 'dist/mcp-enhanced',
        outfile: 'dist/mcp-enhanced/mcp-enhanced.js',
    },
    http: { entry: './src/servers/http.ts', outdir: 'dist/http' },
    cli: { entry: './src/servers/cli.ts', outdir: 'dist/cli' },
};

const externals = [
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-javascript',
    'tree-sitter-python',
    'tree-sitter-rust',
    'tree-sitter-go',
    'pg',
    'bun:sqlite',
    'express',
    'cors',
];

const targetName = process.argv[2];
const target = targetName ? targets[targetName] : undefined;

if (!target) {
    const available = Object.keys(targets).sort().join(', ');
    console.error(`Usage: bun run scripts/build-server.ts <target>`);
    console.error(`Available targets: ${available}`);
    process.exit(2);
}

rmSync(target.outdir, { recursive: true, force: true });
if (target.outfile) {
    mkdirSync(dirname(target.outfile), { recursive: true });
}

const args = [
    'build',
    target.entry,
    '--target=bun',
    target.outfile ? `--outfile=${target.outfile}` : `--outdir=${target.outdir}`,
    '--format=esm',
    ...externals.flatMap((external) => ['--external', external]),
];

const proc = Bun.spawnSync(['bun', ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
});

process.exit(proc.exitCode ?? 1);
