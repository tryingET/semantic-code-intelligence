CLI Demos (VHS)

This repo includes VHS tapes to showcase the `ontology-lsp` CLI.

Prerequisites
- Install VHS: https://github.com/charmbracelet/vhs#installation
- Ensure `ontology-lsp` runs locally (build `dist` if needed).

Render all demos
- Run: `scripts/render-vhs.sh`
- Outputs: `docs/videos/*.gif`

Included tapes
- `00-help.tape`: Global help and per-command help screens
- `01-init.tape`: Initialize a new workspace with config and ignore files
- `02-find.tape`: Find identifiers across languages, file-scoped and verbose
- `03-references.tape`: Show references for Python and TypeScript symbols
- `04-rename.tape`: Dry-run and apply renames with verification
- `05-stats.tape`: System statistics with verbose details

Notes
- Tapes assume running from repo root. Some demos `cd test-workspace`.
- `04-rename.tape` applies a rename in `test-workspace/sample.py`. If you prefer read-only demos, comment out the `--no-dry-run` line.
- To regenerate after changes, rerun the render script.

