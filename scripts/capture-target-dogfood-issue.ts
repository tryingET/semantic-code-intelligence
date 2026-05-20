#!/usr/bin/env bun
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, writeSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { readJson } from './summarize-evidence-review';
import { callFailed, isContainedPath, redactString, sanitizeEvidence, strings } from './evidence-summary-utils';

const defaultInputPath = '.test-results/target-validation-plan-dogfood.json';
const defaultOutputPath = '.test-results/target-dogfood-issue.json';
const schema = 'semantic-code-intelligence.target_dogfood_issue.v1';

type Format = 'json' | 'markdown';

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

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function validateCliOptions(format: string) {
  for (const name of ['--input', '--output', '--format', '--operator-note', '--scenario']) {
    if (argHasMissingValue(name)) throw new Error(`Missing value for ${name}`);
  }
  if (format !== 'json' && format !== 'markdown') {
    throw new Error('Unsupported --format; expected markdown or json');
  }
}

function workspaceRelative(path: string | null | undefined, workspaceRoot = realpathSync(process.cwd())): string | null {
  if (!path) return null;
  const resolved = resolve(workspaceRoot, path);
  return isContainedPath(workspaceRoot, resolved) ? relative(workspaceRoot, resolved) || '.' : null;
}

function mdInline(value: unknown): string {
  return redactString(String(value ?? ''))
    .replace(/\r?\n/g, ' ⏎ ')
    .replace(/[<>]/g, (ch) => (ch === '<' ? '&lt;' : '&gt;'))
    .replace(/([\\`*_\[\]()!])/g, '\\$1');
}

function failedCalls(evidence: any) {
  return Array.isArray(evidence?.calls)
    ? evidence.calls
        .filter(callFailed)
        .map((call: any) => ({
          name: String(call?.name || 'unknown'),
          exitCode: typeof call?.exitCode === 'number' ? call.exitCode : null,
          stderrClean: call?.stderrClean === true,
          elapsedMs: typeof call?.elapsedMs === 'number' ? call.elapsedMs : null,
          observation: typeof call?.observation === 'string' ? redactString(call.observation) : null,
          workflow: typeof call?.payload?.workflow === 'string' ? call.payload.workflow : null,
          ok: typeof call?.payload?.ok === 'boolean' ? call.payload.ok : null,
          validationStatus: typeof call?.payload?.validationPlan?.status === 'string' ? call.payload.validationPlan.status : null,
          checkOk: typeof call?.payload?.checks?.ok === 'boolean' ? call.payload.checks.ok : null,
        }))
    : [];
}

function classify(evidence: any, operatorNote: string | null) {
  const failures = failedCalls(evidence);
  const targetStatusRisk = evidence?.target?.statusPreserved === false || evidence?.target?.cleanAfter === false;
  if (evidence?.ok === true && !operatorNote && failures.length === 0 && !targetStatusRisk) {
    return { trigger: 'none', severity: 'info', category: 'no_issue_detected' };
  }
  if (evidence?.failure === 'target_not_clean') return { trigger: 'dogfood_failure', severity: 'warning', category: 'target_precondition' };
  if (evidence?.failure === 'target_not_git_repo') return { trigger: 'dogfood_failure', severity: 'warning', category: 'target_precondition' };
  if (evidence?.failure === 'no_read_path' || evidence?.failure === 'no_source_file') return { trigger: 'dogfood_failure', severity: 'warning', category: 'target_shape_unsupported' };
  if (failures.some((call: any) => call.name === 'patch_checks_in_snapshot' || call.name === 'recommend_checks')) {
    return { trigger: 'dogfood_failure', severity: 'blocking', category: 'validation_plan_path' };
  }
  if (failures.some((call: any) => call.name === 'graph_expand')) {
    return { trigger: 'dogfood_failure', severity: 'warning', category: 'graph_or_navigation_path' };
  }
  if (targetStatusRisk) return { trigger: evidence?.ok === true ? 'target_status_contradiction' : 'dogfood_failure', severity: 'blocking', category: 'target_status_risk' };
  if (operatorNote) return { trigger: 'operator_reported_friction', severity: evidence?.ok === true ? 'warning' : 'blocking', category: 'operator_reported' };
  return { trigger: 'dogfood_failure', severity: evidence?.ok === true ? 'warning' : 'blocking', category: 'unclassified_target_dogfood_failure' };
}

function suggestedActions(classification: any, evidence: any): string[] {
  const actions = [
    'Inspect this issue candidate; do not treat it as AK evidence until recorded in the owning authority surface.',
  ];
  if (classification.category === 'target_precondition') {
    actions.push('Re-run target dogfood from a clean target worktree or pass --allow-dirty-target only when dirty-state preservation is explicitly accepted.');
  } else if (classification.category === 'target_shape_unsupported') {
    actions.push('Provide an explicit target with a readable markdown/package file and at least one supported source file, or extend the generic target selection contract.');
  } else if (classification.category === 'validation_plan_path') {
    actions.push('Reproduce the failing workflow with the installed SCI CLI from the target repo cwd and preserve command output as task evidence if needed.');
    actions.push('Check whether snapshot artifacts were cleaned and whether selected commands remained caller-supplied rather than silently recommended.');
  } else if (classification.category === 'graph_or_navigation_path') {
    actions.push('Inspect graph_expand limitations and backend provenance before claiming impact coverage.');
  } else if (classification.category === 'no_issue_detected') {
    actions.push('No target issue was detected; avoid adding confidence-only dogfood unless a concrete target failure or operator friction appears.');
  } else if (classification.category === 'target_status_risk') {
    actions.push('Stop and verify target workspace status manually; a green top-level dogfood result cannot override dirty or unpreserved target status evidence.');
  } else {
    actions.push('Classify the failed call into precondition, navigation, recommendation, preview/check, cleanup, or target-owner issue before implementing a fix.');
  }
  if (evidence?.target?.statusPreserved !== true && evidence?.target?.cleanAfter !== true) {
    actions.push('Verify target workspace status manually before continuing; unresolved target mutation risk must fail closed.');
  }
  return actions;
}

function buildIssue(evidence: any, options: { inputPath: string; operatorNote: string | null; scenario: string | null }) {
  if (evidence?.schema !== 'semantic-code-intelligence.target_validation_plan_dogfood.v1') {
    throw new Error('Unsupported target dogfood evidence schema');
  }
  const classification = classify(evidence, options.operatorNote);
  const failures = failedCalls(evidence);
  const target = sanitizeEvidence({
    label: evidence?.target?.label || null,
    nonSciRepo: evidence?.target?.nonSciRepo === true,
    cleanBefore: evidence?.target?.cleanBefore === true,
    cleanAfter: evidence?.target?.cleanAfter === true,
    dirtyAllowed: evidence?.target?.dirtyAllowed === true,
    statusPreserved: evidence?.target?.statusPreserved === true,
    failure: evidence?.failure || null,
    languageCounts: evidence?.target?.languageCounts || null,
    selectedPaths: evidence?.selectedPaths || null,
    cli: evidence?.cli ? { command: evidence.cli.command, cwdModel: evidence.cli.cwdModel, argsUseTargetRelativePaths: evidence.cli.argsUseTargetRelativePaths === true } : null,
  });
  const issueRequired = classification.trigger !== 'none';
  return {
    schema,
    generatedAt: new Date().toISOString(),
    ok: true,
    issueRequired,
    source: {
      kind: 'target_dogfood',
      schema: evidence.schema,
      inputPath: workspaceRelative(options.inputPath),
      note: 'Generated issue candidate only; not AK evidence, target-owner acceptance, or production-readiness proof.',
    },
    trigger: {
      kind: classification.trigger,
      dogfoodOk: evidence?.ok === true,
      operatorNotePresent: !!options.operatorNote,
      scenario: options.scenario ? redactString(options.scenario) : null,
    },
    classification,
    target,
    symptoms: {
      failedCallCount: failures.length,
      failedCalls: sanitizeEvidence(failures),
      assertions: sanitizeEvidence(evidence?.assertions || null),
      interpretationDoesNotProve: strings(evidence?.interpretation?.does_not_prove),
    },
    operatorReport: options.operatorNote ? redactString(options.operatorNote) : null,
    nextActions: suggestedActions(classification, evidence),
    authorityBoundaries: [
      'SCI owns generic CLI/MCP/HTTP behavior and this issue-capture projection; the target repository owns target source and validation decisions.',
      'This generated packet is local evidence material, not AK task/evidence authority unless explicitly recorded there.',
      'Do not hardcode target repository paths or mutate target repositories from this capture path.',
      'Alpha target dogfood evidence is not production readiness.',
    ],
    safety: {
      sourceMutated: false,
      targetStatusPreserved: evidence?.target?.statusPreserved === true,
      targetCleanAfter: evidence?.target?.cleanAfter === true,
      redaction: 'local absolute paths and common token/secret shapes are redacted from generated output',
    },
  };
}

function renderMarkdown(issue: any): string {
  return `# SCI target dogfood issue candidate\n\n` +
    `- Issue required: ${mdInline(issue.issueRequired)}\n` +
    `- Trigger: ${mdInline(issue.trigger.kind)}\n` +
    `- Category: ${mdInline(issue.classification.category)}\n` +
    `- Severity: ${mdInline(issue.classification.severity)}\n` +
    `- Dogfood OK: ${mdInline(issue.trigger.dogfoodOk)}\n` +
    `- Target label: ${mdInline(issue.target.label || 'unknown')}\n` +
    `- Target status preserved: ${mdInline(issue.safety.targetStatusPreserved)}\n\n` +
    `## Symptoms\n\n` +
    `- Failed call count: ${mdInline(issue.symptoms.failedCallCount)}\n` +
    `${issue.symptoms.failedCalls.length ? issue.symptoms.failedCalls.map((call: any) => `- ${mdInline(call.name)} exit=${mdInline(call.exitCode ?? 'unknown')} ok=${mdInline(call.ok ?? 'unknown')} observation=${mdInline(call.observation || 'none')}`).join('\n') : '- none'}\n\n` +
    `## Operator report\n\n${issue.operatorReport ? mdInline(issue.operatorReport) : 'none'}\n\n` +
    `## Next actions\n\n${issue.nextActions.map((action: string) => `- ${mdInline(action)}`).join('\n')}\n\n` +
    `## Authority boundaries\n\n${issue.authorityBoundaries.map((boundary: string) => `- ${mdInline(boundary)}`).join('\n')}\n`;
}

function nearestExistingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const next = dirname(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function safeWriteWorkspaceFile(path: string, content: string) {
  const workspaceRoot = realpathSync(process.cwd());
  const outputPath = resolve(workspaceRoot, path);
  if (!isContainedPath(workspaceRoot, outputPath)) throw new Error('Output path must stay within the workspace');
  const parent = dirname(outputPath);
  const existingAncestorReal = realpathSync(nearestExistingAncestor(parent));
  if (!isContainedPath(workspaceRoot, existingAncestorReal)) throw new Error('Output path must stay within the workspace');
  mkdirSync(parent, { recursive: true });
  const parentReal = realpathSync(parent);
  if (!isContainedPath(workspaceRoot, parentReal)) throw new Error('Output path must stay within the workspace');
  if (existsSync(outputPath) && lstatSync(outputPath).isSymbolicLink()) {
    throw new Error('Output path must not be a symlink');
  }
  const tmp = resolve(parentReal, `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  let fd: number | null = null;
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeSync(fd, content);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Output path must be a regular file');
  } finally {
    if (fd !== null) closeSync(fd);
  }
  renameSync(tmp, outputPath);
}

function main() {
  const inputPath = argValue('--input') || defaultInputPath;
  const outputPath = argValue('--output') || defaultOutputPath;
  const format = (argValue('--format') || 'json') as Format;
  const operatorNote = argValue('--operator-note');
  const scenario = argValue('--scenario');
  validateCliOptions(format);

  const evidence = readJson(inputPath);
  const issue = buildIssue(evidence, { inputPath, operatorNote, scenario });
  const output = format === 'json' ? `${JSON.stringify(issue, null, 2)}\n` : renderMarkdown(issue);
  if (!hasArg('--stdout-only')) safeWriteWorkspaceFile(outputPath, output);
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown target dogfood issue capture error';
    console.error(`target-dogfood-issue: ${message}`);
    process.exit(1);
  }
}
