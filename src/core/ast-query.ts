import * as fs from 'fs/promises';
import { glob } from 'glob';
import * as path from 'path';
import Parser, { Query } from 'tree-sitter';

async function loadLanguage(language: 'typescript' | 'javascript' | 'python') {
    try {
        if (language === 'typescript') {
            const mod: any = await import('tree-sitter-typescript');
            return (mod as any).typescript || (mod as any).default || mod;
        }
        if (language === 'javascript') {
            const mod: any = await import('tree-sitter-javascript');
            return (mod as any).javascript || (mod as any).default || mod;
        }
        if (language === 'python') {
            const mod: any = await import('tree-sitter-python');
            return (mod as any).python || (mod as any).default || mod;
        }
    } catch (e) {
        // Gracefully degrade when language modules are unavailable in this runtime
        return null as any;
    }
    return null as any;
}

export type AstQueryInput = {
    language: 'typescript' | 'javascript' | 'python';
    query: string;
    paths?: string[];
    glob?: string;
    limit?: number;
};

export async function runAstQuery(inp: AstQueryInput) {
    const lang = await loadLanguage(inp.language);
    if (!lang) {
        // No language available; return empty result rather than throw to keep HTTP stable
        return { count: 0, results: [] };
    }
    const parser = new Parser();
    parser.setLanguage(lang);
    const q = new Query(lang as any, inp.query);

    const fileSet = new Set<string>();
    if (inp.paths && inp.paths.length) {
        inp.paths.forEach((p) => fileSet.add(path.resolve(p)));
    }
    if (inp.glob) {
        const matches = glob.sync(inp.glob, {
            ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**'],
            nodir: true,
        } as any);
        matches.slice(0, 2000).forEach((m) => fileSet.add(path.resolve(m)));
    }
    const files = Array.from(fileSet).slice(0, Math.min(inp.limit || 100, 1000));

    const results: any[] = [];
    for (const file of files) {
        try {
            const text = await fs.readFile(file, 'utf8');
            const tree = parser.parse(text);
            const caps = q.captures(tree.rootNode);
            for (const c of caps) {
                const n = c.node;
                results.push({
                    file,
                    capture: c.name,
                    start: { line: n.startPosition.row, column: n.startPosition.column },
                    end: { line: n.endPosition.row, column: n.endPosition.column },
                    snippet: text
                        .split(/\r?\n/)
                        .slice(Math.max(0, n.startPosition.row - 1), n.endPosition.row + 2)
                        .join('\n'),
                });
            }
        } catch {}
        if (results.length >= (inp.limit || 2000)) break;
    }
    return { count: results.length, results };
}
