#!/usr/bin/env bun
/**
 * Aggregate analysis across slice artifacts.
 * Usage: bun run scripts/analyze-slices.ts [slicesDir]
 * Expects structure like: slices/slice-1/.test-results/batch-report.jsonl
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

type BatchRec = {
  batch: number
  start: number
  end: number
  duration_ms: number
  exit_code: number
  files?: string[]
  _slice?: string
}

function findFiles(dir: string, name: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent)
    try {
      const st = statSync(p)
      if (st.isDirectory()) findFiles(p, name, out)
      else if (ent === name) out.push(p)
    } catch {}
  }
  return out
}

function parseJsonl(path: string, slice: string): BatchRec[] {
  const text = readFileSync(path, 'utf8')
  const out: BatchRec[] = []
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try {
      const obj = JSON.parse(s)
      if (typeof obj?.duration_ms === 'number') {
        obj._slice = slice
        out.push(obj)
      }
    } catch {}
  }
  return out
}

function human(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 100) / 10
  return `${s}s`
}

async function main() {
  const slicesRoot = process.argv[2] || 'slices'
  let batchFiles = findFiles(slicesRoot, 'batch-report.jsonl')
  if (batchFiles.length === 0) {
    console.log('\n## Aggregate Slice Analysis\n- No slice batch-report artifacts found')
    return
  }

  let all: BatchRec[] = []
  for (const f of batchFiles) {
    const m = f.match(/slices\/(.+?)\//)
    const slice = m?.[1] || 'unknown'
    all = all.concat(parseJsonl(f, slice))
  }
  if (all.length === 0) {
    console.log('\n## Aggregate Slice Analysis\n- No batches parsed')
    return
  }

  const totalBatches = all.length
  const totalMs = all.reduce((a, r) => a + (r.duration_ms || 0), 0)
  const avgMs = Math.round(totalMs / totalBatches)
  const top = [...all].sort((a, b) => b.duration_ms - a.duration_ms).slice(0, 10)

  const fileCounts = new Map<string, number>()
  for (const r of top) for (const f of r.files || []) fileCounts.set(f, (fileCounts.get(f) || 0) + 1)
  const hotFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)

  let out = ''
  out += `\n## Aggregate Slice Analysis` + `\n`
  out += `- Slice batch files: ${batchFiles.length}` + `\n`
  out += `- Batches: ${totalBatches}, Total: ${human(totalMs)}, Avg: ${human(avgMs)}` + `\n`
  out += `\n**Slowest Batches (top 10)**` + `\n`
  for (const r of top) {
    const files = r.files?.length ?? (r.end - r.start)
    out += `- [${r._slice}] Batch ${r.batch} [${r.start}-${r.end}] · files ${files} · ${human(r.duration_ms)} · exit ${r.exit_code}` + `\n`
  }
  if (hotFiles.length) {
    out += `\n**Hot Files Across Slowest Batches**` + `\n`
    for (const [f, c] of hotFiles) out += `- (${c}) ${f}` + `\n`
  }
  console.log(out)

  // Warnings for slow batches across slices
  const warnMs = Number.parseInt(process.env.WARN_MS || process.env.BATCH_WARN_MS || '', 10)
  const threshold = Number.isFinite(warnMs) && warnMs > 0 ? warnMs : 0
  if (threshold > 0) {
    const slow = all.filter(r => (r.duration_ms || 0) >= threshold)
    if (slow.length) {
      console.log(`\n**Warnings (>${threshold}ms)**`)
      for (const r of slow.slice(0, 20)) {
        console.log(`- [${r._slice}] Batch ${r.batch} · ${human(r.duration_ms)} (start ${r.start} end ${r.end})`)
        console.log(`::warning title=Slow batch (aggregate)::slice=${r._slice} batch=${r.batch} duration=${r.duration_ms}ms threshold=${threshold}ms`)
      }
      const warnMax = Number.parseInt(process.env.WARN_MAX || process.env.BATCH_WARN_MAX || '', 10)
      const failOnSlow = process.env.FAIL_ON_SLOW === '1'
      if (Number.isFinite(warnMax) && warnMax >= 0 && slow.length > warnMax) {
        console.error(`Exceeded WARN_MAX=${warnMax} slow batches across slices (${slow.length}).`)
        if (failOnSlow) process.exit(1)
      }
    }
  }
}

main()
