Set FontSize 14
Set Width 1200
Set Height 800
Set TypingSpeed 28ms
Set Theme "Dracula"
Output docs/videos/03-references.gif

Type "clear"
Enter
Type "cd test-workspace"
Enter
Sleep 400ms

Type "echo 'References for Python function (include declaration)'"
Enter
Sleep 500ms
Type "ontology-lsp references get_user -d -n 10"
Enter
Sleep 2200ms

Type "echo 'References for TS class method'"
Enter
Sleep 500ms
Type "ontology-lsp references fetchUser -n 10"
Enter
Sleep 2200ms
