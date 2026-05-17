#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const outputPath = '.test-results/validation-plan-comparison.json';

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function selected(plan: any): string[] {
  return Array.isArray(plan?.commands?.selected) ? plan.commands.selected.map(String) : [];
}

function minimum(plan: any): string[] {
  return Array.isArray(plan?.commands?.recommendedMinimum) ? plan.commands.recommendedMinimum.map(String) : [];
}

function normalize(plan: any) {
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

const recommendChecks = readJson('.test-results/recommend-checks-dogfood.json');
const safeWrite = readJson('.test-results/safe-write-dogfood.json');
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
  return { source: item.source, ok: failures.length === 0, failures, guidance: explainFailures(failures), expected, actual: item };
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
  ok: plans.length >= 2 && drift.length === 0,
  comparedPlanCount: plans.length,
  stableFields: ['schema', 'workflow', 'mode', 'selectedCommands', 'recommendationsAppliedToSelected', 'checksOk', 'hasArtifacts', 'hasRollback'],
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
    ],
    does_not_prove: ['Historical trend analysis beyond the current generated evidence bundle.'],
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, process.argv.includes('--pretty') ? 2 : 0));
if (!evidence.ok) process.exitCode = 1;
