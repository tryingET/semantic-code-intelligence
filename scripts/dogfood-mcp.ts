#!/usr/bin/env bun
/**
 * Dogfood (stdio MCP) quick workflow with ms timings.
 * Steps:
 *  - explore_codebase (off/on)
 *  - plan_rename (preview)
 *  - get_snapshot + propose_patch (no run_checks by default)
 * Optional (--full): run workflow_quick_patch_checks with build:tsc.
 */

import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { createDefaultCoreConfig } from '../src/adapters/utils.js';
import { createCodeAnalyzer } from '../src/core/index';

type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean };

function ms(now: number) { return `${now}ms`; }
function t0(map: Record<string, number>, key: string) { map[key] = Date.now(); }
function t1(map: Record<string, number>, key: string) { map[key] = Date.now() - map[key]; }
function log(msg: string) { console.log(`[dogfood] ${msg}`); }

async function parse(res: ToolResult): Promise<any> {
  const txt = res?.content?.[0]?.text;
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return txt; }
}

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const fileArgIdx = Math.max(args.indexOf('--file'), args.indexOf('-f'));
  const symArgIdx = Math.max(args.indexOf('--symbol'), args.indexOf('-s'));
  const wsArgIdx = Math.max(args.indexOf('--workspace'), args.indexOf('-w'));
  const file = fileArgIdx >= 0 ? args[fileArgIdx + 1] : 'tests/fixtures/example.ts';
  const symbol = symArgIdx >= 0 ? args[symArgIdx + 1] : 'TestClass';
  const workspaceRoot = wsArgIdx >= 0 ? args[wsArgIdx + 1] : 'tests/fixtures';
  const renameTarget = 'TestFunction';

  const cfg = createDefaultCoreConfig();
  // Keep this fast and deterministic using current config knobs
  (cfg.layers as any).layer1.timeout = 1500;
  (cfg.layers as any).layer2.timeout = 100; // AST budget
  process.env.CI = process.env.CI || '1';
  // Suppress periodic monitoring logs during script run
  process.env.SILENT_MODE = '1';

  // Ensure snapshot materialization respects bounded workspace
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.ONTOLOGY_WORKSPACE = workspaceRoot;
  const analyzer = await createCodeAnalyzer({ ...cfg, workspaceRoot });
  await analyzer.initialize();
  const mcp = new MCPAdapter(analyzer);

  const times: Record<string, number> = {};

  // explore_codebase (off)
  log(`explore_codebase (conceptual=false), file=${file}, symbol=${symbol} ...`);
  t0(times, 'explore_off');
  const off = await mcp.handleToolCall('explore_codebase', { symbol, file, conceptual: false });
  t1(times, 'explore_off');
  const offParsed = await parse(off);
  log(`done in ${ms(times['explore_off'])}: defs=${offParsed?.definitions?.length ?? 0}, refs=${offParsed?.references?.length ?? 0}`);

  // explore_codebase (on)
  process.env.L4_AUGMENT_EXPLORE = '1';
  log('explore_codebase (conceptual=true) ...');
  t0(times, 'explore_on');
  const on = await mcp.handleToolCall('explore_codebase', { symbol, file, conceptual: true });
  t1(times, 'explore_on');
  const onParsed = await parse(on);
  log(`done in ${ms(times['explore_on'])}: defs=${onParsed?.definitions?.length ?? 0}, refs=${onParsed?.references?.length ?? 0}`);

  // plan_rename preview
  log(`plan_rename preview: ${renameTarget} -> ${renameTarget}X ...`);
  t0(times, 'plan_rename');
  const plan = await mcp.handleToolCall('plan_rename', { oldName: renameTarget, newName: `${renameTarget}X`, file, dryRun: true });
  t1(times, 'plan_rename');
  const planParsed = await parse(plan);
  const planFiles = Object.keys(planParsed?.changes || {}).length;
  const planEdits = Object.values(planParsed?.changes || {}).reduce((a: number, v: any) => a + (Array.isArray(v) ? v.length : 0), 0);
  log(`done in ${ms(times['plan_rename'])}: files=${planFiles}, edits=${planEdits}`);

  // get_snapshot + propose_patch (no checks)
  log('get_snapshot ...');
  const snap = await mcp.handleToolCall('get_snapshot', { preferExisting: true });
  const snapParsed = await parse(snap);
  const snapshotId = snapParsed?.id || snapParsed?.snapshot || snapParsed; // accept simple shape
  log(`snapshot id: ${snapshotId}`);

  const patch = `*** Begin Patch\n*** Update File: tests/fixtures/example.ts\n@@\n export class TestClass {\n-    private value: number = 0;\n+    // dogfood: noop comment\n+    private value: number = 0;\n*** End Patch\n`;
  log('propose_patch (no checks) ...');
  t0(times, 'propose_patch');
  const stage = await mcp.handleToolCall('propose_patch', { snapshot: snapshotId, patch });
  t1(times, 'propose_patch');
  const stageParsed = await parse(stage);
  log(`done in ${ms(times['propose_patch'])}: accepted=${!!stageParsed?.accepted}`);

  // Optional full checks (fast default)
  if (full) {
    log('workflow_quick_patch_checks (build:tsc) ...');
    t0(times, 'quick_checks');
    const quick = await mcp.handleToolCall('workflow_quick_patch_checks', { patch, commands: ['bun run build:tsc'], timeoutSec: 180 });
    t1(times, 'quick_checks');
    const quickParsed = await parse(quick);
    log(`done in ${ms(times['quick_checks'])}: ok=${!!quickParsed?.ok}, snapshot=${quickParsed?.snapshot}`);
  }

  // Summary
  console.log(JSON.stringify({
    timingsMs: times,
    explore: {
      off: { defs: offParsed?.definitions?.length ?? 0, refs: offParsed?.references?.length ?? 0 },
      on: { defs: onParsed?.definitions?.length ?? 0, refs: onParsed?.references?.length ?? 0 },
    },
    planRename: { files: planFiles, totalEdits: planEdits },
    proposedPatch: { accepted: !!stageParsed?.accepted, snapshot: snapshotId },
  }, null, 2));
  try { await (analyzer as any)?.dispose?.(); } catch {}
}

main().catch((e) => {
  console.error('[dogfood] failed:', e);
  process.exit(1);
});
