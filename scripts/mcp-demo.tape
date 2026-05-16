Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 650
Set Theme "Dracula"
Set TypingSpeed 30ms

Clear
Type "echo '📦 Ontology MCP (stdio) demo with VHS'"
Enter
Sleep 500ms
Type "echo 'Repo: $(basename $(pwd))'"
Enter
Sleep 300ms

Type "echo"
Enter
Type "echo '▶ tools/list (no heavy init)'"
Enter
Type "printf '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"params\":{},\"id\":1}\\n' | ./mcp-wrapper.sh"
Enter
Sleep 1200ms

Type "echo"
Enter
Type "echo '▶ initialize (handshake)'"
Enter
Type "printf '{\"jsonrpc\":\"2.0\",\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"vhs\",\"version\":\"1.0\"}},\"id\":2}\\n' | ./mcp-wrapper.sh"
Enter
Sleep 1200ms

Type "echo"
Enter
Type "echo '✅ Handshake successful. First tool call will lazy-init core.'"
Enter
Sleep 800ms

