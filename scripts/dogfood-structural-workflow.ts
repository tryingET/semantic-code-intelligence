#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const outputPath = '.test-results/structural-workflow-dogfood.json';
const target = 'tests/alpha-mvp-cli-parity.test.ts';
const jsonMode = process.argv.includes('--json');
const pretty = process.argv.includes('--pretty');

type StructuralDogfoodCall = {
    name: string;
    args: Record<string, unknown>;
    exitCode: number | null;
    success: boolean;
    elapsedMs: number;
    observation: string;
    stdoutJson: boolean;
    stderrClean: boolean;
    sample?: unknown;
};

const calls: StructuralDogfoodCall[] = [];

function commandExists(command: string): boolean {
    return spawnSync('bash', ['-lc', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' }).status === 0;
}

function parseWorkflowStdout(stdout: string) {
    const raw = JSON.parse(stdout.trim() || '{}');
    const text = raw?.content?.[0]?.text;
    const payload = typeof text === 'string' ? JSON.parse(text) : raw;
    return { raw, payload };
}

function compactSample(value: unknown): unknown {
    const cloned = JSON.parse(JSON.stringify(value));
    const text = cloned?.raw?.content?.[0]?.text;
    if (typeof text === 'string' && text.length > 900) {
        cloned.raw.content[0].text = `${text.slice(0, 900)}…`;
    }
    const output = cloned?.payload?.checks?.output;
    if (typeof output === 'string' && output.length > 900) {
        cloned.payload.checks.output = `${output.slice(0, 900)}…`;
    }
    return cloned;
}

function callSciWorkflow(name: string, args: Record<string, unknown>, observation: string, expectedOk: boolean | null = true) {
    const started = Date.now();
    const proc = spawnSync('sci', ['workflow', name, '--args', JSON.stringify(args), '--json'], {
        encoding: 'utf8',
        env: { ...process.env, SILENT_MODE: 'true', STDIO_MODE: 'true', ALLOW_SNAPSHOT_APPLY: '' },
    });
    const elapsedMs = Date.now() - started;
    const stderr = String(proc.stderr || '');
    let parsed: any = null;
    let stdoutJson = false;
    try {
        parsed = parseWorkflowStdout(String(proc.stdout || ''));
        stdoutJson = true;
    } catch {
        parsed = { stdout: String(proc.stdout || '').slice(0, 1000), stderr: stderr.slice(0, 1000) };
    }
    const stderrClean = !stderr.includes('[HTTP Server]') && !stderr.includes('Error:');
    const payloadOk = parsed?.payload?.ok !== false;
    const expectedPayload = expectedOk === null || payloadOk === expectedOk;
    const success = proc.status === 0 && stdoutJson && stderrClean && expectedPayload;
    calls.push({
        name,
        args,
        exitCode: proc.status,
        success,
        elapsedMs,
        observation,
        stdoutJson,
        stderrClean,
        sample: compactSample(parsed),
    });
    return parsed?.payload;
}

const before = await Bun.file(target).text();
const hasAstGrep = commandExists('ast-grep');
const hasSci = commandExists('sci');

let structuralSearch: any = null;
let patchCheckExplicit: any = null;
let patchCheckDefault: any = null;
let refusedApply: any = null;

if (hasAstGrep && hasSci) {
    structuralSearch = callSciWorkflow(
        'structural_search',
        { language: 'typescript', pattern: 'workflow($NAME, $ARGS)', paths: [target], maxResults: 3 },
        'Use installed sci CLI to find a known TypeScript workflow-call pattern inside SCI.'
    );

    patchCheckExplicit = callSciWorkflow(
        'structural_patch_checks',
        {
            language: 'typescript',
            pattern: 'const patchPlanningTarget = $VALUE',
            rewrite: 'const structuralPatchTarget = $VALUE',
            paths: [target],
            commands: ['true'],
            timeoutSec: 30,
            apply: false,
        },
        'Generate a structural rewrite diff, stage it in a snapshot, and run a cheap explicit check.'
    );

    patchCheckDefault = callSciWorkflow(
        'structural_patch_checks',
        {
            language: 'typescript',
            pattern: 'const patchPlanningTarget = $VALUE',
            rewrite: 'const structuralPatchTarget = $VALUE',
            paths: [target],
            timeoutSec: 120,
            apply: false,
        },
        'Verify omitted commands default to the tsgo-primary bun run typecheck lane.'
    );

    refusedApply = callSciWorkflow(
        'structural_patch_checks',
        {
            language: 'typescript',
            pattern: 'const patchPlanningTarget = $VALUE',
            rewrite: 'const structuralPatchTarget = $VALUE',
            paths: [target],
            commands: ['true'],
            timeoutSec: 30,
            apply: true,
        },
        'Verify apply:true is refused unless ALLOW_SNAPSHOT_APPLY=1 is explicitly present.',
        false
    );
}

const after = await Bun.file(target).text();
const workspaceUnchanged = before === after && after.includes('const patchPlanningTarget');
const unavailable = !hasAstGrep || !hasSci;
const evidence = {
    schema: 'semantic-code-intelligence.structural_workflow_dogfood.v1',
    ok: unavailable
        ? true
        : calls.every((call) => call.success) &&
          workspaceUnchanged &&
          structuralSearch?.ok === true &&
          structuralSearch?.matches?.length > 0 &&
          patchCheckExplicit?.ok === true &&
          patchCheckExplicit?.patch?.replacementCount > 0 &&
          patchCheckDefault?.ok === true &&
          String(patchCheckDefault?.checks?.commands?.join(' ') || '').includes('bun run typecheck') &&
          String(patchCheckDefault?.checks?.output || '').includes('tsgo') &&
          refusedApply?.ok === false &&
          refusedApply?.applied === false &&
          refusedApply?.applyResult?.message === 'ALLOW_SNAPSHOT_APPLY=1 required',
    mode: 'self_hosted_structural_workflow_sci_cli',
    targetRepo: process.cwd(),
    target,
    prerequisites: { astGrep: hasAstGrep, sci: hasSci },
    summary: calls.map(({ name, exitCode, success, elapsedMs, observation, stdoutJson, stderrClean }) => ({
        name,
        exitCode,
        success,
        elapsedMs,
        observation,
        stdoutJson,
        stderrClean,
    })),
    calls,
    structuralWorkflow: {
        workspaceUnchanged,
        previewFirst: patchCheckExplicit?.applied === false,
        snapshotArtifacts: patchCheckExplicit?.snapshotArtifacts || null,
        defaultChecks: patchCheckDefault?.checks?.commands || null,
        applyGuard: refusedApply?.applyResult || null,
        unavailableReason: unavailable ? (!hasAstGrep ? 'ast-grep unavailable' : 'sci unavailable') : null,
    },
    interpretation: {
        proves: unavailable
            ? ['Structural dogfood harness reports prerequisite availability and skips mutation when ast-grep or sci is unavailable.']
            : [
                  'Installed sci CLI can drive ast-grep structural search against SCI itself.',
                  'structural_patch_checks produces reviewable snapshot artifacts and preserves the working tree by default.',
                  'Default structural checks use bun run typecheck, the tsgo-primary TypeScript lane.',
                  'apply:true is refused without ALLOW_SNAPSHOT_APPLY=1.',
              ],
        does_not_prove: [
            'External repository usefulness.',
            'Durable cross-process snapshot/session state beyond composite workflow artifacts.',
            'Production-scale performance on very large repositories.',
        ],
    },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

const output = JSON.stringify(evidence, null, pretty ? 2 : 0);
if (jsonMode) process.stdout.write(`${output}\n`);
else console.log(output);

if (!evidence.ok) process.exitCode = 1;
