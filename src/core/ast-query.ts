import { glob } from 'glob';
import * as path from 'path';
import Parser, { Query } from 'tree-sitter';
import { CoreError } from './errors.js';
import { parseBoundedInteger } from './input-validation.js';
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
    excludedTopLevelPaths?: string[];
};

export async function runAstQuery(inp: AstQueryInput) {
    if (!['typescript', 'javascript', 'python'].includes(inp.language)) {
        throw new CoreError('InvalidParams', 'Unsupported ast_query language', {
            field: 'language',
            allowed: ['typescript', 'javascript', 'python'],
        });
    }
    const lang = await loadLanguage(inp.language);
    if (!lang) {
        // No language available; return empty result rather than throw to keep HTTP stable
        return {
            language: inp.language,
            query: inp.query,
            parserStatus: 'unavailable',
            fallback: true,
            capped: false,
            count: 0,
            results: [],
        };
    }
    const parser = new Parser();
    parser.setLanguage(lang);
    let q: Query;
    try {
        q = new Query(lang as any, inp.query);
    } catch (error) {
        return {
            language: inp.language,
            query: inp.query,
            parserStatus: 'query_unavailable',
            fallback: true,
            capped: false,
            count: 0,
            results: [],
            parser: 'query_unavailable',
            error: error instanceof Error ? error.message : String(error),
        };
    }

    const workspaceRoot = path.resolve(inp.workspaceRoot || process.cwd());
    const excludedTopLevelPaths = new Set(
        (Array.isArray(inp.excludedTopLevelPaths) ? inp.excludedTopLevelPaths : [])
            .map((item) => path.normalize(String(item)).split(path.sep)[0])
            .filter(Boolean)
    );
    const isExcludedTopLevelPath = (value: string): boolean => {
        if (!excludedTopLevelPaths.size) return false;
        const normalized = path.normalize(String(value));
        const firstSegment = normalized.split(path.sep)[0];
        return excludedTopLevelPaths.has(firstSegment);
    };
    const fileSet = new Set<string>();
    const explicitPaths = Array.isArray(inp.paths) ? inp.paths.map(String).filter(Boolean) : [];
    for (const requestedPath of explicitPaths) {
        if (!isExcludedTopLevelPath(requestedPath)) fileSet.add(requestedPath);
    }
    if (inp.glob) {
        const pattern = String(inp.glob).trim();
        if (path.isAbsolute(pattern) || pattern.split(/[\\/]+/).includes('..')) {
            throw new CoreError('InvalidParams', 'ast_query glob must stay within the workspace', { glob: inp.glob });
        }
        const excludedGlobs = Array.from(excludedTopLevelPaths).flatMap((segment) => [segment, `${segment}/**`]);
        const matches = glob.sync(pattern, {
            cwd: workspaceRoot,
            ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', ...excludedGlobs],
            nodir: true,
            follow: false,
            absolute: false,
        } as any);
        matches
            .filter((m) => !isExcludedTopLevelPath(String(m)))
            .slice(0, 2000)
            .forEach((m) => fileSet.add(String(m)));
    }
    const files = Array.from(fileSet).slice(0, 2000);
    const resultLimit = parseBoundedInteger(inp.limit, 'limit', { defaultValue: 2000, min: 1, max: 2000 });

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
    return {
        language: inp.language,
        query: inp.query,
        parserStatus: 'ok',
        fallback: false,
        capped: results.length >= resultLimit,
        count: results.length,
        results,
    };
}
