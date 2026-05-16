import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';

type CliResult = { code: number | null; stdout: string; stderr: string };

const patchPlanningMarker = '<!-- alpha cli patch-planning snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -9,1 +9,2 @@
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
`;
const hasAstGrep = spawnSync('bash', ['-lc', 'command -v ast-grep >/dev/null 2>&1'], { stdio: 'ignore' }).status === 0;
const structuralTest = hasAstGrep ? test : test.skip;

function runCli(args: string[]): Promise<CliResult> {
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    return new Promise((resolve) => {
        const proc = spawn(bun, ['run', 'src/servers/cli.ts', ...args], {
            env: { ...process.env, SILENT_MODE: 'true', STDIO_MODE: 'true', ALLOW_SNAPSHOT_APPLY: '' },
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

async function workflow(name: string, args: Record<string, unknown>) {
    const res = await runCli(['workflow', name, '--args', JSON.stringify(args), '--json']);
    expect(res.code, `${name} stderr: ${res.stderr}`).toBe(0);
    expect(res.stderr).not.toContain('[HTTP Server]');
    expect(res.stderr).not.toContain('Error:');
    return parseWorkflow(res.stdout);
}

describe('Alpha MVP CLI fallback parity', () => {
    test('generic workflow command executes read/navigation tools with machine-readable stdout', async () => {
        const read = await workflow('read_file', {
            path: 'docs/project/alpha-mvp-contract.md',
            range: { startLine: 1, endLine: 8 },
        });
        expect(read.payload.path).toBe('docs/project/alpha-mvp-contract.md');
        expect(read.payload.content).toContain('Alpha MVP contract');

        const search = await workflow('text_search', { query: 'handleReadFile', path: 'src', maxResults: 5 });
        expect(search.payload.count).toBeGreaterThan(0);
        expect(search.payload.results.length).toBeLessThanOrEqual(5);
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

        const safePreview = await workflow('safe_write', {
            patch: patchPlanningDiff,
            commands: ['true'],
            timeoutSec: 30,
            brief: true,
        });
        expect(safePreview.payload.workflow).toBe('safe_write');
        expect(safePreview.payload.ok).toBe(true);
        expect(safePreview.payload.mode).toBe('preview_validate');
        expect(safePreview.payload.applied).toBe(false);
        expect(safePreview.payload.risk.category).toBe('docs_only');

        const refusedApply = await workflow('safe_write', {
            patch: patchPlanningDiff,
            commands: ['true'],
            timeoutSec: 30,
            apply: true,
        });
        expect(refusedApply.payload.workflow).toBe('safe_write');
        expect(refusedApply.payload.ok).toBe(false);
        expect(refusedApply.payload.applied).toBe(false);
        expect(refusedApply.payload.applyResult?.message).toBe('ALLOW_SNAPSHOT_APPLY=1 required');
        expect(refusedApply.payload.rollback?.command).toContain('git apply -R');

        const after = await Bun.file(patchPlanningTarget).text();
        expect(after).toBe(before);
        expect(after).not.toContain(patchPlanningMarker);
    }, 60000);

    structuralTest('generic workflow command executes ast-grep structural search and preview-first structural patch checks', async () => {
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
        expect(checked.payload.snapshotArtifacts?.overlayDiff).toContain(`snapshot://${checked.payload.snapshot}/overlay.diff`);
        expect(checked.payload.next_actions.join('\n')).toContain('snapshot://');
        expect(checked.payload.checks?.commands).toEqual(['true']);

        const artifacts = await workflow('extract_snapshot_artifacts', {
            snapshot: checked.payload.snapshot,
            includeContent: true,
            maxBytes: 4096,
        });
        expect(artifacts.payload.status?.exists).toBe(true);
        expect(artifacts.payload.status?.diffCount).toBeGreaterThan(0);
        expect(artifacts.payload.contents?.overlayDiff?.text).toContain('structuralPatchTarget');
        expect(artifacts.payload.links?.map((link: any) => link.uri)).toContain(
            `snapshot://${checked.payload.snapshot}/overlay.diff`,
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
        expect(defaultChecks.payload.checks?.commands).toEqual(['bun run typecheck']);
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
    }, 60000);
});
