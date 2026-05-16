# Changes — September 2025 (Condensed)

This is a condensed changelog capturing key updates that previously lived inline in `PROJECT_STATUS.md`.

## 2025-09-09
- Fast feedback improvements: async runner, balanced slices, hard caps; new test recipes (`test-ci-like-balanced`, `test-quick`, `test-smoke`).
- Surfaced port collisions and L4 schema bootstrap issues in tests; captured mitigations and planned fixes.
- Decision: adopt OpenTelemetry + Prometheus across all adapters; standardized counters/histograms/gauges with bounded labels; ports allocated per adapter; CLI via Pushgateway.

## 2025-09-07
- Dogfooding (HTTP) CI runner: `scripts/dogfood-ci.ts` + `just dogfood_ci`, uploads `dogfood-summary.json`.
- Graph Expand hardening: never 500s; returns empty neighbors with note; tests added.
- Adapter mapping consistency for streaming definitions; shared mapping helpers.
- AST‑backed `list_symbols` (opt‑in) via flag.

## 2025-09-06
- MCP/HTTP parity and workflows polish; snapshots utilities; monitoring snapshots persisted to SQLite with retention.
- HTTP endpoints added: `/api/v1/snapshots`, `/api/v1/snapshots/clean`, `/api/v1/snapshots/{id}/diff`.
- Error mapping & validation centralized; ToolExecutor guards for invalid patches.
- Ports & DevX simplification (no runtime port registry; `.env` overrides).

## 2025-09-05
- Tool‑first parity: HTTP `/api/v1/tools/call` normalizes outputs; CLI workflows; MCP adapter cleanup.
- Partial snapshot materialization for faster loops.
- Web UI: MCP Live Events, Snapshots panel enhancements, Workflows panel.

## 2025-09-04
- Repo hygiene & test reorg under `tests/`.
- Cross‑protocol consistency improvements; MCP normalization; references behavior aligned.
- MCP HTTP initialize path improvements; safer error logging.

## 2025-09-03 – 2025-08-27
- L1–L3 pipeline stabilized for dogfooding; conceptual augmentation default‑on (opt‑out).
- Unified prompts/resources for stdio MCP; meta workflow executor.
- Perf stabilization knob for L2: `L2_MAX_PARSE_FILES`; boundary tests added.
- Learning system: persistence and pipelines endpoints; UI wiring for pipelines.

For full narrative and earlier entries, use Git history or prior versions of `PROJECT_STATUS.md`.

