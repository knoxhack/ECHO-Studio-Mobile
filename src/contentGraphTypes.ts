// Types for the canonical `.ECHO Content Graph` evidence format.
// These are simplified TypeScript shapes aligned with ECHO-SDK schema docs.

export interface EchoContentGraphProvenance {
  generatedBy?: string
  generatedAt?: string
  sourceRepo?: string
  commitSha?: string
}

export interface EchoContentGraphNode {
  schemaVersion?: string
  kind: string
  id: string
  moduleId?: string
  displayName?: string
  description?: string
  capabilities?: string[]
  tags?: string[]
  intent?: string
  actions?: Array<{ id: string; label: string; requires?: string }>
  fallbacks?: Record<string, string>
  runtimeHints?: Record<string, Record<string, unknown>>
  data?: Record<string, unknown>
}

export interface EchoContentGraphEdge {
  schemaVersion?: string
  id?: string
  kind: string
  from: string
  to: string
  moduleId?: string
  optional?: boolean
  data?: Record<string, unknown>
}

export interface EchoContentGraphUnresolvedReference {
  id: string
  context?: string
  required?: boolean
  moduleId?: string
}

export interface EchoExportPlanNode {
  nodeId: string
  status: 'direct' | 'adapter_required' | 'fallback' | 'blocked' | 'not_applicable' | string
  rationale?: string
  mappedTo?: string
}

export interface EchoExportPlan {
  schemaVersion?: string
  target: string
  sourceGraphId?: string
  plannedAt?: string
  nodes: EchoExportPlanNode[]
  summary?: Record<string, number>
}

export interface EchoFeatureListFeature {
  id: string
  title?: string
  description?: string
  nodes?: string[]
  runtimes?: Record<string, string>
  tags?: string[]
}

export interface EchoFeatureList {
  schemaVersion?: string
  moduleId?: string
  generatedAt?: string
  features: EchoFeatureListFeature[]
}

export interface EchoContentGraph {
  schemaVersion?: string
  id?: string
  moduleId?: string
  generatedAt?: string
  modules?: string[]
  provenance?: EchoContentGraphProvenance
  nodes: EchoContentGraphNode[]
  edges: EchoContentGraphEdge[]
  unresolvedReferences?: EchoContentGraphUnresolvedReference[]
  exportPlans?: Record<string, EchoExportPlan>
  features?: EchoFeatureList
}

export interface EchoContentGraphEvidenceModule {
  moduleId: string
  version?: string
  graphPath?: string
  schemaVersion?: string
  nodeCount: number
  edgeCount: number
  featureCount: number
  exportPlanCount: number
  unresolvedReferenceCount?: number
  hytaleBlockerCount: number
  validationState: 'valid' | 'warning' | 'invalid' | 'missing' | string
  hytaleBlockers?: string[]
  validationIssues?: string[]
}

export interface EchoContentGraphEvidence {
  schemaVersion: 'echo.content_graph.evidence.v1' | string
  generatedAt: string
  source: string
  graphCount: number
  moduleCount: number
  nodeCount: number
  edgeCount: number
  featureCount: number
  exportPlanCount: number
  unresolvedReferenceCount?: number
  hytaleBlockerCount: number
  validationState?: 'valid' | 'warning' | 'invalid' | 'missing' | string
  hytaleSummary?: Record<string, number>
  modules?: EchoContentGraphEvidenceModule[]
  diagnostics?: Array<{ severity: string; code?: string; message: string; path?: string }>
}

export interface ContentGraphSummary {
  moduleId: string
  moduleName?: string
  source?: 'release-evidence' | 'content-graph-sidecar'
  evidenceSchemaVersion?: string
  nodeCount: number
  edgeCount: number
  featureCount: number
  exportPlanCount: number
  nodeKinds: Record<string, number>
  edgeKinds: Record<string, number>
  hytaleBlockers: string[]
  hytaleBlockerCount?: number
  unresolvedReferences: number
  validationState?: string
}
