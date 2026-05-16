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

Type "semantic-code-intelligence init"
Enter
Sleep 1500ms

Type "ls -la"
Enter
Sleep 1000ms

Type "echo --- .semantic-code-intelligence-config.yaml --- && sed -n '1,60p' .semantic-code-intelligence-config.yaml"
Enter
Sleep 1600ms

Type "echo --- .semantic-code-ignore --- && sed -n '1,60p' .semantic-code-ignore"
Enter
Sleep 1600ms
