export type RecommendChecksArgs = Record<string, any>;

export function shellQuote(value: string): string {
    return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function shellQuoteIfNeeded(value: string): string {
    const raw = String(value);
    return /^[A-Za-z0-9_./:@+-]+$/.test(raw) ? raw : shellQuote(raw);
}

export function bunTestCommandForFile(file: string): string {
    const rendered = String(file).startsWith('-') ? shellQuote(file) : shellQuoteIfNeeded(file);
    return String(file).startsWith('-') ? `bun test -- ${rendered}` : `bun test ${rendered}`;
}

function stripUnifiedHeaderMetadata(rawPath: string): string {
    const raw = String(rawPath || '').trim();
    const tab = raw.indexOf('\t');
    if (tab >= 0) return raw.slice(0, tab).trim();
    const timestamp = /^(.*?)\s+\d{4}-\d{2}-\d{2}(?:\s|T|$)/.exec(raw);
    return timestamp?.[1]?.trim() || raw;
}

export function extractFilesFromPatch(patch: string): string[] {
    const files = new Set<string>();
    for (const line of patch.split(/\r?\n/)) {
        const match = /^(?:\+\+\+|---)\s+(?:a\/|b\/)?(.+)$/.exec(line.trim());
        if (!match) continue;
        const file = stripUnifiedHeaderMetadata(match[1] || '');
        if (!file || file === '/dev/null') continue;
        files.add(file);
    }
    return [...files].sort();
}

export function classifyPatchRisk(patch: string) {
    const files = new Set<string>();
    let deletions = 0;
    for (const line of patch.split(/\r?\n/)) {
        let m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (m) {
            files.add(m[1]);
            files.add(m[2]);
        }
        m = line.match(/^\+\+\+\s+b\/(.+)$/) || line.match(/^---\s+a\/(.+)$/);
        if (m) files.add(m[1]);
        if (line.startsWith('deleted file mode') || line.startsWith('*** Delete File:')) deletions += 1;
    }
    const list = Array.from(files).filter((file) => file !== '/dev/null');
    const docsOnly = list.length > 0 && list.every((file) => /(^docs\/|\.md$)/.test(file));
    const testsOnly = list.length > 0 && list.every((file) => /(^tests\/|\.test\.|\.spec\.)/.test(file));
    const source = list.some((file) => /^src\//.test(file));
    const level = deletions > 0 || list.length > 10 ? 'high' : source ? 'medium' : 'low';
    return {
        level,
        category: docsOnly ? 'docs_only' : testsOnly ? 'tests_only' : source ? 'source_change' : 'mixed_change',
        files: list,
        fileCount: list.length,
        deletions,
    };
}

export function normalizeRecommendationFiles(args: RecommendChecksArgs): string[] {
    const explicit = Array.isArray(args?.files) ? args.files.filter((file: any) => typeof file === 'string') : [];
    const patchFiles = typeof args?.patch === 'string' ? extractFilesFromPatch(args.patch) : [];
    return [...new Set([...explicit, ...patchFiles].map((file) => file.trim()).filter(Boolean))].sort();
}

export function hasGraphImpact(impactSummary: any): boolean {
    const counts = impactSummary?.counts && typeof impactSummary.counts === 'object' ? impactSummary.counts : {};
    return ['imports', 'exports', 'callers', 'callees'].some((edge) => Number(counts?.[edge] || 0) > 0);
}

