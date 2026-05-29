import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

export interface LearningWorkflowDeps {
    coreAnalyzer: any;
}

export class LearningWorkflowService {
    constructor(private readonly deps: LearningWorkflowDeps) {}

    async listPipelines(): Promise<SnapshotWorkflowResult> {
        const learningOrchestrator = this.getLearningOrchestrator();
        if (!learningOrchestrator) return { text: 'learning orchestrator unavailable', isError: true };

        try {
            const pipelines = Array.from((learningOrchestrator as any).pipelines?.values?.() || []);
            const items = await Promise.all(
                pipelines.map(async (pipeline: any) => {
                    const id = String(pipeline?.id || '');
                    const lastRunAt =
                        typeof (learningOrchestrator as any).getPipelineLastRunAt === 'function'
                            ? await (learningOrchestrator as any).getPipelineLastRunAt(id)
                            : null;
                    const nextRunAt =
                        typeof (learningOrchestrator as any).getPipelineNextRunAt === 'function'
                            ? (learningOrchestrator as any).getPipelineNextRunAt(id)
                            : null;
                    const scheduleNote =
                        typeof (learningOrchestrator as any).getPipelineScheduleNote === 'function'
                            ? (learningOrchestrator as any).getPipelineScheduleNote(id)
                            : null;
                    return {
                        id,
                        name: pipeline.name,
                        trigger: pipeline.trigger,
                        schedule: pipeline.schedule || null,
                        enabled: !!pipeline.enabled,
                        lastRunAt: typeof lastRunAt === 'number' ? lastRunAt : null,
                        nextRunAt: typeof nextRunAt === 'number' ? nextRunAt : null,
                        scheduleNote: typeof scheduleNote === 'string' ? scheduleNote : null,
                    };
                })
            );
            return { text: JSON.stringify({ pipelines: items }, null, 2), isError: false };
        } catch {
            return { text: 'failed to list pipelines', isError: true };
        }
    }

    async pipelineStatus(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const id = String(args?.id || '').trim();
        if (!id) return { text: 'id required', isError: true };

        const learningOrchestrator = this.getLearningOrchestrator();
        if (!learningOrchestrator) return { text: 'learning orchestrator unavailable', isError: true };

        try {
            const pipeline = (learningOrchestrator as any).pipelines?.get?.(id);
            if (!pipeline) return { text: JSON.stringify({ ok: false, reason: 'not_found' }), isError: false };

            const lastRunAt =
                typeof (learningOrchestrator as any).getPipelineLastRunAt === 'function'
                    ? await (learningOrchestrator as any).getPipelineLastRunAt(id)
                    : null;
            const nextRunAt =
                typeof (learningOrchestrator as any).getPipelineNextRunAt === 'function'
                    ? (learningOrchestrator as any).getPipelineNextRunAt(id)
                    : null;
            const scheduleNote =
                typeof (learningOrchestrator as any).getPipelineScheduleNote === 'function'
                    ? (learningOrchestrator as any).getPipelineScheduleNote(id)
                    : null;
            const status = {
                id: pipeline.id,
                name: pipeline.name,
                trigger: pipeline.trigger,
                schedule: pipeline.schedule || null,
                enabled: !!pipeline.enabled,
                stats: pipeline.stats || { runsCompleted: 0, runsSuccessful: 0, averageRuntimeMs: 0 },
                lastRunAt: typeof lastRunAt === 'number' ? lastRunAt : null,
                nextRunAt: typeof nextRunAt === 'number' ? nextRunAt : null,
                scheduleNote: typeof scheduleNote === 'string' ? scheduleNote : null,
            };
            return { text: JSON.stringify(status, null, 2), isError: false };
        } catch {
            return { text: 'failed to get pipeline status', isError: true };
        }
    }

    async runPipeline(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const id = String(args?.id || '').trim();
        if (!id) return { text: 'id required', isError: true };

        const learningOrchestrator = this.getLearningOrchestrator();
        if (!learningOrchestrator) return { text: 'learning orchestrator unavailable', isError: true };

        try {
            const context = {
                requestId: String(Date.now()),
                operation: 'pipeline_run',
                timestamp: new Date(),
                metadata: {},
            };
            const result = await (learningOrchestrator as any).runPipeline(id, context);
            return { text: JSON.stringify(result, null, 2), isError: !result?.ok };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { text: `run_pipeline failed: ${message}`, isError: true };
        }
    }

    async listPipelineRuns(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const id = String(args?.id || '').trim();
        const limit = Math.max(1, Math.min(100, Number(args?.limit || 10)));
        if (!id) return { text: 'id required', isError: true };

        const learningOrchestrator = this.getLearningOrchestrator();
        if (!learningOrchestrator) return { text: 'learning orchestrator unavailable', isError: true };

        try {
            const rows = await (learningOrchestrator as any).listPipelineRuns(id, limit);
            return { text: JSON.stringify({ runs: rows }, null, 2), isError: false };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { text: `list_pipeline_runs failed: ${message}`, isError: true };
        }
    }

    async patternStats(): Promise<SnapshotWorkflowResult> {
        try {
            const layerManager: any = this.deps.coreAnalyzer?.layerManager;
            const layer5 = layerManager?.getLayer?.('layer5');
            const stats =
                layer5 && typeof layer5.getPatternStatistics === 'function' ? await layer5.getPatternStatistics() : {};
            return { text: JSON.stringify(stats, null, 2), isError: false };
        } catch (error) {
            return { text: String(error), isError: true };
        }
    }

    private getLearningOrchestrator(): any | null {
        try {
            return this.deps.coreAnalyzer?.learningOrchestrator || null;
        } catch {
            return null;
        }
    }
}
