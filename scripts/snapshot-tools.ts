#!/usr/bin/env bun
/** Snapshot helpers using overlayStore (stdio path).
 * Usage:
 *  bun run scripts/snapshot-tools.ts diff <id>
 *  bun run scripts/snapshot-tools.ts status <id>
 *  bun run scripts/snapshot-tools.ts progress <id>
 *  bun run scripts/snapshot-tools.ts apply <id> [--check]
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { overlayStore } from '../src/core/overlay-store.js';

async function ensureDir(id: string): Promise<string> {
  const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
  if (!ensure) throw new Error('overlayStore.ensureMaterialized unavailable');
  const dir = await ensure(id);
  if (!dir) throw new Error('Failed to materialize snapshot');
  return dir as string;
}

async function diff(id: string) {
  const dir = await ensureDir(id);
  const file = path.join(dir, 'overlay.diff');
  try {
    const text = await fs.readFile(file, 'utf8');
    console.log(text);
  } catch {
    console.log('# No overlay.diff found');
  }
}

async function status(id: string) {
  // There's no persisted index; show basic FS status
  const dir = await ensureDir(id);
  const hasDiff = await fs
    .access(path.join(dir, 'overlay.diff'))
    .then(() => true)
    .catch(() => false);
  console.log(JSON.stringify({ id, dir, hasDiff }, null, 2));
}



async function applySnap(id: string, check: boolean) {
  if (process.env.ALLOW_SNAPSHOT_APPLY !== '1') {
    console.error('apply disabled: set ALLOW_SNAPSHOT_APPLY=1');
    process.exit(3);
  }
  const { overlayStore } = await import('../src/core/overlay-store.js');
  const res = await overlayStore.applyToWorkingTree(id, { check });
  console.log(JSON.stringify(res, null, 2));
}

async function progress(id: string) {
  const snapsRoot = path.resolve('.ontology', 'snapshots');
  const p = path.join(snapsRoot, id, 'progress.log');
  try {
    const text = await fs.readFile(p, 'utf8');
    console.log(text);
  } catch {
    console.log('# No progress.log found');
  }
}

async function main() {
  const [cmd, id, flag] = process.argv.slice(2);
  if (!cmd || !id) {
    console.error('Usage: bun run scripts/snapshot-tools.ts <diff|status|progress|apply> <id> [--check]');
    process.exit(2);
  }
  if (cmd === 'diff') return diff(id);
  if (cmd === 'status') return status(id);
  if (cmd === 'progress') return progress(id);
  if (cmd === 'apply') return applySnap(id, flag == '--check')
  throw new Error(`Unknown cmd ${cmd}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
