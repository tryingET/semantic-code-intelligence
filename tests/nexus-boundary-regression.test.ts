import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LSPAdapter } from '../src/adapters/lsp-adapter.js';
import { expandNeighbors } from '../src/core/code-graph.js';
import { AsyncEnhancedGrep } from '../src/layers/enhanced-search-tools-async.js';
import { TreeSitterLayer } from '../src/layers/tree-sitter.js';
import { IgnoreFileManager } from '../src/utils/ignore-file.js';

const roots: string[] = [];
function tempWorkspace(prefix = 'sci-nexus-boundary-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('nexus boundary regressions', () => {
  test('IgnoreFileManager is read-only on construction and applies directory patterns relative to workspace root', () => {
    const workspace = tempWorkspace();
    const ignorePath = join(workspace, '.semantic-code-ignore');

    const missing = new IgnoreFileManager(workspace);
    expect(existsSync(ignorePath)).toBe(false);
    expect(missing.shouldIgnore(join(workspace, 'node_modules', 'pkg', 'index.js'))).toBe(true);

    writeFileSync(ignorePath, 'generated/\n', 'utf8');
    const manager = new IgnoreFileManager(workspace);
    expect(manager.shouldIgnore(join(workspace, 'generated', 'a.ts'))).toBe(true);
    expect(manager.shouldIgnore(join(workspace, 'src', 'generated', 'a.ts'))).toBe(true);
    expect(manager.shouldIgnore(join(workspace, '..literal-name.ts'))).toBe(false);

    const otherCwd = tempWorkspace('sci-nexus-boundary-cwd-');
    const previousCwd = process.cwd();
    try {
      process.chdir(otherCwd);
      expect(manager.shouldIgnore(join(workspace, 'generated', 'b.ts'))).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('ripgrep parsing preserves source line whitespace', async () => {
    const workspace = tempWorkspace();
    writeFileSync(join(workspace, 'a.txt'), '  needle  \n', 'utf8');
    const grep = new AsyncEnhancedGrep({ cacheSize: 0 });
    const result = await grep.search({ pattern: 'needle', path: workspace, timeout: 1000 });
    expect(result[0]).toMatchObject({ column: 3, text: '  needle  ' });
  });

  test('TreeSitterLayer emits import relationships and arrow-function names', async () => {
    const workspace = tempWorkspace();
    const importFile = join(workspace, 'imports.ts');
    writeFileSync(importFile, "import {foo} from './b';\nexport function bar(){ return foo(); }\n", 'utf8');
    const arrowFile = join(workspace, 'arrow.ts');
    writeFileSync(arrowFile, 'const baz = () => 1;\n', 'utf8');

    const layer = new TreeSitterLayer({ enabled: true, timeout: 1000, languages: ['typescript'], maxFileSize: '1MB', projectPath: workspace });
    const imports = await layer.process({ exact: [{ file: importFile, line: 1, column: 1, text: 'foo', match: 'foo', confidence: 1 }], fuzzy: [], conceptual: [], files: new Set([importFile]), searchTime: 0, toolsUsed: [], confidence: 1 });
    expect(imports.relationships.some((rel: any) => rel.type === 'imports' && rel.to === './b')).toBe(true);

    const arrows = await layer.process({ exact: [{ file: arrowFile, line: 1, column: 7, text: 'baz', match: 'baz', confidence: 1 }], fuzzy: [], conceptual: [], files: new Set([arrowFile]), searchTime: 0, toolsUsed: [], confidence: 1 });
    expect(arrows.nodes.some((node: any) => node.metadata?.functionName === 'baz')).toBe(true);
  });

  test('Python code graph captures aliased from-imports', async () => {
    const workspace = tempWorkspace();
    writeFileSync(join(workspace, 'a.py'), 'import os, sys\nfrom pkg import a, b as c\n', 'utf8');
    const result = await expandNeighbors({ file: 'a.py', workspaceRoot: workspace, edges: ['imports'], limit: 20 });
    const imports = result.neighbors.imports.map((entry: any) => entry.text);
    expect(imports).toContain('b');
    expect(imports).toContain('c');
  });

  test('LSP rename requests are preview-pure dry runs', async () => {
    const workspace = tempWorkspace();
    const file = join(workspace, 'rename.ts');
    writeFileSync(file, 'const oldName = 1;\n', 'utf8');
    let renameRequest: any;
    const adapter = new LSPAdapter({
      prepareRename: async () => ({ data: null }),
      rename: async (request: any) => {
        renameRequest = request;
        return { data: { changes: {} } };
      },
      getCompletions: async () => ({ data: [] }),
      trackFileChange: async () => undefined,
      getDiagnostics: () => [],
    }, { workspaceRoot: workspace });

    const uri = pathToFileURL(file).toString();
    await adapter.handleDidOpenTextDocument({ textDocument: { uri, languageId: 'typescript', version: 1, text: readFileSync(file, 'utf8') } } as any);
    await adapter.handleRename({ textDocument: { uri }, position: { line: 0, character: 7 }, newName: 'newName' } as any);
    expect(renameRequest?.dryRun).toBe(true);
  });
});
