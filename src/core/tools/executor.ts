import { CoreError } from '../errors.js';
import { ToolRegistry, type ToolSpec } from './registry.js';

export interface ToolAdapter {
    // Minimal surface the executor needs
    handleToolCall(name: string, args: Record<string, any>): Promise<any>;
}

function hasRequired(obj: Record<string, any>, fields: string[]): boolean {
    for (const f of fields) {
        if (obj[f] === undefined || obj[f] === null) return false;
        if (typeof obj[f] === 'string' && obj[f].trim() === '') return false;
    }
    return true;
}

function validateArgs(args: Record<string, any>, spec: ToolSpec): void {
    const schema: any = spec.inputSchema || {};
    // Basic required validation
    if (Array.isArray(schema.required) && schema.required.length > 0) {
        if (!hasRequired(args, schema.required)) {
            throw new CoreError('InvalidParams', `Missing required parameters: ${schema.required.join(', ')}`);
        }
    }
    // Handle anyOf with required clauses (simple case)
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        const ok = schema.anyOf.some((alt: any) =>
            Array.isArray(alt.required) ? hasRequired(args, alt.required) : false
        );
        if (!ok) {
            throw new CoreError('InvalidParams', 'Arguments do not satisfy any required shape');
        }
    }
}

export class ToolExecutor {
    private registry: typeof ToolRegistry;
    constructor(registry = ToolRegistry) {
        this.registry = registry;
    }

    getSpec(name: string): ToolSpec | undefined {
        return this.registry.list().find((t) => t.name === name);
    }

    async execute(adapter: ToolAdapter, name: string, args: Record<string, any>): Promise<any> {
        const spec = this.getSpec(name);
        if (!spec) {
            throw new CoreError('UnknownTool', `Unknown tool: ${name}`);
        }
        validateArgs(args || {}, spec);
        // Extra validation for patch-bearing tools to keep adapters lean
        if (this.requiresPatchValidation(name)) {
            const patch = typeof args?.patch === 'string' ? String(args.patch) : '';
            if (!this.isLikelyDiffOrApplyPatch(patch)) {
                throw new CoreError(
                    'InvalidParams',
                    'invalid_patch: Expected unified diff or apply_patch format. Use apply_patch heredoc or pass a diff file.'
                );
            }
        }
        return adapter.handleToolCall(name, args || {});
    }

    private requiresPatchValidation(name: string): boolean {
        return name === 'patch_checks_in_snapshot' || name === 'propose_patch' || name === 'apply_after_checks' || name === 'safe_write';
    }

    private isLikelyDiffOrApplyPatch(patch: string): boolean {
        if (typeof patch !== 'string' || patch.trim().length === 0) return false;
        const head = patch.slice(0, 4096);
        return /\*\*\* Begin Patch|\*\*\*\s+(?:Update|Add|Delete) File:|^diff --git |^---\s+[ab]\//m.test(head);
    }
}
