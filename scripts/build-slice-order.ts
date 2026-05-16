#!/usr/bin/env bun
/**
 * Build a balanced slice ordering for tests based on recent batch history.
 *
 * Inputs:
 *  --base-list <path>       A newline-delimited list of absolute/relative test file paths to consider
 *  --slices <N>             Total number of slices (required)
 *  --slice <K>              1-based slice index to materialize (required)
 *  --history-dir <dir> ...  One or more directories to search recursively for batch-report.jsonl files
 *  --hot-slice              If set, reserve the last slice exclusively for hot files
 *  --hot-top <N>            Top N hot files (by weight) to assign to the hot slice (default 0)
 *
 * Output:
 *  Prints test file paths (one per line) that should belong to the selected slice.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

type BatchRec = {
  duration_ms?: number;
  files?: string[];
};

function parseArgs() {
  const args = new Map<string, string | boolean | string[]>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hot-slice') {
      args.set('hot-slice', true);
      continue;
    }
    const next = i + 1 < argv.length ? argv[i + 1] : '';
    if (a === '--base-list' || a === '--slices' || a === '--slice' || a === '--hot-top') {
      args.set(a.slice(2), next);
      i++;
    } else if (a === '--history-dir') {
      const cur = (args.get('history-dir') as string[]) || [];
      cur.push(next);
      args.set('history-dir', cur);
      i++;
    }
  }
  return args;
}

function findHistoryFiles(dirs: string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    if (!d) continue;
    const dir = resolve(d);
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const p = stack.pop()!;
      let ents: string[] = [];
      try { ents = readdirSync(p).map(e => join(p, e)); } catch { continue; }
      for (const e of ents) {
        try {
          const st = statSync(e);
          if (st.isDirectory()) stack.push(e);
          else if (e.endsWith('batch-report.jsonl')) out.push(e);
        } catch {}
      }
    }
  }
  return out;
}

function parseJsonl(path: string): BatchRec[] {
  try {
    const text = readFileSync(path, 'utf8');
    const out: BatchRec[] = [];
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s)); } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

function loadBaseList(path: string): string[] {
  try {
    const text = readFileSync(path, 'utf8');
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const args = parseArgs();
  const baseListPath = String(args.get('base-list') || '');
  const slices = Number(args.get('slices') || 0);
  const slice = Number(args.get('slice') || 0);
  const hotTop = Math.max(0, Number(args.get('hot-top') || 0));
  const hotSlice = !!args.get('hot-slice');
  const historyDirs = (args.get('history-dir') as string[]) || [];

  if (!baseListPath || !existsSync(baseListPath) || !Number.isFinite(slices) || !Number.isFinite(slice) || slices < 1 || slice < 1 || slice > slices) {
    return; // print nothing, caller will fallback
  }

  const base = loadBaseList(baseListPath).map(p => resolve(p));
  if (base.length === 0) return;

  // Accumulate weights per file from history
  const weights = new Map<string, number>();
  const files = findHistoryFiles(historyDirs.length ? historyDirs : ['.test-results']);
  for (const f of files) {
    for (const rec of parseJsonl(f)) {
      const dur = Number(rec.duration_ms || 0);
      const list = Array.isArray(rec.files) ? rec.files : [];
      const denom = list.length || 1;
      const perFile = dur / denom;
      for (const fp of list) {
        const abspath = resolve(fp);
        // Only track files present in base list
        if (!base.includes(abspath)) continue;
        weights.set(abspath, (weights.get(abspath) || 0) + perFile);
      }
    }
  }

  // Build ordered list: heavy -> light, missing history at the end
  const withW = base.map(f => ({ f, w: weights.get(resolve(f)) || 0 }));
  withW.sort((a, b) => b.w - a.w);

  // Optional: move top-N to last slice exclusively
  let hot: string[] = [];
  let rest: string[] = withW.map(x => x.f);
  if (hotSlice && hotTop > 0 && slices > 1) {
    hot = rest.slice(0, hotTop);
    rest = rest.slice(hotTop);
  }

  // Assign by round-robin from heavy->light ensuring spread
  const buckets: string[][] = Array.from({ length: slices }, () => []);
  if (hot.length && slices > 1) {
    // Place hot files in the last slice
    buckets[slices - 1].push(...hot);
    // Distribute the rest across the remaining slices
    for (let i = 0; i < rest.length; i++) {
      const b = i % (slices - 1);
      buckets[b].push(rest[i]);
    }
  } else {
    for (let i = 0; i < rest.length; i++) {
      const b = i % slices;
      buckets[b].push(rest[i]);
    }
  }

  // Print the selected slice as relative paths when possible
  const selected = buckets[slice - 1];
  for (const p of selected) {
    // Preserve original (possibly relative) path from base list
    // Attempt to find matching entry in base (not normalized)
    const orig = base.find(b => resolve(b) === resolve(p)) || p;
    console.log(orig);
  }
}

main();

