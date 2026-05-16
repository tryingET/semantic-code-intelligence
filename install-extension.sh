#!/bin/bash

# Install and test the Semantic Code Intelligence VS Code extension

echo "🔧 Installing Semantic Code Intelligence VS Code Extension..."

# Uninstall any existing version
echo "Removing old version..."
code --uninstall-extension tryingET.semantic-code-intelligence 2>/dev/null || true
code-oss --uninstall-extension tryingET.semantic-code-intelligence 2>/dev/null || true

# Install the new version
echo "Installing new version..."
if command -v code &> /dev/null; then
    code --install-extension vscode-client/semantic-code-intelligence-1.0.0.vsix
    echo "✅ Installed to VS Code"
fi

if command -v code-oss &> /dev/null; then
    code-oss --install-extension vscode-client/semantic-code-intelligence-1.0.0.vsix
    echo "✅ Installed to VS Code OSS"
fi

echo ""
echo "📝 Next steps:"
echo "1. Restart VS Code (Ctrl+Shift+P → 'Developer: Reload Window')"
echo "2. Open a TypeScript/JavaScript/Python file"
echo "3. Check the Output panel (View → Output → 'Semantic Code Intelligence Language Server')"
echo "4. Check Developer Console for errors (Help → Toggle Developer Tools)"
echo ""
echo "🔍 Debug commands:"
echo "  - View installed extensions: code --list-extensions | grep ontology"
echo "  - Check extension logs: View → Output → Extension Host"
echo "  - Verify server runs: ~/.bun/bin/bun run dist/lsp/lsp.js --stdio"
