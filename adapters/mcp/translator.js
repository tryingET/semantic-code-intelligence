// Minimal translator to satisfy adapter tests
export class MCPTranslator {
  translateFindDefinitionRequest(req) {
    return {
      symbol: req.symbol,
      location: req.file != null ? { uri: req.file, line: req.line, column: req.column } : undefined,
      context: req.workspace ? { rootUri: req.workspace } : (req.rootUri ? { rootUri: req.rootUri } : undefined)
    };
  }
  translateFindDefinitionResponse(res) {
    if (!res.definitions || res.definitions.length === 0) {
      return { message: 'No definitions found', confidence: res.confidence ?? 0, sources: res.source };
    }
    return {
      definitions: res.definitions.map(d => ({ file: d.location.uri, line: d.location.line, column: d.location.column, name: d.name, kind: d.kind })),
      confidence: res.confidence ?? 1,
      sources: res.source
    };
  }
  translateFindReferencesResponse(res) {
    const groups = new Map();
    for (const r of res.references || []) {
      const arr = groups.get(r.location.uri) || [];
      arr.push({ line: r.location.line, column: r.location.column, kind: r.kind, preview: r.preview, confidence: r.confidence });
      groups.set(r.location.uri, arr);
    }
    return {
      files: Array.from(groups.entries()).map(([file, references]) => ({ file, references })),
      totalReferences: res.total ?? (res.references ? res.references.length : 0),
      truncated: !!res.truncated
    };
  }
  translateRenameResponse(res) {
    return {
      files: res.edits?.map(e => ({ file: e.uri, edits: e.edits })) || [],
      affectedFiles: res.affectedFiles || [],
      preview: res.preview,
      summary: `${res.affectedFiles?.length || 0} files will be renamed`
    };
  }
  translateDiagnosticResponse(res) {
    const diagnostics = { errors: [], warnings: [] };
    for (const d of res.diagnostics || []) {
      if (d.severity === 1) diagnostics.errors.push(d); else if (d.severity === 2) diagnostics.warnings.push(d);
    }
    return {
      diagnostics,
      summary: { total: (res.diagnostics || []).length, errors: diagnostics.errors.length, warnings: diagnostics.warnings.length }
    };
  }
  translatePatternRequest(req) { return { code: req.code, action: req.action, context: req.context }; }
  translateFeedbackRequest(req) { return { operationId: req.operationId, rating: req.rating, comment: req.comment, suggestion: req.suggestion }; }
  translateConceptRequest(req) { return { query: req.query, type: req.type, limit: req.limit }; }
  translateConceptResponse(res) { return { concepts: res.concepts || [], averageConfidence: res.confidence ?? 0 }; }
  translateRelationshipResponse(res) {
    const typeMap = new Map();
    for (const r of res.relationships || []) {
      const t = typeMap.get(r.type) || { type: r.type, count: 0 };
      t.count++;
      typeMap.set(r.type, t);
    }
    return { relationshipTypes: Array.from(typeMap.values()), total: res.total ?? (res.relationships ? res.relationships.length : 0) };
  }
  formatError(err) { return { error: true, message: err?.message || String(err) }; }
}

