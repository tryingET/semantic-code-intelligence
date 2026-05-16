#!/usr/bin/env bun
/**
 * Analyze batch-report.jsonl and print a concise markdown summary.
 * Usage: bun run scripts/analyze-batch-report.ts [.test-results/batch-report.jsonl]
 */

type BatchRec = {
  batch: number
  start: number
  end: number
  duration_ms: number
  exit_code: number
  files?: string[]
}

function parseJsonl(text: string): BatchRec[] {
  const out: BatchRec[] = []
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try {
      const obj = JSON.parse(s)
      if (typeof obj?.duration_ms === 'number') out.push(obj)
    } catch {
      // ignore bad lines
    }
  }
  return out
}

function human(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 100) / 10
  return `${s}s`
}

async function main() {
  const file = process.argv[2] || '.test-results/batch-report.jsonl'
  let text = ''
  try {
    text = await Bun.file(file).text()
  } catch {
    console.log('\n## Batch Analysis\n- No batch report found')
    return
  }
  const rows = parseJsonl(text)
  if (!rows.length) {
    console.log('\n## Batch Analysis\n- Empty or invalid batch report')
    return
  }

  const total = rows.length
  const totalMs = rows.reduce((a, r) => a + (r.duration_ms || 0), 0)
  const avgMs = Math.round(totalMs / total)
  const top = [...rows].sort((a, b) => b.duration_ms - a.duration_ms).slice(0, 5)

  // Hot files by frequency in slowest batches
  const fileCounts = new Map<string, number>()
  for (const r of top) {
    for (const f of r.files || []) {
      fileCounts.set(f, (fileCounts.get(f) || 0) + 1)
    }
  }
  const hotFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)

  let out = ''
  out += `\n## Batch Analysis` + `\n`
  out += `- Batches: ${total}, Total: ${human(totalMs)}, Avg: ${human(avgMs)}` + `\n`
  out += `\n**Slowest Batches (top 5)**` + `\n`
  for (const r of top) {
    const files = r.files?.length ?? (r.end - r.start)
    out += `- Batch ${r.batch} [${r.start}-${r.end}] · files ${files} · ${human(r.duration_ms)} · exit ${r.exit_code}` + `\n`
  }
  if (hotFiles.length) {
    out += `\n**Hot Files (appear in most slow batches)**` + `\n`
    for (const [f, c] of hotFiles) out += `- (${c}) ${f}` + `\n`
  }
  console.log(out)

  // Optional warnings for slow batches (GitHub Actions annotations)
  const warnMs = Number.parseInt(process.env.WARN_MS || process.env.BATCH_WARN_MS || '', 10)
  const threshold = Number.isFinite(warnMs) && warnMs > 0 ? warnMs : 0
  if (threshold > 0) {
    const slow = rows.filter(r => (r.duration_ms || 0) >= threshold)
    if (slow.length) {
      console.log(`\n**Warnings (>${threshold}ms)**`)
      for (const r of slow.slice(0, 10)) {
        console.log(`- Batch ${r.batch} · ${human(r.duration_ms)} (start ${r.start} end ${r.end})`)
        // GitHub Actions annotation
        console.log(`::warning title=Slow batch::batch=${r.batch} duration=${r.duration_ms}ms threshold=${threshold}ms`)
      }
      const warnMax = Number.parseInt(process.env.WARN_MAX || process.env.BATCH_WARN_MAX || '', 10)
      const failOnSlow = process.env.FAIL_ON_SLOW === '1'
      if (Number.isFinite(warnMax) && warnMax >= 0 && slow.length > warnMax) {
        console.error(`Exceeded WARN_MAX=${warnMax} slow batches (${slow.length}).`)
        if (failOnSlow) process.exit(1)
      }
    }
  }
}

main()
