Set FontSize 14
Set Width 1200
Set Height 800
Set TypingSpeed 28ms
Set Theme "Dracula"
Output docs/videos/02-find.gif

Type "clear"
Enter
Type "cd test-workspace"
Enter
Sleep 400ms

Type "ls -1"
Enter
Sleep 600ms

Type "echo 'Find by class name (TS)'"
Enter
Sleep 500ms
Type "ontology-lsp find UserService -n 5"
Enter
Sleep 1600ms

Type "echo 'Find method in specific file (TS, verbose)'"
Enter
Sleep 500ms
Type "ontology-lsp find getUser -f sample.ts -n 3 -v"
Enter
Sleep 2000ms

Type "echo 'Find Python symbol'"
Enter
Sleep 500ms
Type "ontology-lsp find get_user -f sample.py -n 3"
Enter
Sleep 1800ms
