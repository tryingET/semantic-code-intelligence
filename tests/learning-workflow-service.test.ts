import { describe, expect, test } from 'bun:test';
import { LearningWorkflowService } from '../src/core/workflows/learning-workflow.js';

function text(result: any) {
    return 'text' in result ? result.text : JSON.stringify(result.payload);
}

function parsed(result: any) {
    return JSON.parse(text(result));
}

describe('LearningWorkflowService', () => {
    test('lists pipeline metadata without MCP protocol objects', async () => {
        const service = new LearningWorkflowService({ coreAnalyzer: { learningOrchestrator: fakeOrchestrator() } });

        const result = await service.listPipelines();
        expect(result.isError).toBe(false);
        expect(parsed(result).pipelines[0]).toMatchObject({
            id: 'feedback',
            name: 'Feedback Cycle',
            trigger: 'manual',
            enabled: true,
            lastRunAt: 100,
            nextRunAt: 200,
            scheduleNote: 'soon',
        });
    });

    test('runs pipelines and lists bounded run history', async () => {
        const orchestrator = fakeOrchestrator();
        const service = new LearningWorkflowService({ coreAnalyzer: { learningOrchestrator: orchestrator } });

        const run = await service.runPipeline({ id: 'feedback' });
        expect(run.isError).toBe(false);
        expect(parsed(run)).toMatchObject({ ok: true, runId: 'run-1' });
        expect(orchestrator.lastRunContext).toMatchObject({ operation: 'pipeline_run', metadata: {} });

        const runs = await service.listPipelineRuns({ id: 'feedback', limit: 999 });
        expect(parsed(runs).runs).toEqual([{ id: 'run-1' }]);
        expect(orchestrator.lastListLimit).toBe(100);
    });

    test('reports pipeline status and pattern stats from core layers', async () => {
        const service = new LearningWorkflowService({
            coreAnalyzer: {
                learningOrchestrator: fakeOrchestrator(),
                layerManager: { getLayer: () => ({ getPatternStatistics: async () => ({ total: 3 }) }) },
            },
        });

        expect(parsed(await service.pipelineStatus({ id: 'feedback' }))).toMatchObject({
            id: 'feedback',
            stats: { runsCompleted: 1, runsSuccessful: 1, averageRuntimeMs: 5 },
        });
        expect(parsed(await service.pipelineStatus({ id: 'missing' }))).toEqual({ ok: false, reason: 'not_found' });
        expect(parsed(await service.patternStats())).toEqual({ total: 3 });
    });

    test('preserves adapter-visible text errors for missing learning orchestrator', async () => {
        const service = new LearningWorkflowService({ coreAnalyzer: {} });
        const result = await service.listPipelines();

        expect(result).toEqual({ text: 'learning orchestrator unavailable', isError: true });
        expect(await service.pipelineStatus({})).toEqual({ text: 'id required', isError: true });
    });
});

function fakeOrchestrator() {
    return {
        pipelines: new Map([
            [
                'feedback',
                {
                    id: 'feedback',
                    name: 'Feedback Cycle',
                    trigger: 'manual',
                    schedule: null,
                    enabled: true,
                    stats: { runsCompleted: 1, runsSuccessful: 1, averageRuntimeMs: 5 },
                },
            ],
        ]),
        lastRunContext: undefined as any,
        lastListLimit: undefined as any,
        getPipelineLastRunAt: async () => 100,
        getPipelineNextRunAt: () => 200,
        getPipelineScheduleNote: () => 'soon',
        runPipeline(id: string, context: any) {
            this.lastRunContext = context;
            return Promise.resolve({ ok: true, id, runId: 'run-1' });
        },
        listPipelineRuns(id: string, limit: number) {
            this.lastListLimit = limit;
            return Promise.resolve([{ id: 'run-1' }]);
        },
    };
}
