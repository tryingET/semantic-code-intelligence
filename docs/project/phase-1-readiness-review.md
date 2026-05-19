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
| Evidence quality | Improved alpha posture | Evidence packet and validation-plan comparison are repeatable; IW45 adds lightweight elapsed-time history comparison, but not durable metrics storage. |
| Graph semantics | Improved alpha posture | File-scoped graph impact is useful; IW46 adds sparse-edge limitations and best-effort caller context, but symbol caller/callee evidence can still be fallback-shaped. |
| External target proof | Improved after IW41/IW43/IW47/IW48/IW49 | Installed/global CLI from multiple non-SCI cwd targets now exercises graph impact, check recommendation, preview/check, validationPlan evidence, cleanup, and clean target posture. IW47 adds a clean sibling JavaScript target proof; IW48 adds a clean worktree proof for the mixed Python/Rust `agent-kernel` repo; IW49 adds a clean worktree Clojure proof. |
| Performance | Alpha guidance plus lightweight history after IW45 | Per-call latency budgets catch obvious regressions; `docs/project/interactive-slo-guidance.md` gives operator-facing bands and IW45 compares generated elapsed-time maxima against an explicit baseline, but not production p95/p99 SLOs. |
| Durable session semantics | Not closed | Snapshot metadata/artifacts are persisted narrowly; no long-lived cross-process session DB is claimed. |
| Production readiness | Not ready | Kubernetes, marketplace, analytics, production deployment, and broad human IDE polish remain non-goals for alpha. |

## Promotion boundary

It is truthful to say:

> Phase 1 Alpha MVP has credible repeatable evidence for the harnessed-LLM coding-session substrate in this repository.

It is **not** yet truthful to say:

> SCI is production-ready, broadly proven across repositories, or ready to prioritize Phase 2 UI/workbench polish.

## Remaining gaps before broader Phase 1 closure

1. **External-repo diversity** — IW41/IW43 proved the validationPlan spine in two non-SCI repos, IW47 adds a sibling JavaScript target, IW48 adds a mixed Python/Rust `agent-kernel` worktree proof, and IW49 adds a Clojure worktree proof. Remaining diversity work should be driven by closure-review findings rather than automatic dogfood accumulation.
2. **Graph richness** — IW46 characterizes symbol-level caller/callee limitations and adds caller context, but whole-program graph richness remains alpha-limited.
3. **Performance posture** — IW44 added operator-facing latency/SLO guidance and IW45 adds lightweight generated-evidence history; still missing production-grade p95/p99 characterization.
4. **Evidence history** — IW45 provides an explicit elapsed-time baseline and current-run comparison, not a durable metrics database or dashboard-grade trend store.
5. **Interface guidance** — IW42 added `docs/project/interface-choice-guide.md`; future work should validate it with more external target sessions.

## Recommended next wave

**IW50 — Phase 1 closure review**

Goal: perform a decision-quality Phase 1 closure review that explicitly separates alpha-usable substrate evidence from remaining production-readiness gaps.

Preference: choose closure review before adding more dogfood so the next work is guided by a decision checkpoint rather than automatic feature/evidence accumulation.

## Closeout conclusion

IW41 completed the first external target validationPlan proof, IW42 documented interface choice guidance, IW43 added a second external target proof, IW44 documented interactive SLO guidance, IW45 added lightweight elapsed-time history comparison, IW46 improved graph fallback characterization/caller context, IW47 added a sibling JavaScript target proof, IW48 added a mixed Python/Rust `agent-kernel` worktree proof, and IW49 added a Clojure worktree proof. Continue to avoid feature accretion until an explicit closure review resolves the remaining readiness ambiguity.
