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

type EvidenceAbsenceState = 'failed' | 'unavailable' | 'unknown' | 'inapplicable';
type EvidenceDurability = 'ephemeral' | 'reproducible_local' | 'materialized_local' | 'repo_durable' | 'authority_durable';

function evidenceState(kind: string, observed: boolean, failed: boolean, applicable = true): EvidenceAbsenceState | 'observed' {
  if (!applicable) return 'inapplicable';
  if (failed) return 'failed';
  if (observed) return 'observed';
  return kind === 'required' ? 'unavailable' : 'unknown';
}

function claim(id: string, text: string, status: 'supported' | 'weakened' | 'contradicted' | 'unresolved', supportedBy: string[], limitedBy: string[], warrant: string, authorityBoundaries: string[], operatorDecisionPoints: string[]) {
  return { id, claim: text, status, supportedBy, limitedBy, warrant, authorityBoundaries, operatorDecisionPoints };
}

function artifact(id: string, kind: string, schema: string | null, observedStatus: EvidenceAbsenceState | 'observed', durability: EvidenceDurability, uriOrPath: string | null, citationRequirement: string) {
  return { id, kind, schema, observedStatus, durability, uriOrPath, citationRequirement };
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
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

function withConceptualModel(review: any) {
  const selectedCommands = strings(review?.commands?.selected);
  const recommendedMinimum = strings(review?.commands?.recommendedMinimum);
  const recommendedBroader = strings(review?.commands?.recommendedBroader);
  const hasArtifacts = Object.values(review?.artifacts || {}).some(Boolean);
  const rollbackAvailable = review?.rollback?.available === true;
  const checksFailed = review?.checks?.ok === false || strings(review?.checks?.failedGateChecks).length > 0;
  const checksPassedWithObservedCommands = review?.checks?.ok === true && selectedCommands.length > 0;
  const graphObserved = review?.graphImpact?.hasImpactEvidence === true;
  const graphApplicable = review?.source?.kind !== 'target_dogfood' || review?.scope?.sourceKind !== 'unknown';
  const rawLimitations = strings(review?.graphImpact?.limitations);
  const synthesizedGraphLimitations = !graphObserved && graphApplicable && rawLimitations.length === 0
    ? ['graph impact evidence unavailable or not observed; do not infer no impact from absence']
    : [];
  const limitations = rawLimitations.concat(synthesizedGraphLimitations);
  const reviewWithLimitations = {
    ...review,
    graphImpact: {
      ...(review?.graphImpact || {}),
      limitations,
    },
  };

  const validationExecutionState = evidenceState('required', selectedCommands.length > 0, checksFailed);
  const validationExecutionDurability: EvidenceDurability = validationExecutionState === 'observed' || validationExecutionState === 'failed'
    ? 'reproducible_local'
    : 'ephemeral';

  const evidenceArtifacts = [
    artifact('source', reviewWithLimitations?.source?.kind || 'unknown', reviewWithLimitations?.source?.schema || null, 'observed', 'reproducible_local', null, 'cite input schema and command used to generate this review'),
    artifact('validation-execution', 'validation_execution', null, validationExecutionState, validationExecutionDurability, null, 'cite AK evidence id or explicit command transcript when available; local summary output alone is not authority-durable evidence'),
    artifact('graph-impact', 'graph_impact', null, evidenceState('optional', graphObserved, false, graphApplicable), graphObserved ? 'reproducible_local' : 'ephemeral', null, 'cite limitations and regeneration command; do not infer no impact from absence'),
    artifact('snapshot-artifacts', 'snapshot_artifacts', null, evidenceState('optional', hasArtifacts, false), 'ephemeral', firstString([reviewWithLimitations?.artifacts?.overlayDiff, reviewWithLimitations?.artifacts?.status, reviewWithLimitations?.artifacts?.progress]), 'snapshot:// references are pointers, not durable proof, unless materialized or attached to AK evidence'),
    artifact('rollback', 'rollback', null, rollbackAvailable ? 'observed' : 'unavailable', rollbackAvailable ? 'reproducible_local' : 'ephemeral', reviewWithLimitations?.rollback?.command || null, 'cite concrete rollback command or materialized inverse patch; otherwise treat rollback as unavailable'),
  ];

  const authorityBoundaries = [
    { id: 'not-canonical-authority', boundary: reviewWithLimitations?.safety?.authorityBoundary || 'This review is not canonical task/evidence authority.', affectedScope: 'governance' },
    { id: 'not-production-readiness', boundary: reviewWithLimitations?.safety?.productionBoundary || 'Alpha evidence is not production readiness.', affectedScope: 'readiness' },
    { id: 'no-implicit-mutation', boundary: 'Rendering evidence review output must not mutate source, snapshots, target repos, AK, or databases.', affectedScope: 'mutation' },
  ];

  const operatorDecisionPoints = [
    { id: 'continue-or-stop', options: ['continue', 'stop', 'inspect limitations'], supportingClaims: ['checks-result'], limitingClaims: limitations.length ? ['graph-limitations'] : [], residualUncertainty: limitations.length ? 'Graph or impact evidence has visible limitations.' : 'No graph limitation recorded in this review.' },
    { id: 'run-stronger-checks', options: ['accept selected checks', 'run recommended minimum', 'run recommended broader'], supportingClaims: ['command-distinction'], limitingClaims: [], residualUncertainty: recommendedMinimum.length || recommendedBroader.length ? 'Recommended commands remain advisory unless executed.' : 'No additional recommendations recorded.' },
  ];

  const claims = [
    claim(
      'checks-result',
      checksPassedWithObservedCommands ? 'Selected validation checks passed.' : 'Selected validation checks did not prove a clean pass.',
      checksPassedWithObservedCommands ? 'supported' : checksFailed ? 'contradicted' : 'unresolved',
      ['validation-execution'],
      checksPassedWithObservedCommands ? [] : ['validation-execution'],
      'Executed command evidence, not recommendation text, determines this claim; check success without selected command evidence is not enough.',
      ['not-production-readiness', 'not-canonical-authority'],
      ['continue-or-stop', 'run-stronger-checks'],
    ),
    claim(
      'command-distinction',
      'Selected command evidence remains structurally distinct from recommended command advice.',
      'supported',
      ['validation-execution'],
      [],
      'Selected and recommended commands are represented as separate fields; overlapping command strings are allowed when recommendations were intentionally selected.',
      ['not-canonical-authority'],
      ['run-stronger-checks'],
    ),
    claim(
      'graph-limitations',
      limitations.length ? 'Graph or impact evidence includes visible limitations.' : 'No graph limitation was recorded in this review.',
      limitations.length ? 'weakened' : graphObserved ? 'supported' : 'unresolved',
      ['graph-impact'],
      limitations.length ? ['graph-impact'] : [],
      'Missing or fallback-shaped graph evidence qualifies continuation decisions; it does not imply no impact.',
      ['not-production-readiness'],
      ['continue-or-stop'],
    ),
    claim(
      'preview-boundary',
      reviewWithLimitations?.outcome?.previewOnly ? 'This evidence remains preview-only and does not prove apply safety.' : 'This evidence includes apply posture.',
      reviewWithLimitations?.outcome?.previewOnly ? 'weakened' : 'supported',
      ['source', 'snapshot-artifacts'],
      reviewWithLimitations?.outcome?.previewOnly ? ['rollback'] : [],
      'Preview evidence can support continued review, not production readiness or governance acceptance.',
      ['not-production-readiness', 'no-implicit-mutation'],
      ['continue-or-stop'],
    ),
  ];

  return { ...reviewWithLimitations, evidenceArtifacts, claims, authorityBoundaries, operatorDecisionPoints };
}

function normalize(raw: any) {
  const detected = detectInput(raw);
  if (detected.kind === 'validation_plan') return withConceptualModel(normalizeValidationPlan(detected.payload, detected.packet));
  if (detected.kind === 'alpha_packet') return withConceptualModel(normalizeAlphaPacket(detected.payload));
  if (detected.kind === 'target_dogfood') return withConceptualModel(normalizeTargetDogfood(detected.payload));
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
    `### Review claims\n\n` +
    `${arr(review.claims).map((c: any) => `- ${c.id}: ${c.status} — ${c.claim}`).join('\n') || '- none'}\n\n` +
    `### Authority boundaries\n\n` +
    `${arr(review.authorityBoundaries).map((b: any) => `- ${b.id}: ${b.boundary}`).join('\n') || '- none'}\n\n` +
    `### Operator decision points\n\n` +
    `${arr(review.operatorDecisionPoints).map((p: any) => `- ${p.id}: ${strings(p.options).join(', ')}; uncertainty: ${p.residualUncertainty || 'not recorded'}`).join('\n') || '- none'}\n\n` +
    `### Evidence artifact durability\n\n` +
    `${arr(review.evidenceArtifacts).map((a: any) => `- ${a.id}: ${a.observedStatus}; durability=${a.durability}; cite=${a.citationRequirement}`).join('\n') || '- none'}\n\n` +
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
