#!/usr/bin/env bun
/**
 * Dogfood (HTTP tools) CI runner
 * - Starts a local HTTP server on a test port with a bounded workspace
 * - Executes three primary flows via /api/v1/tools/call
 *   1) explore_symbol_impact (precise on) and explore_codebase (conceptual off/on)
 *   2) rename_safely (preview+snapshot with checks disabled for speed)
 *   3) patch_checks_in_snapshot (quick typecheck only)
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
  // Always return parsed body even on non-2xx; include status for diagnostics
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
  // Bounded, deterministic workspace
  const workspaceRoot = process.env.WORKSPACE_ROOT || 'tests/fixtures';
  process.env.CI = process.env.CI || '1';
  process.env.SILENT_MODE = '1';
  // Keep stdout reserved for the final JSON summary (avoid noisy logs)
  process.env.STDIO_MODE = process.env.STDIO_MODE || '1';

  // Start local HTTP server on a dedicated test port
  const host = '127.0.0.1';
  const port = Number(process.env.DOGFOOD_HTTP_PORT || 7051);
  process.env.HTTP_API_PORT = String(port);
  const { HTTPServer } = await import('../src/servers/http.js');
  const server = new HTTPServer({ host, port, workspaceRoot, enableOpenAPI: false });
  await server.start();

  const base = `http://${host}:${port}`;

  const file = 'tests/fixtures/example.ts';
  const symbol = 'TestClass';
  const renameTarget = 'TestFunction';

  const timings: Record<string, number> = {};
  const t0 = (k: string) => (timings[k] = Date.now());
  const t1 = (k: string) => (timings[k] = Date.now() - timings[k]);

  // 1) Explore flows
  t0('explore_symbol_impact');
  const exploreImpact = await callTool(base, {
    name: 'explore_symbol_impact',
    arguments: { symbol, file, precise: true, depth: 1, limit: 50 },
  });
  t1('explore_symbol_impact');

  t0('explore_codebase_off');
  const exploreOff = await callTool(base, {
    name: 'explore_codebase',
    arguments: { symbol, file, conceptual: false },
  });
  t1('explore_codebase_off');

  t0('explore_codebase_on');
  const exploreOn = await callTool(base, {
    name: 'explore_codebase',
    arguments: { symbol, file, conceptual: true },
  });
  t1('explore_codebase_on');

  // 2) Safe rename workflow (checks disabled for speed)
  t0('rename_safely');
  const renameResult = await callTool(base, {
    name: 'rename_safely',
    arguments: { oldName: renameTarget, newName: `${renameTarget}X`, file, runChecks: false, timeoutSec: 60 },
  });
  t1('rename_safely');

  // 3) Patch + checks (typecheck only)
  const patch = `*** Begin Patch\n*** Update File: tests/fixtures/example.ts\n@@\n export class TestClass {\n-    private value: number = 0;\n+    /* ci: noop */\n+    private value: number = 0;\n*** End Patch\n`;
  t0('patch_checks');
  const patchResult = await callTool(base, {
    name: 'patch_checks_in_snapshot',
    arguments: { patch, commands: ['bun run build:tsc'], timeoutSec: 120 },
  });
  t1('patch_checks');

  // Summaries
  // Metrics snapshot (L1/L2 p95 + counts)
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
    explore_symbol_impact: 1,
    explore_codebase: 2,
    rename_safely: 1,
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
    explore: {
      impact: {
        defs: exploreImpact?.definitions?.length ?? 0,
        neighbors: Object.keys(exploreImpact?.neighbors || {}).reduce((a: number, k: string) => a + ((exploreImpact?.neighbors?.[k] || []).length), 0),
      },
      off: {
        defs: exploreOff?.definitions?.length ?? 0,
        refs: exploreOff?.references?.length ?? 0,
      },
      on: {
        defs: exploreOn?.definitions?.length ?? 0,
        refs: exploreOn?.references?.length ?? 0,
      },
    },
    rename: {
      ok: !!renameResult?.ok || !!renameResult?.accepted || false,
      snapshot: renameResult?.snapshot || null,
      files: typeof renameResult?.changes === 'object' ? Object.keys(renameResult?.changes).length : undefined,
    },
    patchChecks: {
      ok: !!patchResult?.ok,
      snapshot: patchResult?.snapshot || null,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  await server.stop();
  // Ensure CI never hangs due to stray timers/handles (e.g., schedulers)
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[dogfood-ci] failed:', err);
  try {
    // Best-effort cleanup if server was started but not tracked
    await fetch('http://127.0.0.1:7051/health').then(() => {}).catch(() => {});
  } catch {}
  process.exit(1);
});
