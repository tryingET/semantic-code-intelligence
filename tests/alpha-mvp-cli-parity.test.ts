import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

type CliResult = { code: number | null; stdout: string; stderr: string };

const patchPlanningMarker = '<!-- alpha cli patch-planning snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -7,6 +7,7 @@ type: "reference"
 ---
${' '}
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
${' '}
 ## User and job
${' '}
`;
const hasAstGrep = spawnSync('bash', ['-lc', 'command -v ast-grep >/dev/null 2>&1'], { stdio: 'ignore' }).status === 0;
const structuralTest = hasAstGrep ? test : test.skip;

function runCli(args: string[], options: { cwd?: string } = {}): Promise<CliResult> {
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    const cliEntry = options.cwd ? path.join(process.cwd(), 'src/servers/cli.ts') : 'src/servers/cli.ts';
    return new Promise((resolve) => {
        const proc = spawn(bun, ['run', cliEntry, ...args], {
            cwd: options.cwd,
            env: {
                ...process.env,
                ...(options.cwd ? { SEMANTIC_CODE_WORKSPACE: options.cwd } : {}),
                SILENT_MODE: 'true',
                STDIO_MODE: 'true',
                ALLOW_SNAPSHOT_APPLY: '',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (chunk) => {
            stdout += String(chunk);
        });
        proc.stderr?.on('data', (chunk) => {
            stderr += String(chunk);
        });
        proc.on('close', (code) => {
            resolve({ code, stdout, stderr });
        });
    });
}

function parseWorkflow(stdout: string): { raw: any; payload: any } {
    const raw = JSON.parse(stdout.trim() || '{}');
    const text = raw?.content?.[0]?.text;
    const payload = typeof text === 'string' ? JSON.parse(text) : raw;
    return { raw, payload };
}

async function workflow(name: string, args: Record<string, unknown>, options: { cwd?: string } = {}) {
    const res = await runCli(['workflow', name, '--args', JSON.stringify(args), '--json'], options);
    expect(res.code, `${name} stderr: ${res.stderr}`).toBe(0);
    expect(res.stderr).not.toContain('[HTTP Server]');
    expect(res.stderr).not.toContain('Error:');
    return parseWorkflow(res.stdout);
}

async function workflowFailure(name: string, args: Record<string, unknown>, options: { cwd?: string } = {}) {
    const res = await runCli(['workflow', name, '--args', JSON.stringify(args), '--json'], options);
    expect(res.code, `${name} should fail`).not.toBe(0);
    expect(res.stderr).not.toContain('[HTTP Server]');
    return JSON.parse(res.stdout.trim() || '{}');
}

describe('Alpha MVP CLI fallback parity', () => {
    test('init refuses dangling .semantic-code-ignore symlinks without writing outside cwd', async () => {
        const workspace = await mkdtemp(path.join(tmpdir(), 'sci-cli-init-symlink-'));
        const outsideTarget = path.join(tmpdir(), `sci-ignore-target-${Date.now()}-${Math.random()}`);
        try {
            await rm(outsideTarget, { force: true });
            await symlink(outsideTarget, path.join(workspace, '.semantic-code-ignore'));
            const res = await runCli(['init'], { cwd: workspace });
            expect(res.code).not.toBe(0);
            expect(res.stderr).toContain('Ignore path must not be a symlink');
            await expect(access(outsideTarget)).rejects.toThrow();
        } finally {
            await rm(workspace, { recursive: true, force: true });
            await rm(outsideTarget, { force: true });
        }
    }, 60000);

    test('generic workflow command rejects registered non-Alpha tools', async () => {
        for (const name of ['plan_rename', 'list_pipelines', 'get_completions']) {
            const refused = await workflowFailure(name, {});
            expect(refused.success, `${name} should fail`).toBe(false);
            expect(refused.error?.code, `${name} should be an Alpha membrane error`).toBe('InvalidParams');
            expect(refused.error?.message, `${name} should report Alpha membrane`).toContain('not available');
        }
    }, 60000);

    test('rename_safely is reachable through generic workflow and direct CLI alias without mutating files', async () => {
        const workspace = await mkdtemp(path.join(tmpdir(), 'sci-cli-rename-'));
        const target = 'target.ts';
        const initial = 'export const oldName = 1;\nconsole.log(oldName);\n';
        try {
            await writeFile(path.join(workspace, target), initial, 'utf8');

            const generic = await workflow(
                'rename_safely',
                { oldName: 'oldName', newName: 'newName', file: target, runChecks: false },
                { cwd: workspace }
            );
            expect(generic.payload).toMatchObject({ workflow: 'rename_safely', ok: true, filesAffected: 1 });
            expect(generic.payload.snapshot).toMatch(/^[0-9a-f-]{8,}$/i);

            const alias = await runCli(['rename-safely', 'oldName', 'newName', '-f', target, '--no-checks', '--json'], {
                cwd: workspace,
            });
            expect(alias.code, alias.stderr).toBe(0);
            const parsedAlias = parseWorkflow(alias.stdout);
            expect(parsedAlias.payload).toMatchObject({ workflow: 'rename_safely', ok: true, filesAffected: 1 });
            expect(await readFile(path.join(workspace, target), 'utf8')).toBe(initial);
        } finally {
            await rm(workspace, { recursive: true, force: true });
        }
    }, 60000);

    test('CLI aliases cannot bypass the Alpha workflow membrane', async () => {
        const help = await runCli(['--help']);
        expect(help.code).toBe(0);
        expect(help.stdout).not.toContain('pipelines');

        const pipelines = await runCli(['pipelines', 'list', '--json']);
        expect(pipelines.code).not.toBe(0);
        const pipelinesError = JSON.parse(pipelines.stdout.trim() || '{}');
        expect(pipelinesError.success).toBe(false);
        expect(pipelinesError.error?.code).toBe('InvalidParams');
        expect(pipelinesError.error?.message).toContain('not available');
    }, 60000);

    test('generic workflow command executes read/navigation tools with machine-readable stdout', async () => {
        const read = await workflow('read_file', {
            path: 'docs/project/alpha-mvp-contract.md',
            range: { startLine: 1, endLine: 8 },
        });
        expect(read.payload.path).toBe('docs/project/alpha-mvp-contract.md');
        expect(read.payload.content).toContain('Alpha MVP contract');

        const search = await workflow('text_search', { query: 'handleToolCall', path: 'src', maxResults: 5 });
        expect(search.payload.count).toBeGreaterThan(0);
        expect(search.payload.results.length).toBeLessThanOrEqual(5);
    }, 60000);

    test('generic workflow command inspects snapshot metadata without materializing content by default', async () => {
        const workspace = await mkdtemp(path.join(tmpdir(), 'sci-cli-snapshot-metadata-'));
        try {
            await writeFile(
                path.join(workspace, 'alpha.md'),
                '# Alpha MVP contract — harnessed LLM coding sessions\n',
                'utf8'
            );

            const snapshot = await workflow('get_snapshot', { preferExisting: false }, { cwd: workspace });
            expect(snapshot.payload.snapshot).toMatch(/^[0-9a-f-]{8,}$/i);
            const materializedMarker = path.join(
                workspace,
                '.ontology',
                'snapshots',
                snapshot.payload.snapshot,
                '.materialized'
            );
            expect(await Bun.file(materializedMarker).exists()).toBe(false);

            const artifacts = await workflow(
                'extract_snapshot_artifacts',
                {
                    snapshot: snapshot.payload.snapshot,
                    includeContent: false,
                },
                { cwd: workspace }
            );
            expect(artifacts.raw.isError).toBe(false);
            expect(artifacts.payload.status).toMatchObject({ exists: true, diffCount: 0, materialized: false });
            expect(artifacts.payload.contents).toBeUndefined();
            expect(artifacts.payload.links?.map((link: any) => link.uri)).toContain(
                `snapshot://${snapshot.payload.snapshot}/status`
            );
            expect(await Bun.file(materializedMarker).exists()).toBe(false);
        } finally {
            await rm(workspace, { recursive: true, force: true });
        }
    }, 60000);

    test('generic workflow command exposes snapshot artifacts across fresh CLI processes without mutating workspace', async () => {
        const workspace = await mkdtemp(path.join(tmpdir(), 'sci-cli-snapshot-'));
        const target = 'alpha.md';
        const initial = '# Alpha MVP contract — harnessed LLM coding sessions\n';
        const marker = '<!-- cross-process snapshot artifact marker -->';
        const diff = `diff --git a/${target} b/${target}
--- a/${target}
+++ b/${target}
@@ -1,1 +1,2 @@
 ${initial.trimEnd()}
+${marker}
`;

        try {
            await writeFile(path.join(workspace, target), initial, 'utf8');

            const checked = await workflow(
                'patch_checks_in_snapshot',
                {
                    patch: diff,
                    commands: ['true'],
                    timeoutSec: 30,
                },
                { cwd: workspace }
            );
            expect(checked.payload.workflow).toBe('patch_checks_in_snapshot');
            expect(checked.payload.ok).toBe(true);
            expect(checked.payload.stage?.accepted).toBe(true);
            expect(checked.payload.checks?.ok).toBe(true);
            expect(checked.payload.snapshot).toMatch(/^[0-9a-f-]{8,}$/i);

            const afterStage = await readFile(path.join(workspace, target), 'utf8');
            expect(afterStage).toBe(initial);
            expect(afterStage).not.toContain(marker);

            const artifacts = await workflow(
                'extract_snapshot_artifacts',
                {
                    snapshot: checked.payload.snapshot,
                    includeContent: true,
                    maxBytes: 4096,
                },
                { cwd: workspace }
            );
            expect(artifacts.raw.isError).toBe(false);
            expect(artifacts.payload.snapshot).toBe(checked.payload.snapshot);
            expect(artifacts.payload.status).toMatchObject({ exists: true, diffCount: 1, materialized: true });
            expect(artifacts.payload.status?.touchedFiles).toEqual([target]);
            expect(artifacts.payload.links?.map((link: any) => link.uri)).toContain(
                `snapshot://${checked.payload.snapshot}/overlay.diff`
            );
            expect(artifacts.payload.contents?.overlayDiff).toMatchObject({ truncated: false });
            expect(artifacts.payload.contents?.overlayDiff?.text).toContain(marker);

            const afterExtract = await readFile(path.join(workspace, target), 'utf8');
            expect(afterExtract).toBe(initial);
            expect(afterExtract).not.toContain(marker);
        } finally {
            await rm(workspace, { recursive: true, force: true });
        }
    }, 60000);

    test('generic workflow command executes preview-first patch checks and safe_write without mutating workspace', async () => {
        const before = await Bun.file(patchPlanningTarget).text();
        expect(before).not.toContain(patchPlanningMarker);

        const checked = await workflow('patch_checks_in_snapshot', {
            patch: patchPlanningDiff,
            commands: ['true'],
            timeoutSec: 30,
        });
        expect(checked.payload.workflow).toBe('patch_checks_in_snapshot');
        expect(checked.payload.ok).toBe(true);
        expect(checked.payload.stage?.accepted).toBe(true);
        expect(checked.payload.checks?.ok).toBe(true);
        expect(checked.payload.validationPlan?.checks?.commands?.[0]).toMatchObject({ command: 'true', ok: true });

        const safePreview = await workflow('safe_write', {
            patch: patchPlanningDiff,
            commands: ['true'],
            timeoutSec: 30,
            brief: true,
            impactSummary: {
                hasImpactEvidence: false,
                counts: {},
                limitations: ['test graph limitation'],
                planningHints: ['test planning hint'],
            },
        });
        expect(safePreview.payload.workflow).toBe('safe_write');
        expect(safePreview.payload.ok).toBe(true);
        expect(safePreview.payload.mode).toBe('preview_validate');
        expect(safePreview.payload.applied).toBe(false);
        expect(safePreview.payload.risk.category).toBe('docs_only');
        expect(safePreview.payload.validationPlan?.checks?.commands?.[0]).toMatchObject({ command: 'true', ok: true });
        expect(safePreview.payload.validationPlan?.graphImpact?.limitations).toEqual(['test graph limitation']);
        expect(safePreview.payload.validationPlan?.verification).toMatchObject({
            staged: true,
            checksPassed: true,
            applyGuardSatisfied: true,
            applied: false,
            appliedDiffMatchesSnapshot: null,
        });

        const refusedApply = await workflow('safe_write', {
            patch: patchPlanningDiff,
            commands: ['true'],
            timeoutSec: 30,
            apply: true,
        });
        expect(refusedApply.payload.ok).toBe(false);
        expect(refusedApply.payload.reason).toBe('apply_guard_required');
        expect(refusedApply.payload.applied).toBe(false);
        expect(refusedApply.payload.applyResult?.message).toBe('ALLOW_SNAPSHOT_APPLY=1 required');
        expect(refusedApply.payload.validationPlan?.verification).toMatchObject({
            staged: true,
            checksPassed: true,
            applyGuardSatisfied: false,
            applied: false,
        });

        const after = await Bun.file(patchPlanningTarget).text();
        expect(after).toBe(before);
        expect(after).not.toContain(patchPlanningMarker);
    }, 60000);

    structuralTest(
        'generic workflow command executes ast-grep structural search and preview-first structural patch checks',
        async () => {
            const target = 'tests/alpha-mvp-cli-parity.test.ts';
            const before = await Bun.file(target).text();
            expect(before).toContain('const patchPlanningTarget');

            const search = await workflow('structural_search', {
                language: 'typescript',
                pattern: 'workflow($NAME, $ARGS)',
                paths: [target],
                maxResults: 5,
            });
            expect(search.payload.ok).toBe(true);
            expect(search.payload.backend).toBe('ast-grep');
            expect(search.payload.matches.length).toBeGreaterThan(0);
            expect(search.payload.matches.length).toBeLessThanOrEqual(5);

            const defaultPathSearch = await workflow('structural_search', {
                language: 'typescript',
                pattern: 'workflow($NAME, $ARGS)',
                maxResults: 1,
            });
            expect(defaultPathSearch.payload.ok).toBe(true);
            expect(defaultPathSearch.payload.paths).toEqual(['.']);
            expect(defaultPathSearch.payload.matches.length).toBeLessThanOrEqual(1);

            const checked = await workflow('structural_patch_checks', {
                language: 'typescript',
                pattern: 'const patchPlanningTarget = $VALUE',
                rewrite: 'const structuralPatchTarget = $VALUE',
                paths: [target],
                commands: ['true'],
                timeoutSec: 30,
                apply: false,
            });
            expect(checked.payload.workflow).toBe('structural_patch_checks');
            expect(checked.payload.ok).toBe(true);
            expect(checked.payload.backend).toBe('ast-grep');
            expect(checked.payload.stage?.accepted).toBe(true);
            expect(checked.payload.checks?.ok).toBe(true);
            expect(checked.payload.applied).toBe(false);
            expect(checked.payload.patch?.replacementCount).toBeGreaterThan(0);
            expect(checked.payload.patch?.diffBytes).toBeGreaterThan(0);
            expect(Array.isArray(checked.payload.patch?.summary)).toBe(true);
            expect(checked.payload.snapshotArtifacts?.overlayDiff).toContain(
                `snapshot://${checked.payload.snapshot}/overlay.diff`
            );
            expect(checked.payload.next_actions.join('\n')).toContain('snapshot://');
            expect(checked.payload.checks?.commands?.[0]).toMatchObject({
                command: 'true',
                ok: true,
                exitCode: 0,
                timedOut: false,
            });

            const artifacts = await workflow('extract_snapshot_artifacts', {
                snapshot: checked.payload.snapshot,
                includeContent: true,
                maxBytes: 4096,
            });
            expect(artifacts.payload.status?.exists).toBe(true);
            expect(artifacts.payload.status?.diffCount).toBeGreaterThan(0);
            expect(artifacts.payload.contents?.overlayDiff?.text).toContain('structuralPatchTarget');
            expect(artifacts.payload.links?.map((link: any) => link.uri)).toContain(
                `snapshot://${checked.payload.snapshot}/overlay.diff`
            );

            const defaultChecks = await workflow('structural_patch_checks', {
                language: 'typescript',
                pattern: 'const patchPlanningTarget = $VALUE',
                rewrite: 'const structuralPatchTarget = $VALUE',
                paths: [target],
                timeoutSec: 120,
                apply: false,
            });
            expect(defaultChecks.payload.ok).toBe(true);
            expect(defaultChecks.payload.checks?.commands?.[0]).toMatchObject({
                command: 'bun run typecheck',
                ok: true,
                exitCode: 0,
                timedOut: false,
            });
            expect(String(defaultChecks.payload.checks?.output || '')).toContain('tsgo');

            const refusedApply = await workflow('structural_patch_checks', {
                language: 'typescript',
                pattern: 'const patchPlanningTarget = $VALUE',
                rewrite: 'const structuralPatchTarget = $VALUE',
                paths: [target],
                commands: ['true'],
                timeoutSec: 30,
                apply: true,
            });
            expect(refusedApply.payload.ok).toBe(false);
            expect(refusedApply.payload.applied).toBe(false);
            expect(refusedApply.payload.applyResult?.message).toBe('ALLOW_SNAPSHOT_APPLY=1 required');

            const after = await Bun.file(target).text();
            expect(after).toBe(before);
            expect(after).toContain('const patchPlanningTarget');
        },
        60000
    );
});
