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

export class ToolRegistry {
    private static tools: ToolSpec[] = TOOL_SPECS;

    static list(): ToolSpec[] {
        return [...ToolRegistry.tools];
    }
}
