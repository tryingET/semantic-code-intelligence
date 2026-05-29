#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readEvidenceJsonFile, safeEvidenceError, sanitizeEvidence, writeTextFileNoSymlink } from './evidence-summary-utils';
import { validateGraphImpactContext } from './validation-plan-graph-impact';
import { validateValidationPlanSemantics } from './validation-plan-semantics';

process.on('uncaughtException', (error) => {
  console.error(`validation-plan-compare: ${safeEvidenceError(error)}`);
  process.exit(1);
});

const evidenceRoot = process.env.SCI_VALIDATION_PLAN_EVIDENCE_ROOT || '.test-results';
const outputPath = join(evidenceRoot, 'validation-plan-comparison.json');

function readJson(path: string): any {
  try {
    return readEvidenceJsonFile(path);
  } catch (error) {
    throw new Error(safeEvidenceError(error));
  }
}

function selected(plan: any): string[] {
  return Array.isArray(plan?.commands?.selected) ? plan.commands.selected.map(String) : [];
}

function minimum(plan: any): string[] {
  return Array.isArray(plan?.commands?.recommendedMinimum) ? plan.commands.recommendedMinimum.map(String) : [];
}

function commandReceipts(plan: any): Array<{ command: string; ok: boolean | null }> {
  return Array.isArray(plan?.checks?.commands)
    ? plan.checks.commands.map((item: any) => ({
        command: String(item?.command || ''),
        ok: typeof item?.ok === 'boolean' ? item.ok : null,
      }))
    : [];
}

function selectedCommandImpliesFailure(command: string): boolean {
  return /(?:^|\s)(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*false(?:\s|$)/.test(command);
}

function expectedChecksOk(item: { selectedCommands: string[]; checkCommandReceipts: Array<{ ok: boolean | null }> }): boolean {
  const decisiveReceipts = item.checkCommandReceipts.filter((receipt) => typeof receipt.ok === 'boolean');
  if (decisiveReceipts.length > 0) return decisiveReceipts.every((receipt) => receipt.ok === true);
  return item.selectedCommands.some(selectedCommandImpliesFailure) ? false : true;
}

function normalize(plan: any) {
  const graphImpact = validateGraphImpactContext(plan?.graphImpact);
  const verification = plan?.verification && typeof plan.verification === 'object' ? plan.verification : null;
  const applied = plan?.apply?.applied === true;
  const verificationAppliedDiffMatchesSnapshot = typeof verification?.appliedDiffMatchesSnapshot === 'boolean' ? verification.appliedDiffMatchesSnapshot : null;
  const semantic = validateValidationPlanSemantics(plan);
  const receipts = commandReceipts(plan);
  return {
    schema: plan?.schema || null,
    workflow: plan?.workflow || null,
    mode: plan?.mode || null,
    status: plan?.status || null,
    selectedCommands: selected(plan),
    checkCommandReceipts: receipts,
    recommendedMinimum: minimum(plan),
    recommendationsAppliedToSelected: plan?.commands?.recommendationsAppliedToSelected === true,
    checksOk: plan?.checks?.ok === true,
    applied,
    hasArtifacts: !!plan?.artifacts?.overlayDiff,
    hasRollback: !!plan?.rollback?.command,
    riskCategory: plan?.risk?.category || null,
    verificationPresent: !!verification,
    verificationApplied: verification?.applied === true,
    verificationAppliedDiffMatchesSnapshot,
    verificationSemanticFailures: semantic.failures.map((failure) => failure.code),
    verificationStateComplete: !!verification && semantic.ok,
    graphImpactPresent: graphImpact.present,
    graphImpactSeed: graphImpact.seed,
    graphImpactRequestedEdges: graphImpact.requestedEdges,
    graphImpactEdgeEvidence: graphImpact.edgeEvidence,
    graphImpactLimitationsFieldPresent: graphImpact.limitationsFieldPresent,
    graphImpactValidationFailures: graphImpact.failures,
    graphImpactHasStableContext: graphImpact.hasStableContext,
  };
}

function hasPlanObject(item: any): boolean {
  return !!item?.plan && typeof item.plan === 'object' && !Array.isArray(item.plan);
}

function fromRecommendChecksEvidence(evidence: any) {
  const calls = Array.isArray(evidence?.calls) ? evidence.calls : [];
  return calls
    .map((call: any) => ({ source: `recommend-checks:${call?.caseName || call?.name || 'unknown'}`, plan: call?.payload?.validationPlan }))
    .filter(hasPlanObject);
}

function fromSafeWriteEvidence(evidence: any) {
  const calls = Array.isArray(evidence?.calls) ? evidence.calls : [];
  return calls
    .map((call: any, index: number) => ({ source: `safe-write:${call?.scenario || call?.payload?.mode || index}`, plan: call?.payload?.validationPlan }))
    .filter(hasPlanObject);
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
  safe_write_verification_missing: {
    explanation: 'safe_write validation evidence no longer exposes applied-state verification posture.',
    remediation: 'Thread safe_write verification into validationPlan.verification for preview, refused, clean apply, and dirty-base apply cases.',
  },
  safe_write_verification_incomplete: {
    explanation: 'safe_write validationPlan verification is present but does not preserve applied state or applied-diff match state.',
    remediation: 'Ensure validationPlan.verification.applied mirrors apply.applied and appliedDiffMatchesSnapshot is boolean only for applied states, null for non-applied preview/refusal states.',
  },
  safe_write_verification_coverage_missing: {
    explanation: 'Generated safe_write validationPlan evidence does not include explicitly marked clean and dirty-base verified apply cases.',
    remediation: 'Restore safe_write dogfood coverage for scenario=clean_apply and scenario=dirty_base_apply with appliedDiffMatchesSnapshot=true.',
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
  const expectedOk = expectedChecksOk(item);
  const expected: Record<string, unknown> = {
    schema: 'semantic-code-intelligence.validation_plan.v1',
    recommendationsAppliedToSelected: false,
    checksOk: expectedOk,
  };
  const failures: string[] = [];
  if (item.schema !== expected.schema) failures.push('schema_changed');
  if (item.recommendationsAppliedToSelected !== false) failures.push('recommendations_started_mutating_selected_commands');
  if (item.checksOk !== expectedOk) failures.push('checks_outcome_changed_for_selected_commands');
  if (!item.selectedCommands.length) failures.push('selected_commands_missing');
  if (!item.hasArtifacts) failures.push('snapshot_artifact_link_missing');
  if (item.workflow === 'safe_write' && !item.hasRollback) failures.push('safe_write_rollback_missing');
  if (item.workflow === 'safe_write' && !item.verificationPresent) failures.push('safe_write_verification_missing');
  if (item.workflow === 'safe_write' && item.verificationPresent && !item.verificationStateComplete) failures.push('safe_write_verification_incomplete');
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
const cleanApplyVerificationPlanCount = normalized.filter((item) => item.source === 'safe-write:clean_apply' && item.workflow === 'safe_write' && item.applied === true && item.verificationApplied === true && item.verificationAppliedDiffMatchesSnapshot === true && item.verificationStateComplete).length;
const dirtyBaseVerificationPlanCount = normalized.filter((item) => item.source === 'safe-write:dirty_base_apply' && item.workflow === 'safe_write' && item.applied === true && item.verificationApplied === true && item.verificationAppliedDiffMatchesSnapshot === true && item.verificationStateComplete).length;
const safeWriteVerificationCoverageOk = cleanApplyVerificationPlanCount >= 1 && dirtyBaseVerificationPlanCount >= 1;
comparisons.push({
  source: 'bundle:safe-write-verification-coverage',
  ok: safeWriteVerificationCoverageOk,
  failures: safeWriteVerificationCoverageOk ? [] : ['safe_write_verification_coverage_missing'],
  guidance: safeWriteVerificationCoverageOk ? [] : explainFailures(['safe_write_verification_coverage_missing']),
  expected: { cleanApplyVerificationPlanCount: '>=1', dirtyBaseVerificationPlanCount: '>=1' },
  actual: { cleanApplyVerificationPlanCount, dirtyBaseVerificationPlanCount },
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
  ok: plans.length >= 2 && graphContextPlanCount >= 1 && safeWriteVerificationCoverageOk && drift.length === 0,
  comparedPlanCount: plans.length,
  graphContextPlanCount,
  safeWriteVerificationCoverage: { cleanApplyVerificationPlanCount, dirtyBaseVerificationPlanCount },
  stableFields: ['schema', 'workflow', 'mode', 'selectedCommands', 'recommendationsAppliedToSelected', 'checksOk', 'hasArtifacts', 'hasRollback', 'verificationPresent', 'verificationApplied', 'verificationAppliedDiffMatchesSnapshot', 'graphImpactSeed', 'graphImpactRequestedEdges', 'graphImpactEdgeEvidence', 'graphImpactLimitationsFieldPresent'],
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
      'safe_write validationPlan evidence preserves applied-state verification posture for downstream evidence review.',
      'At least one generated validationPlan preserves graph seed, requested edges, per-edge status, and limitations for evidence review.',
    ],
    does_not_prove: ['Historical trend analysis beyond the current generated evidence bundle.'],
  },
};

const outputEvidence = sanitizeEvidence(evidence);
mkdirSync(dirname(outputPath), { recursive: true });
writeTextFileNoSymlink(outputPath, `${JSON.stringify(outputEvidence, null, 2)}\n`);
console.log(JSON.stringify(outputEvidence, null, process.argv.includes('--pretty') ? 2 : 0));
if (!evidence.ok) process.exitCode = 1;
