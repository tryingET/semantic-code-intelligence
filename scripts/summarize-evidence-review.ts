#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : null;
}

const inputPath = argValue('--input') || '.test-results/alpha-evidence-packet.json';
const format = argValue('--format') || 'markdown';
const extract = argValue('--extract');

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function arr(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: any): string[] {
  return arr(value).map(String).filter(Boolean);
}

function firstValidationPlan(packet: any): any | null {
  const candidates = [
    packet?.previewFirstMutation?.validationPlanSample,
    ...(arr(packet?.checkRecommendations?.calls).map((call: any) => call?.payload?.validationPlan)),
    ...(arr(packet?.previewFirstMutation?.structuralCalls).map((call: any) => call?.payload?.validationPlan)),
  ];
  return candidates.find((plan: any) => plan?.schema === 'semantic-code-intelligence.validation_plan.v1') || null;
}

function detectInput(raw: any): { kind: string; payload: any; packet?: any } {
  if (extract === 'validationPlan') {
    const plan = raw?.schema === 'semantic-code-intelligence.validation_plan.v1' ? raw : firstValidationPlan(raw);
    if (!plan) throw new Error('No validationPlan found for --extract validationPlan');
    return { kind: 'validation_plan', payload: plan, packet: raw };
  }
  if (raw?.schema === 'semantic-code-intelligence.validation_plan.v1') return { kind: 'validation_plan', payload: raw };
  if (raw?.schema === 'semantic-code-intelligence.alpha_evidence_packet.v1') return { kind: 'alpha_packet', payload: raw };
  if (raw?.schema === 'semantic-code-intelligence.target_validation_plan_dogfood.v1') return { kind: 'target_dogfood', payload: raw };
  throw new Error(`Unsupported evidence schema: ${raw?.schema || 'unknown'}`);
}

function normalizeValidationPlan(plan: any, packet?: any) {
  const graph = plan?.graphImpact || {};
  return {
    schema: 'semantic-code-intelligence.evidence_review.v1',
    source: { kind: 'validation_plan', schema: plan?.schema || null, workflow: plan?.workflow || null },
    outcome: {
      ok: plan?.checks?.ok === true,
      status: plan?.status || null,
      previewOnly: plan?.apply?.applied !== true,
      applied: plan?.apply?.applied === true,
      productionReady: false,
    },
    scope: {
      touchedFiles: strings(plan?.touchedFiles),
      risk: plan?.risk || null,
      target: packet?.target || null,
    },
    commands: {
      selected: strings(plan?.commands?.selected),
      recommendedMinimum: strings(plan?.commands?.recommendedMinimum),
      recommendedBroader: strings(plan?.commands?.recommendedBroader),
      recommendationsAppliedToSelected: plan?.commands?.recommendationsAppliedToSelected === true,
      rationale: arr(plan?.rationale),
    },
    checks: {
      ok: plan?.checks?.ok === true,
      elapsedMs: typeof plan?.checks?.elapsedMs === 'number' ? plan.checks.elapsedMs : null,
      commands: plan?.checks?.commands || null,
    },
    graphImpact: {
      hasImpactEvidence: graph?.hasImpactEvidence === true,
      counts: graph?.counts || {},
      limitations: strings(graph?.limitations),
      planningHints: strings(graph?.planningHints),
    },
    artifacts: plan?.artifacts || {},
    rollback: {
      available: !!plan?.rollback?.command,
      command: plan?.rollback?.command || null,
    },
    safety: {
      sourceMutated: plan?.apply?.applied === true,
      targetStatusPreserved: packet?.target?.statusPreserved ?? packet?.target?.cleanAfter ?? null,
      authorityBoundary: 'AK remains task/evidence authority where registered; this review is not canonical state.',
      productionBoundary: 'Alpha evidence is not production readiness.',
    },
    operatorQuestions: [
      'Is this evidence enough to continue, or should the operator stop and inspect details?',
      'Did the executed checks match the risk of the change?',
    ],
  };
}

function normalizeAlphaPacket(packet: any) {
  const plan = firstValidationPlan(packet);
  const base = plan ? normalizeValidationPlan(plan, packet) : normalizeValidationPlan({ schema: 'semantic-code-intelligence.validation_plan.v1', workflow: 'alpha_evidence_packet', checks: { ok: packet?.ok === true }, commands: {} }, packet);
  return {
    ...base,
    source: { kind: 'alpha_packet', schema: packet?.schema || null, workflow: 'alpha_evidence_packet' },
    outcome: {
      ...base.outcome,
      ok: packet?.ok === true,
      status: packet?.ok === true ? 'evidence_packet_ok' : 'evidence_packet_not_ok',
      previewOnly: true,
      applied: false,
    },
    scope: {
      ...base.scope,
      touchedFiles: base.scope.touchedFiles,
      target: null,
      toolCoverageCount: packet?.toolCoverage?.alphaSummaryCount || 0,
    },
    checks: {
      ...base.checks,
      ok: packet?.evidenceGate?.ok === true,
      failedGateChecks: strings(packet?.evidenceGate?.failedChecks),
      budgetsMs: packet?.evidenceGate?.budgetsMs || null,
    },
    graphImpact: {
      hasImpactEvidence: packet?.graphImpact?.fileImpact?.hasImpactEvidence === true || base.graphImpact.hasImpactEvidence,
      counts: packet?.graphImpact?.fileImpact?.counts || base.graphImpact.counts,
      limitations: strings(packet?.graphImpact?.symbolImpact?.limitations).concat(base.graphImpact.limitations),
      planningHints: strings(packet?.graphImpact?.fileImpact?.planningHints).concat(base.graphImpact.planningHints),
      callerContextCount: packet?.graphImpact?.impact?.callerContext?.callerContextCount || packet?.graphImpact?.fileImpact?.callerContextCount || null,
    },
    safety: {
      ...base.safety,
      sourceMutated: false,
      alphaPacketProves: strings(packet?.operatorSummary?.proves),
      alphaPacketDoesNotProve: strings(packet?.operatorSummary?.doesNotProve),
    },
  };
}

function normalizeTargetDogfood(evidence: any) {
  const plan = arr(evidence?.calls).map((call: any) => call?.payload?.validationPlan).find((p: any) => p?.schema === 'semantic-code-intelligence.validation_plan.v1');
  const base = normalizeValidationPlan(plan || { schema: 'semantic-code-intelligence.validation_plan.v1', workflow: 'target_validation_plan_dogfood', checks: { ok: evidence?.ok === true }, commands: {} }, evidence);
  return {
    ...base,
    source: { kind: 'target_dogfood', schema: evidence?.schema || null, workflow: 'target_validation_plan_dogfood' },
    outcome: { ...base.outcome, ok: evidence?.ok === true, status: evidence?.ok === true ? 'target_dogfood_ok' : 'target_dogfood_not_ok' },
    scope: { ...base.scope, target: evidence?.target || null, sourceKind: evidence?.selectedPaths?.sourceKind || null },
    safety: { ...base.safety, targetStatusPreserved: evidence?.target?.statusPreserved === true || evidence?.target?.cleanAfter === true },
  };
}

function normalize(raw: any) {
  const detected = detectInput(raw);
  if (detected.kind === 'validation_plan') return normalizeValidationPlan(detected.payload, detected.packet);
  if (detected.kind === 'alpha_packet') return normalizeAlphaPacket(detected.payload);
  if (detected.kind === 'target_dogfood') return normalizeTargetDogfood(detected.payload);
  throw new Error(`Unsupported kind: ${detected.kind}`);
}

function bullet(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}

function renderMarkdown(review: any): string {
  const commands = review.commands || {};
  const graph = review.graphImpact || {};
  const artifacts = review.artifacts || {};
  const safety = review.safety || {};
  return `# SCI evidence review\n\n` +
    `## 1. Outcome banner\n\n` +
    `- Source: ${review.source.kind} (${review.source.schema || 'unknown'})\n` +
    `- Workflow: ${review.source.workflow || 'unknown'}\n` +
    `- OK: ${review.outcome.ok}\n` +
    `- Status: ${review.outcome.status || 'unknown'}\n` +
    `- Preview-only: ${review.outcome.previewOnly}\n` +
    `- Applied: ${review.outcome.applied}\n` +
    `- Production-ready: false — Alpha evidence is not production readiness.\n\n` +
    `Operator question: Is this evidence enough to continue, or should the operator stop and inspect details?\n\n` +
    `## 2. Changed or affected scope\n\n` +
    `- Touched files:\n${bullet(strings(review.scope.touchedFiles))}\n` +
    `- Risk: ${review.scope.risk ? JSON.stringify(review.scope.risk) : 'not recorded'}\n` +
    `- Target: ${review.scope.target ? JSON.stringify(review.scope.target) : 'not a target-dogfood review'}\n\n` +
    `## 3. Validation commands\n\n` +
    `Selected commands actually run:\n${bullet(strings(commands.selected))}\n\n` +
    `Recommended minimum commands (advisory):\n${bullet(strings(commands.recommendedMinimum))}\n\n` +
    `Recommended broader commands (advisory):\n${bullet(strings(commands.recommendedBroader))}\n\n` +
    `- Recommendations applied to selected: ${commands.recommendationsAppliedToSelected === true}\n` +
    `- Rationale count: ${arr(commands.rationale).length}\n\n` +
    `## 4. Check results\n\n` +
    `- Checks OK: ${review.checks.ok}\n` +
    `- Elapsed ms: ${review.checks.elapsedMs ?? 'not recorded'}\n` +
    `- Failed gate checks: ${strings(review.checks.failedGateChecks).join(', ') || 'none'}\n\n` +
    `Operator question: Did the executed checks match the risk of the change?\n\n` +
    `## 5. Graph and impact evidence\n\n` +
    `- Has impact evidence: ${graph.hasImpactEvidence}\n` +
    `- Counts: ${JSON.stringify(graph.counts || {})}\n` +
    `- Caller context count: ${graph.callerContextCount ?? 'not recorded'}\n` +
    `- Limitations/fallback notes:\n${bullet(strings(graph.limitations))}\n` +
    `- Planning hints:\n${bullet(strings(graph.planningHints))}\n\n` +
    `## 6. Snapshot and artifacts\n\n` +
    `- Overlay diff: ${artifacts.overlayDiff || 'not recorded'}\n` +
    `- Status: ${artifacts.status || 'not recorded'}\n` +
    `- Progress: ${artifacts.progress || 'not recorded'}\n` +
    `- Rollback available: ${review.rollback.available}\n` +
    `- Rollback command: ${review.rollback.command || 'not recorded'}\n\n` +
    `## 7. Safety and authority boundary\n\n` +
    `- Source mutated: ${safety.sourceMutated === true}\n` +
    `- Target status preserved: ${safety.targetStatusPreserved ?? 'not applicable'}\n` +
    `- Authority: ${safety.authorityBoundary}\n` +
    `- Boundary: ${safety.productionBoundary}\n`;
}

const raw = readJson(inputPath);
const review = normalize(raw);
if (format === 'json') {
  console.log(JSON.stringify(review, null, 2));
} else if (format === 'markdown') {
  console.log(renderMarkdown(review));
} else {
  throw new Error(`Unsupported --format ${format}; expected markdown or json`);
}
