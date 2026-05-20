#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const evidenceRoot = process.env.SCI_VALIDATION_PLAN_EVIDENCE_ROOT || '.test-results';
const outputPath = join(evidenceRoot, 'validation-plan-comparison.json');

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function selected(plan: any): string[] {
  return Array.isArray(plan?.commands?.selected) ? plan.commands.selected.map(String) : [];
}

function minimum(plan: any): string[] {
  return Array.isArray(plan?.commands?.recommendedMinimum) ? plan.commands.recommendedMinimum.map(String) : [];
}

function strings(value: any): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

const allowedGraphEvidenceStatuses = new Set(['evidence', 'limited', 'empty_or_unavailable']);

function normalizeGraphImpact(graphImpact: any) {
  if (!graphImpact || typeof graphImpact !== 'object') {
    return {
      present: false,
      seed: null,
      requestedEdges: [],
      edgeEvidence: [],
      limitationsFieldPresent: false,
      hasStableContext: false,
    };
  }
  const seed = graphImpact.seed && typeof graphImpact.seed === 'object'
    ? { kind: String(graphImpact.seed.kind || ''), value: String(graphImpact.seed.value || '') }
    : null;
  const requestedEdges = strings(graphImpact.requestedEdges);
  const edgeEvidence = Array.isArray(graphImpact.evidence)
    ? graphImpact.evidence.map((item: any) => ({
        edge: String(item?.edge || ''),
        status: String(item?.status || ''),
        count: Number(item?.count || 0),
        limitations: strings(item?.limitations),
      })).filter((item: any) => item.edge && item.status)
    : [];
  const evidenceByEdge = new Map(edgeEvidence.map((item: any) => [item.edge, item]));
  const requestedEdgesCovered = requestedEdges.length > 0 && requestedEdges.every((edge) => evidenceByEdge.has(edge));
  const statusesValid = edgeEvidence.every((item: any) => allowedGraphEvidenceStatuses.has(item.status));
  const countsValid = edgeEvidence.every((item: any) => Number.isFinite(item.count) && item.count >= 0);
  const limitedEdgesExplainLimitations = edgeEvidence.every((item: any) => item.status !== 'limited' || item.limitations.length > 0);
  return {
    present: true,
    seed,
    requestedEdges,
    edgeEvidence,
    limitationsFieldPresent: Array.isArray(graphImpact.limitations),
    hasStableContext:
      !!seed?.kind &&
      !!seed?.value &&
      requestedEdgesCovered &&
      statusesValid &&
      countsValid &&
      limitedEdgesExplainLimitations,
  };
}

function normalize(plan: any) {
  const graphImpact = normalizeGraphImpact(plan?.graphImpact);
  return {
    schema: plan?.schema || null,
    workflow: plan?.workflow || null,
    mode: plan?.mode || null,
    status: plan?.status || null,
    selectedCommands: selected(plan),
    recommendedMinimum: minimum(plan),
    recommendationsAppliedToSelected: plan?.commands?.recommendationsAppliedToSelected === true,
    checksOk: plan?.checks?.ok === true,
    applied: plan?.apply?.applied === true,
    hasArtifacts: !!plan?.artifacts?.overlayDiff,
    hasRollback: !!plan?.rollback?.command,
    riskCategory: plan?.risk?.category || null,
    graphImpactPresent: graphImpact.present,
    graphImpactSeed: graphImpact.seed,
    graphImpactRequestedEdges: graphImpact.requestedEdges,
    graphImpactEdgeEvidence: graphImpact.edgeEvidence,
    graphImpactLimitationsFieldPresent: graphImpact.limitationsFieldPresent,
    graphImpactHasStableContext: graphImpact.hasStableContext,
  };
}

function fromRecommendChecksEvidence(evidence: any) {
  const calls = Array.isArray(evidence?.calls) ? evidence.calls : [];
  return calls
    .map((call: any) => ({ source: `recommend-checks:${call?.caseName || call?.name || 'unknown'}`, plan: call?.payload?.validationPlan }))
    .filter((item: any) => item.plan?.schema === 'semantic-code-intelligence.validation_plan.v1');
}

function fromSafeWriteEvidence(evidence: any) {
  const calls = Array.isArray(evidence?.calls) ? evidence.calls : [];
  return calls
    .map((call: any, index: number) => ({ source: `safe-write:${call?.payload?.mode || index}`, plan: call?.payload?.validationPlan }))
    .filter((item: any) => item.plan?.schema === 'semantic-code-intelligence.validation_plan.v1');
}

const recommendChecks = readJson(join(evidenceRoot, 'recommend-checks-dogfood.json'));
const safeWrite = readJson(join(evidenceRoot, 'safe-write-dogfood.json'));
const plans = [...fromRecommendChecksEvidence(recommendChecks), ...fromSafeWriteEvidence(safeWrite)];
const normalized = plans.map((item) => ({ source: item.source, ...normalize(item.plan) }));

const failureGuidance: Record<string, { explanation: string; remediation: string }> = {
  schema_changed: {
    explanation: 'The validationPlan schema changed, so downstream harnesses may not recognize the evidence shape.',
    remediation: 'Confirm the schema change is intentional; update docs, packet readers, and alpha evidence checks in the same wave.',
  },
  recommendations_started_mutating_selected_commands: {
    explanation: 'Advisory recommendations appear to have changed the selected commands, which would turn suggestions into hidden policy.',
    remediation: 'Keep selected commands sourced from caller input/defaults; expose recommendations separately under recommendedMinimum/recommendedBroader.',
  },
  checks_outcome_changed_for_selected_commands: {
    explanation: 'The check result no longer matches the known dogfood command outcome.',
    remediation: 'Inspect the selected command and check runner output; update the fixture only if the command semantics intentionally changed.',
  },
  selected_commands_missing: {
    explanation: 'The validation plan no longer records which commands actually ran.',
    remediation: 'Populate validationPlan.commands.selected from the exact commands passed to run_checks/safe_write.',
  },
  snapshot_artifact_link_missing: {
    explanation: 'The validation plan no longer links snapshot artifacts, weakening preview/rollback inspectability.',
    remediation: 'Ensure snapshot artifact links are built after snapshot creation and included in validationPlan.artifacts.',
  },
  safe_write_rollback_missing: {
    explanation: 'safe_write validation evidence no longer exposes rollback posture.',
    remediation: 'Restore rollback command/artifact fields for safe_write validationPlan output.',
  },
  graph_impact_context_missing: {
    explanation: 'Generated validationPlan evidence no longer includes a graph-bearing plan, so graph review context can drift unnoticed.',
    remediation: 'Thread graph_expand impactSummary into at least one preview/check dogfood validationPlan and preserve seed, requested edges, edge status, and limitations.',
  },
  graph_impact_context_incomplete: {
    explanation: 'A graph-bearing validationPlan is missing stable graph context fields needed for evidence review.',
    remediation: 'Preserve validationPlan.graphImpact seed, requestedEdges, per-edge evidence/status, and limitations as stable non-volatile fields.',
  },
};

function explainFailures(failures: string[]) {
  return failures.map((failure) => ({
    failure,
    explanation: failureGuidance[failure]?.explanation || 'Unexpected validation-plan drift.',
    remediation: failureGuidance[failure]?.remediation || 'Inspect validationPlan output and update comparison expectations only if the drift is intentional.',
  }));
}

const comparisons = normalized.map((item) => {
  const expectedChecksOk = item.selectedCommands.includes('false') ? false : true;
  const expected: Record<string, unknown> = {
    schema: 'semantic-code-intelligence.validation_plan.v1',
    recommendationsAppliedToSelected: false,
    checksOk: expectedChecksOk,
  };
  const failures: string[] = [];
  if (item.schema !== expected.schema) failures.push('schema_changed');
  if (item.recommendationsAppliedToSelected !== false) failures.push('recommendations_started_mutating_selected_commands');
  if (item.checksOk !== expectedChecksOk) failures.push('checks_outcome_changed_for_selected_commands');
  if (!item.selectedCommands.length) failures.push('selected_commands_missing');
  if (!item.hasArtifacts) failures.push('snapshot_artifact_link_missing');
  if (item.workflow === 'safe_write' && !item.hasRollback) failures.push('safe_write_rollback_missing');
  if (item.graphImpactPresent && (!item.graphImpactHasStableContext || !item.graphImpactLimitationsFieldPresent)) failures.push('graph_impact_context_incomplete');
  return { source: item.source, ok: failures.length === 0, failures, guidance: explainFailures(failures), expected, actual: item };
});
const graphContextPlanCount = normalized.filter((item) => item.graphImpactHasStableContext && item.graphImpactLimitationsFieldPresent).length;
comparisons.push({
  source: 'bundle:graph-impact-context',
  ok: graphContextPlanCount >= 1,
  failures: graphContextPlanCount >= 1 ? [] : ['graph_impact_context_missing'],
  guidance: graphContextPlanCount >= 1 ? [] : explainFailures(['graph_impact_context_missing']),
  expected: { graphContextPlanCount: '>=1' },
  actual: { graphContextPlanCount },
});

const drift = comparisons.filter((item) => !item.ok);
const operatorSummary = {
  status: drift.length === 0 ? 'no_validation_plan_drift' : 'validation_plan_drift_detected',
  summary: drift.length === 0
    ? 'Stable validationPlan fields match current dogfood expectations.'
    : `${drift.length} validationPlan comparison(s) drifted; inspect remediation hints before trusting check-plan evidence.`,
  remediationHints: drift.flatMap((item) => item.guidance.map((hint: any) => ({ source: item.source, ...hint }))),
};
const evidence = {
  schema: 'semantic-code-intelligence.validation_plan_comparison.v1',
  ok: plans.length >= 2 && graphContextPlanCount >= 1 && drift.length === 0,
  comparedPlanCount: plans.length,
  graphContextPlanCount,
  stableFields: ['schema', 'workflow', 'mode', 'selectedCommands', 'recommendationsAppliedToSelected', 'checksOk', 'hasArtifacts', 'hasRollback', 'graphImpactSeed', 'graphImpactRequestedEdges', 'graphImpactEdgeEvidence', 'graphImpactLimitationsFieldPresent'],
  ignoredVolatileFields: ['snapshot', 'elapsedMs', 'artifact paths with snapshot ids', 'generatedAt'],
  comparisons,
  drift,
  operatorSummary,
  remediationCatalog: failureGuidance,
  interpretation: {
    proves: [
      'Current generated validationPlan evidence preserves stable safety/check-planning fields.',
      'Recommendations remain advisory and do not mutate selected commands.',
      'Preview evidence still links snapshot artifacts and safe_write rollback posture.',
      'At least one generated validationPlan preserves graph seed, requested edges, per-edge status, and limitations for evidence review.',
    ],
    does_not_prove: ['Historical trend analysis beyond the current generated evidence bundle.'],
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, process.argv.includes('--pretty') ? 2 : 0));
if (!evidence.ok) process.exitCode = 1;
