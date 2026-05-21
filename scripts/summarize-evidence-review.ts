#!/usr/bin/env bun
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync, type Stats } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { validateValidationPlanSemantics } from './validation-plan-semantics';

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : null;
}

function argHasMissingValue(name: string): boolean {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && (!process.argv[idx + 1] || process.argv[idx + 1].startsWith('--'))) return true;
  return process.argv.includes(`${name}=`);
}

const inputPath = argValue('--input') || '.test-results/alpha-evidence-packet.json';
const format = argValue('--format') || 'markdown';
const extract = argValue('--extract');
const maxInputBytes = 10 * 1024 * 1024;

function validateCliOptions() {
  for (const name of ['--input', '--format', '--extract']) {
    if (argHasMissingValue(name)) throw new Error(`Missing value for ${name}`);
  }
  if (format !== 'json' && format !== 'markdown') {
    throw new Error('Unsupported --format; expected markdown or json');
  }
  if (extract !== null && extract !== 'validationPlan') {
    throw new Error('Unsupported --extract; expected validationPlan');
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function defaultFdLinkCandidates(fd: number): string[] {
  return process.platform === 'linux'
    ? [`/proc/self/fd/${fd}`, `/dev/fd/${fd}`]
    : [`/dev/fd/${fd}`, `/proc/self/fd/${fd}`];
}

function openedFdRealpath(fd: number, candidates = defaultFdLinkCandidates(fd)): string | null {
  for (const candidate of candidates) {
    try {
      return realpathSync(candidate);
    } catch {
      // Try the next fd-link convention before falling back to stat identity.
    }
  }
  return null;
}

function tooLargeError(sizeDescription: string): Error {
  return new Error(`Evidence input too large: ${sizeDescription} exceeds ${maxInputBytes} byte limit`);
}

function readBoundedUtf8(fd: number): string {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const remainingWithSentinel = maxInputBytes + 1 - totalBytes;
    if (remainingWithSentinel <= 0) throw tooLargeError('more than limit');
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remainingWithSentinel));
    const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > maxInputBytes) throw tooLargeError(`${totalBytes} bytes`);
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

function sameObservedFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function assertSameObservedFile(label: string, expected: Stats, actual: Stats) {
  if (!sameObservedFile(expected, actual)) {
    throw new Error(`Evidence input changed while it was being ${label}`);
  }
}

function parseEvidenceJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Evidence input is not valid JSON');
  }
}

type ReadJsonOptions = {
  workspaceRoot?: string;
  afterInitialStat?: () => void;
  afterOpenStat?: () => void;
  fdLinkCandidates?: string[];
};

export function readJson(path: string, options: ReadJsonOptions = {}): any {
  const workspaceRoot = realpathSync(options.workspaceRoot || process.cwd());
  const lexicalPath = resolve(workspaceRoot, path);
  if (!isContainedPath(workspaceRoot, lexicalPath)) {
    throw new Error('Evidence input must stay within the workspace');
  }

  let initialStat;
  try {
    initialStat = statSync(lexicalPath);
  } catch {
    throw new Error('Evidence input is unavailable or unreadable');
  }
  if (!initialStat.isFile()) {
    throw new Error('Evidence input must be a regular file');
  }

  let lexicalRealPath;
  try {
    lexicalRealPath = realpathSync(lexicalPath);
  } catch {
    throw new Error('Evidence input is unavailable or unreadable');
  }
  if (!isContainedPath(workspaceRoot, lexicalRealPath)) {
    throw new Error('Evidence input must stay within the workspace');
  }

  options.afterInitialStat?.();

  let fd: number;
  try {
    fd = openSync(lexicalPath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    throw new Error('Evidence input is unavailable or unreadable');
  }

  try {
    const openedStat = fstatSync(fd);
    if (!openedStat.isFile()) {
      throw new Error('Evidence input must be a regular file');
    }
    assertSameObservedFile('opened', initialStat, openedStat);
    if (openedStat.size > maxInputBytes) {
      throw tooLargeError(`${openedStat.size} bytes`);
    }

    const realPath = openedFdRealpath(fd, options.fdLinkCandidates);
    if (realPath && !isContainedPath(workspaceRoot, realPath)) {
      throw new Error('Evidence input must stay within the workspace');
    }

    options.afterOpenStat?.();
    const text = readBoundedUtf8(fd);
    assertSameObservedFile('read', openedStat, fstatSync(fd));
    return parseEvidenceJson(text);
  } finally {
    closeSync(fd);
  }
}

function arr(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: any): string[] {
  return arr(value).map(String).filter(Boolean);
}

type EvidenceAbsenceState = 'failed' | 'unavailable' | 'unknown' | 'inapplicable';
type EvidenceObservedState = EvidenceAbsenceState | 'observed';
type EvidenceDurability = 'ephemeral' | 'reproducible_local' | 'materialized_local' | 'repo_durable' | 'authority_durable';
type ClaimStatus = 'supported' | 'weakened' | 'contradicted' | 'unresolved';
type LimitationSeverity = 'info' | 'warning' | 'blocking';

type EvidenceArtifact = {
  id: string;
  kind: string;
  schema: string | null;
  observedStatus: EvidenceObservedState;
  durability: EvidenceDurability;
  uriOrPath: string | null;
  citationRequirement: string;
};

type ReviewLimitation = {
  id: string;
  limitation: string;
  sourceArtifact: string;
  affectsClaims: string[];
  affectsDecisionPoints: string[];
  severity: LimitationSeverity;
};

type ReviewClaim = {
  id: string;
  claim: string;
  status: ClaimStatus;
  supportedBy: string[];
  limitedBy: string[];
  warrant: string;
  authorityBoundaries: string[];
  operatorDecisionPoints: string[];
};

type AuthorityBoundary = { id: string; boundary: string; affectedScope: string };
type OperatorDecisionPoint = { id: string; options: string[]; supportingClaims: string[]; limitingClaims: string[]; residualUncertainty: string };
type HandoffGateStatus = 'present' | 'missing' | 'not_asserted';
type HandoffReadinessGate = {
  id: string;
  status: HandoffGateStatus;
  schemaIndicatorsPresent: string[];
  observedStatuses: string[];
  externalAuthorityRequired: boolean;
  limitation: string;
  nextAction: string;
};
type HandoffReadiness = { status: 'blocked'; decision: 'cli_only'; summary: string; gates: HandoffReadinessGate[]; nextActions: string[]; authorityBoundary: string };

function evidenceState(kind: string, observed: boolean, failed: boolean, applicable = true): EvidenceObservedState {
  if (!applicable) return 'inapplicable';
  if (failed) return 'failed';
  if (observed) return 'observed';
  return kind === 'required' ? 'unavailable' : 'unknown';
}

function claim(id: string, text: string, status: ClaimStatus, supportedBy: string[], limitedBy: string[], warrant: string, authorityBoundaries: string[], operatorDecisionPoints: string[]): ReviewClaim {
  return { id, claim: text, status, supportedBy, limitedBy, warrant, authorityBoundaries, operatorDecisionPoints };
}

function artifact(id: string, kind: string, schema: string | null, observedStatus: EvidenceObservedState, durability: EvidenceDurability, uriOrPath: string | null, citationRequirement: string): EvidenceArtifact {
  return { id, kind, schema, observedStatus, durability, uriOrPath, citationRequirement };
}

function limitation(id: string, text: string, sourceArtifact: string, affectsClaims: string[], affectsDecisionPoints: string[], severity: LimitationSeverity = 'warning'): ReviewLimitation {
  return { id, limitation: text, sourceArtifact, affectsClaims, affectsDecisionPoints, severity };
}

function mdInline(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ⏎ ')
    .replace(/[<>]/g, (ch) => (ch === '<' ? '&lt;' : '&gt;'))
    .replace(/([\\`*_\[\]()!])/g, '\\$1');
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function hasUriScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

function isSnapshotUri(value: string): boolean {
  return value.startsWith('snapshot://');
}

function isSafeRelativeWorkspaceRef(ref: string): boolean {
  if (!ref || isAbsolute(ref) || hasUriScheme(ref)) return false;
  const workspaceRoot = realpathSync(process.cwd());
  return isContainedPath(workspaceRoot, resolve(workspaceRoot, ref));
}

function isWorkspaceMaterializedFile(ref: string): boolean {
  if (!isSafeRelativeWorkspaceRef(ref)) return false;
  const workspaceRoot = realpathSync(process.cwd());
  const lexicalPath = resolve(workspaceRoot, ref);
  try {
    const stat = statSync(lexicalPath);
    if (!stat.isFile()) return false;
    const realPath = realpathSync(lexicalPath);
    return isContainedPath(workspaceRoot, realPath);
  } catch {
    return false;
  }
}

function rollbackCommandPatchPath(command: string): string | null {
  const match = command.match(/^git apply\s+(?:-R|--reverse)\s+([^\s;&|`$<>]+)$/);
  return match?.[1] || null;
}

function rollbackCommandIsPlausible(command: string): boolean {
  const patchPath = rollbackCommandPatchPath(command);
  return !!patchPath && isWorkspaceMaterializedFile(patchPath);
}

type ArtifactRefSummary = {
  observed: boolean;
  durability: EvidenceDurability;
  uriOrPath: string | null;
  citationRequirement: string;
  materialized: boolean;
  snapshotPointer: boolean;
  unsafeOrMissingLocal: boolean;
};

function summarizeArtifactRefs(refs: string[]): ArtifactRefSummary {
  const candidates = refs.filter((ref) => ref.length > 0);
  const materializedRef = candidates.find(isWorkspaceMaterializedFile) || null;
  const snapshotRef = candidates.find(isSnapshotUri) || null;
  const unsafeOrMissingLocal = candidates.some((ref) => !isSnapshotUri(ref) && !isWorkspaceMaterializedFile(ref));
  if (materializedRef) {
    return {
      observed: true,
      durability: 'materialized_local',
      uriOrPath: materializedRef,
      citationRequirement: 'local artifact path was workspace-contained and materialized when reviewed; cite path plus command context, not as authority-durable evidence',
      materialized: true,
      snapshotPointer: !!snapshotRef,
      unsafeOrMissingLocal,
    };
  }
  if (snapshotRef) {
    return {
      observed: true,
      durability: 'ephemeral',
      uriOrPath: snapshotRef,
      citationRequirement: 'snapshot:// references are pointers, not durable proof, unless materialized or attached to AK evidence',
      materialized: false,
      snapshotPointer: true,
      unsafeOrMissingLocal,
    };
  }
  return {
    observed: candidates.length > 0,
    durability: 'ephemeral',
    uriOrPath: null,
    citationRequirement: unsafeOrMissingLocal
      ? 'artifact references were not promoted because they were missing, absolute, escaped the workspace, or used unsupported URI schemes'
      : 'no snapshot artifact reference was recorded',
    materialized: false,
    snapshotPointer: false,
    unsafeOrMissingLocal,
  };
}

type CheckCommandEvidence = { command: string; ok: boolean | null };

function checkCommandEvidence(entry: any): CheckCommandEvidence | null {
  if (typeof entry === 'string') return { command: entry, ok: null };
  if (entry && typeof entry.command === 'string') return { command: entry.command, ok: typeof entry.ok === 'boolean' ? entry.ok : null };
  return null;
}

function selectedCommandEvidence(review: any, selectedCommands: string[]): Array<CheckCommandEvidence | null> {
  const executedByCommand = new Map<string, CheckCommandEvidence[]>();
  for (const entry of arr(review?.checks?.commands).map(checkCommandEvidence).filter((item): item is CheckCommandEvidence => !!item)) {
    const entries = executedByCommand.get(entry.command) || [];
    entries.push(entry);
    executedByCommand.set(entry.command, entries);
  }
  return selectedCommands.map((command) => executedByCommand.get(command)?.shift() || null);
}

function requireKnownReferences(label: string, ownerId: string, refs: string[], known: Set<string>) {
  for (const ref of refs) {
    if (!known.has(ref)) throw new Error(`${label} ${ownerId} references unknown id ${ref}`);
  }
}

function validateReferenceIntegrity(review: any) {
  const artifactIds = new Set(arr(review?.evidenceArtifacts).map((item: EvidenceArtifact) => item.id));
  const limitationIds = new Set(arr(review?.limitations).map((item: ReviewLimitation) => item.id));
  const claimIds = new Set(arr(review?.claims).map((item: ReviewClaim) => item.id));
  const boundaryIds = new Set(arr(review?.authorityBoundaries).map((item: AuthorityBoundary) => item.id));
  const decisionIds = new Set(arr(review?.operatorDecisionPoints).map((item: OperatorDecisionPoint) => item.id));

  for (const limitationItem of arr(review?.limitations) as ReviewLimitation[]) {
    requireKnownReferences('limitation.sourceArtifact', limitationItem.id, [limitationItem.sourceArtifact], artifactIds);
    requireKnownReferences('limitation.affectsClaims', limitationItem.id, limitationItem.affectsClaims, claimIds);
    requireKnownReferences('limitation.affectsDecisionPoints', limitationItem.id, limitationItem.affectsDecisionPoints, decisionIds);
  }
  for (const claimItem of arr(review?.claims) as ReviewClaim[]) {
    requireKnownReferences('claim.supportedBy', claimItem.id, claimItem.supportedBy, artifactIds);
    requireKnownReferences('claim.limitedBy', claimItem.id, claimItem.limitedBy, limitationIds);
    requireKnownReferences('claim.authorityBoundaries', claimItem.id, claimItem.authorityBoundaries, boundaryIds);
    requireKnownReferences('claim.operatorDecisionPoints', claimItem.id, claimItem.operatorDecisionPoints, decisionIds);
  }
  for (const decisionPoint of arr(review?.operatorDecisionPoints) as OperatorDecisionPoint[]) {
    requireKnownReferences('operatorDecisionPoint.supportingClaims', decisionPoint.id, decisionPoint.supportingClaims, claimIds);
    requireKnownReferences('operatorDecisionPoint.limitingClaims', decisionPoint.id, decisionPoint.limitingClaims, claimIds);
  }
}

function handoffGate(
  id: string,
  status: HandoffGateStatus,
  fields: Pick<HandoffReadinessGate, 'schemaIndicatorsPresent' | 'observedStatuses' | 'externalAuthorityRequired'>,
  limitation: string,
  nextAction: string,
): HandoffReadinessGate {
  return { id, status, ...fields, limitation, nextAction };
}

function buildHandoffReadiness(review: any): HandoffReadiness {
  const claimModelIndicators = ['evidenceArtifacts', 'claims', 'limitations', 'authorityBoundaries', 'operatorDecisionPoints'].filter((field) => arr(review?.[field]).length > 0);
  const hasClaimModel = claimModelIndicators.length === 5;
  const allowedEvidenceStates = ['observed', 'failed', 'unavailable', 'unknown', 'inapplicable'];
  const observedArtifactStatuses = arr(review?.evidenceArtifacts).map((artifact: EvidenceArtifact) => String(artifact?.observedStatus || ''));
  const observedStatesValid = observedArtifactStatuses.length > 0 && observedArtifactStatuses.every((status) => allowedEvidenceStates.includes(status));
  const commandIndicators = ['commands.selected', 'commands.recommendedMinimum', 'commands.recommendedBroader', 'commands.recommendationsAppliedToSelected'].filter((field) => {
    if (field === 'commands.recommendationsAppliedToSelected') return typeof review?.commands?.recommendationsAppliedToSelected === 'boolean';
    const key = field.replace('commands.', '');
    return Array.isArray(review?.commands?.[key]);
  });
  const commandDistinction = commandIndicators.length === 4;
  const readOnlyIndicators = arr(review?.authorityBoundaries).some((boundary: AuthorityBoundary) => boundary.id === 'no-implicit-mutation')
    ? ['authorityBoundaries.no-implicit-mutation']
    : [];
  const readOnlyBoundary = readOnlyIndicators.length > 0;
  const localGateFields = (schemaIndicatorsPresent: string[] = [], observedStatuses: string[] = []) => ({
    schemaIndicatorsPresent,
    observedStatuses,
    externalAuthorityRequired: false,
  });

  const gates = [
    handoffGate(
      'claim-model-fields',
      hasClaimModel ? 'present' : 'missing',
      localGateFields(claimModelIndicators),
      hasClaimModel ? 'The normalized review carries the first-class claim model fields required before reconsidering handoff.' : 'The normalized review is missing one or more first-class claim model fields.',
      'Keep evidence review CLI/markdown/JSON-only unless all ADR-0002 reconsideration gates are present and owner acceptance is recorded outside SCI.',
    ),
    handoffGate(
      'absence-states',
      observedStatesValid ? 'present' : 'missing',
      localGateFields([], observedArtifactStatuses),
      observedStatesValid ? 'Evidence artifact observedStatus values are constrained to the supported absence-state vocabulary.' : 'One or more evidence artifact states are missing or outside the supported absence-state vocabulary.',
      'Treat missing or unsupported evidence states as schema drift and block handoff.',
    ),
    handoffGate(
      'selected-vs-recommended-commands',
      commandDistinction ? 'present' : 'missing',
      localGateFields(commandIndicators),
      commandDistinction ? 'Selected validation commands remain structurally distinct from advisory recommendations.' : 'Selected and recommended command fields are not structurally distinct.',
      'Do not render recommendations as executed commands or silently add them to selected validation.',
    ),
    handoffGate(
      'read-only-boundary',
      readOnlyBoundary ? 'present' : 'missing',
      localGateFields(readOnlyIndicators),
      readOnlyBoundary ? 'The review preserves a no-implicit-mutation boundary for source, snapshots, target repos, AK, and databases.' : 'The review does not expose the no-implicit-mutation authority boundary.',
      'Do not attach host handoff or UI behavior that can mutate owner surfaces through this summary.',
    ),
    handoffGate(
      'sample-and-test-evidence',
      'not_asserted',
      localGateFields(),
      'This runtime summary does not certify committed fixture freshness or test execution.',
      'Run bun test tests/evidence-review-claim-model.test.ts and cite the result before claiming schema-readiness evidence.',
    ),
    handoffGate(
      'host-owner-acceptance',
      'missing',
      { schemaIndicatorsPresent: [], observedStatuses: [], externalAuthorityRequired: true },
      'SCI cannot self-accept Pi/operator-workbench scope or create host integration authority.',
      'Request explicit host-owner acceptance/review before any Pi/operator-workbench handoff or UI work.',
    ),
  ];

  return {
    status: 'blocked',
    decision: 'cli_only',
    summary: 'ADR-0002 keeps evidence review CLI/markdown/JSON-only; this summary may inform an operator but does not authorize host handoff, UI rendering, AK decision advancement, or production readiness.',
    gates,
    nextActions: [
      'Use this summary for local operator review only.',
      'Run and cite the evidence-review tests before claiming schema-readiness evidence.',
      'Seek explicit Pi/operator-workbench owner acceptance before any host handoff or rendered UI work.',
    ],
    authorityBoundary: 'Generated readiness is a local review projection, not AK evidence, governance acceptance, host-owner approval, or production-readiness proof.',
  };
}

function firstValidationPlan(packet: any): any | null {
  const candidates = [
    packet?.previewFirstMutation?.validationPlanSample,
    ...(arr(packet?.checkRecommendations?.calls).map((call: any) => call?.payload?.validationPlan)),
    ...(arr(packet?.previewFirstMutation?.structuralCalls).map((call: any) => call?.payload?.validationPlan)),
    ...(arr(packet?.calls).map((call: any) => call?.payload?.validationPlan)),
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
  throw new Error('Unsupported evidence schema');
}

function normalizeRollback(plan: any) {
  const applied = plan?.apply?.applied === true;
  const rawCommand = typeof plan?.rollback?.command === 'string' && plan.rollback.command.trim() ? plan.rollback.command : null;
  const command = rawCommand && rollbackCommandIsPlausible(rawCommand) ? rawCommand : null;
  const inversePatch = firstString([plan?.rollback?.inversePatch, plan?.rollback?.inversePatchPath, plan?.rollback?.artifact]);
  const inversePatchSummary = inversePatch ? summarizeArtifactRefs([inversePatch]) : null;
  const hasMaterializedInversePatch = inversePatchSummary?.materialized === true;
  if (command) {
    return {
      available: true,
      notNeeded: false,
      status: 'command_available',
      command,
      inversePatch,
      reason: 'Rollback command is recorded; cite command context before use.',
    };
  }
  if (hasMaterializedInversePatch) {
    return {
      available: true,
      notNeeded: false,
      status: 'inverse_patch_materialized',
      command: null,
      inversePatch,
      reason: 'Materialized inverse patch is recorded as local rollback evidence.',
    };
  }
  if (!applied) {
    return {
      available: false,
      notNeeded: true,
      status: 'not_needed_preview',
      command: null,
      inversePatch,
      reason: 'No source mutation occurred; rollback is not needed for preview-only evidence.',
    };
  }
  return {
    available: false,
    notNeeded: false,
    status: rawCommand ? 'untrusted_command_unavailable_after_apply' : 'unavailable_after_apply',
    command: null,
    inversePatch,
    reason: rawCommand
      ? 'Applied evidence has no plausible workspace-local git apply -R rollback command or materialized inverse patch.'
      : 'Applied evidence has no rollback command or materialized inverse patch.',
  };
}

function normalizeVerification(plan: any) {
  const verification = plan?.verification && typeof plan.verification === 'object' ? plan.verification : null;
  const semantic = validateValidationPlanSemantics(plan);
  return {
    applied: typeof verification?.applied === 'boolean' ? verification.applied : null,
    appliedDiffMatchesSnapshot: typeof verification?.appliedDiffMatchesSnapshot === 'boolean' ? verification.appliedDiffMatchesSnapshot : null,
    method: typeof verification?.method === 'string' ? verification.method : null,
    diagnostics: verification?.diagnostics && typeof verification.diagnostics === 'object' ? verification.diagnostics : null,
    semanticFailures: semantic.failures,
  };
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
      ok: typeof plan?.checks?.ok === 'boolean' ? plan.checks.ok : null,
      elapsedMs: typeof plan?.checks?.elapsedMs === 'number' ? plan.checks.elapsedMs : null,
      commands: plan?.checks?.commands || null,
    },
    graphImpact: {
      seed: graph?.seed && typeof graph.seed === 'object' ? { kind: String(graph.seed.kind || 'unknown'), value: String(graph.seed.value || '') } : null,
      languageSupport: graph?.languageSupport && typeof graph.languageSupport === 'object'
        ? {
            language: String(graph.languageSupport.language || 'unknown'),
            support: String(graph.languageSupport.support || 'unknown'),
            supportedEdges: strings(graph.languageSupport.supportedEdges),
          }
        : null,
      backend: typeof graph?.backend === 'string' ? graph.backend : null,
      freshness: typeof graph?.freshness === 'string' ? graph.freshness : null,
      requestedEdges: strings(graph?.requestedEdges),
      hasImpactEvidence: graph?.hasImpactEvidence === true,
      counts: graph?.counts || {},
      evidence: arr(graph?.evidence).map((item: any) => ({
        edge: typeof item?.edge === 'string' ? item.edge : 'unknown',
        count: typeof item?.count === 'number' ? item.count : 0,
        status: typeof item?.status === 'string' ? item.status : 'unknown',
        limitations: strings(item?.limitations),
      })),
      limitations: strings(graph?.limitations),
      callerContextCount: typeof graph?.callerContextCount === 'number' ? graph.callerContextCount : null,
      planningHints: strings(graph?.planningHints),
    },
    artifacts: plan?.artifacts || {},
    rollback: normalizeRollback(plan),
    verification: normalizeVerification(plan),
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
    },
    scope: {
      ...base.scope,
      touchedFiles: base.scope.touchedFiles,
      target: null,
      toolCoverageCount: packet?.toolCoverage?.alphaSummaryCount || 0,
    },
    checks: {
      ...base.checks,
      bundleGateOk: typeof packet?.evidenceGate?.ok === 'boolean' ? packet.evidenceGate.ok : null,
      failedGateChecks: strings(packet?.evidenceGate?.failedChecks),
      budgetsMs: packet?.evidenceGate?.budgetsMs || null,
    },
    graphImpact: {
      hasImpactEvidence: packet?.graphImpact?.fileImpact?.hasImpactEvidence === true || base.graphImpact.hasImpactEvidence,
      seed: packet?.graphImpact?.fileImpact?.seed || base.graphImpact.seed,
      languageSupport: packet?.graphImpact?.fileImpact?.languageSupport || base.graphImpact.languageSupport,
      backend: packet?.graphImpact?.fileImpact?.backend || base.graphImpact.backend,
      freshness: packet?.graphImpact?.fileImpact?.freshness || base.graphImpact.freshness,
      requestedEdges: strings(packet?.graphImpact?.fileImpact?.requestedEdges).concat(base.graphImpact.requestedEdges || []),
      counts: packet?.graphImpact?.fileImpact?.counts || base.graphImpact.counts,
      evidence: arr(packet?.graphImpact?.fileImpact?.evidence).concat(base.graphImpact.evidence || []),
      limitations: strings(packet?.graphImpact?.fileImpact?.limitations).concat(strings(packet?.graphImpact?.symbolImpact?.limitations), base.graphImpact.limitations),
      planningHints: strings(packet?.graphImpact?.fileImpact?.planningHints).concat(base.graphImpact.planningHints),
      callerContextCount: packet?.graphImpact?.impact?.callerContext?.callerContextCount ?? packet?.graphImpact?.fileImpact?.callerContextCount ?? base.graphImpact.callerContextCount ?? null,
    },
    safety: {
      ...base.safety,
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
  const artifactSummary = summarizeArtifactRefs(strings(Object.values(review?.artifacts || {})));
  const hasArtifacts = artifactSummary.observed;
  const rollbackAvailable = review?.rollback?.available === true;
  const rollbackNotNeeded = review?.rollback?.notNeeded === true;
  const rollbackUnavailableAfterApply = review?.outcome?.applied === true && !rollbackAvailable;
  const checkOkObserved = typeof review?.checks?.ok === 'boolean';
  const failedGateChecks = strings(review?.checks?.failedGateChecks);
  const selectedEvidence = selectedCommandEvidence(review, selectedCommands);
  const selectedCommandsObserved = selectedCommands.length > 0 && selectedEvidence.every((entry) => entry !== null);
  const selectedCommandsPassed = selectedCommandsObserved && selectedEvidence.every((entry) => entry?.ok === true);
  const selectedCommandsFailed = selectedCommandsObserved && selectedEvidence.some((entry) => entry?.ok === false);
  const validationExecutionObserved = selectedCommandsPassed && checkOkObserved;
  const checksFailed = selectedCommandsFailed || (selectedCommandsObserved && review.checks.ok === false);
  const checksPassedWithObservedCommands = validationExecutionObserved && review?.checks?.ok === true;
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

  const validationExecutionState = evidenceState('required', validationExecutionObserved, checksFailed);
  const validationExecutionDurability: EvidenceDurability = validationExecutionState === 'observed' || validationExecutionState === 'failed'
    ? 'reproducible_local'
    : 'ephemeral';
  const rollbackArtifactState: EvidenceObservedState = rollbackAvailable ? 'observed' : rollbackNotNeeded ? 'inapplicable' : 'unavailable';
  const rollbackDurability: EvidenceDurability = reviewWithLimitations?.rollback?.status === 'inverse_patch_materialized'
    ? 'materialized_local'
    : rollbackAvailable ? 'reproducible_local' : 'ephemeral';
  const verificationSemanticFailures = arr(reviewWithLimitations?.verification?.semanticFailures).map((failure: any) => String(failure?.code || 'verification_semantic_failure'));
  const verificationApplicable = reviewWithLimitations?.outcome?.applied === true || typeof reviewWithLimitations?.verification?.appliedDiffMatchesSnapshot === 'boolean' || verificationSemanticFailures.length > 0;
  const verificationFailed = verificationSemanticFailures.length > 0 || (reviewWithLimitations?.outcome?.applied === true && reviewWithLimitations?.verification?.appliedDiffMatchesSnapshot === false);
  const verificationObserved = typeof reviewWithLimitations?.verification?.appliedDiffMatchesSnapshot === 'boolean';
  const verificationUnavailable = verificationApplicable && !verificationObserved && verificationSemanticFailures.length === 0;
  const verificationState = verificationFailed ? 'failed' : evidenceState('optional', verificationObserved, false, verificationApplicable);

  const evidenceArtifacts = [
    artifact('source', reviewWithLimitations?.source?.kind || 'unknown', reviewWithLimitations?.source?.schema || null, 'observed', 'reproducible_local', null, 'cite input schema and command used to generate this review'),
    artifact('validation-execution', 'validation_execution', null, validationExecutionState, validationExecutionDurability, null, 'cite AK evidence id or explicit command transcript when available; local summary output alone is not authority-durable evidence'),
    artifact('graph-impact', 'graph_impact', null, evidenceState('optional', graphObserved, false, graphApplicable), graphObserved ? 'reproducible_local' : 'ephemeral', null, 'cite limitations and regeneration command; do not infer no impact from absence'),
    artifact('snapshot-artifacts', 'snapshot_artifacts', null, evidenceState('optional', hasArtifacts, false), artifactSummary.durability, artifactSummary.uriOrPath, artifactSummary.citationRequirement),
    artifact('rollback', 'rollback', null, rollbackArtifactState, rollbackDurability, reviewWithLimitations?.rollback?.command || reviewWithLimitations?.rollback?.inversePatch || null, rollbackNotNeeded ? 'no rollback needed because this evidence is preview-only and no source mutation occurred' : 'cite concrete rollback command or materialized inverse patch; otherwise treat rollback as unavailable'),
    artifact('apply-verification', 'apply_verification', null, verificationState, verificationObserved ? 'reproducible_local' : 'ephemeral', null, 'cite applied-diff verification evidence when source mutation is claimed; mismatch blocks apply-safety claims'),
  ];

  const authorityBoundaries = [
    { id: 'not-canonical-authority', boundary: reviewWithLimitations?.safety?.authorityBoundary || 'This review is not canonical task/evidence authority.', affectedScope: 'governance' },
    { id: 'not-production-readiness', boundary: reviewWithLimitations?.safety?.productionBoundary || 'Alpha evidence is not production readiness.', affectedScope: 'readiness' },
    { id: 'no-implicit-mutation', boundary: 'Rendering evidence review output must not mutate source, snapshots, target repos, AK, or databases.', affectedScope: 'mutation' },
  ];

  const validationLimitations = checksPassedWithObservedCommands ? [] : [limitation(
    'validation-execution-limitation-1',
    checksFailed ? 'Selected validation checks failed.' : 'Selected validation check evidence is unavailable or incomplete.',
    'validation-execution',
    ['checks-result'],
    ['continue-or-stop', 'run-stronger-checks'],
    checksFailed ? 'blocking' : 'warning',
  )];
  const graphLimitations = limitations.map((text, index) => limitation(
    `graph-impact-limitation-${index + 1}`,
    text,
    'graph-impact',
    ['graph-limitations'],
    ['continue-or-stop'],
  ));
  const artifactLimitations = artifactSummary.unsafeOrMissingLocal ? [limitation(
    'snapshot-artifact-limitation-1',
    'One or more artifact references were not promoted to materialized evidence because they were missing, absolute, escaped the workspace, or used unsupported URI schemes.',
    'snapshot-artifacts',
    ['artifact-durability'],
    ['continue-or-stop'],
  )] : [];
  const rollbackLimitations = rollbackUnavailableAfterApply ? [limitation(
    'rollback-limitation-1',
    'Applied evidence has no rollback command or materialized inverse patch; rollback is unavailable after mutation.',
    'rollback',
    ['rollback-posture'],
    ['continue-or-stop'],
    'blocking',
  )] : [];
  const verificationLimitations = verificationFailed || verificationUnavailable ? [limitation(
    'apply-verification-limitation-1',
    verificationSemanticFailures.length
      ? `Apply verification is lifecycle-inconsistent (${verificationSemanticFailures.join(', ')}); stop or inspect before treating apply evidence as valid.`
      : verificationUnavailable
        ? 'Applied evidence has no applied-diff verification observation; stop or inspect before treating apply evidence as valid.'
        : 'Applied diff does not match the reviewed snapshot artifact; stop or inspect before treating apply evidence as valid.',
    'apply-verification',
    ['apply-verification'],
    ['continue-or-stop'],
    verificationFailed ? 'blocking' : 'warning',
  )] : [];
  const previewLimitations = reviewWithLimitations?.outcome?.previewOnly ? [limitation(
    'preview-boundary-limitation-1',
    'Preview-only evidence does not prove apply safety; rollback is not needed unless a source mutation is applied.',
    'rollback',
    ['preview-boundary'],
    ['continue-or-stop'],
  )] : [];
  const reviewLimitations = validationLimitations.concat(graphLimitations, artifactLimitations, rollbackLimitations, verificationLimitations, previewLimitations);
  const validationLimitationIds = validationLimitations.map((item) => item.id);
  const graphLimitationIds = graphLimitations.map((item) => item.id);
  const artifactLimitationIds = artifactLimitations.map((item) => item.id);
  const rollbackLimitationIds = rollbackLimitations.map((item) => item.id);
  const verificationLimitationIds = verificationLimitations.map((item) => item.id);
  const previewLimitationIds = previewLimitations.map((item) => item.id);
  const continueLimitingClaims = [
    ...(checksPassedWithObservedCommands ? [] : ['checks-result']),
    ...(limitations.length ? ['graph-limitations'] : []),
    ...(artifactLimitations.length ? ['artifact-durability'] : []),
    ...(rollbackLimitations.length ? ['rollback-posture'] : []),
    ...(verificationLimitations.length ? ['apply-verification'] : []),
    ...(previewLimitations.length ? ['preview-boundary'] : []),
  ];
  const continueUncertainty = continueLimitingClaims.length
    ? 'Review claims include visible limitations; inspect before continuing.'
    : 'No graph, check, or preview limitation recorded in this review.';

  const operatorDecisionPoints = [
    { id: 'continue-or-stop', options: ['continue', 'stop', 'inspect limitations'], supportingClaims: ['checks-result'], limitingClaims: continueLimitingClaims, residualUncertainty: continueUncertainty },
    { id: 'run-stronger-checks', options: ['accept selected checks', 'run recommended minimum', 'run recommended broader'], supportingClaims: ['command-distinction'], limitingClaims: checksPassedWithObservedCommands ? [] : ['checks-result'], residualUncertainty: recommendedMinimum.length || recommendedBroader.length ? 'Recommended commands remain advisory unless executed.' : 'No additional recommendations recorded.' },
  ];

  const claims = [
    claim(
      'checks-result',
      checksPassedWithObservedCommands ? 'Selected validation checks passed.' : 'Selected validation checks did not prove a clean pass.',
      checksPassedWithObservedCommands ? 'supported' : checksFailed ? 'contradicted' : 'unresolved',
      ['validation-execution'],
      validationLimitationIds,
      'Executed command evidence, not recommendation text, determines this claim; check success without selected command evidence is not enough.',
      ['not-production-readiness', 'not-canonical-authority'],
      ['continue-or-stop', 'run-stronger-checks'],
    ),
    claim(
      'command-distinction',
      'Selected command evidence remains structurally distinct from recommended command advice.',
      'supported',
      ['source'],
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
      graphLimitationIds,
      'Missing or fallback-shaped graph evidence qualifies continuation decisions; it does not imply no impact.',
      ['not-production-readiness'],
      ['continue-or-stop'],
    ),
    claim(
      'artifact-durability',
      artifactSummary.materialized ? 'At least one snapshot artifact reference is materialized as a workspace-local file.' : 'Snapshot artifact references are not materialized local proof.',
      artifactSummary.materialized ? 'supported' : artifactSummary.snapshotPointer ? 'weakened' : artifactSummary.unsafeOrMissingLocal ? 'weakened' : 'unresolved',
      ['snapshot-artifacts'],
      artifactLimitationIds,
      'Artifact references must distinguish materialized local files from ephemeral snapshot pointers, missing files, unsupported URIs, and path escapes.',
      ['not-canonical-authority'],
      ['continue-or-stop'],
    ),
    claim(
      'rollback-posture',
      rollbackAvailable ? 'Rollback evidence is recorded.' : rollbackNotNeeded ? 'Rollback is not needed because no source mutation was applied.' : 'Rollback evidence is unavailable after mutation.',
      rollbackAvailable || rollbackNotNeeded ? 'supported' : rollbackUnavailableAfterApply ? 'contradicted' : 'unresolved',
      ['rollback'],
      rollbackLimitationIds,
      'Rollback availability requires a command or materialized inverse patch; preview-only evidence does not need rollback because it does not mutate source.',
      ['not-canonical-authority', 'no-implicit-mutation'],
      ['continue-or-stop'],
    ),
    claim(
      'apply-verification',
      verificationFailed ? 'Applied diff verification contradicts the reviewed snapshot or lifecycle.' : verificationObserved ? 'Applied diff verification evidence is recorded.' : 'Applied diff verification is not recorded for this review.',
      verificationFailed ? 'contradicted' : verificationObserved ? 'supported' : verificationApplicable ? 'unresolved' : 'weakened',
      ['apply-verification'],
      verificationLimitationIds,
      'Applied mutation evidence must preserve whether the applied diff matched the reviewed snapshot; mismatch blocks apply-safety claims.',
      ['not-production-readiness', 'not-canonical-authority'],
      ['continue-or-stop'],
    ),
    claim(
      'preview-boundary',
      reviewWithLimitations?.outcome?.previewOnly ? 'This evidence remains preview-only and does not prove apply safety.' : 'This evidence includes apply posture.',
      reviewWithLimitations?.outcome?.previewOnly ? 'weakened' : 'supported',
      ['source', 'snapshot-artifacts'],
      previewLimitationIds,
      'Preview evidence can support continued review, not production readiness or governance acceptance.',
      ['not-production-readiness', 'no-implicit-mutation'],
      ['continue-or-stop'],
    ),
  ];

  const reviewWithConcepts = { ...reviewWithLimitations, evidenceArtifacts, limitations: reviewLimitations, claims, authorityBoundaries, operatorDecisionPoints };
  validateReferenceIntegrity(reviewWithConcepts);
  return { ...reviewWithConcepts, handoffReadiness: buildHandoffReadiness(reviewWithConcepts) };
}

function normalize(raw: any) {
  const detected = detectInput(raw);
  if (detected.kind === 'validation_plan') return withConceptualModel(normalizeValidationPlan(detected.payload, detected.packet));
  if (detected.kind === 'alpha_packet') return withConceptualModel(normalizeAlphaPacket(detected.payload));
  if (detected.kind === 'target_dogfood') return withConceptualModel(normalizeTargetDogfood(detected.payload));
  throw new Error(`Unsupported kind: ${detected.kind}`);
}

function bullet(items: string[]): string {
  return items.length ? items.map((item) => `- ${mdInline(item)}`).join('\n') : '- none';
}

function checkReceiptBullet(entry: any): string {
  const command = typeof entry?.command === 'string' ? entry.command : 'unknown command';
  const ok = typeof entry?.ok === 'boolean' ? entry.ok : 'unknown';
  const exitCode = typeof entry?.exitCode === 'number' ? entry.exitCode : 'not recorded';
  const timedOut = entry?.timedOut === true;
  const elapsedMs = typeof entry?.elapsedMs === 'number' ? entry.elapsedMs : 'not recorded';
  return `- ${mdInline(command)} — ok=${mdInline(ok)}; exitCode=${mdInline(exitCode)}; timedOut=${mdInline(timedOut)}; elapsedMs=${mdInline(elapsedMs)}`;
}

function checkReceiptBullets(entries: any[]): string {
  return entries.length ? entries.map(checkReceiptBullet).join('\n') : '- none recorded';
}

function graphEvidenceBullet(entry: any): string {
  const edge = typeof entry?.edge === 'string' ? entry.edge : 'unknown';
  const count = typeof entry?.count === 'number' ? entry.count : 0;
  const status = typeof entry?.status === 'string' ? entry.status : 'unknown';
  const limitations = strings(entry?.limitations);
  return `- ${mdInline(edge)} — status=${mdInline(status)}; count=${mdInline(count)}; limitations=${mdInline(limitations.length ? limitations.join('; ') : 'none')}`;
}

function graphEvidenceBullets(entries: any[]): string {
  return entries.length ? entries.map(graphEvidenceBullet).join('\n') : '- none recorded';
}

function renderMarkdown(review: any): string {
  const commands = review.commands || {};
  const graph = review.graphImpact || {};
  const artifacts = review.artifacts || {};
  const safety = review.safety || {};
  return `# SCI evidence review\n\n` +
    `## 1. Outcome banner\n\n` +
    `- Source: ${mdInline(review.source.kind)} (${mdInline(review.source.schema || 'unknown')})\n` +
    `- Workflow: ${mdInline(review.source.workflow || 'unknown')}\n` +
    `- OK: ${mdInline(review.outcome.ok)}\n` +
    `- Status: ${mdInline(review.outcome.status || 'unknown')}\n` +
    `- Preview-only: ${review.outcome.previewOnly}\n` +
    `- Applied: ${review.outcome.applied}\n` +
    `- Production-ready: false — Alpha evidence is not production readiness.\n\n` +
    `Operator question: Is this evidence enough to continue, or should the operator stop and inspect details?\n\n` +
    `### Review claims\n\n` +
    `${arr(review.claims).map((c: any) => `- ${mdInline(c.id)}: ${mdInline(c.status)} — ${mdInline(c.claim)}`).join('\n') || '- none'}\n\n` +
    `### Authority boundaries\n\n` +
    `${arr(review.authorityBoundaries).map((b: any) => `- ${mdInline(b.id)}: ${mdInline(b.boundary)}`).join('\n') || '- none'}\n\n` +
    `### Operator decision points\n\n` +
    `${arr(review.operatorDecisionPoints).map((p: any) => `- ${mdInline(p.id)}: ${strings(p.options).map(mdInline).join(', ')}; uncertainty: ${mdInline(p.residualUncertainty || 'not recorded')}`).join('\n') || '- none'}\n\n` +
    `### Evidence artifact durability\n\n` +
    `${arr(review.evidenceArtifacts).map((a: any) => `- ${mdInline(a.id)}: ${mdInline(a.observedStatus)}; durability=${mdInline(a.durability)}; ref=${mdInline(a.uriOrPath || 'not recorded')}; cite=${mdInline(a.citationRequirement)}`).join('\n') || '- none'}\n\n` +
    `### First-class limitations\n\n` +
    `${arr(review.limitations).map((l: any) => `- ${mdInline(l.id)}: ${mdInline(l.severity || 'warning')} — ${mdInline(l.limitation)}; source=${mdInline(l.sourceArtifact || 'unknown')}`).join('\n') || '- none'}\n\n` +
    `### Handoff readiness (ADR-0002)\n\n` +
    `- Status: ${mdInline(review.handoffReadiness?.status || 'blocked')}\n` +
    `- Decision: ${mdInline(review.handoffReadiness?.decision || 'cli_only')}\n` +
    `- Summary: ${mdInline(review.handoffReadiness?.summary || 'Host handoff is not authorized by this summary.')}\n` +
    `- Authority boundary: ${mdInline(review.handoffReadiness?.authorityBoundary || 'Generated readiness is not host-owner acceptance.')}\n` +
    `- Gates:\n${arr(review.handoffReadiness?.gates).map((gate: any) => `  - ${mdInline(gate.id)}: ${mdInline(gate.status)} — indicators=${mdInline(strings(gate.schemaIndicatorsPresent).join(', ') || 'none')}; observedStatuses=${mdInline(strings(gate.observedStatuses).join(', ') || 'none')}; externalAuthorityRequired=${mdInline(gate.externalAuthorityRequired === true)} — ${mdInline(gate.limitation)} Next: ${mdInline(gate.nextAction)}`).join('\n') || '  - none'}\n` +
    `- Next actions:\n${arr(review.handoffReadiness?.nextActions).map((action: any) => `  - ${mdInline(action)}`).join('\n') || '  - none'}\n\n` +
    `## 2. Changed or affected scope\n\n` +
    `- Touched files:\n${bullet(strings(review.scope.touchedFiles))}\n` +
    `- Risk: ${mdInline(review.scope.risk ? JSON.stringify(review.scope.risk) : 'not recorded')}\n` +
    `- Target: ${mdInline(review.scope.target ? JSON.stringify(review.scope.target) : 'not a target-dogfood review')}\n\n` +
    `## 3. Validation commands\n\n` +
    `Selected commands declared for validation:\n${bullet(strings(commands.selected))}\n\n` +
    `Recommended minimum commands (advisory):\n${bullet(strings(commands.recommendedMinimum))}\n\n` +
    `Recommended broader commands (advisory):\n${bullet(strings(commands.recommendedBroader))}\n\n` +
    `- Recommendations applied to selected: ${commands.recommendationsAppliedToSelected === true}\n` +
    `- Rationale count: ${arr(commands.rationale).length}\n\n` +
    `## 4. Check results\n\n` +
    `- Checks OK: ${review.checks.ok}\n` +
    `- Elapsed ms: ${review.checks.elapsedMs ?? 'not recorded'}\n` +
    `- Failed gate checks: ${strings(review.checks.failedGateChecks).join(', ') || 'none'}\n` +
    `- Command receipts:\n${checkReceiptBullets(arr(review.checks.commands))}\n\n` +
    `Operator question: Did the executed checks match the risk of the change?\n\n` +
    `## 5. Graph and impact evidence\n\n` +
    `- Seed: ${mdInline(graph.seed ? `${graph.seed.kind}:${graph.seed.value}` : 'not recorded')}\n` +
    `- Backend: ${mdInline(graph.backend || 'not recorded')}\n` +
    `- Freshness: ${mdInline(graph.freshness || 'not recorded')}\n` +
    `- Language support: ${mdInline(graph.languageSupport ? JSON.stringify(graph.languageSupport) : 'not recorded')}\n` +
    `- Requested edges:\n${bullet(strings(graph.requestedEdges))}\n` +
    `- Has impact evidence: ${graph.hasImpactEvidence}\n` +
    `- Counts: ${mdInline(JSON.stringify(graph.counts || {}))}\n` +
    `- Edge evidence/status:\n${graphEvidenceBullets(arr(graph.evidence))}\n` +
    `- Caller context count: ${mdInline(graph.callerContextCount ?? 'not recorded')}\n` +
    `- Limitations/fallback notes:\n${bullet(strings(graph.limitations))}\n` +
    `- Planning hints:\n${bullet(strings(graph.planningHints))}\n\n` +
    `## 6. Snapshot and artifacts\n\n` +
    `- Overlay diff: ${mdInline(artifacts.overlayDiff || 'not recorded')}\n` +
    `- Status: ${mdInline(artifacts.status || 'not recorded')}\n` +
    `- Progress: ${mdInline(artifacts.progress || 'not recorded')}\n` +
    `- Rollback available: ${mdInline(review.rollback.available)}\n` +
    `- Rollback not needed: ${mdInline(review.rollback.notNeeded === true)}\n` +
    `- Rollback status: ${mdInline(review.rollback.status || 'not recorded')}\n` +
    `- Rollback command: ${mdInline(review.rollback.command || 'not recorded')}\n` +
    `- Rollback inverse patch: ${mdInline(review.rollback.inversePatch || 'not recorded')}\n` +
    `- Rollback reason: ${mdInline(review.rollback.reason || 'not recorded')}\n` +
    `- Applied diff matches snapshot: ${mdInline(review.verification?.appliedDiffMatchesSnapshot ?? 'not recorded')}\n\n` +
    `## 7. Safety and authority boundary\n\n` +
    `- Source mutated: ${safety.sourceMutated === true}\n` +
    `- Target status preserved: ${mdInline(safety.targetStatusPreserved ?? 'not applicable')}\n` +
    `- Authority: ${mdInline(safety.authorityBoundary)}\n` +
    `- Boundary: ${mdInline(safety.productionBoundary)}\n`;
}

function main() {
  validateCliOptions();
  const raw = readJson(inputPath);
  const review = normalize(raw);
  if (format === 'json') {
    console.log(JSON.stringify(review, null, 2));
  } else {
    console.log(renderMarkdown(review));
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown evidence review error';
    console.error(`evidence-review: ${message}`);
    process.exit(1);
  }
}
