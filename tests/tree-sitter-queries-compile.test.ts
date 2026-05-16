import { describe, expect, test } from 'bun:test';
import { Query } from 'tree-sitter';

// Load grammars directly as used by the layer
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JavaScript = require('tree-sitter-javascript');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TypeScript = require('tree-sitter-typescript').typescript;

describe('Tree-sitter query compile sanity', () => {
    test('JavaScript classes query compiles (no TS-only nodes)', () => {
        const jsClasses = `
      (class_declaration
        name: (identifier) @class.name
        body: (class_body) @class.body)
    `;
        const q = new Query(JavaScript, jsClasses);
        expect(q).toBeDefined();
    });

    test('TypeScript classes query compiles (TS nodes allowed)', () => {
        const tsClasses = `
      (class_declaration
        name: (type_identifier) @class.name
        (class_heritage
          (extends_clause
            (identifier) @class.extends))?
        (class_heritage
          (implements_clause
            (type_identifier) @class.implements)*)?
        body: (class_body) @class.body)
    `;
        const q = new Query(TypeScript, tsClasses);
        expect(q).toBeDefined();
    });
});
