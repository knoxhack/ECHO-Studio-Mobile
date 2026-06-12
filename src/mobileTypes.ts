import type { AddonManifest, ContentMap, ContentType, ValidationReport } from '@echo/shared'

export type ProjectContent = {
  [K in ContentType]: ContentMap[K][]
}

export interface GitHubTarget {
  owner: string
  repo: string
  branch: string
}

export interface RemoteBuildState {
  task: 'build' | 'test' | 'validate' | 'package' | 'preview'
  status: 'idle' | 'queued' | 'in_progress' | 'completed' | 'failed'
  runId?: number
  url?: string
  conclusion?: string
  updatedAt?: number
  log?: string
  artifacts?: BuildArtifactSummary[]
  testSummary?: BuildTestSummary
}

export interface ReleaseDraftState {
  tag: string
  name: string
  url?: string
  createdAt: number
  releaseIndexEntry: string
}

export interface EchoMobileProject {
  id: string
  localName: string
  manifest: AddonManifest
  content: ProjectContent
  files: Record<string, string>
  github?: GitHubTarget
  dirty: boolean
  conflictCount: number
  conflicts?: SyncConflict[]
  lastSyncAt?: number
  lastCatalogSyncAt?: number
  lastBuild?: RemoteBuildState
  lastValidation?: ValidationReport
  releaseDraft?: ReleaseDraftState
  createdAt: number
  updatedAt: number
}

export interface MobileSettings {
  githubToken: string
  githubClientId: string
  openAiApiKey: string
  openAiBaseUrl: string
  openAiModel: string
  releaseIndexOwner: string
  releaseIndexRepo: string
  defaultBranch: string
  notificationsEnabled: boolean
  onboardingComplete: boolean
}

export interface EchoFilePatch {
  path: string
  content: string
}

export interface AiChatResult {
  text: string
  files: EchoFilePatch[]
  usedModel: boolean
}

export interface SyncResult {
  message: string
  url?: string
  changedFiles: string[]
}

export interface SyncConflict {
  id: string
  path: string
  localContent: string
  remoteContent: string
  detectedAt: number
}

export interface BuildRunSummary {
  id: number
  status: string
  conclusion?: string
  url?: string
  createdAt?: string
  updatedAt?: string
  logsUrl?: string
}

export interface BuildArtifactSummary {
  id: number
  name: string
  sizeInBytes?: number
  url?: string
  expired?: boolean
}

export interface BuildTestSummary {
  suites: number
  tests: number
  failures: number
  skipped: number
}

export interface ReleaseIndexCatalogEntry {
  id: string
  name: string
  version?: string
  channel?: string
  description?: string
  source?: string
  path: string
  validation?: {
    publishingReady?: boolean
    blockers?: number
    errors?: number
  }
}

export interface GitHubDeviceCodeState {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}
