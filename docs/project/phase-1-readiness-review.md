---
summary: "IW40 Phase 1 closeout/readiness review for the harnessed-LLM Alpha MVP."
read_when:
  - "You need the current Phase 1 promotion posture."
  - "You are deciding whether to keep hardening Phase 1 or start Phase 2 work."
  - "You are reviewing alpha evidence, validation gaps, or remaining risks."
type: "review"
---

# Phase 1 readiness review — harnessed LLM substrate

Date: 2026-05-18  
Wave: IW40 — Phase 1 closeout readiness review

## Decision posture

**Posture: Alpha MVP substrate is credible for the first user, but Phase 1 should not be declared broadly closed or production-ready.**

SCI now has enough repeatable evidence to treat the harnessed-LLM coding-session substrate as alpha-usable for bounded navigation, preview-first patch planning, explicit checks, guarded apply, rollback evidence, and operator-readable validation planning.

The recommended next move is **targeted hardening and external-repo dogfood**, not more feature accretion inside the SCI repo. Phase 2 developer-workbench work should wait until at least one more nontrivial target-repo/global-CLI proof exercises the current validation-plan spine outside this repository.

## Evidence reviewed

Primary validation surface:

```bash
bun run alpha:mvp:check
```

Current bundle covers:

- registry/discovery for the Alpha MVP tool surface;
- HTTP `/api/v1/tools/call` bounded read/navigation/patch-planning paths;
- direct `MCPAdapter` parity for bounded reads and navigation;
- MCP HTTP JSON-RPC tools/list and representative tools/call behavior;
- MCP stdio initialization, tools/list, read/navigation, and preview-first patch checks with protocol-clean stdout;
- CLI workflow fallback for machine-readable local tool calls;
- self-hosted SCI-first discovery before patch planning;
- ast-grep structural search and preview-first structural patch checks;
- graph impact summaries with edge counts/status and planning hints;
- impact-aware check recommendations for docs-only, TS source, test-file, and graph-impact cases;
- validationPlan summaries for preview/check workflows;
- validation-plan stable-field comparison with remediation hints;
- safe_write preview/check by default, guarded apply, exact applied-diff verification, dirty mismatch fail-closed proof, and rollback proof;
- migration hygiene for product identity/path/artifact safety.

Generated evidence surfaces reviewed:

- `.test-results/alpha-mvp-dogfood.json`
- `.test-results/self-hosted-cli-dogfood.json`
- `.test-results/structural-workflow-dogfood.json`
- `.test-results/graph-impact-dogfood.json`
- `.test-results/recommend-checks-dogfood.json`
- `.test-results/safe-write-dogfood.json`
- `.test-results/validation-plan-comparison.json`
- `.test-results/alpha-evidence-check.json`
- `.test-results/alpha-evidence-packet.json`

## Readiness assessment

| Area | Status | Notes |
|---|---|---|
| First-user fit | Ready for alpha use | The substrate directly supports harnessed LLM navigation, patch planning, check recommendation, and evidence reporting. |
| Mutation safety | Strong alpha posture | Preview-first default, guarded apply, exact applied-diff verification, rollback artifact, and dirty mismatch fail-closed evidence are present. |
| Interface coverage | Credible alpha coverage | HTTP, MCP HTTP, MCP stdio, direct adapter tests, and CLI fallback are all exercised. |
| Evidence quality | Credible but current-run scoped | Evidence packet and validation-plan comparison are repeatable, but not yet historical trend analysis. |
| Graph semantics | Partial | File-scoped graph impact is useful; symbol caller/callee evidence can still be sparse or fallback-shaped. |
| External target proof | Improved after IW41 | Installed/global CLI from a non-SCI cwd now exercises graph impact, check recommendation, preview/check, validationPlan evidence, cleanup, and clean target posture. More target diversity is still needed before broad closure. |
| Performance | Coarse budget only | Per-call latency budgets catch obvious regressions but are not a full interactive SLO characterization. |
| Durable session semantics | Not closed | Snapshot metadata/artifacts are persisted narrowly; no long-lived cross-process session DB is claimed. |
| Production readiness | Not ready | Kubernetes, marketplace, analytics, production deployment, and broad human IDE polish remain non-goals for alpha. |

## Promotion boundary

It is truthful to say:

> Phase 1 Alpha MVP has credible repeatable evidence for the harnessed-LLM coding-session substrate in this repository.

It is **not** yet truthful to say:

> SCI is production-ready, broadly proven across repositories, or ready to prioritize Phase 2 UI/workbench polish.

## Remaining gaps before broader Phase 1 closure

1. **External-repo diversity** — IW41 proved the validationPlan spine in one non-SCI repo; repeat across at least one larger/less TypeScript-centric target before broad closure.
2. **Graph richness** — improve or characterize symbol-level caller/callee limitations so fallback shapes are clearer to harnesses.
3. **Performance posture** — add explicit operator-facing interactive budgets beyond coarse per-call gates.
4. **Evidence history** — current comparison is current-run stable-field comparison, not a durable historical regression store.
5. **Interface guidance** — operators still need a concise explanation for when to choose MCP HTTP, MCP stdio, direct adapter tests, HTTP tools/call, or CLI fallback.

## Recommended next wave

**IW42 — Target diversity / interface guidance hardening**

Goal: either repeat the external validationPlan spine on a second, meaningfully different target repo or write concise operator guidance for choosing CLI, MCP HTTP, MCP stdio, direct adapter tests, and HTTP tools/call.

Preference: run a second external target proof if a clean target is available; otherwise document interface choice guidance from current evidence.

## Closeout conclusion

IW41 completed the first external target validationPlan proof. Continue to avoid SCI-internal feature accretion until either a second external target proof or concise interface-choice guidance reduces the remaining readiness ambiguity.
