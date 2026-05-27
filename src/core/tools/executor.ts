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
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const [key, property] of Object.entries(properties) as Array<[string, any]>) {
        const value = args?.[key];
        if (value === undefined || value === null) continue;
        if (property?.type === 'array') {
            if (!Array.isArray(value)) throw new CoreError('InvalidParams', `${key} must be an array`, { field: key });
            if (typeof property.maxItems === 'number' && value.length > property.maxItems) {
                throw new CoreError('InvalidParams', `${key} must contain at most ${property.maxItems} items`, { field: key, maxItems: property.maxItems });
            }
            if (property.items?.type === 'string') {
                value.forEach((item, index) => {
                    if (typeof item !== 'string') throw new CoreError('InvalidParams', `${key}[${index}] must be a string`, { field: key, index });
                });
            }
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

    validate(name: string, args: Record<string, any>): void {
        const spec = this.getSpec(name);
        if (!spec) {
            throw new CoreError('UnknownTool', `Unknown tool: ${name}`);
        }
        validateArgs(args || {}, spec);
        // Extra validation for patch-bearing tools to keep adapters lean
        if (spec.execution?.requiresPatchValidation) {
            const patch = typeof args?.patch === 'string' ? String(args.patch) : '';
            if (!this.isLikelyDiffOrApplyPatch(patch)) {
                throw new CoreError(
                    'InvalidParams',
                    'invalid_patch: Expected unified diff or apply_patch format. Use apply_patch heredoc or pass a diff file.'
                );
            }
        }
    }

    async execute(adapter: ToolAdapter, name: string, args: Record<string, any>): Promise<any> {
        this.validate(name, args || {});
        return adapter.handleToolCall(name, args || {});
    }

    private isLikelyDiffOrApplyPatch(patch: string): boolean {
        if (typeof patch !== 'string' || patch.trim().length === 0) return false;
        const head = patch.slice(0, 4096);
        return /\*\*\* Begin Patch|\*\*\*\s+(?:Update|Add|Delete) File:|^diff --git |^---\s+[ab]\//m.test(head);
    }
}
