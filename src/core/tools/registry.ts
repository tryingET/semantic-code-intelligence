/**
 * Universal Tool Registry
 *
 * Single source of truth for capabilities exposed by adapters (MCP/HTTP/CLI).
 * Each tool includes a name, description, and JSON schema for inputs/outputs.
 */

import { TOOL_SPECS } from './tool-specs.js';

export interface ToolSpec {
    name: string;
    description: string;
    title?: string;
    inputSchema: any;
    outputSchema?: any;
    availability?: {
        adapters?: Array<'mcp' | 'http' | 'cli' | 'lsp'>;
        languages?: string[];
    };
    category?: 'workflow' | 'operation' | 'system';
    execution?: {
        longRunning?: boolean;
        disableRetries?: boolean;
        requiresPatchValidation?: boolean;
    };
}

function cloneJsonLike<T>(value: T): T {
    if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
}

function cloneToolSpec(spec: ToolSpec): ToolSpec {
    return {
        ...spec,
        inputSchema: cloneJsonLike(spec.inputSchema),
        outputSchema: spec.outputSchema === undefined ? undefined : cloneJsonLike(spec.outputSchema),
        availability: spec.availability
            ? {
                  ...spec.availability,
                  adapters: spec.availability.adapters ? [...spec.availability.adapters] : undefined,
                  languages: spec.availability.languages ? [...spec.availability.languages] : undefined,
              }
            : undefined,
        execution: spec.execution ? { ...spec.execution } : undefined,
    };
}

export class ToolRegistry {
    private static tools: ToolSpec[] = TOOL_SPECS;

    static list(): ToolSpec[] {
        return ToolRegistry.tools.map(cloneToolSpec);
    }
}
