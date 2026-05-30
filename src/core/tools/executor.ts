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

function validateSchemaValue(value: any, property: any, field: string): void {
    if (Array.isArray(property?.enum) && !property.enum.includes(value)) {
        throw new CoreError('InvalidParams', `${field} must be one of: ${property.enum.join(', ')}`, {
            field,
            allowed: property.enum,
        });
    }

    if (property?.type === 'string') {
        if (typeof value !== 'string') throw new CoreError('InvalidParams', `${field} must be a string`, { field });
        if (typeof property.minLength === 'number' && value.length < property.minLength) {
            throw new CoreError('InvalidParams', `${field} must be at least ${property.minLength} characters`, {
                field,
                minLength: property.minLength,
            });
        }
        if (typeof property.maxLength === 'number' && value.length > property.maxLength) {
            throw new CoreError('InvalidParams', `${field} must be at most ${property.maxLength} characters`, {
                field,
                maxLength: property.maxLength,
            });
        }
    }

    if (property?.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new CoreError('InvalidParams', `${field} must be a number`, { field });
        }
        if (typeof property.minimum === 'number' && value < property.minimum) {
            throw new CoreError('InvalidParams', `${field} must be >= ${property.minimum}`, {
                field,
                minimum: property.minimum,
            });
        }
        if (typeof property.maximum === 'number' && value > property.maximum) {
            throw new CoreError('InvalidParams', `${field} must be <= ${property.maximum}`, {
                field,
                maximum: property.maximum,
            });
        }
    }

    if (property?.type === 'boolean' && typeof value !== 'boolean') {
        throw new CoreError('InvalidParams', `${field} must be a boolean`, { field });
    }

    if (property?.type === 'object') {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            throw new CoreError('InvalidParams', `${field} must be an object`, { field });
        }
        validateObjectAgainstSchema(value, property, field);
    }

    if (property?.type === 'array') {
        if (!Array.isArray(value)) throw new CoreError('InvalidParams', `${field} must be an array`, { field });
        if (typeof property.minItems === 'number' && value.length < property.minItems) {
            throw new CoreError('InvalidParams', `${field} must contain at least ${property.minItems} items`, {
                field,
                minItems: property.minItems,
            });
        }
        if (typeof property.maxItems === 'number' && value.length > property.maxItems) {
            throw new CoreError('InvalidParams', `${field} must contain at most ${property.maxItems} items`, {
                field,
                maxItems: property.maxItems,
            });
        }
        if (property.items && typeof property.items === 'object') {
            value.forEach((item, index) => validateSchemaValue(item, property.items, `${field}[${index}]`));
        }
    }
}

function validateObjectAgainstSchema(obj: Record<string, any>, schema: any, prefix = ''): void {
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    if (Array.isArray(schema.required) && schema.required.length > 0) {
        const missing = schema.required.filter((key: string) => !hasRequired(obj, [key]));
        if (missing.length > 0) {
            const qualified = missing.map((key: string) => (prefix ? `${prefix}.${key}` : key));
            throw new CoreError('InvalidParams', `Missing required parameters: ${qualified.join(', ')}`);
        }
    }
    for (const [key, property] of Object.entries(properties) as Array<[string, any]>) {
        const value = obj?.[key];
        if (value === undefined) continue;
        validateSchemaValue(value, property, prefix ? `${prefix}.${key}` : key);
    }
}

function validateArgs(args: Record<string, any>, spec: ToolSpec): void {
    const schema: any = spec.inputSchema || {};
    if (schema?.type === 'object' && (args === null || typeof args !== 'object' || Array.isArray(args))) {
        throw new CoreError('InvalidParams', 'Arguments must be an object');
    }
    // Basic required validation
    validateObjectAgainstSchema(args, schema);
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

    validate(name: string, args: Record<string, any>): void {
        const spec = this.getSpec(name);
        if (!spec) {
            throw new CoreError('UnknownTool', `Unknown tool: ${name}`);
        }
        validateArgs(args || {}, spec);
        // Extra validation for patch-bearing tools to keep adapters lean
        if (spec.execution?.requiresPatchValidation && !this.workflowOwnsPatchStageFailure(name)) {
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

    private workflowOwnsPatchStageFailure(name: string): boolean {
        return name === 'patch_checks_in_snapshot' || name === 'safe_write' || name === 'apply_after_checks';
    }

    private isLikelyDiffOrApplyPatch(patch: string): boolean {
        if (typeof patch !== 'string' || patch.trim().length === 0) return false;
        const head = patch.slice(0, 4096);
        return /\*\*\* Begin Patch|\*\*\*\s+(?:Update|Add|Delete) File:|^diff --git |^---\s+[ab]\//m.test(head);
    }
}
