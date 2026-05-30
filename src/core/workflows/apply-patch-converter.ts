import { overlayStore } from '../overlay-store.js';
import { openWorkspaceFileForRead } from '../workspace-path.js';

export async function convertApplyPatchToUnified(
    patch: string,
    options: { snapshotId?: string; workspaceRoot: string }
): Promise<string> {
    const { workspaceRoot } = options;
    type HunkLine = { op: ' ' | '+' | '-'; text: string };
    const lines = patch.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let i = 0;
    const isFileHeader = (s: string) => /^\*\*\*\s+(Update|Add|Delete) File: /i.test(s);
    const splitFileLines = (text: string) => {
        const fileLines = text.replace(/\r\n/g, '\n').split('\n');
        if (fileLines.length && fileLines[fileLines.length - 1] === '') fileLines.pop();
        return fileLines;
    };
    const findSequences = (haystack: string[], needle: string[], startAt: number): number[] => {
        if (!needle.length) return [];
        const matches: number[] = [];
        for (let pos = Math.max(0, startAt); pos <= haystack.length - needle.length; pos++) {
            let ok = true;
            for (let offset = 0; offset < needle.length; offset++) {
                if (haystack[pos + offset] !== needle[offset]) {
                    ok = false;
                    break;
                }
            }
            if (ok) matches.push(pos);
        }
        return matches;
    };
    const readSourceLines = async (file: string): Promise<string[]> => {
        let sourceWorkspaceRoot = workspaceRoot;
        const snapshotId = options.snapshotId;
        if (snapshotId) {
            const snap = overlayStore.ensureSnapshot(snapshotId, {
                workspaceRoot,
            });
            if (Array.isArray((snap as any).diffs) && (snap as any).diffs.length > 0) {
                const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
                const materializedRoot = ensure
                    ? await ensure(snapshotId, { workspaceRoot })
                    : null;
                if (materializedRoot) sourceWorkspaceRoot = materializedRoot;
            }
        }

        const opened = await openWorkspaceFileForRead(file, {
            workspaceRoot: sourceWorkspaceRoot,
            inputLabel: 'apply_patch file',
        });
        let fileText: string;
        try {
            fileText = await opened.handle.readFile('utf8');
        } finally {
            await opened.handle.close().catch(() => undefined);
        }
        return splitFileLines(fileText);
    };

    const buildHunks = async (kind: string, file: string, rawChunk: string[]) => {
        const hunks: HunkLine[][] = [];
        let current: HunkLine[] = [];
        for (const line of rawChunk) {
            if (/^@@/.test(line)) {
                if (current.length) hunks.push(current);
                current = [];
                continue;
            }
            if (/^[ +-]/.test(line)) current.push({ op: line[0] as HunkLine['op'], text: line.slice(1) });
        }
        if (current.length) hunks.push(current);
        if (!hunks.length) throw new Error(`apply_patch conversion found no hunks for ${file}`);

        if (kind === 'add') {
            let newLine = 1;
            return hunks.flatMap((hunk) => {
                const newLines = hunk.filter((line) => line.op !== '-');
                const header = `@@ -0,0 +${newLine},${newLines.length} @@`;
                newLine += newLines.length;
                return [header, ...hunk.map((line) => `${line.op}${line.text}`)];
            });
        }

        const sourceLines = await readSourceLines(file);
        let cursor = 0;
        return hunks.flatMap((hunk) => {
            const oldLines = hunk.filter((line) => line.op !== '+').map((line) => line.text);
            const newLines = hunk.filter((line) => line.op !== '-').map((line) => line.text);
            const matches = findSequences(sourceLines, oldLines, cursor);
            if (matches.length > 1) throw new Error(`apply_patch hunk is ambiguous for ${file}`);
            const match = matches[0] ?? -1;
            if (match >= 0) {
                cursor = match + Math.max(oldLines.length, 1);
                return [
                    `@@ -${match + 1},${oldLines.length} +${match + 1},${newLines.length} @@`,
                    ...hunk.map((line) => `${line.op}${line.text}`),
                ];
            }

            const changed = hunk.filter((line) => line.op !== ' ');
            const oldChanged = changed.filter((line) => line.op === '-').map((line) => line.text);
            const newChanged = changed.filter((line) => line.op !== '-').map((line) => line.text);
            const changedMatches = findSequences(sourceLines, oldChanged, cursor);
            if (changedMatches.length === 0) throw new Error(`apply_patch hunk did not match ${file}`);
            if (changedMatches.length > 1) throw new Error(`apply_patch hunk is ambiguous for ${file}`);
            const changedMatch = changedMatches[0];
            cursor = changedMatch + Math.max(oldChanged.length, 1);
            return [
                `@@ -${changedMatch + 1},${oldChanged.length} +${changedMatch + 1},${newChanged.length} @@`,
                ...changed.map((line) => `${line.op}${line.text}`),
            ];
        });
    };
    while (i < lines.length) {
        const line = lines[i];
        const m = line.match(/^\*\*\*\s+(Update|Add|Delete) File:\s+(.+)$/i);
        if (!m) {
            i++;
            continue;
        }
        const kind = m[1].toLowerCase();
        const file = m[2].trim();
        i++;
        const chunk: string[] = [];
        while (i < lines.length && !isFileHeader(lines[i]) && !/^\*\*\*\s+End Patch$/i.test(lines[i])) {
            const l = lines[i];
            if (/^@@/.test(l) || /^[ +-]/.test(l)) {
                chunk.push(l);
            }
            i++;
        }
        if (kind === 'delete') {
            throw new Error(`apply_patch delete not supported for ${file}`);
        }
        out.push(`diff --git a/${file} b/${file}`);
        if (kind === 'add') {
            out.push('--- /dev/null');
            out.push(`+++ b/${file}`);
        } else {
            out.push(`--- a/${file}`);
            out.push(`+++ b/${file}`);
        }
        out.push(...(await buildHunks(kind, file, chunk)));
    }
    const joined = out.join('\n');
    if (!joined.trim()) {
        throw new Error('apply_patch conversion produced empty diff');
    }
    return joined + (joined.endsWith('\n') ? '' : '\n');
}
