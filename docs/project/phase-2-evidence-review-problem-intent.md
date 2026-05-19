---
summary: "Draft problem-intent for Phase 2 evidence review work; not reviewed or ADR-ready."
read_when:
  - "You need the draft problem/intent before reviewing the Phase 2 evidence-review RFC."
  - "You are deciding whether Phase 2 evidence review work should proceed to RFC review."
  - "You need to distinguish draft planning artifacts from superseded AK decisions 46 and 47."
type: "draft"
---

# Phase 2 evidence review — problem intent draft

Date: 2026-05-19  
Wave: IW56 — Phase 2 problem-intent and RFC draft  
Status: **draft only; not reviewed; not ADR-ready**

## Authority note

This document is a draft planning artifact. It is not an accepted AK decision, not a reviewed RFC, and not ADR-ready.

AK decisions `46` and `47` were superseded after the operator rejected unilateral decision lifecycle advancement. This draft must go through explicit review before it can support any ADR or implementation authority.

## Problem

Phase 1 is closed as an Alpha MVP substrate for harnessed-LLM coding sessions, but its evidence is still hard for a human operator to inspect quickly during live work.

The evidence exists in machine-oriented artifacts:

- `validationPlan` objects;
- `.test-results/alpha-evidence-packet.json`;
- graph impact summaries and limitations;
- check recommendation rationale;
- snapshot artifact links;
- safe-write verification and rollback evidence.

These artifacts are sufficient for repeatable validation, but they are not yet optimized for fast operator judgment:

> Should the operator continue, narrow scope, run stronger checks, inspect a graph limitation, or stop because evidence is insufficient?

Without a review surface, operators must manually read raw JSON or trust an agent's summary. That creates two risks:

1. important limitations are missed, especially fallback-shaped graph evidence or advisory-vs-selected command differences;
2. agents may overclaim evidence, production readiness, or authority.

## Intent

Create a minimal, read-only evidence review path that lets a human operator inspect SCI evidence without changing Phase 1 semantics.

The intended outcome is not a dashboard. It is a trustworthy review summary that makes the existing evidence legible.

The review path must preserve these boundaries:

- recommendations remain advisory;
- selected commands remain distinct from recommended commands;
- preview-only results remain visibly preview-only;
- graph fallback/limitations remain visible;
- rollback absence/presence remains visible;
- Alpha evidence is not production readiness;
- AK remains task/evidence authority where registered.

## First user

Primary user:

> A human operator supervising a harnessed LLM coding session using SCI for discovery, patch planning, validation, and evidence.

Secondary user:

> A maintainer reviewing evidence after a session to understand why a change was considered safe or unsafe.

## Scope boundary

In scope for RFC review:

- read-only evidence summary contract;
- normalized evidence-review shape;
- markdown/JSON review output;
- host handoff requirements for future Pi/operator-workbench rendering;
- validation checks that prove no mutation or hidden command selection.

Out of scope:

- VS Code extension;
- full dashboard;
- persistent UI state;
- production deployment;
- production SLOs;
- hidden validation command selection;
- new mutation/apply semantics;
- accepted AK decision lifecycle advancement without explicit review.

## Success criteria

A reviewed RFC should make these decisions explicit:

1. whether SCI should own only the summary producer or also a rendered surface;
2. what fields a review summary must expose;
3. how the summary is validated against existing evidence samples;
4. what future host integration may consume;
5. what remains non-authoritative until a later ADR or implementation wave.

## Open questions for RFC review

1. Should the initial integration remain CLI/markdown only, or should a host handoff be prepared immediately?
2. Is `semantic-code-intelligence.evidence_review.v1` sufficient as a compatibility shape?
3. Should target-dogfood evidence and alpha-packet evidence share one rendering path or have separate sections?
4. What review outcome is required before any Pi/operator-workbench integration begins?
5. What exact artifacts should an ADR cite if this proceeds?
