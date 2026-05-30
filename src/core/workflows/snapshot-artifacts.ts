export function snapshotArtifactLinks(snapshot: string) {
    return {
        overlayDiff: `snapshot://${snapshot}/overlay.diff`,
        status: `snapshot://${snapshot}/status`,
        progress: `snapshot://${snapshot}/progress`,
    };
}

function shellQuote(value: string): string {
    return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function shellQuoteIfNeeded(value: string): string {
    const raw = String(value);
    return /^[A-Za-z0-9_./:@+-]+$/.test(raw) ? raw : shellQuote(raw);
}

function bunTestCommandForFile(file: string): string {
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

export function clampMaxBytes(value: unknown, fallback = 65_536): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(262_144, Math.floor(parsed))) : fallback;
}

export function truncateUtf8WholeCodePoints(text: string, maxBytes: number): { text: string; truncated: boolean } {
    let bytes = 0;
    let truncated = false;
    const out: string[] = [];
    for (const char of text) {
        const charBytes = Buffer.byteLength(char, 'utf8');
        if (bytes + charBytes > maxBytes) {
            truncated = true;
            break;
        }
        out.push(char);
        bytes += charBytes;
    }
    return { text: out.join(''), truncated: truncated || bytes < Buffer.byteLength(text, 'utf8') };
}

