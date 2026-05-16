## Principles for a high‑quality software foundation (one page)
1) **Outcome‑driven & constraint‑aware** — make objectives, **MUST/MUST‑NOT** rules, and risk bounds explicit up front.  
2) **Contract‑first boundaries** — describe sync APIs with **OpenAPI**; async channels with **AsyncAPI**; keep invariants & SLOs in those contracts.  
3) **Modular monolith first** — split only for distinct SLOs, compliance, or scaling; single writer per aggregate.  
4) **Reliability as a budgeted property** — define SLIs/SLOs; use **error budgets** to gate changes.  
5) **Delivery health (DORA)** — track deploy frequency, lead time, change‑fail rate, time‑to‑restore.  
6) **Observability by design** — traces/metrics/logs via **OpenTelemetry**; correlation IDs across boundaries.  
7) **12‑Factor hygiene** — config in env, stateless services, reproducible builds, one‑command deploys.  
8) **Risk‑proportionate testing** — unit + property‑based + **contract tests** (OpenAPI/AsyncAPI) + integration + load/resilience (timeouts, jitter, circuit breakers).  
9) **Security & privacy as policy‑as‑code** — secret scanning, dep/IaC scans, least privilege, PII tagging, data lineage.  
10) **Change safety & reversibility** — feature flags, canary, blue/green, tested rollback; forward/backward‑compatible migrations.  
11) **Cost & capacity as first‑class** — dashboards for cost/1k events, queue depth, saturation; autoscaling aligned to SLOs.  
12) **Knowledge compounding** — ADRs for big decisions; assumption & prediction ledgers; promote reusable components to a small “IP vault”.  
〔This mirrors your 6E structure (Constraints/Boundaries/Edges/Assumptions/Dependencies/Exceptions) feeding CLARITY’s constraints‑first loop.〕 :contentReference[oaicite:10]{index=10} :contentReference[oaicite:11]{index=11} :contentReference[oaicite:12]{index=12}

## Tech‑stack (default lane)
@docs/tech-stack-py.md # default

> To switch lanes later, replace the import above with **@docs/tech-stack-ts.md** or **@docs/tech-stack-go.md**. (Keep only one imported at a time to avoid conflicting defaults.)
