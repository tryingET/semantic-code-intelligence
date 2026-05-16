#!/usr/bin/env bun
/**
 * Dogfood: Harden uriToPath() to support file://workspace and subpaths.
 * Flow: compute diff -> get_snapshot -> propose_patch -> run_checks (tsc) -> apply_snapshot.
 */

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { AnalyzerFactory } from '../src/core/index';

type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean };
async function parse(res: ToolResult): Promise<any> {
  const txt = res?.content?.[0]?.text;
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return txt; }
}

async function main() {
  const repoRoot = process.cwd();
  const targetRel = 'src/adapters/utils.ts';
  const targetAbs = path.join(repoRoot, targetRel);
  const original = await fs.readFile(targetAbs, 'utf8');

  // Prepare hardened content by patching uriToPath handling of file://workspace
  const marker = 'export function uriToPath(uri: string): string {';
  if (!original.includes(marker)) {
    throw new Error('Could not find uriToPath marker in utils.ts');
  }

  let hardened = original;
  if (!original.includes('const WORKSPACE_PREFIX =')) {
    hardened = hardened.replace(
      marker,
      `const WORKSPACE_PREFIX = 'file://workspace';\nfunction getWorkspaceRoot(): string {\n  return process.env.ONTOLOGY_WORKSPACE || process.env.WORKSPACE_ROOT || process.cwd();\n}\n\n${marker}`
    );
  }

  // Replace the body of uriToPath to handle workspace prefix
  const startIdx = hardened.indexOf(marker);
  const bodyStart = hardened.indexOf('{', startIdx) + 1;
  // naive search for the matching closing brace of the function
  let depth = 1, i = bodyStart;
  for (; i < hardened.length; i++) {
    const ch = hardened[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  const funcBody = `\n    // Handle special workspace prefix (file://workspace[/...])\n    if (uri.startsWith(WORKSPACE_PREFIX)) {\n        const ws = getWorkspaceRoot();\n        const sub = uri.length > WORKSPACE_PREFIX.length ? uri.substring(WORKSPACE_PREFIX.length) : '';\n        const rel = sub.replace(/^\/+/, '');\n        const p = rel ? path.join(ws, rel) : ws;\n        return path.resolve(p);\n    }\n    if (uri.startsWith('file://')) {\n        try {\n            return fileURLToPath(uri);\n        } catch {\n            // Fallback best-effort stripping for odd URIs\n            const body = uri.replace(/^file:\/\//, '');\n            return path.isAbsolute(body) ? body : path.resolve('/', body);\n        }\n    }\n    // Treat plain strings as file paths; resolve to absolute\n    return path.isAbsolute(uri) ? uri : path.resolve(process.cwd(), uri);\n  `;
  const hardened2 = hardened.slice(0, bodyStart) + funcBody + hardened.slice(i);

  // Write temp file and build a proper git diff
  const tmpDir = path.join(repoRoot, '.ontology', 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `utils.${randomUUID()}.ts`);
  await fs.writeFile(tmpPath, hardened2, 'utf8');
  const diffProc = spawnSync('bash', ['-lc', `git diff --no-index --src-prefix=a/ --dst-prefix=b/ -- ${JSON.stringify(targetAbs)} ${JSON.stringify(tmpPath)}`], { stdio: 'pipe' });
  let unified = String(diffProc.stdout || '');
  // Normalize paths in diff to repo-relative so git apply in snapshot can find files
  unified = unified.replace(/diff --git a\/.+?src\/adapters\/utils\.ts b\/.+?\n/, 'diff --git a/src/adapters/utils.ts b/src/adapters/utils.ts\n');
  unified = unified.replace(/--- a\/.+?utils\.ts\n/, '--- a/src/adapters/utils.ts\n');
  unified = unified.replace(/\+\+\+ b\/.+?utils\.ts\n/, '+++ b/src/adapters/utils.ts\n');
  if (!unified || !unified.includes('diff --git')) {
    throw new Error('Failed to construct unified diff');
  }

  // Stage via MCP and apply
  const created = await AnalyzerFactory.createAnalyzer({});
  const analyzer: any = created.analyzer;
  await analyzer.initialize();
  const mcp = new MCPAdapter(analyzer);

  const snap = await mcp.handleToolCall('get_snapshot', { preferExisting: true });
  const snapParsed = await parse(snap);
  const snapshotId = snapParsed?.snapshot || snapParsed?.id;
  if (!snapshotId) throw new Error('No snapshot id');

  const stage = await mcp.handleToolCall('propose_patch', { snapshot: snapshotId, patch: unified });
  const stageParsed = await parse(stage);
  if (!stageParsed?.accepted) throw new Error('propose_patch was not accepted');

  let checks = await mcp.handleToolCall('run_checks', { snapshot: snapshotId, commands: ['bun run build:tsc'], timeoutSec: 180 });
  let checksParsed = await parse(checks);
  if (!checksParsed?.ok) {
    // Add a quick fix for fs promises misuse in MCP adapter (existsSync/readFileSync -> async)
    const mcpFile = path.join(repoRoot, 'src/adapters/mcp-adapter.ts');
    const mcpOrig = await fs.readFile(mcpFile, 'utf8');
    let mcpNew = mcpOrig.replace(/fs\.existsSync\(([^)]+)\)/g, 'await fs.stat($1).then(() => true).catch(() => false)');
    mcpNew = mcpNew.replace(/fs\.readFileSync\(([^,]+),\s*'utf8'\)/g, 'await fs.readFile($1, "utf8")');
    const tmpMcp = path.join(tmpDir, `mcp.${randomUUID()}.ts`);
    await fs.writeFile(tmpMcp, mcpNew, 'utf8');
    const diff2 = spawnSync('bash', ['-lc', `git diff --no-index --src-prefix=a/ --dst-prefix=b/ -- ${JSON.stringify(mcpFile)} ${JSON.stringify(tmpMcp)}`], { stdio: 'pipe' });
    let unified2 = String(diff2.stdout || '');
    unified2 = unified2.replace(/diff --git a\/.+?src\/adapters\/mcp-adapter\.ts b\/.+?\n/, 'diff --git a/src/adapters/mcp-adapter.ts b/src/adapters/mcp-adapter.ts\n');
    unified2 = unified2.replace(/--- a\/.+?mcp-adapter\.ts\n/, '--- a/src/adapters/mcp-adapter.ts\n');
    unified2 = unified2.replace(/\+\+\+ b\/.+?mcp-adapter\.ts\n/, '+++ b/src/adapters/mcp-adapter.ts\n');
    if (!unified2.includes('diff --git')) throw new Error('Failed to construct unified diff for MCP adapter fix');
    const stage2 = await mcp.handleToolCall('propose_patch', { snapshot: snapshotId, patch: unified2 });
    const stage2Parsed = await parse(stage2);
    if (!stage2Parsed?.accepted) throw new Error('mcp adapter patch not accepted');
    // Re-run checks
    checks = await mcp.handleToolCall('run_checks', { snapshot: snapshotId, commands: ['bun run build:tsc'], timeoutSec: 180 });
    checksParsed = await parse(checks);
    if (!checksParsed?.ok) {
      console.error(checksParsed?.output || 'checks failed');
      throw new Error('run_checks failed after mcp adapter fix');
    }
  }

  // Allow apply for this process
  process.env.ALLOW_SNAPSHOT_APPLY = '1';
  const apply = await mcp.handleToolCall('apply_snapshot', { snapshot: snapshotId, check: false });
  const applyParsed = await parse(apply);
  if (!applyParsed || applyParsed.ok === false) {
    throw new Error('apply_snapshot failed');
  }

  console.log(JSON.stringify({ snapshotId, staged: true, checksOk: true, applied: true }, null, 2));
}

main().catch((e) => { console.error('dogfood-harden-path failed:', e); process.exit(1); });
