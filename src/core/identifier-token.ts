export function wordAtIdentifierPosition(text: string, pos: { line: number; character: number }): string | null {
    const lines = text.split(/\r?\n/);
    if (pos.line < 0 || pos.line >= lines.length) return null;
    const line = lines[pos.line] || '';
    const idx = Math.min(Math.max(pos.character, 0), line.length);
    const identifier = /[$A-Za-z_][$A-Za-z0-9_]*/g;
    let match: RegExpExecArray | null = null;
    while ((match = identifier.exec(line))) {
        const start = match.index;
        const end = start + match[0].length;
        if (idx >= start && idx <= end) return match[0];
    }
    return null;
}
