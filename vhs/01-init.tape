Set FontSize 14
Set Width 1200
Set Height 800
Set TypingSpeed 30ms
Set Theme "Dracula"
Output docs/videos/01-init.gif

Type "clear"
Enter
Type "rm -rf /tmp/ontology-demo && mkdir -p /tmp/ontology-demo && cd /tmp/ontology-demo"
Enter
Sleep 400ms

Type "ontology-lsp init"
Enter
Sleep 1500ms

Type "ls -la"
Enter
Sleep 1000ms

Type "echo --- .ontology-lsp-config.yaml --- && sed -n '1,60p' .ontology-lsp-config.yaml"
Enter
Sleep 1600ms

Type "echo --- .ontologyignore --- && sed -n '1,60p' .ontologyignore"
Enter
Sleep 1600ms
