import { glob } from 'glob';
import * as path from 'path';
import Parser, { Query } from 'tree-sitter';
import { CoreError } from './errors.js';
import { openWorkspaceFileForRead } from './workspace-path.js';

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
    workspaceRoot?: string;
};

export async function runAstQuery(inp: AstQueryInput) {
    const lang = await loadLanguage(inp.language);
    if (!lang) {
        // No language available; return empty result rather than throw to keep HTTP stable
        return { count: 0, results: [] };
    }
    const parser = new Parser();
    parser.setLanguage(lang);
    let q: Query;
    try {
        q = new Query(lang as any, inp.query);
    } catch (error) {
        return {
            count: 0,
            results: [],
            parser: 'query_unavailable',
            error: error instanceof Error ? error.message : String(error),
        };
    }

    const workspaceRoot = path.resolve(inp.workspaceRoot || process.cwd());
    const fileSet = new Set<string>();
    const explicitPaths = Array.isArray(inp.paths) ? inp.paths.map(String).filter(Boolean) : [];
    for (const requestedPath of explicitPaths) {
        fileSet.add(requestedPath);
    }
    if (inp.glob) {
        const pattern = String(inp.glob).trim();
        if (path.isAbsolute(pattern)) {
            throw new CoreError('InvalidParams', 'ast_query glob must stay within the workspace', { glob: inp.glob });
        }
        const matches = glob.sync(pattern, {
            cwd: workspaceRoot,
            ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**'],
            nodir: true,
            follow: false,
            absolute: false,
        } as any);
        matches.slice(0, 2000).forEach((m) => fileSet.add(String(m)));
    }
    const files = Array.from(fileSet).slice(0, 2000);
    const resultLimit = Math.max(1, Math.min(inp.limit || 2000, 2000));

    const results: any[] = [];
    for (const requestedFile of files) {
        if (results.length >= resultLimit) break;
        let opened: Awaited<ReturnType<typeof openWorkspaceFileForRead>> | null = null;
        try {
            opened = await openWorkspaceFileForRead(requestedFile, { workspaceRoot, inputLabel: 'ast_query path' });
            const text = await opened.handle.readFile('utf8');
            const tree = parser.parse(text);
            const caps = q.captures(tree.rootNode);
            for (const c of caps) {
                if (results.length >= resultLimit) break;
                const n = c.node;
                results.push({
                    file: opened.relativePath,
                    capture: c.name,
                    start: { line: n.startPosition.row, column: n.startPosition.column },
                    end: { line: n.endPosition.row, column: n.endPosition.column },
                    snippet: text
                        .split(/\r?\n/)
                        .slice(Math.max(0, n.startPosition.row - 1), n.endPosition.row + 2)
                        .join('\n'),
                });
            }
        } catch (error) {
            if (explicitPaths.includes(requestedFile) && error instanceof CoreError) throw error;
        } finally {
            await opened?.handle.close().catch(() => undefined);
        }
        if (results.length >= resultLimit) break;
    }
    return { count: results.length, results };
}
