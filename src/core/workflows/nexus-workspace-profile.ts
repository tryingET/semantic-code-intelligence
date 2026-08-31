import * as path from 'node:path';
import { type WorkspaceBinding, loadOrCreateWorkspaceBinding, verifyWorkspaceBinding } from '../workspace-binding.js';
import { workspaceInputToPath, workspacePathRefToPath } from '../workspace-input.js';
import { isOutsideWorkspaceRelative, resolveWorkspacePath } from '../workspace-path.js';
import {
    assertWorkspaceRef,
    assertWorkspaceStateRef,
    createWorkspacePathRef,
    type WorkspaceStateRefV1,
    workspaceReferenceError,
} from '../workspace-ref.js';
import { captureWorkspaceState, sameWorkspaceState } from '../workspace-state.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

export class NexusWorkspaceProfile {
    private bindingPromise: Promise<WorkspaceBinding> | undefined;
    private readonly configuredRoot: string;

    constructor(workspaceRoot: () => string) {
        this.configuredRoot = path.resolve(workspaceRoot());
    }

    async currentBinding(): Promise<WorkspaceBinding> {
        if (!this.bindingPromise) this.bindingPromise = loadOrCreateWorkspaceBinding(this.configuredRoot);
        const binding = await this.bindingPromise;
        await verifyWorkspaceBinding(binding);
        return binding;
    }

    async bindingFor(args: Record<string, any>): Promise<WorkspaceBinding | null> {
        if (args?.workspace === undefined) return null;
        const binding = await this.currentBinding();
        assertWorkspaceRef(args.workspace, binding.workspace);
        return binding;
    }

    async preflightFile(args: Record<string, any>, binding: WorkspaceBinding): Promise<void> {
        if (args?.file === undefined) return;
        if (typeof args.file !== 'string') throw workspaceReferenceError('workspace_path_invalid');
        const reference = createWorkspacePathRef(binding.workspace, args.file);
        const requested = workspacePathRefToPath(reference, binding);
        await resolveWorkspacePath(requested, {
            workspaceRoot: binding.root.realRoot,
            inputLabel: 'NEXUS context file',
            binding,
        });
    }

    async preflightPaths(args: Record<string, any>, binding: WorkspaceBinding): Promise<void> {
        if (args?.paths === undefined) return;
        if (!Array.isArray(args.paths)) throw workspaceReferenceError('workspace_path_invalid');
        for (const value of args.paths) {
            if (typeof value !== 'string') throw workspaceReferenceError('workspace_path_invalid');
            const reference = createWorkspacePathRef(binding.workspace, value, { allowRoot: true });
            const requested = workspacePathRefToPath(reference, binding, { allowRoot: true });
            await resolveWorkspacePath(requested, {
                workspaceRoot: binding.root.realRoot,
                inputLabel: 'NEXUS structural path',
                allowRoot: true,
                binding,
            });
        }
    }

    async runNavigation(
        args: Record<string, any>,
        operation: () => Promise<SnapshotWorkflowResult>
    ): Promise<SnapshotWorkflowResult> {
        const binding = await this.bindingFor(args);
        if (!binding) return operation();
        await this.preflightFile(args, binding);
        await this.preflightPaths(args, binding);
        const additionalPaths = typeof args.file === 'string' ? [args.file] : [];
        const before = await captureWorkspaceState(binding, { additionalPaths, verifyStable: false });
        if (args?.state !== undefined) assertWorkspaceStateRef(args.state, before);
        const result = await operation();
        const after = await captureWorkspaceState(binding, { additionalPaths, verifyStable: false });
        if (!sameWorkspaceState(before, after)) {
            throw workspaceReferenceError('workspace_state_changed');
        }
        return decorateNavigationResult(result, binding, after);
    }
}

function decorateNavigationResult(
    result: SnapshotWorkflowResult,
    binding: WorkspaceBinding,
    state: WorkspaceStateRefV1
): SnapshotWorkflowResult {
    if (!('payload' in result) || !isRecord(result.payload)) return result;
    const payload: Record<string, any> = { ...result.payload, workspace: binding.workspace, state };
    bindNavigationPaths(payload, binding);
    if (payload.workflow === 'explore_symbol_impact' && Array.isArray(payload.nextReads)) {
        if (payload.status === 'indeterminate') {
            payload.nextReads = [];
        } else {
            payload.nextReads = payload.nextReads.map((item: unknown) => {
                if (!isRecord(item)) return item;
                const pathRef = locationRef(item.path, binding);
                if (!isRecord(item.arguments)) return pathRef ? { ...item, pathRef } : item;
                return {
                    ...item,
                    ...(pathRef ? { pathRef } : {}),
                    arguments: { ...item.arguments, workspace: binding.workspace, state },
                };
            });
        }
    }
    return { ...result, payload };
}

function bindNavigationPaths(payload: Record<string, any>, binding: WorkspaceBinding): void {
    if (isRecord(payload.definition)) {
        const ref = locationRef(payload.definition.path ?? payload.definition.uri, binding);
        if (ref) payload.definition = { ...payload.definition, pathRef: ref };
    }
    if (Array.isArray(payload.definitions)) {
        payload.definitions = payload.definitions.map((item: unknown) => {
            if (!isRecord(item)) return item;
            const ref = locationRef(item.path ?? item.uri, binding);
            return ref ? { ...item, pathRef: ref } : item;
        });
    }
    if (isRecord(payload.impact) && Array.isArray(payload.impact.files)) {
        payload.impact = {
            ...payload.impact,
            files: payload.impact.files.map((item: unknown) => {
                if (!isRecord(item)) return item;
                const ref = locationRef(item.path ?? item.uri, binding);
                return ref ? { ...item, pathRef: ref } : item;
            }),
        };
    }
}

function locationRef(value: unknown, binding: WorkspaceBinding) {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    try {
        const absolute = workspaceInputToPath(value, binding.root.realRoot);
        const relative = path.relative(binding.root.realRoot, absolute);
        if (isOutsideWorkspaceRelative(relative)) return undefined;
        return createWorkspacePathRef(binding.workspace, relative.split(path.sep).join('/'));
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
