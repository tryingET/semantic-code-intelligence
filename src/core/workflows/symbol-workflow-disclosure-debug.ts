import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SymbolImpactDisclosureMode = 'standard' | 'debug';
export type SymbolImpactSubcallStatus = 'ok' | 'error_result' | 'unstructured_result' | 'threw';

export type SymbolImpactDisclosureSubcall = {
    name: 'find_definition' | 'build_symbol_map' | 'graph_expand';
    input: Record<string, unknown>;
    value: Record<string, unknown>;
    status: SymbolImpactSubcallStatus;
    issue: string | null;
    elapsedMs?: number;
};

export const SYMBOL_IMPACT_DISCLOSURE_BUDGETS = Object.freeze({
    packetBytes: 49_152,
    standardBytes: 24_576,
    debugBytes: 36_864,
    itemsPerSection: 12,
    analyzedItemsPerSection: 4_096,
    analyzedMetadataFields: 4_096,
    analyzedLimitations: 64,
    provenanceFields: 8,
    limitations: 8,
    textCharacters: 200,
    pathCharacters: 1_024,
    inputPathCharacters: 4_096,
    debugSubcalls: 3,
    debugShapeFailuresPerSubcall: 8,
    debugRawFragmentsPerSubcall: 1,
    debugRawFragmentBytes: 768,
    debugObjectKeys: 8,
    debugArrayItems: 2,
    debugDepth: 3,
    debugNodes: 128,
});

type SectionShape = { shapeFailures: { invalid: number; outsideWorkspace: number } };

type DebugSanitizeState = {
    nodes: number;
    sampledSourceBytes: number;
    omittedArrayItems: number;
    omittedObjectFields: number;
    omittedDepthNodes: number;
    omittedNodeBudget: number;
    truncatedTextValues: number;
    redactedValues: number;
};

export function buildSymbolImpactDebugDiagnostics(args: {
    subcalls: SymbolImpactDisclosureSubcall[];
    sections: Record<string, SectionShape>;
    workspaceRoot: string;
    totalElapsedMs?: number;
    ontologySeedElapsedMs?: number;
}): Record<string, unknown> {
    return {
        timingsMs: {
            ...(finiteDuration(args.totalElapsedMs) !== undefined
                ? { total: finiteDuration(args.totalElapsedMs) }
                : {}),
            ...(finiteDuration(args.ontologySeedElapsedMs) !== undefined
                ? { ontologySeed: finiteDuration(args.ontologySeedElapsedMs) }
                : {}),
        },
        subcalls: args.subcalls
            .slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugSubcalls)
            .map((subcall) => debugSubcall(subcall, args.sections, args.workspaceRoot)),
        redaction: {
            policy: 'bounded-allowlisted-shape-and-sensitive-value-redaction',
            absolutePaths: 'workspace-relative-or-redacted',
            secrets: 'redacted',
            environment: 'redacted-or-not-collected',
            stackTraces: 'redacted',
            connectionCredentials: 'redacted',
        },
        rawFragmentBudgetBytes: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugRawFragmentBytes,
    };
}

export function sanitizeDisclosureText(value: string, workspaceRoot: string, maxCharacters = 200): string {
    const scanLimit = Math.max(512, maxCharacters * 4);
    const inputTruncated = value.length > scanLimit;
    const bounded = value.slice(0, scanLimit);
    if (looksLikeStack(bounded)) return '[REDACTED:stack-trace]';
    if (/-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----/i.test(bounded)) return '[REDACTED:pem]';

    let sanitized = isAbsolutePathText(bounded)
        ? safeDisclosurePath(bounded, workspaceRoot) || '[REDACTED:absolute-path]'
        : bounded;
    sanitized = sanitized
        .replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/g, '$1[REDACTED:credentials]@')
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, 'Bearer [REDACTED:secret]')
        .replace(
            /\b(?:sk|gh[oprsu]|github_pat|glpat|xox[a-z]|npm|AKIA|ASIA)[-_.A-Za-z0-9]{8,}\b/gi,
            '[REDACTED:secret]'
        )
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED:secret]')
        .replace(/\b[A-Za-z0-9/+]{40}={0,2}\b/g, '[REDACTED:secret]')
        .replace(
            /\b[A-Za-z_][A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|DATABASE_URL)[A-Za-z0-9_]*\s*=\s*[^\s,;]+/gi,
            (match) => `${match.slice(0, match.indexOf('='))}=[REDACTED:environment]`
        )
        .replace(
            /(["']?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)["']?\s*:\s*)["'][^"']*["']/gi,
            '$1"[REDACTED:sensitive]"'
        )
        .replace(/\b(?:credentials?|authorization)\s*[:=]\s*(?:\{[^}\r\n]{0,256}\}|[^\s,;]+)/gi, '[REDACTED:sensitive]')
        .replace(
            /(^|[\s("'`,=\[{])file:\/\/[^\s"'`,}\]]+/gi,
            (_match, prefix: string) => `${prefix}[REDACTED:absolute-path]`
        )
        .replace(/(^|[\s("'`,=\[{])[A-Za-z]:[\\/][^\s"'`,}\]]+/g, '$1[REDACTED:absolute-path]')
        .replace(/(^|[\s("'`,=\[{])\\\\[^\s"'`,}\]]+/g, '$1[REDACTED:absolute-path]')
        .replace(/(^|[\s("'`,=\[{])\/[^\s"'`,}\]]+/g, (match, prefix: string) => {
            const candidate = match.slice(prefix.length);
            return `${prefix}${safeDisclosurePath(candidate, workspaceRoot) || '[REDACTED:absolute-path]'}`;
        });
    if (inputTruncated || sanitized.length > maxCharacters) {
        sanitized = `${sanitized.slice(0, Math.max(0, maxCharacters - 1))}…`;
    }
    return sanitized;
}

function debugSubcall(
    subcall: SymbolImpactDisclosureSubcall,
    sections: Record<string, SectionShape>,
    workspaceRoot: string
): Record<string, unknown> {
    const sectionNames =
        subcall.name === 'find_definition'
            ? ['definitions']
            : subcall.name === 'build_symbol_map'
              ? ['declarations', 'references']
              : ['graph.exports', 'graph.callers', 'graph.imports', 'graph.callees'];
    const shapeValidationFailures = sectionNames
        .flatMap((name) => {
            const section = sections[name];
            return [
                ...(section?.shapeFailures.invalid
                    ? [{ code: 'invalid_item_shape', section: name, count: section.shapeFailures.invalid }]
                    : []),
                ...(section?.shapeFailures.outsideWorkspace
                    ? [{ code: 'outside_workspace_path', section: name, count: section.shapeFailures.outsideWorkspace }]
                    : []),
            ];
        })
        .slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugShapeFailuresPerSubcall);
    const elapsedMs = finiteDuration(subcall.elapsedMs);
    return {
        name: subcall.name,
        status: subcall.status,
        input: sanitizeSubcallInput(subcall.input, workspaceRoot),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        backendDiagnostics: backendDiagnostics(subcall.value),
        shapeValidationFailures,
        rawFragments: [rawFragment(subcall, workspaceRoot)].slice(
            0,
            SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugRawFragmentsPerSubcall
        ),
    };
}

function sanitizeSubcallInput(input: Record<string, unknown>, workspaceRoot: string): Record<string, unknown> {
    const allowed = ['symbol', 'file', 'precise', 'maxResults', 'maxFiles', 'astOnly', 'edges', 'depth', 'limit'];
    const output: Record<string, unknown> = {};
    for (const key of allowed) {
        if (!(key in input)) continue;
        const value = input[key];
        if (key === 'file' && typeof value === 'string')
            output[key] = safeDisclosurePath(value, workspaceRoot) || '[REDACTED:path]';
        else if (Array.isArray(value))
            output[key] = value
                .slice(0, 8)
                .map((item) => safeDisclosureLabel(item))
                .filter(Boolean);
        else if (typeof value === 'string') output[key] = sanitizeDisclosureText(value, workspaceRoot, 160);
        else if (typeof value === 'number' || typeof value === 'boolean') output[key] = value;
    }
    return output;
}

function backendDiagnostics(value: Record<string, unknown>): Record<string, unknown> {
    const impactSummary = recordOf(value.impactSummary);
    return {
        ...(safeDisclosureLabel(value.backend) ? { backend: safeDisclosureLabel(value.backend) } : {}),
        ...(typeof value.fallback === 'boolean' ? { fallback: value.fallback } : {}),
        ...(typeof value.partial === 'boolean' ? { partial: value.partial } : {}),
        ...(typeof value.degraded === 'boolean' ? { degraded: value.degraded } : {}),
        ...(Number.isFinite(value.count) ? { count: Number(value.count) } : {}),
        ...(impactSummary && typeof impactSummary.hasImpactEvidence === 'boolean'
            ? { hasImpactEvidence: impactSummary.hasImpactEvidence }
            : {}),
    };
}

function rawFragment(subcall: SymbolImpactDisclosureSubcall, workspaceRoot: string): Record<string, unknown> {
    const state = newDebugSanitizeState();
    const sanitized = sanitizeDebugValue(sampledRawValue(subcall), workspaceRoot, 0, 'root', state);
    const serialized = safeStringify(sanitized);
    const text = truncateUtf8(serialized, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugRawFragmentBytes);
    const byteTruncated = byteLength(serialized) > byteLength(text);
    const omitted =
        state.omittedArrayItems +
        state.omittedObjectFields +
        state.omittedDepthNodes +
        state.omittedNodeBudget +
        state.truncatedTextValues;
    return {
        sourcePath: '$',
        encoding: 'json',
        text,
        sampledSourceBytes: state.sampledSourceBytes,
        sourceMeasurementTruncated: omitted > 0,
        emittedBytes: byteLength(text),
        truncated: byteTruncated || omitted > 0 || state.redactedValues > 0,
        omissions: {
            arrayItems: state.omittedArrayItems,
            objectFields: state.omittedObjectFields,
            depthNodes: state.omittedDepthNodes,
            nodeBudget: state.omittedNodeBudget,
            textValues: state.truncatedTextValues,
        },
        redactedValues: state.redactedValues,
    };
}

function sampledRawValue(subcall: SymbolImpactDisclosureSubcall): Record<string, unknown> {
    if (subcall.name === 'find_definition') {
        return {
            backend: subcall.value.backend,
            definitions: arrayOf(subcall.value.definitions).slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugArrayItems),
            provenance: subcall.value.provenance,
        };
    }
    if (subcall.name === 'build_symbol_map') {
        return {
            identifier: subcall.value.identifier,
            declarations: arrayOf(subcall.value.declarations).slice(
                0,
                SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugArrayItems
            ),
            references: arrayOf(subcall.value.references).slice(0, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugArrayItems),
        };
    }
    const neighbors = recordOf(subcall.value.neighbors);
    return {
        neighbors: Object.fromEntries(
            ['exports', 'callers', 'imports', 'callees'].map((edge) => [edge, arrayOf(neighbors[edge]).slice(0, 1)])
        ),
        impactSummary: subcall.value.impactSummary,
    };
}

function sanitizeDebugValue(
    value: unknown,
    workspaceRoot: string,
    depth: number,
    key: string,
    state: DebugSanitizeState
): unknown {
    state.nodes++;
    if (state.nodes > SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugNodes) {
        state.omittedNodeBudget++;
        return '[OMITTED:node-budget]';
    }
    if (key.length > 128) {
        state.omittedObjectFields++;
        return '[REDACTED:oversized-key]';
    }
    if (sensitiveKey(key)) {
        state.redactedValues++;
        return `[REDACTED:${redactionKind(key)}]`;
    }
    if (typeof value === 'string') {
        state.sampledSourceBytes += byteLength(value.slice(0, 2_048));
        const sanitized = sanitizeDisclosureText(value, workspaceRoot, 160);
        if (sanitized !== value) {
            if (value.length > 160) state.truncatedTextValues++;
            else state.redactedValues++;
        }
        return sanitized;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (depth >= SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugDepth) {
        state.omittedDepthNodes++;
        return '[OMITTED:depth-budget]';
    }
    if (Array.isArray(value)) {
        const limit = SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugArrayItems;
        if (value.length > limit) state.omittedArrayItems += value.length - limit;
        return value.slice(0, limit).map((item) => sanitizeDebugValue(item, workspaceRoot, depth + 1, key, state));
    }
    const record = maybeRecord(value);
    if (!record) return '[OMITTED:unsupported-value]';
    const keys = boundedOwnKeys(record, SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugObjectKeys);
    state.omittedObjectFields += keys.omitted;
    return Object.fromEntries(
        keys.values.map((childKey, index) => {
            state.sampledSourceBytes += byteLength(childKey.slice(0, 256));
            let childValue: unknown;
            try {
                childValue = record[childKey];
            } catch {
                state.omittedObjectFields++;
                childValue = '[OMITTED:unreadable-field]';
            }
            return [
                safeDebugKey(childKey, index),
                sanitizeDebugValue(childValue, workspaceRoot, depth + 1, childKey, state),
            ];
        })
    );
}

function boundedOwnKeys(record: Record<string, unknown>, limit: number): { values: string[]; omitted: number } {
    const values: string[] = [];
    let observed = 0;
    try {
        for (const key in record) {
            if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
            observed++;
            if (values.length < limit) values.push(key);
            if (observed > limit) break;
        }
    } catch {
        return { values, omitted: 1 };
    }
    return { values, omitted: observed > limit ? 1 : 0 };
}

function sensitiveKey(key: string): boolean {
    const compact = key.replace(/[^A-Za-z0-9]/g, '_');
    return (
        /secret|token|password|passwd|credential|authorization|cookie|private[_-]?key|access[_-]?key|session[_-]?(?:id|key)|database[_-]?url|dsn|environment|stack|trace/i.test(
            key
        ) ||
        /^(?:PATH|HOME|USER|USERNAME|SHELL|TMPDIR|TEMP|AWS_PROFILE|AWS_REGION)$/i.test(compact) ||
        /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API_KEY|ACCESS_KEY|PRIVATE_KEY|DATABASE_URL|DSN)(?:_|$)/i.test(
            compact
        )
    );
}

function secretLike(value: string): boolean {
    return (
        /^(?:Bearer\s+)?(?:sk|gh[oprsu]|github_pat|glpat|xox[a-z]|npm|AKIA|ASIA)[-_.A-Za-z0-9]{8,}$/i.test(value) ||
        /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(value) ||
        /^[A-Za-z0-9/+]{40}={0,2}$/.test(value) ||
        /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----/i.test(value) ||
        /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/.test(value) ||
        looksHighEntropyCredential(value)
    );
}

function looksHighEntropyCredential(value: string): boolean {
    if (value.length < 32 || value.length > 128 || !/^[A-Za-z0-9_+/=.-]+$/.test(value)) return false;
    return /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

function safeDebugKey(value: string, index: number): string {
    if (
        value.length > 64 ||
        !/^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/.test(value) ||
        sensitiveKey(value) ||
        secretLike(value)
    ) {
        return `[REDACTED:key-${index + 1}]`;
    }
    return value;
}

function redactionKind(key: string): string {
    if (/stack|trace/i.test(key)) return 'stack-trace';
    if (/environment|\benv\b|database[_-]?url|dsn/i.test(key)) return 'environment';
    return 'sensitive';
}

export function safeDisclosurePath(value: string, workspaceRoot: string): string | null {
    if (
        value.length > SYMBOL_IMPACT_DISCLOSURE_BUDGETS.inputPathCharacters ||
        workspaceRoot.length > SYMBOL_IMPACT_DISCLOSURE_BUDGETS.inputPathCharacters ||
        /^[A-Za-z]:[\\/]/.test(value) ||
        /^\\\\/.test(value)
    ) {
        return null;
    }
    let normalized: string;
    try {
        normalized = value.startsWith('file://') ? canonicalPath(fileURLToPath(value)) : canonicalPath(value);
    } catch {
        return null;
    }
    const root = canonicalPath(workspaceRoot);
    const absolute = posix.isAbsolute(normalized) ? normalized : canonicalPath(posix.join(root, normalized));
    const relative = posix.relative(root, absolute);
    if (
        relative === '..' ||
        relative.startsWith('../') ||
        posix.isAbsolute(relative) ||
        relative.length > SYMBOL_IMPACT_DISCLOSURE_BUDGETS.pathCharacters
    ) {
        return null;
    }
    return relative || '.';
}

export function safeDisclosureLabel(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (
        !trimmed ||
        trimmed.length > 80 ||
        sensitiveKey(trimmed) ||
        secretLike(trimmed) ||
        isAbsolutePathText(trimmed) ||
        trimmed.includes('://') ||
        looksLikeStack(trimmed)
    ) {
        return undefined;
    }
    return /^[A-Za-z0-9_.+:@/-]+$/.test(trimmed) && !trimmed.startsWith('/') ? trimmed : undefined;
}

function isAbsolutePathText(value: string): boolean {
    return value.startsWith('/') || value.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function looksLikeStack(value: string): boolean {
    return /(?:^|\n)\s*(?:Traceback \(most recent call last\):|at\s+\S+|File\s+"[^"]+",\s+line\s+\d+|Caused by:|[A-Za-z][A-Za-z0-9_.]*(?:Error|Exception):)/.test(
        value
    );
}

function recordOf(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function maybeRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function arrayOf(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function canonicalPath(value: string): string {
    return posix.normalize(value.replaceAll('\\', '/'));
}

function finiteDuration(value: unknown): number | undefined {
    return Number.isFinite(value) ? Math.max(0, Math.round(Number(value) * 1000) / 1000) : undefined;
}

function newDebugSanitizeState(): DebugSanitizeState {
    return {
        nodes: 0,
        sampledSourceBytes: 0,
        omittedArrayItems: 0,
        omittedObjectFields: 0,
        omittedDepthNodes: 0,
        omittedNodeBudget: 0,
        truncatedTextValues: 0,
        redactedValues: 0,
    };
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) || 'null';
    } catch {
        return '"[UNSERIALIZABLE]"';
    }
}

function byteLength(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}

function truncateUtf8(value: string, maxBytes: number): string {
    if (byteLength(value) <= maxBytes) return value;
    let end = Math.min(value.length, maxBytes);
    while (end > 0 && byteLength(`${value.slice(0, end)}…`) > maxBytes) end--;
    return `${value.slice(0, end)}…`;
}
