declare module '../core/unified-analyzer.js' {
    export interface CodeAnalyzer {
        [key: string]: any;
    }
}

declare module '../core/analyzer-factory.js' {
    export const AnalyzerFactory: any;
}

declare module '../core/tools/registry.js' {
    export const ToolRegistry: any;
}

declare module '../core/utils/error-handler.js' {
    export type ErrorContext = any;
    export function createValidationError(...args: any[]): Error;
    export function withMcpErrorHandling(component: string, operation: string, fn: () => Promise<any>, requestId?: string, options?: any): Promise<any>;
}

declare module '../core/utils/file-logger.js' {
    export const adapterLogger: any;
    export const mcpLogger: any;
}
