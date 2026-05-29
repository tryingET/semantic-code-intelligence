#!/usr/bin/env bun
/**
 * Dogfood (stdio MCP) quick workflow with ms timings.
 * Steps:
 *  - find_definition + find_references + graph_expand
 *  - rename_safely (preview)
 *  - get_snapshot + propose_patch (no run_checks by default)
 * Optional (--full): run patch_checks_in_snapshot with typecheck.
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
  process.env.SEMANTIC_CODE_WORKSPACE = workspaceRoot;
  const analyzer = await createCodeAnalyzer({ ...cfg, workspaceRoot });
  await analyzer.initialize();
  const mcp = new MCPAdapter(analyzer);

  const times: Record<string, number> = {};

  log(`find_definition, file=${file}, symbol=${symbol} ...`);
  t0(times, 'find_definition');
  const definition = await mcp.handleToolCall('find_definition', { symbol, file, maxResults: 20, precise: true });
  t1(times, 'find_definition');
  const definitionParsed = await parse(definition);
  log(`done in ${ms(times['find_definition'])}: candidates=${definitionParsed?.results?.length ?? definitionParsed?.definitions?.length ?? 0}`);

  log('find_references ...');
  t0(times, 'find_references');
  const references = await mcp.handleToolCall('find_references', { symbol, file, includeDeclaration: true, maxResults: 50 });
  t1(times, 'find_references');
  const referencesParsed = await parse(references);
  log(`done in ${ms(times['find_references'])}: candidates=${referencesParsed?.results?.length ?? referencesParsed?.references?.length ?? 0}`);

  log('graph_expand ...');
  t0(times, 'graph_expand');
  const graph = await mcp.handleToolCall('graph_expand', { symbol, file, edges: ['imports', 'exports', 'callers', 'callees'], depth: 1, limit: 50 });
  t1(times, 'graph_expand');
  const graphParsed = await parse(graph);
  log(`done in ${ms(times['graph_expand'])}: neighbors=${graphParsed?.neighbors?.length ?? 0}`);

  log(`rename_safely preview: ${renameTarget} -> ${renameTarget}X ...`);
  t0(times, 'rename_safely');
  const plan = await mcp.handleToolCall('rename_safely', { oldName: renameTarget, newName: `${renameTarget}X`, file, runChecks: false });
  t1(times, 'rename_safely');
  const planParsed = await parse(plan);
  const planFiles = Array.isArray(planParsed?.affectedFiles) ? planParsed.affectedFiles.length : Object.keys(planParsed?.changes || {}).length;
  const planEdits = typeof planParsed?.edits === 'number' ? planParsed.edits : Object.values(planParsed?.changes || {}).reduce((a: number, v: any) => a + (Array.isArray(v) ? v.length : 0), 0);
  log(`done in ${ms(times['rename_safely'])}: files=${planFiles}, edits=${planEdits}`);

  // get_snapshot + propose_patch (no checks)
  log('get_snapshot ...');
  const snap = await mcp.handleToolCall('get_snapshot', { preferExisting: true });
  const snapParsed = await parse(snap);
  const snapshotId = snapParsed?.id || snapParsed?.snapshot || snapParsed; // accept simple shape
  log(`snapshot id: ${snapshotId}`);

  const patch = [
    '*** Begin Patch',
    '*** Update File: tests/fixtures/example.ts',
    '@@',
    ' export class TestClass {',
    '     // mcp unified apply_after_checks test',
    '+    // dogfood: noop comment',
    '     private value: number = 0;',
    '*** End Patch',
    '',
  ].join('\n');
  log('propose_patch (no checks) ...');
  t0(times, 'propose_patch');
  const stage = await mcp.handleToolCall('propose_patch', { snapshot: snapshotId, patch });
  t1(times, 'propose_patch');
  const stageParsed = await parse(stage);
  log(`done in ${ms(times['propose_patch'])}: accepted=${!!stageParsed?.accepted}`);

  // Optional full checks (fast default)
  if (full) {
    log('patch_checks_in_snapshot (typecheck) ...');
    t0(times, 'quick_checks');
    const quick = await mcp.handleToolCall('patch_checks_in_snapshot', { patch, commands: ['bun run typecheck'], timeoutSec: 180 });
    t1(times, 'quick_checks');
    const quickParsed = await parse(quick);
    log(`done in ${ms(times['quick_checks'])}: ok=${!!quickParsed?.ok}, snapshot=${quickParsed?.snapshot}`);
  }

  // Summary
  console.log(JSON.stringify({
    timingsMs: times,
    navigation: {
      definitions: definitionParsed?.results?.length ?? definitionParsed?.definitions?.length ?? 0,
      references: referencesParsed?.results?.length ?? referencesParsed?.references?.length ?? 0,
      graphNeighbors: graphParsed?.neighbors?.length ?? 0,
    },
    renameSafely: { files: planFiles, totalEdits: planEdits },
    proposedPatch: { accepted: !!stageParsed?.accepted, snapshot: snapshotId },
  }, null, 2));
  try { await (analyzer as any)?.dispose?.(); } catch {}
}

main().catch((e) => {
  console.error('[dogfood] failed:', e);
  process.exit(1);
});
