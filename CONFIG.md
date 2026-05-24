---
summary: "Configuration Guide for the Semantic Code Intelligence repo."
read_when:
  - "You need CONFIG information for Semantic Code Intelligence."
  - "You are changing CONFIG.md or related behavior."
type: "reference"
---

# Configuration Guide

## Overview

The Semantic Code Intelligence system uses a centralized configuration approach to prevent port conflicts and ensure consistent settings across all components.

## Configuration File

The main configuration is defined in `src/core/config/server-config.ts`.

## Port Allocation

| Service | Default Port | Environment Variable | Purpose |
|---------|-------------|---------------------|---------|
| **Production** | | | |
| HTTP API Server | 7000 | `HTTP_API_PORT` | Main REST API for ontology operations |
| MCP HTTP Server | 7001 | `MCP_HTTP_PORT` | MCP protocol over Streamable HTTP |
| LSP Server | 7002 (or stdio) | `LSP_SERVER_PORT` | Language Server Protocol (TCP or stdio mode) |
| **Test Instances** | | | |
| Test HTTP API | 7010 | - | Test instance of HTTP API server |
| Test MCP HTTP | 7011 | - | Test instance of MCP server |
| Test LSP | 7012 | - | Test instance of LSP server |
| **Test Targets** | | | |
| Test Target API | 7020 | `TEST_API_PORT` | Isolated server for tests to connect to |
| Test Target MCP | 7021 | `TEST_MCP_PORT` | Isolated MCP for tests to connect to |
| Test Target LSP | 7022 | `TEST_LSP_PORT` | Isolated LSP for tests to connect to |

## Configuration Sources

Settings are loaded in this priority order:
1. Environment variables (highest priority)
2. `.env` file (if present)
3. Default configuration in `server-config.ts`

## Environment Variables

### Server Configuration
- `HTTP_API_PORT` - HTTP API server port (default: 7000)
- `MCP_HTTP_PORT` - MCP HTTP server port (default: 7001)
- `MCP_HTTP_HOST` - MCP HTTP bind host (default: central server host / localhost)
- `MCP_HTTP_CORS_ORIGIN` - MCP HTTP browser CORS policy. Defaults to allowing only loopback browser origins (`localhost`, `127.0.0.1`, `::1`) when bound to a loopback host, and no browser CORS headers for externally bound hosts. Set explicitly for reverse-proxy/external exposure: `*`, one origin, a comma-separated allowlist, or `false`/`none`/`0` to disable.
- `LSP_SERVER_PORT` - LSP server port for TCP mode (default: 7002)
- `LSP_HOST` - Server host (default: localhost)

### Storage (Layer 4) Selection
- `LAYER4_ADAPTER` or `ONTOLOGY_STORAGE_ADAPTER` or `STORAGE_ADAPTER`
  - Values: `sqlite` (default) | `postgres` | `triplestore` (scaffold)
- `SEMANTIC_CODE_DB_PATH` or `LAYER4_DB_PATH`
  - Path to SQLite DB file (applies to Layers 3/4/5 when set)
- `ONTOLOGY_PG_URL` / `DATABASE_URL` / `PG_URL`
  - Postgres connection string (only required if using `postgres` adapter)
- `L4_AUTO_MIGRATE` - Enable automatic schema creation and migration (default: `1`)
  - When set to `1` (default): Schema is auto-created in the constructor, eliminating "no such table" errors
  - When set to `0`: Schema is only created when `initialize()` is explicitly called
  - Safe for dev/test: Uses forward-only, idempotent CREATE TABLE IF NOT EXISTS and ALTER TABLE ADD COLUMN
  - Note: The `ensureSchema()` method can be called multiple times safely (idempotent)

### Performance Settings
- `LSP_TIMEOUT` - Request timeout in milliseconds (default: 5000)
- `LSP_MAX_RETRIES` - Maximum retry attempts (default: 3)
- `LSP_CACHE_ENABLED` - Enable response caching (default: true)
- `LSP_CACHE_TTL` - Cache time-to-live in milliseconds (default: 300000)
- `L2_MAX_PARSE_FILES` - Max files Layer 2 (AST) parses per request (default: 20; clamp 1–100). Useful to reduce variance in perf/CI.
  - Numeric values are clamped: values ≤ 0 become 1; values > 100 become 100.
  - Non-numeric/invalid values fall back to the default of 20.
  - CI recommendation: set `L2_MAX_PARSE_FILES=12` for perf-gated CI jobs to stabilize p95 on typical runners (see .github/workflows/ci.yml).
- `LIST_SYMBOLS_AST` - When set to `1`, `list_symbols` tool uses an AST-backed path (Tree-sitter) for improved coverage; gracefully falls back to a fast regex scanner when grammars are unavailable.
- Snapshot checks timeout clamp: all tools that run commands inside snapshots (e.g., `run_checks`, `patch_checks_in_snapshot`, `rename_safely`) accept `timeoutSec` but are centrally clamped to 1–600 seconds per command. The HTTP adapter already enforces this; core now applies the same cap for MCP/CLI parity.

### Metrics (Prometheus) Ports
- `MCP_STDIO_PROM_PORT` — MCP stdio metrics HTTP endpoint (default: 9466, bind 127.0.0.1)
- `LSP_PROM_PORT` — LSP metrics HTTP endpoint (default: 9467, bind 127.0.0.1)

### CLI Metrics (Pushgateway)
- `PUSHGATEWAY_URL` — Prometheus Pushgateway URL for CLI metrics (e.g., `http://localhost:9091`)
  - When set, CLI commands record metrics and push them to the Pushgateway on exit
  - Alternative: `PROMETHEUS_PUSHGATEWAY_URL` (fallback if `PUSHGATEWAY_URL` is not set)
  - Job name: `ontology_cli`
  - Metrics pushed: `tool_calls_total`, `tool_duration_ms` (histogram)
  - Push occurs on CLI shutdown (success or failure)
- `CLI_METRICS_DEBUG` — Set to `1` to enable debug logging for CLI metrics push failures

### Circuit Breaker
- `CIRCUIT_BREAKER_THRESHOLD` - Failures before opening circuit (default: 5)
- `CIRCUIT_BREAKER_RESET_TIMEOUT` - Reset timeout in milliseconds (default: 30000)

### Environment Mode
- `NODE_ENV` - Set to 'test' for test configuration
- `BUN_ENV` - Alternative to NODE_ENV for Bun runtime

## Usage Examples

### Starting Servers with Custom Ports

```bash
# Using environment variables
HTTP_API_PORT=8000 MCP_HTTP_PORT=8001 bun run start

# Using .env file
cp .env.sample .env
# Edit .env file with your settings
bun run start
```

### Running Tests

Tests automatically use the test configuration to avoid port conflicts:

```bash
# Tests will use ports 7010-7012 for test instances
# and 7020-7022 for isolated test targets
bun test

# Or explicitly set test environment
BUN_ENV=test bun test
```

### Programmatic Usage

```typescript
import { getEnvironmentConfig, getServiceUrl } from './config/server-config'

// Get current configuration
const config = getEnvironmentConfig()
console.log(`API server: ${config.host}:${config.ports.httpAPI}`)

// Get service URL
const apiUrl = getServiceUrl('httpAPI')
const mcpUrl = getServiceUrl('mcpHTTP')
```

## Configuration Validation

The configuration module includes validation to ensure:
- No port conflicts between services
- Ports are in valid range (1024-65535)
- Required settings are present

## Development vs Production

### Development (default)
- Verbose logging
- CORS enabled with permissive settings
- Shorter cache TTL
- More retries

### Production
```bash
NODE_ENV=production bun run start
```
- Optimized performance settings
- Stricter CORS settings
- Longer cache TTL
- Authentication required

### Test Environment
```bash
BUN_ENV=test bun test
```
- Isolated ports (7010-7012 for instances, 7020-7022 for targets)
- In-memory database
- Disabled caching
- Shorter timeouts

## Troubleshooting

### Port Already in Use

If you see "EADDRINUSE" errors:

1. Check running processes:
```bash
lsof -i :7000
lsof -i :7001
```

2. Kill existing processes:
```bash
./.claude/hooks/session-stop.sh
```

3. Use different ports:
```bash
HTTP_API_PORT=8000 MCP_HTTP_PORT=8001 bun run start
```

### Configuration Not Loading

1. Check environment variables:
```bash
env | grep -E "LSP_|MCP_|HTTP_API"
```

2. Verify .env file location:
```bash
ls -la .env
```

3. Enable debug logging:
```bash
LOG_LEVEL=debug bun run start
```

## Best Practices

1. **Never commit .env files** - Use .env.sample as template
2. **Use environment-specific configs** - Set NODE_ENV/BUN_ENV appropriately
3. **Validate ports before starting** - Check for conflicts
4. **Monitor circuit breaker** - Adjust thresholds based on network conditions
5. **Tune cache settings** - Balance freshness vs performance

## Observability: Metrics (Prometheus)

The HTTP and MCP HTTP servers expose a Prometheus-compatible `/metrics` endpoint with low-cardinality counters and histograms.

- Endpoints:
  - HTTP API: `http://<host>:<HTTP_API_PORT>/metrics` (default port 7000)
  - MCP HTTP: `http://<host>:<MCP_HTTP_PORT>/metrics` (default port 7001)

- Metrics emitted:
  - `tool_calls_total{adapter,tool,result}` — total tool calls by adapter and tool with `result=success|error`
  - `tool_duration_ms{adapter,tool}` — histogram of tool durations (ms)
  - `layer_latency_ms{adapter,layer}` — histogram of per-layer latencies (ms)
  - `inflight_requests{adapter}` — gauge of in-flight requests per adapter

- Example Prometheus scrape config:
```yaml
scrape_configs:
  - job_name: 'ontology-http'
    static_configs:
      - targets: ['localhost:7000']
  - job_name: 'semantic-code-mcp-http'
    static_configs:
      - targets: ['localhost:7001']
```

Notes:
- Label sets are bounded to prevent cardinality explosions.
- The LSP and CLI adapters can be instrumented similarly in future phases (CLI via Pushgateway).

## Layer 4 StoragePort (Ontology) Configuration

Layer 4 persists concepts and relations through a pluggable StoragePort. Select the backend via config or environment.

- Adapter selection (default: sqlite):
  - `layers.layer4.adapter: 'sqlite' | 'postgres' | 'triplestore'`

- SQLite options:
  - `layers.layer4.dbPath`: path to the SQLite DB file (default: `.semantic-graph/semantic-graph.db`)

- Postgres options:
  - Install the `pg` package in your environment.
  - Provide a connection string using one of:
    - `ONTOLOGY_PG_URL`
    - `DATABASE_URL`
    - `PG_URL` or `PGURL`
  - Example:
    - `export ONTOLOGY_PG_URL=postgres://user:pass@localhost:5432/ontology`
  - Set adapter:
    - `layers.layer4.adapter: postgres`

## MCP/HTTP/CLI Parity (New)

### HTTP: Generic Tools Endpoint

- `POST /api/v1/tools/call`
  - Body: `{ "name": "<toolName>", "arguments": { ... } }`
  - Returns: `{ success: true, result: <MCP tool result> }`
  - Example:
    ```bash
    curl -sS -X POST \
      -H 'content-type: application/json' \
      http://localhost:${HTTP_API_PORT:-7000}/api/v1/tools/call \
      -d '{"name":"get_snapshot","arguments":{"preferExisting":true}}' | jq .
    ```

### CLI Workflows

- Generic: `semantic-code-intelligence workflow <name> --args '<json>' [--args-file file] [--json]`
  - Example: `semantic-code-intelligence workflow locate_confirm_definition --args '{"symbol":"TestClass","file":"tests/fixtures/example.ts"}'`

- Rename safely (alias of `rename_safely` tool):
  - `semantic-code-intelligence rename-safely <oldName> <newName> [-f file] [--no-checks] [--cmd <command...>] [-t sec] [--json]`

- Patch checks in snapshot (alias of `patch_checks_in_snapshot`):
  - `semantic-code-intelligence patch-checks-in-snapshot [-s snapshot] [-p patch.diff] [--cmd <command...>] [-t sec] [--only-touched] [--json]`

### Dev UX Env Defaults

- `FAST_STDIO_CHECKS=touched` (default in `mcp-wrapper.sh`): run quick type checks for touched TS files inside snapshots when commands are omitted.
- `SNAPSHOT_PARTIAL=1`: partial snapshot materialization (only touched files + essentials).
- `L4_AUGMENT_EXPLORE=1`: opt-in conceptual hints for explore flows.

### Learning Pipelines (Dev)

Pipelines are enabled by default in dev. They persist to the same SQLite database used by L4/L5 and are safe to run locally.

- List pipelines:
  - CLI: `semantic-code-intelligence pipelines list`
  - HTTP: `POST /api/v1/tools/call` body `{ "name": "list_pipelines", "arguments": {} }`
- Run a pipeline manually (returns a run id):
  - CLI: `semantic-code-intelligence pipelines run pattern_feedback_cycle`
  - HTTP: `POST /api/v1/tools/call` body `{ "name": "run_pipeline", "arguments": { "id": "pattern_feedback_cycle" } }`
- Inspect recent runs:
  - CLI: `semantic-code-intelligence pipelines runs pattern_feedback_cycle --limit 5`
  - HTTP: `POST /api/v1/tools/call` body `{ "name": "list_pipeline_runs", "arguments": { "id": "pattern_feedback_cycle", "limit": 5 } }`

- Inspect status and run details (HTTP endpoints):
  - Status: `GET /api/v1/pipelines/status?id=pattern_feedback_cycle`
  - Run detail: `GET /api/v1/pipelines/run?id=pattern_feedback_cycle&runId=<uuid>`
  - Stream (NDJSON): `POST /api/v1/pipelines/run-stream` body `{ "id": "pattern_feedback_cycle", "timeoutSec": 120, "pollMs": 300 }`
  - Register (dev-only): `POST /api/v1/pipelines` body `{ id, name, components:[...], trigger, schedule?, enabled? }`

Notes:
- No special env flags are required; the orchestrator initializes with default pipelines in dev/test.
- Set `SILENT_MODE=1` to reduce logs during CLI/MCP workflows.
- All pipeline execution occurs within the process with budgeted times; results are summarized in `pipeline_runs`.

Troubleshooting:
- If `run-stream` emits `{ "event": "timeout", ... }`, re-run with a larger `timeoutSec` (max 600).

- Triple Store options:
  - Adapter is scaffolded but CRUD is not implemented yet.

Notes:
- If Postgres is not configured, the adapter’s `initialize()` will no-op and related tests are skipped.
- For production deployments, use managed Postgres with pooling and SSL; configure timeouts and budgets per SLOs.

### Metrics & Dashboards

- HTTP metrics endpoints:
  - JSON: `GET /metrics` → consolidated metrics for L1, L2, and L4.
    - L1 (Fast Search): `{ searches, cacheHits, fallbacks, timeouts, avgResponseTime, asyncTools: { processPoolSize, defaultTimeout } }`
    - L2 (AST Parser): `{ count, errors, p50, p95, p99 }`
    - L4 (Storage): `{ startedAt, updatedAt, operations: { op -> { count, errors, p50, p95, p99 } }, extras: { skippedRepresentationsSave, skippedRepresentationsLoad } }`
  - Prometheus: `GET /metrics?format=prometheus` → text exposition format with series for L1/L2/L4.
    - L1: `ontology_l1_timeouts_total`, `ontology_l1_fallbacks_total`, `ontology_l1_avg_response_ms`
    - L2: `ontology_l2_parse_count`, `ontology_l2_parse_errors`, `ontology_l2_parse_duration_ms{quantile="p50|p95|p99"}`
    - L4: `ontology_l4_operation_count{op}`, `ontology_l4_operation_errors{op}`, `ontology_l4_operation_duration_ms{op,quantile="p50|p95|p99"}`, `ontology_l4_started_at_seconds`, `ontology_l4_updated_at_seconds`

- Prometheus scrape config is provided at `config/prometheus/prometheus.yml` (HTTP job at port 7000, path `/metrics`).

- Grafana dashboard: see `config/grafana/dashboards/layer4-storage-metrics.json` (basic timeseries panels for counts, errors, p95/p99).

## Performance Testing Overrides (Perf Suite)

These environment variables are used to tune and stabilize perf tests
on different hosts. Defaults target typical developer machines; CI may
override as needed.

- Async search timeout override:
  - `ENHANCED_GREP_DEFAULT_TIMEOUT_MS` (number, optional)
  - `ENHANCED_GREP_MAX_PROCESSES` (number, optional) — align async process pool with host cores or override explicitly

- Perf thresholds (consumed by perf tests):
  - `PERF_P95_TARGET_MS` (default 150)
  - `PERF_P99_TARGET_MS` (default 200)
  - `PERF_CONCURRENCY_P95_TARGET_MS` (default 200)

Guidance:
- Run a warm‑up iteration in perf tests to pre‑warm caches and minimize
  cold‑start noise.
- Prefer deterministic, synthetic fixtures for “large codebase”
  scenarios to reduce I/O variance.

## CLI Stats

- `semantic-code-intelligence stats` prints a concise per-layer metrics summary:
  - L1 searches/cache hits/fallbacks/timeouts/average latency, plus async pool size and default timeout
  - L2 parse counts/errors and p50/p95
  - L4 storage operation counts/errors and duration quantiles


## Configuration API Reference

### `getEnvironmentConfig()`
Returns the current configuration based on environment.

### `getTestConfig()`
Returns configuration optimized for testing.

### `getServiceUrl(service: string)`
Returns the full URL for a service.

### `validatePorts(config: ServerConfig)`
Validates port configuration for conflicts.

### `logConfig(config: ServerConfig)`
Logs the current configuration for debugging.
