#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(repoRoot, '.test-results/local-production-candidate.json');
const installRoot = join(repoRoot, `.test-results/.local-production-install-${process.pid}`);
const targetRoot = join(installRoot, 'target');
const jsonMode = process.argv.includes('--json');
const allowDirtySource = process.argv.includes('--allow-dirty-source');
const keepInstall = process.env.SCI_KEEP_PRODUCTION_DOGFOOD_INSTALL === '1';

function sha256(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? repoRoot,
        env: options.env ?? process.env,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(-6000);
        throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}\n${detail}`);
    }
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function parseJsonOutput(text: string, label: string): any {
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${label} did not emit one JSON value: ${text.slice(0, 1000)}`);
    }
}

function parseCliToolOutput(text: string, label: string): any {
    const envelope = parseJsonOutput(text, label);
    if (envelope?.isError) throw new Error(`${label} returned a tool error: ${JSON.stringify(envelope)}`);
    const contentText = envelope?.content?.[0]?.text;
    if (typeof contentText !== 'string') throw new Error(`${label} omitted its JSON text content`);
    return parseJsonOutput(contentText, `${label} content`);
}

function isJsonRpcRecord(message: any): boolean {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') return false;
    const validId = message.id === null || typeof message.id === 'string' || typeof message.id === 'number';
    if (typeof message.method === 'string') {
        if ('result' in message || 'error' in message) return false;
        if ('id' in message && !validId) return false;
        return !('params' in message) || (message.params !== null && typeof message.params === 'object');
    }
    if (!('id' in message) || !validId) return false;
    const hasResult = 'result' in message;
    const hasError = 'error' in message;
    if (hasResult === hasError) return false;
    if (!hasError) return true;
    return (
        message.error !== null &&
        typeof message.error === 'object' &&
        typeof message.error.code === 'number' &&
        typeof message.error.message === 'string'
    );
}

function describeEntry(root: string, absolute: string): string {
    const path = absolute === root ? '.' : relative(root, absolute).replaceAll('\\', '/');
    const metadata = lstatSync(absolute);
    const mode = (metadata.mode & 0o7777).toString(8);
    if (metadata.isDirectory()) return `${path}\0directory\0${mode}`;
    if (metadata.isFile()) return `${path}\0file\0${mode}\0${metadata.size}\0${sha256(readFileSync(absolute))}`;
    if (metadata.isSymbolicLink()) return `${path}\0symlink\0${mode}\0${readlinkSync(absolute)}`;
    return `${path}\0other\0${mode}`;
}

function sourceDigest(): string {
    const rootMetadata = lstatSync(targetRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error('Dogfood workspace root must be a real directory');
    const entries = [describeEntry(targetRoot, targetRoot)];
    const visit = (current: string): void => {
        for (const name of readdirSync(current).sort()) {
            if (current === targetRoot && name === '.ontology') continue;
            const absolute = join(current, name);
            entries.push(describeEntry(targetRoot, absolute));
            if (lstatSync(absolute).isDirectory()) visit(absolute);
        }
    };
    visit(targetRoot);
    return sha256(entries.join('\n'));
}

function runtimeStateEntries(): string[] {
    const stateRoot = join(targetRoot, '.ontology');
    try {
        const rootMetadata = lstatSync(stateRoot);
        if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error('Runtime state root must be a real directory');
    } catch (error: any) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
    const entries = [describeEntry(targetRoot, stateRoot)];
    const visit = (current: string): void => {
        for (const name of readdirSync(current).sort()) {
            const absolute = join(current, name);
            const metadata = lstatSync(absolute);
            if (metadata.isSymbolicLink()) throw new Error(`Runtime state must not contain symlinks: ${relative(targetRoot, absolute)}`);
            entries.push(describeEntry(targetRoot, absolute));
            if (metadata.isDirectory()) visit(absolute);
        }
    };
    visit(stateRoot);
    return entries;
}

async function dogfoodMcp(mcpBin: string, env: NodeJS.ProcessEnv): Promise<any> {
    const proc: ChildProcessWithoutNullStreams = spawn(mcpBin, [], { cwd: targetRoot, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let nextId = 1;
    let buffer = '';
    let stderr = '';
    const pollution: string[] = [];
    const pending = new Map<
        number,
        { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
    >();

    proc.stdout.on('data', (chunk) => {
        buffer += String(chunk);
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.trim()) continue;
            let message: any;
            try {
                message = JSON.parse(line);
            } catch {
                pollution.push(line);
                continue;
            }
            if (!isJsonRpcRecord(message)) {
                pollution.push(line);
                continue;
            }
            if (typeof message?.id !== 'number') continue;
            const waiter = pending.get(message.id);
            if (!waiter) continue;
            pending.delete(message.id);
            clearTimeout(waiter.timer);
            waiter.resolve(message);
        }
    });
    proc.stderr.on('data', (chunk) => {
        stderr += String(chunk);
    });
    proc.on('close', (code) => {
        for (const [id, waiter] of pending) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error(`MCP stdio exited with ${code} while waiting for response ${id}: ${stderr.slice(-2000)}`));
        }
        pending.clear();
    });

    const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<any> => {
        const id = nextId++;
        const promise = new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Timed out waiting for MCP ${method}: ${stderr.slice(-2000)}`));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
        });
        proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        return promise;
    };

    try {
        const initialize = await send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'sci-local-production-dogfood', version: '1.0.0' },
        });
        if (initialize.error) throw new Error(`MCP initialize failed: ${JSON.stringify(initialize.error)}`);
        proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);

        const listed = await send('tools/list');
        if (listed.error) throw new Error(`MCP tools/list failed: ${JSON.stringify(listed.error)}`);
        const names = (listed.result?.tools ?? []).map((tool: any) => String(tool.name));
        for (const required of ['read_file', 'text_search', 'patch_checks_in_snapshot', 'safe_write']) {
            if (!names.includes(required)) throw new Error(`Installed MCP package is missing ${required}`);
        }

        const readResponse = await send('tools/call', {
            name: 'read_file',
            arguments: { path: 'README.md', range: { startLine: 1, endLine: 6 } },
        });
        if (readResponse.error) throw new Error(`MCP read_file failed: ${JSON.stringify(readResponse.error)}`);
        const contentText = readResponse.result?.content?.[0]?.text;
        const readPayload = parseJsonOutput(String(contentText ?? ''), 'MCP read_file content');
        if (!String(readPayload.content ?? '').includes('packaged runtime dogfood target')) {
            throw new Error('Installed MCP read_file returned the wrong target content');
        }
        return {
            initialize: { protocolVersion: initialize.result?.protocolVersion, serverInfo: initialize.result?.serverInfo },
            toolsListed: names.length,
            requiredTools: ['read_file', 'text_search', 'patch_checks_in_snapshot', 'safe_write'],
            readFile: { path: readPayload.path, matchedTarget: true },
            stdoutClean: true,
        };
    } finally {
        for (const waiter of pending.values()) clearTimeout(waiter.timer);
        pending.clear();
        proc.stdin.end();
        await new Promise<void>((resolveClose, rejectClose) => {
            let termTimer: ReturnType<typeof setTimeout> | undefined;
            let killTimer: ReturnType<typeof setTimeout> | undefined;
            const finish = () => {
                if (termTimer) clearTimeout(termTimer);
                if (killTimer) clearTimeout(killTimer);
                resolveClose();
            };
            proc.once('close', finish);
            proc.once('error', rejectClose);
            termTimer = setTimeout(() => {
                proc.kill('SIGTERM');
                killTimer = setTimeout(() => {
                    if (proc.exitCode === null) proc.kill('SIGKILL');
                }, 1000);
            }, 5000);
        });
        if (buffer.trim()) {
            try {
                const trailing = JSON.parse(buffer);
                if (!isJsonRpcRecord(trailing)) pollution.push(buffer);
            } catch {
                pollution.push(buffer);
            }
        }
        if (pollution.length) throw new Error(`MCP stdio polluted stdout: ${pollution.join(' | ')}`);
    }
}

async function main(): Promise<boolean> {
    mkdirSync(dirname(evidencePath), { recursive: true });
    rmSync(installRoot, { recursive: true, force: true });
    mkdirSync(join(targetRoot, 'src'), { recursive: true });
    writeFileSync(join(installRoot, 'package.json'), '{"name":"sci-local-production-install","private":true}\n');
    writeFileSync(join(targetRoot, 'README.md'), '# packaged runtime dogfood target\n\nTrusted local fixture.\n');
    writeFileSync(join(targetRoot, 'src/example.ts'), 'export const packagedRuntimeMarker = 42;\n');

    const artifactBuild = run('bun', ['run', 'scripts/build-local-production-artifact.ts', '--json']);
    const artifactManifest = parseJsonOutput(artifactBuild.stdout, 'artifact builder');
    const artifactPath = resolve(repoRoot, artifactManifest.artifact.path);

    run('bun', ['add', '--cwd', installRoot, '--no-save', '--production', '--ignore-scripts', artifactPath]);
    const cliBin = join(installRoot, 'node_modules/.bin/semantic-code-intelligence');
    const shortCliBin = join(installRoot, 'node_modules/.bin/sci');
    const mcpBin = join(installRoot, 'node_modules/.bin/semantic-code-mcp');
    const env = {
        ...process.env,
        SEMANTIC_CODE_WORKSPACE: targetRoot,
        WORKSPACE_ROOT: targetRoot,
        SILENT_MODE: 'true',
        STDIO_MODE: 'true',
        MCP_LOG_DIR: join(targetRoot, '.ontology/logs'),
    };

    const before = sourceDigest();
    const version = run(cliBin, ['--version'], { cwd: targetRoot, env }).stdout;
    const shortVersion = run(shortCliBin, ['--version'], { cwd: targetRoot, env }).stdout;
    const read = parseCliToolOutput(
        run(cliBin, ['workflow', 'read_file', '--args', '{"path":"README.md","range":{"startLine":1,"endLine":6}}', '--json'], {
            cwd: targetRoot,
            env,
        }).stdout,
        'installed CLI read_file'
    );
    if (!String(read.content ?? '').includes('packaged runtime dogfood target')) {
        throw new Error('Installed CLI read_file returned the wrong target content');
    }
    const search = parseCliToolOutput(
        run(
            cliBin,
            ['workflow', 'text_search', '--args', '{"query":"packagedRuntimeMarker","path":"src","maxResults":5}', '--json'],
            { cwd: targetRoot, env }
        ).stdout,
        'installed CLI text_search'
    );
    if (!(Number(search.count) >= 1)) throw new Error('Installed CLI text_search did not find the target marker');

    const mcp = await dogfoodMcp(mcpBin, env);
    const after = sourceDigest();
    if (before !== after) throw new Error('Packaged-runtime dogfood mutated source outside the declared .ontology runtime state');
    const stateEntries = runtimeStateEntries();

    const candidateReady = Boolean(artifactManifest.source.trackedClean);
    const evidence = {
        schema: 'semantic-code-intelligence.local_production_candidate.v1',
        ok: true,
        candidateReady,
        artifact: artifactManifest.artifact,
        source: artifactManifest.source,
        installation: { isolated: true, source: relative(repoRoot, artifactPath), lifecycleScriptsIgnored: true },
        calls: {
            cli: {
                version,
                shortAliasVersion: shortVersion,
                readFile: { path: read.path, matchedTarget: true },
                textSearch: { count: search.count, capped: search.capped ?? false },
            },
            mcpStdio: mcp,
        },
        workspace: {
            rootInventoried: true,
            sourceUnchanged: true,
            sourceDigest: after,
            runtimeStateRoot: '.ontology',
            runtimeStateContained: stateEntries.length > 0,
            runtimeStateEntries: stateEntries,
        },
        proves: [
            'The canonical runtime tarball installs into an isolated local directory.',
            'Installed CLI and MCP stdio bins execute bounded calls against the configured target.',
            'MCP stdio keeps protocol stdout JSON-clean.',
            'Dogfood leaves the complete configured workspace source tree outside declared .ontology runtime state byte-identical.',
            'Repeated archive creation produces the same per-file payload digest.',
        ],
        doesNotProve: [
            'No package, image, or service was published or deployed.',
            'HTTP, MCP HTTP, LSP, Docker, Compose, hosted, and multi-tenant production support remain outside this candidate.',
            'Trusted repository checks are not sandboxed hostile-code execution.',
            'No production availability or p95/p99 SLO is claimed.',
            'Dependency resolution is not a hermetic vendored closure.',
        ],
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    if (jsonMode) process.stdout.write(`${JSON.stringify(evidence)}\n`);
    else {
        process.stdout.write(`local-production-dogfood: ok\n`);
        process.stdout.write(`candidate-ready: ${candidateReady}\n`);
        process.stdout.write(`evidence: ${relative(repoRoot, evidencePath)}\n`);
    }
    return candidateReady;
}

try {
    const candidateReady = await main();
    if (!candidateReady && !allowDirtySource) {
        process.stderr.write('local-production-dogfood: packaged runtime passed, but candidate readiness requires a tracked-clean source commit\n');
        process.exitCode = 1;
    }
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(
        evidencePath,
        `${JSON.stringify(
            {
                schema: 'semantic-code-intelligence.local_production_candidate.v1',
                ok: false,
                candidateReady: false,
                error: message,
            },
            null,
            2
        )}\n`,
        { mode: 0o600 }
    );
    process.stderr.write(`local-production-dogfood: ${message}\n`);
    process.exit(1);
} finally {
    if (!keepInstall) rmSync(installRoot, { recursive: true, force: true });
}
