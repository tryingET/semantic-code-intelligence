#!/usr/bin/env bun
/**
 * Dogfood (HTTP Alpha tools) CI runner
 * - Starts a local HTTP server on a test port with a bounded workspace
 * - Exercises only the Alpha MVP /api/v1/tools/call membrane:
 *   1) find_definition, find_references, graph_expand
 *   2) safe_write preview (no working-tree mutation)
 *   3) patch_checks_in_snapshot
 * - Prints a concise JSON summary to stdout
 */

type ToolCallArgs = { name: string; arguments?: Record<string, any> };

async function postJson(url: string, payload: any): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { _httpStatus: res.status, ...(body || {}) };
}

async function callTool(base: string, args: ToolCallArgs): Promise<any> {
  const body = await postJson(`${base}/api/v1/tools/call`, args);
  if (body?.success === false) {
    return { ok: false, error: body?.error || { message: 'tool call failed' }, status: body?._httpStatus };
  }
  return body?.result ?? body;
}

async function main() {
  const workspaceRoot = process.env.WORKSPACE_ROOT || 'tests/fixtures';
  process.env.CI = process.env.CI || '1';
  process.env.SILENT_MODE = '1';
  process.env.STDIO_MODE = process.env.STDIO_MODE || '1';

  const host = '127.0.0.1';
  const port = Number(process.env.DOGFOOD_HTTP_PORT || 7051);
  process.env.HTTP_API_PORT = String(port);
  const { HTTPServer } = await import('../src/servers/http.js');
  const server = new HTTPServer({ host, port, workspaceRoot, enableOpenAPI: false });
  await server.start();

  const base = `http://${host}:${port}`;
  const file = 'example.ts';
  const symbol = 'TestClass';

  const timings: Record<string, number> = {};
  const t0 = (k: string) => (timings[k] = Date.now());
  const t1 = (k: string) => (timings[k] = Date.now() - timings[k]);

  t0('find_definition');
  const definition = await callTool(base, {
    name: 'find_definition',
    arguments: { symbol, file, precise: true, maxResults: 20 },
  });
  t1('find_definition');

  t0('find_references');
  const references = await callTool(base, {
    name: 'find_references',
    arguments: { symbol, file, includeDeclaration: true, maxResults: 50 },
  });
  t1('find_references');

  t0('graph_expand');
  const graph = await callTool(base, {
    name: 'graph_expand',
    arguments: { file, edges: ['imports', 'exports'], depth: 1, limit: 50 },
  });
  t1('graph_expand');

  const patch = [
    '*** Begin Patch',
    '*** Update File: example.ts',
    '@@',
    ' export class TestClass {',
    '     // mcp unified apply_after_checks test',
    '-    private value: number = 0;',
    '+    /* ci: noop */',
    '+    private value: number = 0;',
    '*** End Patch',
    '',
  ].join('\n');

  t0('safe_write');
  const safeWrite = await callTool(base, {
    name: 'safe_write',
    arguments: { patch, commands: ['true'], timeoutSec: 60, apply: false, brief: true },
  });
  t1('safe_write');

  t0('patch_checks');
  const patchResult = await callTool(base, {
    name: 'patch_checks_in_snapshot',
    arguments: { patch, commands: ['true'], timeoutSec: 60 },
  });
  t1('patch_checks');

  let metrics: any = {};
  try {
    const m = await fetch(`${base}/metrics?format=json`).then((r) => r.json());
    metrics = {
      l1: m?.l1?.layer
        ? {
            p50: m.l1.layer.p50ResponseTime ?? 0,
            p95: m.l1.layer.p95ResponseTime ?? 0,
            p99: m.l1.layer.p99ResponseTime ?? 0,
            searches: m.l1.layer.searches ?? 0,
            errors: m.l1.layer.errors ?? 0,
          }
        : {},
      l2: m?.l2
        ? {
            p50: m.l2.p50 ?? 0,
            p95: m.l2.p95 ?? 0,
            p99: m.l2.p99 ?? 0,
            count: m.l2.count ?? 0,
            errors: m.l2.errors ?? 0,
          }
        : {},
    };
  } catch {
    metrics = {};
  }

  const toolCounts = {
    find_definition: 1,
    find_references: 1,
    graph_expand: 1,
    safe_write: 1,
    patch_checks_in_snapshot: 1,
  };

  const summary = {
    schemaVersion: 1,
    meta: {
      ci: String(process.env.CI || '') === '1',
      workspaceRoot,
      host,
      port,
    },
    timingsMs: timings,
    metrics,
    toolCounts,
    navigation: {
      definitions: definition?.definitions?.length ?? definition?.count ?? 0,
      references: references?.references?.length ?? references?.count ?? 0,
      graphNodes: Object.keys(graph?.neighbors || {}).reduce((a: number, k: string) => a + ((graph?.neighbors?.[k] || []).length), 0),
    },
    safeWrite: {
      ok: !!safeWrite?.ok,
      snapshot: safeWrite?.snapshot || null,
      applied: !!safeWrite?.applied,
    },
    patchChecks: {
      ok: !!patchResult?.ok,
      snapshot: patchResult?.snapshot || null,
    },
  };

  await server.stop();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err?.message || err) }));
  process.exit(1);
});
