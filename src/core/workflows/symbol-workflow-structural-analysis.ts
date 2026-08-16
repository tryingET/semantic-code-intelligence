import Parser from 'tree-sitter';
import { loadLanguageForFile } from '../code-graph-language.js';
import { openWorkspaceFileForRead } from '../workspace-path.js';
import { safeDisclosurePath } from './symbol-workflow-disclosure.js';
import {
    dedupeImpactSignalEvidence,
    type ImpactSignalEvidence,
    type StructuralSignalAnalysis,
    type StructuralSignalCandidate,
} from './symbol-workflow-signals.js';
import {
    ASSIGNMENT_TYPES,
    collectFileFacts,
    collectTargetBodies,
    readBoundedStructuralSource,
    STRUCTURAL_BUDGETS,
    takeWork,
    UPDATE_TYPES,
    type WorkBudget,
} from './symbol-workflow-structural-budget.js';

const TEST_MODULES = new Set(['bun:test', 'node:test', 'vitest', '@jest/globals']);
const TEST_CALL_NAMES = new Set(['test', 'it', 'describe']);
const MEMBER_TYPES = new Set([
    'member_expression',
    'subscript_expression',
    'attribute',
    'field_expression',
    'index_expression',
    'selector_expression',
]);
const CALL_TYPES = new Set(['call_expression', 'call', 'macro_invocation']);

export async function analyzeStructuralSignalEvidence(args: {
    workspaceRoot: string;
    symbol: string;
    candidates: StructuralSignalCandidate[];
}): Promise<StructuralSignalAnalysis> {
    const grouped = new Map<string, StructuralSignalCandidate[]>();
    let perFileOmittedCandidates = 0;
    let rejectedCandidates = 0;
    for (const candidate of args.candidates) {
        const path = safeDisclosurePath(candidate.path, args.workspaceRoot);
        if (!path) {
            rejectedCandidates++;
            continue;
        }
        const current = grouped.get(path) || [];
        if (current.length < STRUCTURAL_BUDGETS.candidatesPerFile) current.push({ ...candidate, path });
        else perFileOmittedCandidates++;
        grouped.set(path, current);
    }
    const ordered = [...grouped.entries()].sort(([pathA, itemsA], [pathB, itemsB]) => {
        const definitionA = itemsA.some((item) => item.origin === 'definition') ? 1 : 0;
        const definitionB = itemsB.some((item) => item.origin === 'definition') ? 1 : 0;
        return definitionB - definitionA || pathA.localeCompare(pathB);
    });
    const selected = ordered.slice(0, STRUCTURAL_BUDGETS.files);
    const fileBudgetOmittedCandidates = ordered
        .slice(STRUCTURAL_BUDGETS.files)
        .reduce((sum, [, candidates]) => sum + candidates.length, 0);
    const selectedCandidates = selected.reduce((sum, [, candidates]) => sum + candidates.length, 0);
    const omittedCandidates = perFileOmittedCandidates + fileBudgetOmittedCandidates;
    const filesOmittedByFileBudget = Math.max(0, ordered.length - selected.length);
    const evidence: ImpactSignalEvidence[] = [];
    const limitations: string[] = [];
    let attemptedFiles = 0;
    let analyzedFiles = 0;
    let failedFiles = 0;
    let oversizedFiles = 0;
    let sourceBytesRead = 0;
    let sourceBytesAnalyzed = 0;
    let filesOmittedByTotalByteBudget = 0;
    let totalBudgetRejectedFiles = 0;
    let unattemptedFiles = 0;
    let totalSourceByteBudgetExhausted = false;
    let astNodesInspected = 0;
    let astNodeBudgetHits = 0;
    let astWorkUnits = 0;
    let astWorkBudgetHits = 0;
    let targetOccurrencesObserved = 0;
    let targetOccurrencesAnalyzed = 0;
    let omittedTargetOccurrences = 0;
    let symbolBodiesObserved = 0;
    let symbolBodiesAnalyzed = 0;
    let omittedSymbolBodies = 0;
    let writeNodesObserved = 0;
    let writeNodesAnalyzed = 0;
    let omittedWriteNodes = 0;
    let importNodesObserved = 0;
    let importNodesAnalyzed = 0;
    let omittedImportNodes = 0;

    for (let index = 0; index < selected.length; index++) {
        if (sourceBytesRead >= STRUCTURAL_BUDGETS.totalSourceBytes) {
            totalSourceByteBudgetExhausted = true;
            unattemptedFiles = selected.length - index;
            filesOmittedByTotalByteBudget = unattemptedFiles;
            break;
        }
        const [path] = selected[index];
        attemptedFiles++;
        try {
            const opened = await openWorkspaceFileForRead(path, {
                workspaceRoot: args.workspaceRoot,
                inputLabel: 'symbol impact structural evidence file',
            });
            let bounded: Awaited<ReturnType<typeof readBoundedStructuralSource>>;
            try {
                bounded = await readBoundedStructuralSource(
                    opened.handle,
                    STRUCTURAL_BUDGETS.totalSourceBytes - sourceBytesRead,
                    (bytes) => {
                        sourceBytesRead += bytes;
                    }
                );
            } finally {
                await opened.handle.close().catch(() => undefined);
            }
            if (bounded.oversized) {
                oversizedFiles++;
                continue;
            }
            if (bounded.totalBudgetExceeded) {
                totalSourceByteBudgetExhausted = true;
                totalBudgetRejectedFiles++;
                unattemptedFiles = selected.length - index - 1;
                filesOmittedByTotalByteBudget = totalBudgetRejectedFiles + unattemptedFiles;
                break;
            }
            sourceBytesAnalyzed += bounded.bytes;
            const { lang } = await loadLanguageForFile(opened.realPath);
            const parser = new Parser();
            parser.setLanguage(lang);
            parser.setTimeoutMicros(STRUCTURAL_BUDGETS.parseTimeoutMicros);
            const tree = parser.parse(bounded.source);
            analyzedFiles++;

            const work: WorkBudget = { used: 0, exhausted: false };
            const facts = collectFileFacts(tree.rootNode, args.symbol, work);
            const bodies = collectTargetBodies(facts.targets, work);
            const testCalls = importedTestCallNames(facts.imports);
            inspectDefinitionWrites(bodies.items, facts.writes, path, evidence, work);
            for (const node of facts.targets) inspectTargetAncestors(node, path, testCalls, evidence, work);

            astNodesInspected += facts.nodesInspected;
            astNodeBudgetHits += Number(facts.astNodeBudgetHit);
            astWorkUnits += work.used;
            astWorkBudgetHits += Number(work.exhausted);
            targetOccurrencesObserved += facts.targetsObserved;
            targetOccurrencesAnalyzed += facts.targets.length;
            omittedTargetOccurrences += Math.max(0, facts.targetsObserved - facts.targets.length);
            symbolBodiesObserved += bodies.observed;
            symbolBodiesAnalyzed += bodies.items.length;
            omittedSymbolBodies += Math.max(0, bodies.observed - bodies.items.length);
            writeNodesObserved += facts.writesObserved;
            writeNodesAnalyzed += facts.writes.length;
            omittedWriteNodes += Math.max(0, facts.writesObserved - facts.writes.length);
            importNodesObserved += facts.importsObserved;
            importNodesAnalyzed += facts.imports.length;
            omittedImportNodes += Math.max(0, facts.importsObserved - facts.imports.length);
        } catch {
            failedFiles++;
        }
    }

    const omittedFiles = filesOmittedByFileBudget + filesOmittedByTotalByteBudget;
    if (omittedCandidates > 0) {
        limitations.push('Structural source candidates exceeded an analysis budget and were omitted.');
    }
    if (omittedFiles > 0) {
        limitations.push('Structural source files exceeded an analysis budget and were omitted deterministically.');
    }
    if (oversizedFiles > 0) {
        limitations.push('Oversized structural source files were not read or parsed; affected signals remain unknown.');
    }
    if (failedFiles > 0) {
        limitations.push('Structural source analysis failed for one or more files; affected signals remain unknown.');
    }
    if (astNodeBudgetHits > 0 || astWorkBudgetHits > 0) {
        limitations.push('Structural AST analysis reached a deterministic work budget; affected signals remain unknown.');
    }
    if (omittedTargetOccurrences > 0 || omittedSymbolBodies > 0 || omittedWriteNodes > 0 || omittedImportNodes > 0) {
        limitations.push('Structural AST evidence exceeded an item budget and was omitted deterministically.');
    }
    if (totalSourceByteBudgetExhausted) {
        limitations.push('Structural source analysis reached its total byte budget; remaining signals remain unknown.');
    }
    const analysis = {
        fileBudget: STRUCTURAL_BUDGETS.files,
        candidateBudgetPerFile: STRUCTURAL_BUDGETS.candidatesPerFile,
        sourceFileByteBudget: STRUCTURAL_BUDGETS.sourceBytesPerFile,
        totalSourceByteBudget: STRUCTURAL_BUDGETS.totalSourceBytes,
        parseTimeoutMicros: STRUCTURAL_BUDGETS.parseTimeoutMicros,
        astNodeBudgetPerFile: STRUCTURAL_BUDGETS.astNodesPerFile,
        astWorkUnitBudgetPerFile: STRUCTURAL_BUDGETS.astWorkUnitsPerFile,
        targetOccurrenceBudgetPerFile: STRUCTURAL_BUDGETS.targetOccurrencesPerFile,
        symbolBodyBudgetPerFile: STRUCTURAL_BUDGETS.symbolBodiesPerFile,
        writeNodeBudgetPerFile: STRUCTURAL_BUDGETS.writeNodesPerFile,
        importNodeBudgetPerFile: STRUCTURAL_BUDGETS.importNodesPerFile,
        observedFiles: ordered.length,
        selectedFiles: selected.length,
        attemptedFiles,
        analyzedFiles,
        failedFiles,
        oversizedFiles,
        omittedFiles,
        filesOmittedByFileBudget,
        filesOmittedByTotalByteBudget,
        totalBudgetRejectedFiles,
        unattemptedFiles,
        observedCandidates: args.candidates.length,
        selectedCandidates,
        omittedCandidates,
        candidatesOmittedByFileBudget: fileBudgetOmittedCandidates,
        rejectedCandidates,
        sourceBytesRead,
        sourceBytesAnalyzed,
        totalSourceByteBudgetExhausted,
        astNodesInspected,
        astNodeBudgetHits,
        astWorkUnits,
        astWorkBudgetHits,
        targetOccurrencesObserved,
        targetOccurrencesAnalyzed,
        omittedTargetOccurrences,
        symbolBodiesObserved,
        symbolBodiesAnalyzed,
        omittedSymbolBodies,
        writeNodesObserved,
        writeNodesAnalyzed,
        omittedWriteNodes,
        importNodesObserved,
        importNodesAnalyzed,
        omittedImportNodes,
    };
    return {
        evidence: dedupeImpactSignalEvidence(evidence),
        limitations: Array.from(new Set(limitations)).sort(),
        analysis,
        analyzedFiles,
        omittedFiles,
    };
}

function inspectDefinitionWrites(
    bodies: any[],
    writes: any[],
    path: string,
    evidence: ImpactSignalEvidence[],
    work: WorkBudget
): void {
    for (const write of writes) {
        if (!takeWork(work)) return;
        let inBody = false;
        for (const body of bodies) {
            if (!takeWork(work)) return;
            if (containsNode(body, write)) {
                inBody = true;
                break;
            }
        }
        if (!inBody || !containsMemberWrite(write, work)) continue;
        evidence.push({
            signal: 'state',
            path,
            confidence: 'medium',
            provenance: 'ast.definition_write',
            reason: 'The target definition body contains a structural member or indexed write; shared-state aliasing is not proved.',
            fallback: false,
        });
        return;
    }
}

function inspectTargetAncestors(
    node: any,
    path: string,
    testCalls: Set<string>,
    evidence: ImpactSignalEvidence[],
    work: WorkBudget
): void {
    let current = node;
    while (current && takeWork(work)) {
        const type = String(current.type || '');
        if (isExportDeclaration(current) && isDirectTargetExport(node, current, work)) {
            evidence.push({
                signal: 'publicApi',
                path,
                confidence: 'high',
                provenance: 'ast.export_declaration',
                reason: 'An exact target occurrence participates directly in an export declaration.',
                fallback: false,
            });
        }
        if (ASSIGNMENT_TYPES.has(type)) {
            const left = current.childForFieldName?.('left') || current.childForFieldName?.('name') || current.namedChildren?.[0];
            if (left && containsNode(left, node)) {
                evidence.push({
                    signal: 'state',
                    path,
                    confidence: 'high',
                    provenance: 'ast.write_occurrence',
                    reason: 'The target occurrence is structurally on the written side of an assignment.',
                    fallback: false,
                });
            }
        } else if (UPDATE_TYPES.has(type) && containsNode(current, node)) {
            evidence.push({
                signal: 'state',
                path,
                confidence: 'high',
                provenance: 'ast.write_occurrence',
                reason: 'The target occurrence is structurally updated.',
                fallback: false,
            });
        }
        if (CALL_TYPES.has(type)) inspectCall(current, node, path, testCalls, evidence);
        current = current.parent;
    }
}

function inspectCall(
    call: any,
    targetNode: any,
    path: string,
    testCalls: Set<string>,
    evidence: ImpactSignalEvidence[]
): void {
    const callee = call.childForFieldName?.('function') || call.childForFieldName?.('name') || call.namedChildren?.[0];
    const calleeText = String(callee?.text || '').trim();
    const calleeParts = calleeText.split(/[.:]/).filter(Boolean);
    const simpleCallee = calleeParts[calleeParts.length - 1] || calleeText;
    if (testCalls.has(simpleCallee) && containsNode(call, targetNode) && !containsNode(callee, targetNode)) {
        evidence.push({
            signal: 'tests',
            path,
            confidence: 'high',
            provenance: 'ast.imported_test_call',
            reason: `The target occurrence is enclosed by ${simpleCallee}(...) imported from a supported test module.`,
            fallback: false,
        });
    }
    const argsNode =
        call.childForFieldName?.('arguments') ||
        (call.namedChildren || []).find((child: any) => /argument/.test(String(child.type || '')));
    if (!argsNode || !containsNode(argsNode, targetNode)) return;
    const args = (argsNode.namedChildren || []).filter((child: any) => child !== callee);
    const targetIndex = args.findIndex((arg: any) => containsNode(arg, targetNode));
    if ((simpleCallee === 'set' && targetIndex >= 1) || (simpleCallee === 'add' && targetIndex === 0)) {
        evidence.push({
            signal: 'registry',
            path,
            confidence: 'medium',
            provenance: 'ast.keyed_collection_write',
            reason: 'The target is inserted by a structural keyed/set collection write; registry framework semantics are not proved.',
            fallback: false,
        });
    }
}

function importedTestCallNames(imports: any[]): Set<string> {
    const names = new Set<string>();
    for (const node of imports) {
        const text = String(node?.text || '');
        const source = [...TEST_MODULES].find(
            (module) => text.includes(`'${module}'`) || text.includes(`"${module}"`)
        );
        if (!source) continue;
        const braces = text.match(/\{([^}]*)\}/)?.[1] || '';
        for (const part of braces.split(',')) {
            const match = part.trim().match(/^(test|it|describe)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
            if (match) names.add(match[2] || match[1]);
        }
        const defaultImport = text.match(/^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+/)?.[1];
        if (defaultImport && TEST_CALL_NAMES.has(defaultImport)) names.add(defaultImport);
    }
    return names;
}

function isExportDeclaration(node: any): boolean {
    const type = String(node?.type || '');
    if (type === 'export_statement' || type === 'export_declaration') return true;
    if (type === 'function_item' || type === 'struct_item' || type === 'enum_item' || type === 'trait_item') {
        return /^\s*pub(?:\b|\()/.test(String(node.text || ''));
    }
    return false;
}

function isDirectTargetExport(target: any, exportNode: any, work: WorkBudget): boolean {
    let current = target;
    while (current && current !== exportNode && takeWork(work)) {
        const body = current.childForFieldName?.('body');
        if (body && containsNode(body, target)) return false;
        current = current.parent;
    }
    return current === exportNode;
}

function containsMemberWrite(node: any, work: WorkBudget): boolean {
    const stack = [node];
    while (stack.length && takeWork(work)) {
        const current = stack.pop();
        if (MEMBER_TYPES.has(String(current?.type || ''))) return true;
        const children = current?.namedChildren || [];
        for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
    return false;
}

function containsNode(container: any, target: any): boolean {
    if (!container || !target) return false;
    return Number(target.startIndex) >= Number(container.startIndex) && Number(target.endIndex) <= Number(container.endIndex);
}
