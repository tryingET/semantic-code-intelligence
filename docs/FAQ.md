# Frequently Asked Questions (FAQ)

## General Questions

### What is Ontology LSP?

Ontology LSP is an enhanced Language Server Protocol implementation that adds intelligent code understanding through:
- Fuzzy matching for identifiers
- Pattern learning from refactoring history
- Conceptual relationships between code elements
- Automated change propagation
- Multi-language support (TypeScript, JavaScript, Python)

### How does it differ from standard LSP servers?

Unlike traditional LSP servers that rely on exact string matching, Ontology LSP:
- Understands conceptual relationships between identifiers
- Learns from your refactoring patterns
- Suggests related changes when you rename symbols
- Provides fuzzy search capabilities
- Maintains a knowledge graph of your codebase

### What languages are supported?

Currently supported:
- TypeScript (.ts, .tsx)
- JavaScript (.js, .jsx)
- Python (.py)

Coming soon:
- Go
- Rust
- Java
- C/C++

## Installation & Setup

### How do I install Ontology LSP?

#### Via NPM (Global Installation):
```bash
npm install -g ontology-lsp-proxy
```

#### Via Bun:
```bash
bun add -g ontology-lsp-proxy
```

#### VS Code Extension:
1. Download the `.vsix` file from releases
2. Install: `code --install-extension ontology-lsp-1.0.0.vsix`

### Why is Bun required?

Bun provides:
- Native SQLite support (no compilation needed)
- Faster build times (50ms vs several seconds)
- Better performance for file operations
- Simplified dependency management
- Built-in TypeScript support

### Can I use it without Bun?

The server requires Bun to run, but the VS Code extension handles this automatically. You don't need Bun installed globally if you're only using the extension.

## Configuration

### Where is the configuration stored?

Configuration is stored in multiple places:
1. `.ontology/config.json` - Project-specific settings
2. VS Code settings - Extension configuration
3. `.ontologyignore` - File exclusion patterns
4. Environment variables - Runtime overrides

### How do I exclude files from analysis?

Create a `.ontologyignore` file in your project root:
```
# Dependencies
node_modules/
vendor/

# Build outputs
dist/
build/

# Custom patterns
*.generated.ts
test-data/
```

### Can I adjust performance settings?

Yes, in your VS Code settings:
```json
{
  "ontologyLSP.performance.workers": 2,
  "ontologyLSP.performance.cacheSize": "250MB",
  "ontologyLSP.propagation.maxDepth": 2
}
```

## Features

### How does fuzzy matching work?

Fuzzy matching uses multiple strategies:
1. **Edit distance**: Finds similar spellings (e.g., "getUserId" matches "getUserID")
2. **Token overlap**: Matches partial names (e.g., "getUser" matches "getUserInfo")
3. **Semantic similarity**: Understands synonyms (e.g., "fetch" matches "get")

### What is pattern learning?

Pattern learning observes your refactoring habits:
- When you rename `getUserData` to `fetchUserData`
- It learns the pattern: `get* → fetch*`
- Next time, it suggests `fetchOrderData` when you rename `getOrderData`

### How does change propagation work?

When you rename a symbol:
1. Finds all direct references (exact matches)
2. Identifies related concepts (fuzzy matches)
3. Suggests related changes based on patterns
4. Auto-applies high-confidence suggestions
5. Shows lower-confidence suggestions for review

### What is the concept graph?

The concept graph is a knowledge representation of your code:
- Nodes represent code concepts (functions, classes, variables)
- Edges represent relationships (calls, extends, imports)
- Weights indicate relationship strength
- Used for intelligent navigation and refactoring

## Troubleshooting

### Extension not activating?

1. Check VS Code version (requires 1.74.0+)
2. Reload window: `Ctrl+Shift+P` → "Developer: Reload Window"
3. Check output panel: View → Output → "Ontology Language Server"
4. Verify Bun is accessible: `bun --version`

### Server crashes or high CPU usage?

1. Reduce worker count in settings
2. Clear cache: `ontology-lsp clear-cache`
3. Check `.ontologyignore` patterns
4. Reduce propagation depth
5. Check available memory

### Fuzzy matching not working?

1. Verify fuzzy matching is enabled
2. Check threshold settings
3. Ensure file types are supported
4. Clear and rebuild index

### Pattern learning not working?

1. Patterns require 3+ similar renames to learn
2. Check confidence threshold (default 0.7)
3. Verify database isn't corrupted
4. Check write permissions for `.ontology/`

## HTTP API

### How do I start the API server?

```bash
# Default port 7000
ontology-lsp api

# Custom port
ONTOLOGY_API_PORT=8080 ontology-lsp api

# With CORS enabled
ONTOLOGY_API_CORS=true ontology-lsp api
```

### What endpoints are available?

- `GET /stats` - Ontology statistics
- `GET /concepts?identifier=name` - Find concept
- `GET /patterns` - Learned patterns
- `POST /analyze` - Analyze codebase
- `POST /suggest` - Get refactoring suggestions
- `GET /export` - Export ontology data
- `POST /import` - Import ontology data
- `GET /health` - Health check

### How do I integrate with CI/CD?

Use the GitHub Actions workflow:
```yaml
- name: Ontology Check
  run: |
    bunx ontology-lsp-proxy analyze
    bunx ontology-lsp-proxy stats
```

## Performance

### How much memory does it use?

Typical memory usage:
- Small projects (<1000 files): 50-100MB
- Medium projects (1000-10000 files): 100-300MB
- Large projects (>10000 files): 300-500MB

Configurable via cache settings.

### How fast is it?

Performance benchmarks:
- Initial indexing: ~100 files/second
- Fuzzy search: <50ms for most queries
- Pattern matching: <10ms per pattern
- Rename propagation: <200ms for typical refactoring

### Can it handle large codebases?

Yes, optimizations for large codebases:
- Incremental indexing
- Bloom filters for negative lookups
- LRU cache for frequent queries
- Parallel processing with workers
- Configurable memory limits

## Privacy & Security

### Is my code sent anywhere?

No, Ontology LSP runs entirely locally:
- All processing happens on your machine
- No network requests except for updates
- Database stored in `.ontology/` folder
- No telemetry or analytics

### What data is stored?

The local database stores:
- Identifier names and locations
- Learned patterns (anonymized)
- Concept relationships
- Cache data

No source code content is stored.

### Can I exclude sensitive files?

Yes, use `.ontologyignore`:
```
.env
secrets/
*.key
*.pem
config/production.json
```

## Contributing

### How can I contribute?

See [CONTRIBUTING.md](../CONTRIBUTING.md) for:
- Development setup
- Coding standards
- Pull request process
- Testing guidelines

### Where do I report bugs?

1. Check existing issues on GitHub
2. Create a new issue with:
   - Clear description
   - Steps to reproduce
   - System information
   - Error logs

### Can I add support for a new language?

Yes! To add language support:
1. Add tree-sitter grammar
2. Implement parser adapter
3. Add language configuration
4. Write tests
5. Submit PR

## Advanced Usage

### Can I use it programmatically?

Yes, via the API:
```typescript
import { OntologyEngine } from 'ontology-lsp-proxy';

const engine = new OntologyEngine('./my-project');
const concept = await engine.findConcept('getUserData');
```

### How do I export/import ontology data?

Export:
```bash
ontology-lsp export > ontology-backup.json
```

Import:
```bash
ontology-lsp import ontology-backup.json
```

### Can I customize pattern matching?

Yes, in configuration:
```json
{
  "patterns": {
    "synonyms": {
      "get": ["fetch", "retrieve", "load"],
      "set": ["update", "modify", "change"]
    },
    "transformations": {
      "camelCase": true,
      "snake_case": true
    }
  }
}
```

## More Questions?

- Check the [documentation](./index.md)
- Join our [discussions](https://github.com/yourusername/ontology-lsp/discussions)
- Open an [issue](https://github.com/yourusername/ontology-lsp/issues)
- Contact maintainers