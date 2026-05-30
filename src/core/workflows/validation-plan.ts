import { bunTestCommandForFile, extractFilesFromPatch, hasGraphImpact, normalizeRecommendationFiles, type RecommendChecksArgs } from './patch-analysis.js';

export function buildValidationPlan(args: {
    workflow: string;
    mode: string;
    snapshot?: string;
    snapshotArtifacts?: any;
    risk?: any;
    commands: string[];
    checksOk: boolean;
    checksElapsedMs: number | null;
    checkCommands?: Array<{
        command: string;
        ok?: boolean | null;
        elapsedMs?: number;
        exitCode?: number | null;
        timedOut?: boolean;
    }>;
    checkRecommendations?: any;
    impactSummary?: any;
    applied: boolean;
    applyGuardSatisfied: boolean;
    rollback?: any;
    verification?: any;
}) {
    const recommendedMinimum = Array.isArray(args.checkRecommendations?.minimum)
        ? args.checkRecommendations.minimum.map(String)
        : [];
    const recommendedBroader = Array.isArray(args.checkRecommendations?.broader)
        ? args.checkRecommendations.broader.map(String)
        : [];
    const rationale = Array.isArray(args.checkRecommendations?.rationale) ? args.checkRecommendations.rationale : [];
    const impactCounts =
        args.impactSummary?.counts && typeof args.impactSummary.counts === 'object' ? args.impactSummary.counts : null;
    const impactSeed =
        args.impactSummary?.seed && typeof args.impactSummary.seed === 'object'
            ? {
                  kind: String(args.impactSummary.seed.kind || 'unknown'),
                  value: String(args.impactSummary.seed.value || ''),
              }
            : null;
    const languageSupport =
        args.impactSummary?.languageSupport && typeof args.impactSummary.languageSupport === 'object'
            ? {
                  language: String(args.impactSummary.languageSupport.language || 'unknown'),
                  support: String(args.impactSummary.languageSupport.support || 'unknown'),
                  supportedEdges: Array.isArray(args.impactSummary.languageSupport.supportedEdges)
                      ? args.impactSummary.languageSupport.supportedEdges.map(String)
                      : [],
              }
            : null;
    const edgeEvidence = Array.isArray(args.impactSummary?.evidence)
        ? args.impactSummary.evidence.map((item: any) => ({
              edge: String(item?.edge || 'unknown'),
              count: Number(item?.count || 0),
              status: String(item?.status || 'unknown'),
              limitations: Array.isArray(item?.limitations) ? item.limitations.map(String) : [],
          }))
        : [];
    const executedCommands = Array.isArray(args.checkCommands)
        ? args.checkCommands.map((item) => String(item?.command || '').trim()).filter(Boolean)
        : [];
    const selectedCommands = executedCommands.length ? executedCommands : args.commands.map(String);
    const status = !args.checksOk
        ? 'checks_failed'
        : args.mode === 'apply_after_checks' && !args.applied
          ? args.applyGuardSatisfied
              ? 'apply_failed'
              : 'apply_refused'
          : 'checks_passed';
    return {
        schema: 'semantic-code-intelligence.validation_plan.v1',
        workflow: args.workflow,
        mode: args.mode,
        snapshot: args.snapshot || null,
        status,
        touchedFiles: Array.isArray(args.risk?.files) ? args.risk.files : [],
        risk: args.risk
            ? {
                  level: args.risk.level,
                  category: args.risk.category,
                  fileCount: args.risk.fileCount,
              }
            : null,
        commands: {
            selected: selectedCommands,
            requested: args.commands.map(String),
            recommendedMinimum,
            recommendedBroader,
            recommendationsAppliedToSelected: false,
        },
        rationale,
        graphImpact: args.impactSummary
            ? {
                  seed: impactSeed,
                  languageSupport,
                  backend: typeof args.impactSummary?.backend === 'string' ? args.impactSummary.backend : null,
                  freshness: typeof args.impactSummary?.freshness === 'string' ? args.impactSummary.freshness : null,
                  requestedEdges: Array.isArray(args.impactSummary?.requestedEdges)
                      ? args.impactSummary.requestedEdges.map(String)
                      : [],
                  counts: impactCounts,
                  evidence: edgeEvidence,
                  limitations: Array.isArray(args.impactSummary?.limitations)
                      ? args.impactSummary.limitations.map(String)
                      : [],
                  callerContextCount:
                      typeof args.impactSummary?.callerContextCount === 'number'
                          ? args.impactSummary.callerContextCount
                          : null,
                  hasImpactEvidence: args.impactSummary?.hasImpactEvidence === true,
                  planningHints: Array.isArray(args.impactSummary?.planningHints)
                      ? args.impactSummary.planningHints.map(String)
                      : [],
              }
            : null,
        checks: {
            ok: args.checksOk,
            elapsedMs: args.checksElapsedMs,
            commands: Array.isArray(args.checkCommands) ? args.checkCommands : [],
        },
        artifacts: args.snapshotArtifacts
            ? {
                  overlayDiff: args.snapshotArtifacts.overlayDiff,
                  status: args.snapshotArtifacts.status,
                  progress: args.snapshotArtifacts.progress,
              }
            : null,
        apply: { applied: args.applied, guardSatisfied: args.applyGuardSatisfied },
        rollback: args.rollback
            ? {
                  available: !!args.rollback.available,
                  command: args.rollback.command,
                  artifact: args.rollback.artifact,
              }
            : null,
        verification: args.verification
            ? {
                  staged: args.verification.staged === true,
                  checksPassed: args.verification.checksPassed === true,
                  applyGuardSatisfied: args.verification.applyGuardSatisfied === true,
                  applied: args.verification.applied === true,
                  appliedDiffMatchesSnapshot:
                      typeof args.verification.appliedDiffMatchesSnapshot === 'boolean'
                          ? args.verification.appliedDiffMatchesSnapshot
                          : null,
                  method: typeof args.verification.method === 'string' ? args.verification.method : null,
                  diagnostics:
                      args.verification.diagnostics && typeof args.verification.diagnostics === 'object'
                          ? args.verification.diagnostics
                          : null,
              }
            : null,
        note: 'Evidence summary only; it does not select, append, or enforce validation commands.',
    };
}

export function recommendChecksPayload(args: RecommendChecksArgs) {
    const files = normalizeRecommendationFiles(args);
    const mode = args?.mode === 'broader' ? 'broader' : 'minimum';
    const impactSummary = args?.impactSummary && typeof args.impactSummary === 'object' ? args.impactSummary : null;
    const rationale: Array<{
        reason: string;
        files?: string[];
        command?: string;
        detail?: string;
    }> = [];
    const minimum = new Set<string>();
    const broader = new Set<string>();
    const addMinimum = (command: string) => {
        minimum.add(command);
        broader.add(command);
    };
    const addBroader = (command: string) => broader.add(command);

    const docs = files.filter((file) => /(^|\/)docs\//.test(file) || /\.mdx?$/.test(file));
    const docsProject = docs.filter((file) => file.startsWith('docs/project/'));
    const tsSource = files.filter((file) => /^src\/.*\.[cm]?tsx?$/.test(file));
    const tests = files.filter(
        (file) => /(^|\/)(tests?|__tests__)\//.test(file) || /(?:^|[./-])(test|spec)\.[cm]?[tj]sx?$/.test(file)
    );
    const configs = files.filter((file) =>
        /(^package\.json$|^bun\.lockb?$|^tsconfig.*\.json$|^justfile$|^Justfile$|^\.github\/workflows\/|^scripts\/.*\.[cm]?tsx?$)/.test(
            file
        )
    );
    const nonDocs = files.filter((file) => !docs.includes(file));

    if (files.length === 0) {
        addMinimum('bun run typecheck');
        rationale.push({
            reason: 'no_touched_files_supplied',
            command: 'bun run typecheck',
            detail: 'Conservative default when neither files nor parseable patch paths are supplied.',
        });
    }

    if (files.length > 0 && nonDocs.length === 0) {
        addMinimum('true');
        rationale.push({
            reason: docsProject.length > 0 ? 'docs_project_changed' : 'markdown_only_changed',
            files: docs,
            command: 'true',
        });
    }

    if (tsSource.length > 0) {
        addMinimum('bun run typecheck');
        rationale.push({
            reason: 'typescript_source_changed',
            files: tsSource,
            command: 'bun run typecheck',
        });
    }

    for (const file of tests) {
        const command = bunTestCommandForFile(file);
        addMinimum(command);
        rationale.push({ reason: 'test_file_changed', files: [file], command });
    }
    if (tests.length > 0) {
        addBroader('bun run typecheck');
    }

    if (configs.length > 0) {
        addMinimum('bun run typecheck');
        addBroader('bun test');
        rationale.push({
            reason: 'package_or_config_changed',
            files: configs,
            command: 'bun run typecheck',
        });
    }

    if (
        impactSummary &&
        hasGraphImpact(impactSummary) &&
        (tsSource.length > 0 || files.some((file) => /\.[cm]?[tj]sx?$/.test(file)))
    ) {
        addBroader('bun run typecheck');
        rationale.push({
            reason: 'graph_impact_edges_present',
            command: 'consider broader validation',
            detail: 'graph_expand impactSummary has non-empty imports/exports/callers/callees counts for a source-adjacent change.',
        });
    }

    if (minimum.size === 0) {
        addMinimum('bun run typecheck');
        rationale.push({
            reason: 'fallback_unknown_change_shape',
            files,
            command: 'bun run typecheck',
        });
    }

    const minimumCommands = [...minimum];
    const broaderCommands = [...broader];
    const commands = mode === 'broader' ? broaderCommands : minimumCommands;
    const confidence =
        files.length === 0 ? 'low' : impactSummary && hasGraphImpact(impactSummary) ? 'medium' : 'medium';
    return {
        workflow: 'recommend_checks',
        ok: true,
        mode,
        commands,
        minimum: minimumCommands,
        broader: broaderCommands,
        rationale,
        confidence,
        inputs: {
            files,
            hasPatch: typeof args?.patch === 'string' && args.patch.trim().length > 0,
            hasImpactSummary: !!impactSummary,
        },
        note: 'Heuristic recommendation only; callers remain responsible for choosing and running validation.',
    };
}