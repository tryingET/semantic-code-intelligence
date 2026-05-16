# Ontology LSP VS Code Extension

A comprehensive VS Code extension that connects to the Ontology Language Server, providing intelligent code navigation with semantic understanding, pattern learning, and knowledge propagation.

## Features

### 🧠 **Intelligent Code Understanding**
- **Semantic Navigation**: Go beyond syntax to understand code meaning
- **Fuzzy Matching**: Find related code even with different naming
- **Concept Relationships**: Visualize how code elements relate

### 📚 **Pattern Learning**
- **Automatic Learning**: Learns from your refactoring patterns
- **Confidence Scoring**: Applies patterns based on reliability
- **Team Sharing**: Share learned patterns with your team

### 🔄 **Knowledge Propagation**
- **Smart Refactoring**: Suggests related changes across codebase
- **Cascading Updates**: Propagates changes through dependencies
- **Confidence-based Application**: Only applies high-confidence changes

### 📊 **Performance & Security**
- **Performance Monitoring**: Tracks and optimizes resource usage
- **Security Filtering**: Prevents exposure of sensitive patterns
- **Privacy Protection**: Respects user privacy settings

## Installation

### From Source

1. **Build the extension:**
```bash
cd vscode-client
npm install
npm run compile
```

2. **Package the extension:**
```bash
npm install -g @vscode/vsce
vsce package
```

3. **Install in VS Code:**
```bash
code --install-extension ontology-lsp-1.0.0.vsix
```

### Development Mode

1. Open the extension folder in VS Code
2. Press `F5` to launch a new VS Code window with the extension
3. The extension will connect to the LSP server automatically

## Configuration

Access settings through VS Code Settings or edit `settings.json`:

```json
{
    // Enable/disable the extension
    "ontologyLSP.enable": true,
    
    // Fuzzy matching settings
    "ontologyLSP.fuzzyMatching.enabled": true,
    "ontologyLSP.fuzzyMatching.threshold": 0.7,
    
    // Pattern learning
    "ontologyLSP.patternLearning.enabled": true,
    "ontologyLSP.patternLearning.minConfidence": 0.8,
    
    // Knowledge propagation
    "ontologyLSP.propagation.enabled": true,
    "ontologyLSP.propagation.autoApply": false,
    "ontologyLSP.propagation.maxDepth": 3,
    
    // Performance tuning
    "ontologyLSP.performance.cacheSize": 500,
    "ontologyLSP.performance.parallelWorkers": 4,
    
    // UI preferences
    "ontologyLSP.ui.showStatusBar": true,
    "ontologyLSP.ui.showInlineHints": true,
    
    // Privacy settings
    "ontologyLSP.telemetry.enabled": false,
    
    // Experimental features
    "ontologyLSP.experimental.aiSuggestions": false
}
```

## Commands

Access via Command Palette (`Ctrl+Shift+P`):

- `Ontology: Enable` - Enable the extension
- `Ontology: Disable` - Disable the extension
- `Ontology: Restart Language Server` - Restart the LSP server
- `Ontology: Show Concept Graph` - Visualize concept relationships
- `Ontology: Analyze Codebase` - Full codebase analysis
- `Ontology: Show Learned Patterns` - View learned patterns
- `Ontology: Show Statistics` - Performance and usage stats
- `Ontology: Clear Cache` - Clear ontology cache
- `Ontology: Export Ontology` - Export ontology data
- `Ontology: Import Ontology` - Import ontology data
- `Ontology: Train Pattern` - Train pattern from selection
- `Ontology: Suggest Refactoring` - Get refactoring suggestions
- `Symbol: Build Symbol Map` - Build targeted declarations/references map for a symbol
- `Refactor: Plan Rename (Preview)` - Preview WorkspaceEdit for symbol rename

## Keyboard Shortcuts

- `Ctrl+Shift+O G` - Show concept graph
- `Ctrl+Shift+O R` - Suggest refactoring

## Architecture Considerations

This extension was designed with deep architectural considerations:

### First-Order: Core Functionality
- LSP protocol implementation
- Basic code navigation and refactoring

### Second-Order: Performance & Conflicts
- Performance monitoring with automatic optimization
- Conflict resolution with TypeScript server
- Resource usage tracking

### Third-Order: Memory & Dependencies
- Intelligent caching with TTL
- Cross-file dependency tracking
- Memory leak prevention

### Fourth-Order: Team Collaboration
- Shared pattern libraries
- Team synchronization
- Repository integration

### Fifth-Order: Security & Privacy
- Sensitive pattern filtering
- Encrypted storage for credentials
- Privacy-respecting telemetry

### Sixth-Order: Future Extensibility
- AI integration readiness
- Extension API for third-party plugins
- Industry standard contributions

## API for Extension Developers

Other extensions can integrate with Ontology LSP:

```typescript
const ontologyAPI = vscode.extensions.getExtension('ontology-team.ontology-lsp')?.exports;

// Get concept information
const concept = await ontologyAPI.getConcept(uri, position);

// Find related concepts
const related = await ontologyAPI.findRelatedConcepts(concept.id);

// Register custom propagation rule
ontologyAPI.registerPropagationRule({
    name: 'my-custom-rule',
    description: 'Custom propagation logic',
    matcher: (change) => change.uri.includes('my-pattern'),
    propagate: async (change) => {
        // Custom propagation logic
        return [];
    }
});

// Subscribe to events
ontologyAPI.onConceptDiscovered((concept) => {
    console.log('New concept:', concept);
});
```

## Troubleshooting

### Extension not activating
1. Check VS Code version (requires 1.74.0+)
2. Ensure LSP server is built (`npm run build` in parent directory)
3. Check Output panel for errors

### Poor performance
1. Reduce cache size in settings
2. Decrease parallel workers
3. Disable pattern learning temporarily

### Conflicts with TypeScript
1. Disable TypeScript server: `"typescript.tsserver.enable": false`
2. Or use both with reduced features

## Contributing

We welcome contributions! Please see the main repository's CONTRIBUTING.md.

## License

MIT - See LICENSE in the repository root

## Support

- GitHub Issues: [Report bugs and request features](https://github.com/your-org/ontology-lsp/issues)
- Documentation: [Full documentation](https://docs.ontology-lsp.dev)
- Discord: [Join our community](https://discord.gg/ontology-lsp)

---

Built with deep architectural consideration for performance, security, and extensibility.
