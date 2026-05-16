Set FontSize 14
Set Width 1200
Set Height 800
Set TypingSpeed 28ms
Set Theme "Dracula"
Output docs/videos/04-rename.gif

Type "clear"
Enter
Type "cd test-workspace"
Enter
Sleep 400ms

Type "echo 'Dry-run rename with change preview (default)'"
Enter
Sleep 500ms
Type "ontology-lsp rename getProduct fetchProductById"
Enter
Sleep 2400ms

Type "echo 'Apply changes (no-dry-run)'"
Enter
Sleep 500ms
Type "ontology-lsp rename get_product fetch_product_by_id --no-dry-run"
Enter
Sleep 2600ms

Type "echo 'Verify rename in sample.py'"
Enter
Sleep 400ms
Type "rg -n ""fetch_product_by_id"" sample.py || true"
Enter
Sleep 2200ms
