import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export async function ensureLargeTree(rootDir: string, totalFiles = 10000): Promise<string> {
    await fsp.mkdir(rootDir, { recursive: true });
    // Deterministic layout: 10 dirs x 10 subdirs x N files
    const topDirs = 10;
    const subDirs = 10;
    const filesPerSub = Math.max(1, Math.floor(totalFiles / (topDirs * subDirs)));
    const content = 'export function fn() { return 42; }\n';
    for (let i = 0; i < topDirs; i++) {
        for (let j = 0; j < subDirs; j++) {
            const dir = path.join(rootDir, `d${i}`, `s${j}`);
            await fsp.mkdir(dir, { recursive: true });
            for (let k = 0; k < filesPerSub; k++) {
                const idx = (i * subDirs + j) * filesPerSub + k;
                const file = path.join(dir, `file_${String(idx).padStart(5, '0')}.ts`);
                if (!fs.existsSync(file)) {
                    await fsp.writeFile(file, content, 'utf8');
                }
            }
        }
    }
    return rootDir;
}
