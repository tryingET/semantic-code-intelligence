export const allowedGraphEvidenceStatuses = new Set(['evidence', 'limited', 'empty_or_unavailable']);

function strings(value: any): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export type NormalizedGraphImpactContext = {
  present: boolean;
  seed: { kind: string; value: string } | null;
  requestedEdges: string[];
  edgeEvidence: Array<{ edge: string; status: string; count: number; limitations: string[] }>;
  limitationsFieldPresent: boolean;
  hasStableContext: boolean;
  failures: string[];
};

export function validateGraphImpactContext(graphImpact: any): NormalizedGraphImpactContext {
  if (!graphImpact || typeof graphImpact !== 'object') {
    return {
      present: false,
      seed: null,
      requestedEdges: [],
      edgeEvidence: [],
      limitationsFieldPresent: false,
      hasStableContext: false,
      failures: [],
    };
  }

  const failures: string[] = [];
  const seed = graphImpact.seed && typeof graphImpact.seed === 'object'
    ? { kind: String(graphImpact.seed.kind || ''), value: String(graphImpact.seed.value || '') }
    : null;
  if (!seed?.kind || !seed?.value) failures.push('graph_seed_missing');

  const requestedEdges = strings(graphImpact.requestedEdges);
  if (requestedEdges.length === 0) failures.push('graph_requested_edges_missing');

  const edgeEvidence = Array.isArray(graphImpact.evidence)
    ? graphImpact.evidence.map((item: any) => ({
        edge: String(item?.edge || ''),
        status: String(item?.status || ''),
        count: typeof item?.count === 'number' ? item.count : Number.NaN,
        limitations: strings(item?.limitations),
      })).filter((item: any) => item.edge && item.status)
    : [];
  if (edgeEvidence.length === 0) failures.push('graph_edge_evidence_missing');

  const evidenceByEdge = new Map(edgeEvidence.map((item) => [item.edge, item]));
  const missingEvidenceEdges = requestedEdges.filter((edge) => !evidenceByEdge.has(edge));
  if (missingEvidenceEdges.length > 0) failures.push('graph_requested_edge_evidence_missing');

  if (edgeEvidence.some((item) => !allowedGraphEvidenceStatuses.has(item.status))) failures.push('graph_edge_status_invalid');
  if (edgeEvidence.some((item) => !Number.isFinite(item.count) || item.count < 0)) failures.push('graph_edge_count_invalid');
  if (edgeEvidence.some((item) => item.status === 'limited' && item.limitations.length === 0)) failures.push('graph_limited_edge_without_limitation');

  const limitationsFieldPresent = Array.isArray(graphImpact.limitations);
  if (!limitationsFieldPresent) failures.push('graph_limitations_field_missing');

  return {
    present: true,
    seed,
    requestedEdges,
    edgeEvidence,
    limitationsFieldPresent,
    hasStableContext: failures.length === 0,
    failures,
  };
}
