export const STRUCTURAL_BUDGETS = {
    files: 64,
    candidatesPerFile: 256,
    sourceBytesPerFile: 512 * 1_024,
    totalSourceBytes: 4 * 1_024 * 1_024,
    parseTimeoutMicros: 100_000,
    astNodesPerFile: 100_000,
    astWorkUnitsPerFile: 10_000,
    targetOccurrencesPerFile: 4_096,
    symbolBodiesPerFile: 256,
    writeNodesPerFile: 4_096,
    importNodesPerFile: 1_024,
} as const;

export const ASSIGNMENT_TYPES = new Set([
    'assignment_expression',
    'augmented_assignment_expression',
    'assignment',
    'augmented_assignment',
    'assignment_statement',
    'short_var_declaration',
]);
export const UPDATE_TYPES = new Set(['update_expression', 'inc_statement', 'dec_statement']);

export type WorkBudget = { used: number; exhausted: boolean };
export type FileFacts = {
    targets: any[];
    writes: any[];
    imports: any[];
    nodesInspected: number;
    astNodeBudgetHit: boolean;
    targetsObserved: number;
    writesObserved: number;
    importsObserved: number;
};

export async function readBoundedStructuralSource(
    handle: any,
    remainingTotalBytes: number,
    recordRead: (bytes: number) => void = () => undefined
): Promise<{ source: string; bytes: number; oversized: boolean; totalBudgetExceeded: boolean }> {
    const stat = await handle.stat();
    const size = Number(stat?.size || 0);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid structural source size');
    if (size > STRUCTURAL_BUDGETS.sourceBytesPerFile) {
        return { source: '', bytes: 0, oversized: true, totalBudgetExceeded: false };
    }
    if (size > remainingTotalBytes) {
        return { source: '', bytes: 0, oversized: false, totalBudgetExceeded: true };
    }
    const buffer = Buffer.allocUnsafe(size);
    let bytes = 0;
    while (bytes < size) {
        const result = await handle.read(buffer, bytes, size - bytes, bytes);
        const count = Number(result?.bytesRead || 0);
        if (count <= 0) break;
        bytes += count;
        recordRead(count);
    }
    return {
        source: buffer.subarray(0, bytes).toString('utf8'),
        bytes,
        oversized: false,
        totalBudgetExceeded: false,
    };
}

export function collectFileFacts(root: any, symbol: string, work: WorkBudget): FileFacts {
    const targets: any[] = [];
    const writes: any[] = [];
    const imports: any[] = [];
    const stack = [root];
    let nodesInspected = 0;
    let targetsObserved = 0;
    let writesObserved = 0;
    let importsObserved = 0;
    while (
        stack.length &&
        nodesInspected < STRUCTURAL_BUDGETS.astNodesPerFile &&
        takeWork(work)
    ) {
        const node = stack.pop();
        nodesInspected++;
        const type = String(node?.type || '');
        const children = node?.namedChildren || [];
        if (children.length === 0 && String(node?.text || '') === symbol) {
            targetsObserved++;
            if (targets.length < STRUCTURAL_BUDGETS.targetOccurrencesPerFile) targets.push(node);
        }
        if (ASSIGNMENT_TYPES.has(type) || UPDATE_TYPES.has(type)) {
            writesObserved++;
            if (writes.length < STRUCTURAL_BUDGETS.writeNodesPerFile) writes.push(node);
        }
        if (type === 'import_statement' || type === 'import_declaration') {
            importsObserved++;
            if (imports.length < STRUCTURAL_BUDGETS.importNodesPerFile) imports.push(node);
        }
        for (let child = children.length - 1; child >= 0; child--) stack.push(children[child]);
    }
    return {
        targets,
        writes,
        imports,
        nodesInspected,
        astNodeBudgetHit: stack.length > 0,
        targetsObserved,
        writesObserved,
        importsObserved,
    };
}

export function collectTargetBodies(targets: any[], work: WorkBudget): { items: any[]; observed: number } {
    const bodies: any[] = [];
    const seen = new Set<string>();
    let observed = 0;
    for (const target of targets) {
        if (!takeWork(work)) break;
        const body = directSymbolBody(target);
        if (!body) continue;
        const key = `${body.startIndex}:${body.endIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        observed++;
        if (bodies.length < STRUCTURAL_BUDGETS.symbolBodiesPerFile) bodies.push(body);
    }
    return { items: bodies, observed };
}

export function takeWork(work: WorkBudget): boolean {
    if (work.used >= STRUCTURAL_BUDGETS.astWorkUnitsPerFile) {
        work.exhausted = true;
        return false;
    }
    work.used++;
    return true;
}

function directSymbolBody(target: any): any | null {
    const parent = target?.parent;
    if (!parent) return null;
    const name = parent.childForFieldName?.('name');
    if (name && containsNode(name, target)) return parent.childForFieldName?.('body') || null;
    if (parent.type === 'variable_declarator') {
        const pattern = parent.childForFieldName?.('name');
        if (!pattern || !containsNode(pattern, target)) return null;
        const value = parent.childForFieldName?.('value');
        if (value?.type === 'arrow_function' || value?.type === 'function_expression') {
            return value.childForFieldName?.('body') || value;
        }
    }
    return null;
}

function containsNode(container: any, target: any): boolean {
    if (!container || !target) return false;
    return Number(target.startIndex) >= Number(container.startIndex) && Number(target.endIndex) <= Number(container.endIndex);
}
