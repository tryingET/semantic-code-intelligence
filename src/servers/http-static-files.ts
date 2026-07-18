import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HTTP_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATIC_FILE_MAX_BYTES = 10 * 1024 * 1024;

function httpStaticFileMaxBytes(): number {
    const raw = Number(process.env.SCI_HTTP_STATIC_MAX_BYTES);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_STATIC_FILE_MAX_BYTES;
}

export function contentTypeFor(filePath: string): string {
    if (filePath.endsWith('.html')) return 'text/html';
    if (filePath.endsWith('.js')) return 'application/javascript';
    if (filePath.endsWith('.css')) return 'text/css';
    if (filePath.endsWith('.svg')) return 'image/svg+xml';
    if (filePath.endsWith('.png')) return 'image/png';
    if (filePath.endsWith('.ico')) return 'image/x-icon';
    return 'application/octet-stream';
}

function webUiRoots(): string[] {
    return Array.from(
        new Set([
            path.resolve(HTTP_MODULE_DIR, '../../web-ui'),
            path.resolve(HTTP_MODULE_DIR, '../web-ui'),
            path.resolve(process.cwd(), 'web-ui'),
        ])
    );
}

export function decodeStaticPath(encodedPath: string): string | null {
    try {
        return decodeURIComponent(encodedPath);
    } catch {
        return null;
    }
}

function safeStaticRelativePath(relPath: string): string | null {
    const normalized = path.normalize(relPath);
    if (!normalized || path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
        return null;
    }
    return normalized;
}

export async function findWebUiFile(
    relPath: string,
    subdirs: Array<'dist' | null>
): Promise<{ filePath: string; file: Buffer } | null> {
    const safeRel = safeStaticRelativePath(relPath);
    if (!safeRel) return null;

    for (const root of webUiRoots()) {
        for (const subdir of subdirs) {
            const base = subdir ? path.resolve(root, subdir) : root;
            const candidate = path.resolve(base, safeRel);
            const relative = path.relative(base, candidate);
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;

            try {
                const stat = await fs.lstat(candidate);
                if (!stat.isFile() || stat.isSymbolicLink() || stat.size > httpStaticFileMaxBytes()) continue;
                const [realBase, realCandidate] = await Promise.all([fs.realpath(base), fs.realpath(candidate)]);
                const realRelative = path.relative(realBase, realCandidate);
                if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) continue;
                const noFollow = typeof fsSync.constants.O_NOFOLLOW === 'number' ? fsSync.constants.O_NOFOLLOW : 0;
                const handle = await fs.open(candidate, fsSync.constants.O_RDONLY | noFollow);
                try {
                    const openedReal = await fs
                        .realpath(`/proc/self/fd/${handle.fd}`)
                        .catch(() => fs.realpath(`/dev/fd/${handle.fd}`));
                    const openedRelative = path.relative(realBase, openedReal);
                    if (!openedRelative || openedRelative.startsWith('..') || path.isAbsolute(openedRelative)) continue;
                    return { filePath: candidate, file: await handle.readFile() };
                } finally {
                    await handle.close().catch(() => undefined);
                }
            } catch {}
        }
    }
    return null;
}
