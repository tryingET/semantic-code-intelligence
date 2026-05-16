/**
 * API Types for Core ↔ Adapter Interface
 * These types define the contract between the protocol-agnostic core
 * and all protocol adapters (MCP, LSP, HTTP, etc.)
 */

// Common Types
export interface Location {
  uri: string      // File URI
  line: number     // 0-based line number
  column: number   // 0-based column number
}

export interface Range {
  start: Location
  end: Location
}

export interface TextDocument {
  uri: string
  languageId: string
  version: number
  content: string
}

export interface WorkspaceContext {
  rootUri: string
  workspaceFolders?: string[]
  configuration?: Record<string, any>
}

// Navigation Types
export interface FindDefinitionParams {
  symbol: string
  location?: Location
  context?: WorkspaceContext
  includeDeclaration?: boolean
}

export interface FindDefinitionResult {
  definitions: Definition[]
  confidence: number  // 0-1 confidence score
  source: string[]    // Which layers contributed
}

export interface Definition {
  location: Location
  kind: SymbolKind
  name: string
  detail?: string
  documentation?: string
  confidence: number
}

export interface FindReferencesParams {
  symbol: string
  location?: Location
  context?: WorkspaceContext
  includeDeclaration?: boolean
  includeWrites?: boolean
  includeReads?: boolean
}

export interface FindReferencesResult {
  references: Reference[]
  total: number
  truncated: boolean
}

export interface Reference {
  location: Location
  kind: ReferenceKind
  preview: string      // Line of code with reference
  confidence: number
}

export interface FindImplementationsParams {
  symbol: string
  location?: Location
  context?: WorkspaceContext
}

export interface FindImplementationsResult {
  implementations: Implementation[]
  confidence: number
}

export interface Implementation {
  location: Location
  kind: SymbolKind
  name: string
  detail?: string
  confidence: number
}

// Code Understanding Types
export interface HoverParams {
  symbol: string
  location: Location
  context?: WorkspaceContext
}

export interface HoverResult {
  content: {
    kind: 'plaintext' | 'markdown'
    value: string
  }
  range?: Range
}

export interface CompletionParams {
  prefix: string
  location: Location
  context?: WorkspaceContext
  triggerCharacter?: string
  selectedCompletion?: string  // For learning
}

export interface CompletionResult {
  items: CompletionItem[]
  isIncomplete: boolean
}

export interface CompletionItem {
  label: string
  kind: CompletionItemKind
  detail?: string
  documentation?: string
  insertText: string
  score: number
  source: string  // Which layer provided this
}

// Refactoring Types
export interface RenameParams {
  symbol: string
  newName: string
  location: Location
  context?: WorkspaceContext
}

export interface RenameResult {
  edits: WorkspaceEdit[]
  affectedFiles: string[]
  preview?: string
}

export interface WorkspaceEdit {
  uri: string
  edits: TextEdit[]
}

export interface TextEdit {
  range: Range
  newText: string
}

// Analysis Types
export interface DiagnosticParams {
  uri?: string  // If not provided, get workspace diagnostics
  context?: WorkspaceContext
}

export interface DiagnosticResult {
  diagnostics: Diagnostic[]
}

export interface Diagnostic {
  range: Range
  severity: DiagnosticSeverity
  code?: string | number
  source?: string
  message: string
  relatedInformation?: DiagnosticRelatedInformation[]
  tags?: DiagnosticTag[]
}

export interface DiagnosticRelatedInformation {
  location: Location
  message: string
}

// Learning Types
export interface Pattern {
  id: string
  name: string
  description: string
  template: string
  examples: Example[]
  confidence: number
  usageCount: number
  lastUsed: Date
  tags: string[]
}

export interface Example {
  before: string
  after: string
  context?: string
}

export interface PatternParams {
  code: string
  action: PatternAction
  context?: WorkspaceContext
}

export interface FeedbackParams {
  operationId: string
  rating: 'positive' | 'neutral' | 'negative'
  comment?: string
  suggestion?: string
}

// Knowledge Types
export interface ConceptParams {
  query?: string
  type?: ConceptType
  limit?: number
  context?: WorkspaceContext
}

export interface ConceptResult {
  concepts: Concept[]
  total: number
  confidence: number
}

export interface Concept {
  id: string
  name: string
  type: ConceptType
  description?: string
  metadata?: Record<string, any>
  confidence: number
}

export interface RelationshipParams {
  source?: string
  target?: string
  type?: RelationshipType
  limit?: number
}

export interface RelationshipResult {
  relationships: Relationship[]
  total: number
}

export interface Relationship {
  source: string
  target: string
  type: RelationshipType
  confidence: number
  metadata?: Record<string, any>
}

// Enums
export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26
}

export enum ReferenceKind {
  Read = 'read',
  Write = 'write',
  Call = 'call',
  Import = 'import',
  Export = 'export',
  Type = 'type',
  Extend = 'extend',
  Implement = 'implement'
}

export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4
}

export enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2
}

export enum PatternAction {
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
  Use = 'use',
  Reject = 'reject'
}

export enum ConceptType {
  Class = 'class',
  Function = 'function',
  Variable = 'variable',
  Module = 'module',
  Interface = 'interface',
  Type = 'type',
  Namespace = 'namespace',
  Package = 'package'
}

export enum RelationshipType {
  Uses = 'uses',
  UsedBy = 'used_by',
  Extends = 'extends',
  ExtendedBy = 'extended_by',
  Implements = 'implements',
  ImplementedBy = 'implemented_by',
  Imports = 'imports',
  ImportedBy = 'imported_by',
  Contains = 'contains',
  ContainedBy = 'contained_by',
  DependsOn = 'depends_on',
  DependedOnBy = 'depended_on_by'
}

// Error Types
export class CoreError extends Error {
  code: ErrorCode
  details?: any
  recoverable: boolean
  
  constructor(code: ErrorCode, message: string, details?: any) {
    super(message)
    this.code = code
    this.details = details
    this.recoverable = isRecoverable(code)
  }
}

export enum ErrorCode {
  // Client errors (4xx equivalent)
  InvalidRequest = 'INVALID_REQUEST',
  NotFound = 'NOT_FOUND',
  Unauthorized = 'UNAUTHORIZED',
  RateLimited = 'RATE_LIMITED',
  
  // Server errors (5xx equivalent)
  InternalError = 'INTERNAL_ERROR',
  ServiceUnavailable = 'SERVICE_UNAVAILABLE',
  Timeout = 'TIMEOUT',
  
  // Domain errors
  PatternNotFound = 'PATTERN_NOT_FOUND',
  ConceptNotFound = 'CONCEPT_NOT_FOUND',
  InvalidSymbol = 'INVALID_SYMBOL',
  ParseError = 'PARSE_ERROR'
}

function isRecoverable(code: ErrorCode): boolean {
  const recoverable = [
    ErrorCode.RateLimited,
    ErrorCode.ServiceUnavailable,
    ErrorCode.Timeout
  ]
  return recoverable.includes(code)
}

// Resource Limits
export interface ResourceLimits {
  maxRequestSize: number       // 10MB default
  maxResponseSize: number      // 50MB default
  maxConcurrentRequests: number // 100 default
  requestTimeout: number        // 30s default
  cacheSize: number            // 1GB default
  memoryLimit: number          // 2GB default
}

// Version Management
export interface Version {
  major: number  // Breaking changes
  minor: number  // New features, backwards compatible
  patch: number  // Bug fixes
  
  isCompatible(other: Version): boolean
}

export interface VersionNegotiation {
  clientVersion: Version
  serverVersion: Version
  negotiatedVersion: Version
  features: string[]  // Features available in negotiated version
}