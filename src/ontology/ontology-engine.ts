// Semantic Graph Engine (Layer 4) - explicit Thing / Concept / Symbol handling (Ullmann triangle)
import { EventEmitter } from 'events';
import { Graph } from 'graphlib';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { ThingKind } from '../types/core';
import type {
    Concept,
    ConceptSignature,
    EvolutionHistory,
    Relation,
    RelationType,
    Symbol,
    Thing,
    ThingConceptLink,
    ThingSymbolLink,
    ThingSymbolRole,
} from '../types/core';
import { ConceptBuilder, type ConceptBuildResult } from './concept-builder';
import { InstrumentedStoragePort, type L4StorageMetrics } from './instrumented-storage';
import { isValidLocation, normalizeUri as normUri, sanitizeRange } from './location-utils';
import { SimilarityCalculator } from './similarity-calculator';
import type { StoragePort } from './storage-port';

export interface RelatedConcept {
    concept: Concept;
    relation: string;
    distance: number;
    confidence: number;
}

export interface ConceptChange {
    type: 'rename' | 'signature' | 'relation' | 'move';
    conceptId: string;
    newName?: string;
    newSignature?: ConceptSignature;
    targetConcept?: string;
    relationType?: RelationType;
    location?: string;
    evidence?: string[];
}

export interface ConceptAnchor {
    symbolText: string;
    location: Thing['location'];
    kind: ThingKind;
    occurrences: number;
    role: ThingSymbolRole;
    confidence: number;
}

export type ExportedConceptV2 = {
    version: 2;
    concept: {
        id: string;
        canonicalName: string;
        type?: string;
        relations: Array<[string, Relation]>;
        signature: ConceptSignature;
        evolution: EvolutionHistory[];
        metadata: any;
        confidence: number;
    };
    anchors: ConceptAnchor[];
};

export class SemanticGraphEngine extends EventEmitter {
    private conceptGraph: Graph;
    private concepts = new Map<string, Concept>();
    private symbols = new Map<string, Symbol>();
    private things = new Map<string, Thing>();

    // Links and derived indexes
    private thingSymbols = new Map<string, ThingSymbolLink>(); // key: thing|symbol|role
    private thingConcepts = new Map<string, ThingConceptLink>(); // key: thing|concept
    private conceptToThingIds = new Map<string, Set<string>>();
    private symbolTextToConceptIds = new Map<string, Set<string>>();
    private symbolIdToText = new Map<string, string>();

    private similarityCalculator: SimilarityCalculator;
    private conceptBuilder: ConceptBuilder;
    private storage: StoragePort;
    private initPromise: Promise<void> | null = null;

    constructor(storage: StoragePort) {
        super();
        this.conceptGraph = new Graph({ directed: true, multigraph: true });
        this.similarityCalculator = new SimilarityCalculator();
        this.conceptBuilder = new ConceptBuilder();
        const s: any = storage as any;
        this.storage = s && typeof s.getMetrics === 'function' ? storage : new InstrumentedStoragePort(storage);
        this.initPromise = null;
    }

    async ensureInitialized(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.initialize();
        }
        await this.initPromise;
    }

    getStorageMetrics(): L4StorageMetrics | null {
        const s: any = this.storage as any;
        if (s && typeof s.getMetrics === 'function') {
            try {
                return s.getMetrics();
            } catch {
                return null;
            }
        }
        return null;
    }

    private async initialize(): Promise<void> {
        await this.storage.initialize();
        await this.loadExistingGraph();
    }

    private async loadExistingGraph(): Promise<void> {
        const [concepts, symbols, things, thingSymbols, thingConcepts] = await Promise.all([
            this.storage.loadAllConcepts(),
            this.storage.loadAllSymbols(),
            this.storage.loadAllThings(),
            this.storage.loadAllThingSymbols(),
            this.storage.loadAllThingConcepts(),
        ]);

        // Clear maps to be safe on re-init
        this.concepts.clear();
        this.symbols.clear();
        this.things.clear();
        this.thingSymbols.clear();
        this.thingConcepts.clear();
        this.conceptToThingIds.clear();
        this.symbolTextToConceptIds.clear();
        this.symbolIdToText.clear();
        this.conceptGraph = new Graph({ directed: true, multigraph: true });

        for (const c of concepts) {
            this.concepts.set(c.id, c);
            this.conceptGraph.setNode(c.id, c);
        }
        for (const c of concepts) {
            for (const [targetId, relation] of c.relations) {
                this.conceptGraph.setEdge(c.id, targetId, relation);
            }
        }

        for (const s of symbols) {
            this.symbols.set(s.id, s);
            this.symbolIdToText.set(s.id, s.text);
        }

        for (const t of things) {
            this.things.set(t.id, t);
        }

        for (const link of thingSymbols) {
            const key = this.thingSymbolKey(link);
            this.thingSymbols.set(key, link);
        }

        for (const link of thingConcepts) {
            const key = this.thingConceptKey(link);
            this.thingConcepts.set(key, link);
            if (!this.conceptToThingIds.has(link.conceptId)) this.conceptToThingIds.set(link.conceptId, new Set());
            this.conceptToThingIds.get(link.conceptId)!.add(link.thingId);
        }

        this.rebuildSymbolTextIndex();
    }

    private rebuildSymbolTextIndex(): void {
        this.symbolTextToConceptIds.clear();

        // For each thing ↔ concept link, look at associated thing ↔ symbol links and derive text → concept.
        for (const [, tc] of this.thingConcepts) {
            const thingId = tc.thingId;
            const conceptId = tc.conceptId;
            const symbolIds = this.getSymbolIdsForThing(thingId);
            for (const symbolId of symbolIds) {
                const text = this.symbolIdToText.get(symbolId);
                if (!text) continue;
                if (!this.symbolTextToConceptIds.has(text)) this.symbolTextToConceptIds.set(text, new Set());
                this.symbolTextToConceptIds.get(text)!.add(conceptId);
            }
        }
    }

    async findConcept(identifier: string, options?: { inferIfMissing?: boolean }): Promise<Concept | null> {
        await this.ensureInitialized();

        // 1) Exact canonical name match (preferred label)
        for (const [, c] of this.concepts) {
            if (c.canonicalName === identifier) return c;
        }

        // 2) Direct symbol → concept lookup
        const direct = this.findBySymbolText(identifier);
        if (direct) return direct;

        // 3) Fuzzy search
        const fuzzyMatch = await this.fuzzySearchConcepts(identifier);
        if (fuzzyMatch.length > 0 && fuzzyMatch[0].confidence > 0.8) {
            return fuzzyMatch[0].concept;
        }

        // 4) Infer (default true unless explicitly disabled)
        if (options?.inferIfMissing !== false) {
            return this.inferConcept(identifier);
        }

        return null;
    }

    async findConceptStrict(identifier: string): Promise<Concept | null> {
        return this.findConcept(identifier, { inferIfMissing: false });
    }

    private findBySymbolText(text: string): Concept | null {
        const conceptIds = this.symbolTextToConceptIds.get(text);
        if (!conceptIds || conceptIds.size === 0) return null;

        let best: { concept: Concept; score: number } | null = null;
        for (const conceptId of conceptIds) {
            const concept = this.concepts.get(conceptId);
            if (!concept) continue;
            const score = this.scoreConceptForSymbolText(conceptId, text);
            if (!best || score > best.score) best = { concept, score };
        }

        return best?.concept ?? null;
    }

    private scoreConceptForSymbolText(conceptId: string, symbolText: string): number {
        const thingIds = this.conceptToThingIds.get(conceptId);
        if (!thingIds) return 0;
        let score = 0;
        for (const thingId of thingIds) {
            const thing = this.things.get(thingId);
            if (!thing) continue;
            const symbolIds = this.getSymbolIdsForThing(thingId);
            for (const sid of symbolIds) {
                if (this.symbolIdToText.get(sid) === symbolText) {
                    score += thing.occurrences ?? 1;
                }
            }
        }
        return score;
    }

    private getSymbolIdsForThing(thingId: string): string[] {
        const out: string[] = [];
        for (const [, link] of this.thingSymbols) {
            if (link.thingId === thingId) out.push(link.symbolId);
        }
        return out;
    }

    private async fuzzySearchConcepts(identifier: string): Promise<{ concept: Concept; confidence: number }[]> {
        const candidates: { concept: Concept; confidence: number }[] = [];

        for (const [, concept] of this.concepts) {
            const similarity = await this.calculateConceptSimilarity(identifier, concept);
            if (similarity > 0.5) candidates.push({ concept, confidence: similarity });
        }

        return candidates.sort((a, b) => b.confidence - a.confidence);
    }

    private async calculateConceptSimilarity(identifier: string, concept: Concept): Promise<number> {
        let maxSimilarity = 0;

        // Compare against canonical name
        maxSimilarity = Math.max(
            maxSimilarity,
            (await this.similarityCalculator.calculate(identifier, concept.canonicalName)) * 0.9
        );

        // Compare against symbol texts that currently map to this concept
        for (const [text, conceptIds] of this.symbolTextToConceptIds) {
            if (!conceptIds.has(concept.id)) continue;
            const sim = await this.similarityCalculator.calculate(identifier, text);
            maxSimilarity = Math.max(maxSimilarity, sim);
        }

        return maxSimilarity;
    }

    private async inferConcept(identifier: string): Promise<Concept | null> {
        const context = await this.gatherIdentifierContext(identifier);
        if (!context) return null;

        const built = await this.conceptBuilder.buildFromContext(identifier, context);
        if (!built) return null;

        await this.addConcept(built.concept, built.anchors);
        return built.concept;
    }

    private async gatherIdentifierContext(identifier: string): Promise<any> {
        return {
            identifier,
            location: null,
            signature: null,
            usage: [],
        };
    }

    async addConcept(
        concept: Concept,
        anchors: Array<{
            symbolText: string;
            location: Thing['location'];
            kind?: ThingKind;
            occurrences?: number;
            role?: ThingSymbolRole;
            confidence?: number;
        }> = []
    ): Promise<void> {
        if (!concept.id || !concept.canonicalName) {
            throw new Error('Invalid concept: missing id or canonicalName');
        }
        if (!Array.isArray((concept as any).evolution)) (concept as any).evolution = [];

        this.concepts.set(concept.id, concept);
        this.conceptGraph.setNode(concept.id, concept);
        for (const [targetId, relation] of concept.relations) {
            this.conceptGraph.setEdge(concept.id, targetId, relation);
        }

        await this.storage.upsertConcept(concept);

        for (const a of anchors) {
            await this.addAnchor(concept.id, a);
        }

        this.emit('conceptAdded', concept);
    }

    async addAnchor(
        conceptId: string,
        anchor: {
            symbolText: string;
            location: Thing['location'];
            kind?: ThingKind;
            occurrences?: number;
            role?: ThingSymbolRole;
            confidence?: number;
        }
    ): Promise<void> {
        await this.ensureInitialized();
        const concept = this.concepts.get(conceptId);
        if (!concept) throw new Error(`Concept not found: ${conceptId}`);

        const normalized = {
            uri: normUri((anchor.location as any)?.uri),
            range:
                sanitizeRange((anchor.location as any)?.range) || {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                },
        };
        if (!isValidLocation(normalized)) return;

        const kind = (anchor.kind ?? ThingKind.Variable) as ThingKind;

        const symbol: Symbol = {
            id: this.symbolId(anchor.symbolText),
            text: anchor.symbolText,
            confidence: anchor.confidence ?? concept.confidence ?? 0.5,
        };

        const thingId = this.thingId(kind, normalized);
        const existingThing = this.things.get(thingId);
        const now = new Date();
        const occurrences = Math.max(1, anchor.occurrences ?? 1);

        const thing: Thing = existingThing
            ? {
                  ...existingThing,
                  lastSeen: now,
                  occurrences: (existingThing.occurrences ?? 1) + occurrences,
              }
            : {
                  id: thingId,
                  kind,
                  location: normalized as any,
                  confidence: anchor.confidence ?? concept.confidence ?? 0.5,
                  firstSeen: now,
                  lastSeen: now,
                  occurrences,
              };

        const thingSymbol: ThingSymbolLink = {
            thingId: thing.id,
            symbolId: symbol.id,
            role: (anchor.role ?? 'unknown') as ThingSymbolRole,
        };

        const thingConcept: ThingConceptLink = {
            thingId: thing.id,
            conceptId,
            confidence: anchor.confidence ?? concept.confidence ?? 0.5,
            evidence: [],
        };

        await this.storage.upsertSymbol(symbol);
        await this.storage.upsertThing(thing);
        await this.storage.upsertThingSymbol(thingSymbol);
        await this.storage.upsertThingConcept(thingConcept);

        this.symbols.set(symbol.id, symbol);
        this.symbolIdToText.set(symbol.id, symbol.text);
        this.things.set(thing.id, thing);

        this.thingSymbols.set(this.thingSymbolKey(thingSymbol), thingSymbol);
        this.thingConcepts.set(this.thingConceptKey(thingConcept), thingConcept);
        if (!this.conceptToThingIds.has(conceptId)) this.conceptToThingIds.set(conceptId, new Set());
        this.conceptToThingIds.get(conceptId)!.add(thing.id);

        if (!this.symbolTextToConceptIds.has(symbol.text)) this.symbolTextToConceptIds.set(symbol.text, new Set());
        this.symbolTextToConceptIds.get(symbol.text)!.add(conceptId);
    }

    async evolveConcept(change: ConceptChange): Promise<void> {
        const concept = this.concepts.get(change.conceptId);
        if (!concept) throw new Error(`Concept not found: ${change.conceptId}`);

        const evolutionEntry: EvolutionHistory = {
            timestamp: new Date(),
            type: change.type,
            from: concept.canonicalName,
            to: this.getNewState(change),
            reason: this.generateChangeReason(change),
            confidence: 0.9,
        };

        await this.applyConceptChange(concept, change);
        concept.evolution.push(evolutionEntry);
        await this.storage.upsertConcept(concept);
        this.emit('conceptEvolved', { concept, change });
    }

    private async applyConceptChange(concept: Concept, change: ConceptChange): Promise<void> {
        switch (change.type) {
            case 'rename':
                if (change.newName) concept.canonicalName = change.newName;
                break;
            case 'signature':
                if (change.newSignature) concept.signature = change.newSignature;
                break;
            case 'relation':
                if (change.targetConcept && change.relationType) {
                    await this.addRelation(concept.id, change.targetConcept, change.relationType);
                }
                break;
            case 'move':
                // Moves are expressed via anchors (Thing location); no-op here.
                break;
        }
    }

    async addRelation(
        fromConceptId: string,
        toConceptId: string,
        relationType: RelationType,
        confidence: number = 0.9,
        evidence: string[] = []
    ): Promise<void> {
        const fromConcept = this.concepts.get(fromConceptId);
        const toConcept = this.concepts.get(toConceptId);
        if (!fromConcept || !toConcept) throw new Error('One or both concepts not found for relation');

        const relation: Relation = {
            id: uuidv4(),
            targetConceptId: toConceptId,
            type: relationType,
            confidence,
            evidence,
            createdAt: new Date(),
        };

        fromConcept.relations.set(toConceptId, relation);
        this.conceptGraph.setEdge(fromConceptId, toConceptId, relation);
        await this.storage.upsertConcept(fromConcept);
    }

    getRelatedConcepts(conceptId: string, maxDepth: number = 2): RelatedConcept[] {
        const related: RelatedConcept[] = [];
        const visited = new Set<string>();
        this.traverseRelations(conceptId, 0, maxDepth, visited, related);
        return related
            .filter((r) => r.confidence > 0.3)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 20);
    }

    private traverseRelations(
        conceptId: string,
        currentDepth: number,
        maxDepth: number,
        visited: Set<string>,
        result: RelatedConcept[]
    ): void {
        if (currentDepth >= maxDepth || visited.has(conceptId)) return;
        visited.add(conceptId);

        const outEdges = this.conceptGraph.outEdges(conceptId) || [];
        for (const edge of outEdges) {
            const targetConcept = this.concepts.get(edge.w);
            if (!targetConcept) continue;
            const relation = this.conceptGraph.edge(edge) as Relation;
            const conf = this.calculateRelationConfidence(relation, currentDepth);
            result.push({ concept: targetConcept, relation: relation.type, distance: currentDepth + 1, confidence: conf });
            this.traverseRelations(edge.w, currentDepth + 1, maxDepth, visited, result);
        }

        const inEdges = this.conceptGraph.inEdges(conceptId) || [];
        for (const edge of inEdges) {
            const sourceConcept = this.concepts.get(edge.v);
            if (!sourceConcept || visited.has(edge.v)) continue;
            const relation = this.conceptGraph.edge(edge) as Relation;
            const conf = this.calculateRelationConfidence(relation, currentDepth) * 0.8;
            result.push({
                concept: sourceConcept,
                relation: `inverse_${relation.type}`,
                distance: currentDepth + 1,
                confidence: conf,
            });
        }
    }

    private calculateRelationConfidence(relation: Relation, depth: number): number {
        let confidence = relation.confidence ?? 0.5;
        confidence *= 0.8 ** depth;
        const relationWeights: Record<string, number> = {
            extends: 0.95,
            implements: 0.9,
            uses: 0.7,
            calls: 0.6,
            references: 0.5,
            similar_to: 0.4,
            co_changes: 0.8,
        };
        confidence *= relationWeights[relation.type] || 0.3;
        confidence += Math.min(0.1, (relation.evidence?.length ?? 0) * 0.02);
        return Math.min(1.0, confidence);
    }

    listConceptAnchors(conceptId: string): ConceptAnchor[] {
        const thingIds = this.conceptToThingIds.get(conceptId);
        if (!thingIds) return [];
        const out: ConceptAnchor[] = [];
        for (const thingId of thingIds) {
            const thing = this.things.get(thingId);
            if (!thing) continue;
            const links = [...this.thingSymbols.values()].filter((l) => l.thingId === thingId);
            for (const l of links) {
                const text = this.symbolIdToText.get(l.symbolId);
                if (!text) continue;
                const tcKey = `${thingId}|${conceptId}`;
                const tc = this.thingConcepts.get(tcKey);
                out.push({
                    symbolText: text,
                    location: thing.location,
                    kind: thing.kind as any,
                    occurrences: thing.occurrences ?? 1,
                    role: (l.role as any) ?? 'unknown',
                    confidence: tc?.confidence ?? thing.confidence ?? 0.5,
                });
            }
        }
        // Prefer higher occurrence anchors first
        return out.sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0));
    }

    getStatistics(): {
        totalConcepts: number;
        totalRelations: number;
        totalSymbols: number;
        totalThings: number;
        averageAnchorsPerConcept: number;
    } {
        const totalConcepts = this.concepts.size;
        const totalRelations = this.conceptGraph.edgeCount();
        const totalSymbols = this.symbols.size;
        const totalThings = this.things.size;
        let totalAnchors = 0;
        for (const [, s] of this.conceptToThingIds) totalAnchors += s.size;
        return {
            totalConcepts,
            totalRelations,
            totalSymbols,
            totalThings,
            averageAnchorsPerConcept: totalConcepts > 0 ? totalAnchors / totalConcepts : 0,
        };
    }

    getConceptGraphSnapshot(options?: { maxNodes?: number; maxEdges?: number }): { nodes: any[]; edges: any[] } {
        const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
        const maxNodes = clamp(Number(options?.maxNodes ?? 200), 0, 2000);
        const maxEdges = clamp(Number(options?.maxEdges ?? 500), 0, 5000);

        const all = Array.from(this.concepts.values()).map((c) => ({
            id: c.id,
            label: c.canonicalName,
            confidence: c.confidence ?? 0.5,
            anchors: this.conceptToThingIds.get(c.id)?.size ?? 0,
        }));

        all.sort((a, b) => b.anchors - a.anchors || b.confidence - a.confidence || a.label.localeCompare(b.label));

        const selected = all.slice(0, maxNodes);
        const selectedIds = new Set(selected.map((n) => n.id));

        const nodes = selected.map((n) => ({
            id: n.id,
            label: n.label,
            confidence: n.confidence,
            anchors: n.anchors,
        }));

        const edges: any[] = [];
        const allEdges = this.conceptGraph.edges() || [];
        for (const e of allEdges as any[]) {
            const from = e.v;
            const to = e.w;
            if (!selectedIds.has(from) || !selectedIds.has(to)) continue;
            const rel = this.conceptGraph.edge(e) as Relation;
            edges.push({
                from,
                to,
                type: (rel as any)?.type || 'unknown',
                confidence: (rel as any)?.confidence ?? 0.5,
            });
            if (edges.length >= maxEdges) break;
        }

        return { nodes, edges };
    }

    async dispose(): Promise<void> {
        await this.storage.close();
        this.removeAllListeners();
    }

    async importConcept(conceptData: ExportedConceptV2): Promise<void> {
        if (!conceptData || conceptData.version !== 2) {
            throw new Error('IMPORT_UNSUPPORTED: expected ExportedConceptV2');
        }

        const concept: Concept = {
            id: conceptData.concept.id || uuidv4(),
            canonicalName: conceptData.concept.canonicalName,
            type: conceptData.concept.type,
            relations: new Map(conceptData.concept.relations || []),
            signature: conceptData.concept.signature,
            metadata: conceptData.concept.metadata || { tags: [] },
            evolution: conceptData.concept.evolution || [],
            confidence: conceptData.concept.confidence || 0.5,
        };

        await this.addConcept(concept, []);

        for (const a of conceptData.anchors || []) {
            await this.addAnchor(concept.id, a);
        }
    }

    async exportConcepts(): Promise<ExportedConceptV2[]> {
        const out: ExportedConceptV2[] = [];
        for (const [, concept] of this.concepts) {
            out.push({
                version: 2,
                concept: {
                    id: concept.id,
                    canonicalName: concept.canonicalName,
                    type: concept.type,
                    relations: Array.from(concept.relations.entries()),
                    signature: concept.signature,
                    evolution: concept.evolution,
                    metadata: concept.metadata,
                    confidence: concept.confidence,
                },
                anchors: this.listConceptAnchors(concept.id),
            });
        }
        return out;
    }

    private thingSymbolKey(l: ThingSymbolLink): string {
        return `${l.thingId}|${l.symbolId}|${l.role}`;
    }
    private thingConceptKey(l: ThingConceptLink): string {
        return `${l.thingId}|${l.conceptId}`;
    }

    private symbolId(text: string, language: string = ''): string {
        return this.hashId('sym', `${language}\u0000${text}`);
    }

    private thingId(kind: ThingKind, loc: { uri: string; range: any }): string {
        const s = `${kind}\u0000${loc.uri}\u0000${loc.range.start.line}:${loc.range.start.character}-${loc.range.end.line}:${loc.range.end.character}`;
        return this.hashId('thing', s);
    }

    private hashId(prefix: string, input: string): string {
        const h = createHash('sha1').update(input).digest('hex');
        return `${prefix}_${h}`;
    }

    private getNewState(change: ConceptChange): string {
        switch (change.type) {
            case 'rename':
                return change.newName || 'unknown';
            case 'signature':
                return 'signature_changed';
            case 'relation':
                return `+${change.relationType}`;
            case 'move':
                return change.location || 'moved';
            default:
                return 'changed';
        }
    }

    private generateChangeReason(change: ConceptChange): string {
        switch (change.type) {
            case 'rename':
                return `Renamed to ${change.newName}`;
            case 'signature':
                return 'Signature updated';
            case 'relation':
                return `Added ${change.relationType} relation`;
            case 'move':
                return `Moved to ${change.location}`;
            default:
                return 'Unknown change';
        }
    }
}

// Back-compat alias inside the codebase: many call sites still import OntologyEngine.
// The project’s semantics are now explicit Thing/Concept/Symbol even if the filename remains.
export { SemanticGraphEngine as OntologyEngine };
