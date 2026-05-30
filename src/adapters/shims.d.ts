declare module 'cors' {
    const cors: (...args: any[]) => any;
    export default cors;
}

declare module 'express' {
    namespace express {
        export type Request = any;
        export type Response = any;
        export type NextFunction = any;
    }
    interface ExpressApp {
        use(...args: any[]): any;
        get(path: string, handler: (req: any, res: any) => any): any;
        post(path: string, handler: (req: any, res: any) => any): any;
        delete(path: string, handler: (req: any, res: any) => any): any;
        listen(port: number, host: string, callback?: () => void): any;
    }
    function express(): ExpressApp;
    namespace express {
        export function json(...args: any[]): any;
    }
    export default express;
}

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

declare module '../mcp/error-handler.js' {
    export type ErrorContext = any;
    export function createValidationError(...args: any[]): Error;
    export function withMcpErrorHandling(
        component: string,
        operation: string,
        fn: () => Promise<any>,
        requestId?: string,
        options?: any
    ): Promise<any>;
}

declare module '../mcp/file-logger.js' {
    export const adapterLogger: any;
    export const mcpLogger: any;
}
