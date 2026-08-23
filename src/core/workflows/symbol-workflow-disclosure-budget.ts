import { sanitizeDisclosureText, SYMBOL_IMPACT_DISCLOSURE_BUDGETS } from './symbol-workflow-disclosure-debug.js';

type EvidenceSection = {
    count: number;
    emitted: number;
    omitted: number;
    truncated: boolean;
    items: unknown[];
    shapeFailures: { invalid: number; outsideWorkspace: number };
};

type Omission = {
    section: string;
    reason: 'item_budget' | 'invalid_shape' | 'outside_workspace' | 'byte_budget';
    count: number;
};

type PacketOmissions = { impactFiles: number; nextReads: number; limitations: number };

export function fitSymbolImpactPacket(packet: Record<string, any>): Record<string, any> {
    const packetBudget = SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes;
    const mode = disclosureMode(packet.details);
    if (mode) {
        const baseBytes = byteLength(safeStringify({ ...packet, details: null }));
        packet.details = fitDisclosureDetails(packet.details, Math.max(4_096, packetBudget - baseBytes - 512));
    }

    const omitted: PacketOmissions = { impactFiles: 0, nextReads: 0, limitations: 0 };
    const files = Array.isArray(packet.impact?.files) ? packet.impact.files : [];
    while (byteLength(safeStringify(packet)) > packetBudget && files.length > 0) {
        files.pop();
        omitted.impactFiles++;
        packet.impact.truncated = true;
    }
    while (
        byteLength(safeStringify(packet)) > packetBudget &&
        Array.isArray(packet.nextReads) &&
        packet.nextReads.length
    ) {
        packet.nextReads.pop();
        omitted.nextReads++;
    }
    while (
        byteLength(safeStringify(packet)) > packetBudget &&
        Array.isArray(packet.limitations) &&
        packet.limitations.length
    ) {
        packet.limitations.pop();
        omitted.limitations++;
    }

    if (mode && packet.details) {
        recordPacketOmissions(packet.details, omitted);
        const baseBytes = byteLength(safeStringify({ ...packet, details: null }));
        packet.details = fitDisclosureDetails(packet.details, Math.max(4_096, packetBudget - baseBytes - 256));
    }
    if (byteLength(safeStringify(packet)) > packetBudget && mode) {
        packet.details = emergencyDetails(packet.details, 4_096);
        updateEmittedBytes(packet.details);
    }
    if (mode === 'standard' && packet.details) packet.details = projectStandardDetails(packet.details);
    if (byteLength(safeStringify(packet)) > packetBudget) return failClosedPacket(packet, mode, omitted);
    return packet;
}

export function fitDisclosureDetails(details: Record<string, any>, budgetOverride?: number): Record<string, any> {
    const declaredBudget = Number(details.disclosure?.byteBudget);
    const budget = Math.min(
        Number.isFinite(declaredBudget)
            ? Math.max(2_048, declaredBudget)
            : SYMBOL_IMPACT_DISCLOSURE_BUDGETS.standardBytes,
        Number.isFinite(budgetOverride) ? Math.max(4_096, Number(budgetOverride)) : Number.POSITIVE_INFINITY
    );
    details.disclosure.byteBudget = budget;
    updateEmittedBytes(details);
    const sections = allSections(details);
    const removable = [
        sections.references,
        sections['graph.callees'],
        sections['graph.imports'],
        sections['graph.callers'],
        sections['graph.exports'],
        sections.declarations,
        sections.definitions,
    ].filter(Boolean) as EvidenceSection[];
    let byteTruncated = details.disclosure.byteTruncated === true;
    if (byteLength(safeStringify(details)) > budget && details.diagnostics?.subcalls) {
        for (const subcall of [...details.diagnostics.subcalls].reverse()) {
            while (subcall.rawFragments?.length && byteLength(safeStringify(details)) > budget) {
                subcall.rawFragments.pop();
                details.disclosure.omittedRawFragments++;
                byteTruncated = true;
            }
        }
    }
    while (byteLength(safeStringify(details)) > budget && removable.some((section) => section.items.length > 0)) {
        for (const section of removable) {
            if (!section.items.length || byteLength(safeStringify(details)) <= budget) continue;
            section.items.pop();
            section.emitted--;
            section.omitted++;
            section.truncated = true;
            byteTruncated = true;
        }
    }
    refreshDisclosure(details, byteTruncated);
    updateEmittedBytes(details);
    return byteLength(safeStringify(details)) <= budget ? details : emergencyDetails(details, budget);
}

function projectStandardDetails(details: Record<string, any>): Record<string, any> {
    const sections = allSections(details);
    const evidence: Record<string, unknown> = {};
    for (const name of ['definitions', 'declarations', 'references']) {
        const projected = projectEvidenceSection(sections[name]);
        if (projected) evidence[name] = projected;
    }
    const edges = Object.fromEntries(
        ['exports', 'callers', 'imports', 'callees']
            .map((edge) => [edge, projectEvidenceSection(sections[`graph.${edge}`])] as const)
            .filter((entry) => entry[1] !== undefined)
    );
    const graphObservedItems = ['exports', 'callers', 'imports', 'callees'].reduce(
        (sum, edge) => sum + Number(sections[`graph.${edge}`]?.count || 0),
        0
    );
    const graphUsableItems = ['exports', 'callers', 'imports', 'callees'].reduce(
        (sum, edge) => sum + Number(sections[`graph.${edge}`]?.emitted || 0),
        0
    );
    const observedImpact = details.graph?.observedImpact === true || graphObservedItems > 0;
    const usableImpact = details.graph?.usableImpact === true || graphUsableItems > 0;
    if (observedImpact || graphObservedItems > 0 || Object.keys(edges).length > 0) {
        evidence.graph = {
            observedImpact,
            usableImpact,
            observedItems: graphObservedItems,
            usableItems: graphUsableItems,
            ...(Object.keys(edges).length > 0 ? { edges } : {}),
        };
    }

    const provenance = Object.fromEntries(
        Object.entries(recordOf(details.provenance)).filter(([, value]) => recordOf(value).present === true)
    );
    const omissions = arrayOf(details.omissions);
    const sourceDisclosure = recordOf(details.disclosure);
    const packetOmissions = recordOf(sourceDisclosure.packetOmissions);
    const projected: Record<string, any> = {
        schemaVersion: 2,
        mode: 'standard',
        evidence,
        ...(Object.keys(provenance).length > 0 ? { provenance } : {}),
        ...(omissions.length > 0 ? { omissions } : {}),
        disclosure: {
            packetByteBudget: Number(sourceDisclosure.packetByteBudget || SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes),
            byteBudget: Number(sourceDisclosure.byteBudget || SYMBOL_IMPACT_DISCLOSURE_BUDGETS.standardBytes),
            emittedBytes: 0,
            truncated: sourceDisclosure.truncated === true,
            byteTruncated: sourceDisclosure.byteTruncated === true,
            omittedItems: Number(sourceDisclosure.omittedItems || 0),
            ...(sourceDisclosure.packetFallback === true ? { packetFallback: true } : {}),
            ...(Object.values(packetOmissions).some((value) => Number(value) > 0) ? { packetOmissions } : {}),
        },
    };
    updateEmittedBytes(projected);
    return projected;
}

function projectEvidenceSection(section: EvidenceSection | undefined): Record<string, unknown> | undefined {
    if (!section || (section.count === 0 && section.emitted === 0 && section.omitted === 0)) return undefined;
    return {
        observed: section.count,
        usable: section.emitted,
        ...(section.omitted > 0 ? { omitted: section.omitted } : {}),
        ...(section.items.length > 0 ? { items: section.items } : {}),
    };
}

function failClosedPacket(
    packet: Record<string, any>,
    mode: 'standard' | 'debug' | null,
    omitted: PacketOmissions
): Record<string, any> {
    const symbol = sanitizeDisclosureText(String(packet.symbol || ''), '.', 256);
    const fallback: Record<string, any> = {
        schemaVersion: 1,
        workflow: 'explore_symbol_impact',
        ok: false,
        symbol,
        status: 'indeterminate',
        degraded: true,
        message:
            'Impact evidence exceeded the complete packet budget; omitted evidence must not be used to plan edits.',
        evidence: { references: 0, graphImpact: false, partial: false },
        nextReads: [
            {
                action: 'locate_confirm_definition',
                arguments: { symbol, precise: true },
                reason: 'Use a narrower file or result limit before planning edits.',
            },
        ],
        limitations: ['Complete packet exceeded 48 KiB and was replaced with this fail-closed result.'],
        truncation: {
            applied: true,
            byteBudget: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes,
            omissions: omitted,
        },
    };
    if (mode) {
        const emergency = emergencyDetails(recordOf(packet.details), 4_096);
        emergency.disclosure.packetFallback = true;
        updateEmittedBytes(emergency);
        fallback.details = mode === 'standard' ? projectStandardDetails(emergency) : emergency;
    }
    if (byteLength(safeStringify(fallback)) <= SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes) return fallback;
    return {
        schemaVersion: 1,
        workflow: 'explore_symbol_impact',
        ok: false,
        status: 'indeterminate',
        degraded: true,
        message: 'Impact evidence exceeded the complete packet budget and was omitted.',
        truncation: { applied: true, byteBudget: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes },
    };
}

function emergencyDetails(details: Record<string, any>, budget: number): Record<string, any> {
    const minimal: Record<string, any> = {
        schemaVersion: 1,
        mode: disclosureMode(details) || details.mode || 'standard',
        definitions: emptySection(details.definitions?.count),
        declarations: emptySection(details.declarations?.count),
        references: emptySection(details.references?.count),
        graph: {
            hasImpactEvidence: details.graph?.hasImpactEvidence === true,
            observedImpact: details.graph?.observedImpact === true,
            usableImpact: details.graph?.usableImpact === true,
            edges: Object.fromEntries(
                ['exports', 'callers', 'imports', 'callees'].map((edge) => [
                    edge,
                    emptySection(details.graph?.edges?.[edge]?.count),
                ])
            ),
        },
        provenance: {
            definitionLookup: emptyProvenance(),
            symbolMap: emptyProvenance(),
            graph: emptyProvenance(),
        },
        counts: {},
        omissions: [],
        limitations: ['Detail evidence exceeded the byte budget and was omitted deterministically.'],
        disclosure: {
            packetByteBudget: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes,
            byteBudget: budget,
            emittedBytes: 0,
            itemBudgetPerSection: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.itemsPerSection,
            analyzedItemBudgetPerSection: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection,
            textCharacterBudget: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.textCharacters,
            truncated: true,
            byteTruncated: true,
            omittedItems: 0,
            omittedRawFragments:
                Number(details.disclosure?.omittedRawFragments || 0) + countRawFragments(details.diagnostics),
            truncatedRawFragments: Number(details.disclosure?.truncatedRawFragments || 0),
            packetOmissions: details.disclosure?.packetOmissions || {
                impactFiles: 0,
                nextReads: 0,
                limitations: 0,
            },
        },
        ...(details.mode === 'debug'
            ? {
                  diagnostics: {
                      timingsMs: boundedTimings(details.diagnostics?.timingsMs),
                      subcalls: [],
                      redaction: details.diagnostics?.redaction,
                      rawFragmentBudgetBytes: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugRawFragmentBytes,
                  },
              }
            : {}),
    };
    refreshDisclosure(minimal, true);
    updateEmittedBytes(minimal);
    return minimal;
}

function recordPacketOmissions(details: Record<string, any>, added: PacketOmissions): void {
    if (!details.disclosure) return;
    const current = recordOf(details.disclosure.packetOmissions);
    details.disclosure.packetOmissions = {
        impactFiles: Number(current.impactFiles || 0) + added.impactFiles,
        nextReads: Number(current.nextReads || 0) + added.nextReads,
        limitations: Number(current.limitations || 0) + added.limitations,
    };
    const total = Object.values(details.disclosure.packetOmissions).reduce(
        (sum: number, value) => sum + Number(value || 0),
        0
    );
    if (total > 0) {
        details.disclosure.truncated = true;
        details.disclosure.byteTruncated = true;
    }
}

function refreshDisclosure(details: Record<string, any>, byteTruncated: boolean): void {
    updateCounts(details);
    const sections = allSections(details);
    const omissions = collectOmissions(sections);
    if (byteTruncated) omissions.push({ section: 'details', reason: 'byte_budget', count: 1 });
    details.omissions = omissions;
    details.disclosure.omittedItems = Object.values(sections).reduce(
        (sum, section) => sum + Number(section?.omitted || 0),
        0
    );
    details.disclosure.byteTruncated = byteTruncated;
    details.disclosure.truncated =
        byteTruncated ||
        omissions.length > 0 ||
        Number(details.disclosure.omittedRawFragments || 0) > 0 ||
        Number(details.disclosure.truncatedRawFragments || 0) > 0 ||
        packetOmissionCount(details) > 0;
}

function collectOmissions(sections: Record<string, EvidenceSection>): Omission[] {
    const omissions: Omission[] = [];
    for (const [name, section] of Object.entries(sections)) {
        const budgetOmitted = Math.max(
            0,
            section.omitted - section.shapeFailures.invalid - section.shapeFailures.outsideWorkspace
        );
        if (budgetOmitted) omissions.push({ section: name, reason: 'item_budget', count: budgetOmitted });
        if (section.shapeFailures.invalid)
            omissions.push({ section: name, reason: 'invalid_shape', count: section.shapeFailures.invalid });
        if (section.shapeFailures.outsideWorkspace)
            omissions.push({
                section: name,
                reason: 'outside_workspace',
                count: section.shapeFailures.outsideWorkspace,
            });
    }
    return omissions;
}

function allSections(details: Record<string, any>): Record<string, EvidenceSection> {
    return {
        definitions: details.definitions,
        declarations: details.declarations,
        references: details.references,
        'graph.exports': details.graph?.edges?.exports,
        'graph.callers': details.graph?.edges?.callers,
        'graph.imports': details.graph?.edges?.imports,
        'graph.callees': details.graph?.edges?.callees,
    };
}

function updateCounts(details: Record<string, any>): void {
    if (!details.counts) details.counts = {};
    for (const [name, section] of Object.entries(allSections(details))) {
        if (section) details.counts[name] = { observed: section.count, emitted: section.emitted };
    }
}

function updateEmittedBytes(details: Record<string, any>): void {
    if (!details.disclosure) return;
    let previous = -1;
    for (let iteration = 0; iteration < 8 && details.disclosure.emittedBytes !== previous; iteration++) {
        previous = Number(details.disclosure.emittedBytes || 0);
        details.disclosure.emittedBytes = byteLength(safeStringify(details));
    }
}

function emptySection(count: unknown): EvidenceSection {
    const observed = Number.isFinite(count) ? Number(count) : 0;
    return {
        count: observed,
        emitted: 0,
        omitted: observed,
        truncated: observed > 0,
        items: [],
        shapeFailures: { invalid: 0, outsideWorkspace: 0 },
    };
}

function emptyProvenance(): Record<string, unknown> {
    return { present: false, sources: [], fields: [], fieldCount: 0, fieldCountExact: true, fieldsTruncated: true };
}

function boundedTimings(value: unknown): Record<string, number> {
    const timings = recordOf(value);
    return Object.fromEntries(
        ['total', 'ontologySeed']
            .filter((key) => Number.isFinite(timings[key]))
            .map((key) => [key, Math.max(0, Number(timings[key]))])
    );
}

function countRawFragments(diagnostics: unknown): number {
    return arrayOf(recordOf(diagnostics).subcalls).reduce(
        (sum, subcall) => sum + arrayOf(recordOf(subcall).rawFragments).length,
        0
    );
}

function packetOmissionCount(details: Record<string, any>): number {
    return Object.values(recordOf(details.disclosure?.packetOmissions)).reduce(
        (sum: number, value) => sum + Number(value || 0),
        0
    );
}

function disclosureMode(value: unknown): 'standard' | 'debug' | null {
    const mode = recordOf(value).mode;
    return mode === 'standard' || mode === 'debug' ? mode : null;
}

function recordOf(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function arrayOf(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
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
