# Layer 4 StoragePort

Layer 4 (Ontology / Semantic Graph) persistence is now abstracted behind a StoragePort.

## Why
- Keep Layer 4 protocol-agnostic and storage-agnostic.
- Enable pluggable backends: SQLite (default), Postgres, Triple Store.
- Support consistent SLOs and observability irrespective of backend.

## Interface
See `src/ontology/storage-port.ts`:
- Lifecycle: `initialize()`, `close()`
- CRUD: `saveConcept`, `updateConcept`, `deleteConcept`, `loadConcept`, `loadAllConcepts`
- Optional: `findConceptsByName`, `getConceptStatistics`, `vacuum`, `analyze`, `backup`

## Adapters
- SQLite (default): `src/ontology/storage.ts` implements `StoragePort`.
- Postgres (scaffold): `src/ontology/adapters/postgres-adapter.ts` (not implemented yet).
- Triple Store (scaffold): `src/ontology/adapters/triple-adapter.ts` (not implemented yet).

## Wiring
- Factory: `src/ontology/storage-factory.ts` selects adapter from config
  - `layers.layer4.adapter`: `'sqlite' | 'postgres' | 'triplestore'` (default `'sqlite'`)
  - `layers.layer4.dbPath`: path for SQLite database (default `.ontology/ontology.db`)
- Engine: `OntologyEngine` now accepts a `StoragePort` in its constructor.
- Analyzer: `AnalyzerFactory` uses the storage factory and injects the adapter.

## Tests
- Ontology engine parity (find/rename/relations): `tests/step3_ontology-engine.test.ts`
- Import/Export parity: `tests/layer4-import-export.test.ts`

## Notes
- Non-SQLite adapters are stubs and will throw on use until implemented.
- Existing configs continue to work; if `adapter` is not specified, SQLite is used.

