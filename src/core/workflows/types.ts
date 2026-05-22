export type WorkflowCoreAnalyzer = {
    rename: (req: any) => Promise<{ data: any; performance: any; requestId?: string }>;
    getCompletions?: (req: any) => Promise<{ data: any }>;
    findDefinitionAsync?: (req: any) => Promise<{ data: any[]; performance: any; requestId?: string }>;
    findReferencesAsync?: (req: any) => Promise<{ data: any[]; performance: any; requestId?: string }>;
    buildSymbolMap?: (req: any) => Promise<any>;
    exploreCodebase?: (req: any) => Promise<any>;
    getDiagnostics?: () => any;
    config?: any;
};
