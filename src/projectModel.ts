import {
  CONTENT_FOLDER,
  type AddonManifest,
  type ContentMap,
  type ContentType,
  type CreateAddonOptions,
  buildManifest,
  buildProjectFiles,
  emptyContent,
  idToFileName,
  runValidationCheck
} from '@echo/shared'
import type { EchoFilePatch, EchoMobileProject, ProjectContent, SyncConflict } from './mobileTypes'

export const CONTENT_TYPES: ContentType[] = [
  'mission',
  'recipe',
  'item',
  'loot',
  'dialogue',
  'holomap',
  'index',
  'screen'
]

export const REMOTE_BUILD_WORKFLOW_PATH = '.github/workflows/echo-remote-build.yml'

export const REMOTE_BUILD_WORKFLOW = `name: ECHO Remote Build

on:
  workflow_dispatch:
    inputs:
      task:
        description: "Task to run"
        required: true
        default: "build"
        type: choice
        options:
          - build
          - test
          - validate
          - package
          - preview
      project_id:
        description: "ECHO project id"
        required: true
      manifest_path:
        description: "Path to echo.mod.json"
        required: true
        default: "echo.mod.json"

jobs:
  echo:
    name: ECHO \${{ inputs.task }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Validate manifest
        shell: bash
        run: |
          node <<'NODE'
          const fs = require('fs')
          const path = process.env.MANIFEST_PATH || 'echo.mod.json'
          const manifest = JSON.parse(fs.readFileSync(path, 'utf8'))
          const required = ['schemaVersion', 'id', 'name', 'version', 'publisher', 'target', 'runtime', 'dependencies']
          const missing = required.filter((key) => manifest[key] === undefined)
          if (missing.length) throw new Error('Missing manifest fields: ' + missing.join(', '))
          if (!Array.isArray(manifest.runtime?.supports) || manifest.runtime.supports.length === 0) {
            throw new Error('runtime.supports must contain at least one runtime.')
          }
          if (!Array.isArray(manifest.target?.experiences) || manifest.target.experiences.length === 0) {
            throw new Error('target.experiences must contain at least one target.')
          }
          console.log(JSON.stringify({
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            task: process.env.ECHO_TASK
          }, null, 2))
          NODE
        env:
          ECHO_TASK: \${{ inputs.task }}
          MANIFEST_PATH: \${{ inputs.manifest_path }}
      - name: Test JSON content
        if: inputs.task == 'test' || inputs.task == 'validate' || inputs.task == 'build' || inputs.task == 'package'
        shell: bash
        run: |
          node <<'NODE'
          const fs = require('fs')
          const roots = ['missions', 'recipes', 'items', 'loot_tables', 'dialogue', 'holomap', 'index', 'screens']
          let checked = 0
          for (const root of roots) {
            if (!fs.existsSync(root)) continue
            for (const file of fs.readdirSync(root)) {
              if (!file.endsWith('.json')) continue
              JSON.parse(fs.readFileSync(root + '/' + file, 'utf8'))
              checked++
            }
          }
          console.log('Checked ' + checked + ' JSON content file(s).')
          NODE
      - name: Package project
        if: inputs.task == 'build' || inputs.task == 'package' || inputs.task == 'preview'
        shell: bash
        run: |
          mkdir -p dist
          tar -czf "dist/\${{ inputs.project_id }}-\${{ github.run_number }}.tgz" echo.mod.json README.md CHANGELOG.md LICENSE missions recipes items loot_tables dialogue holomap index screens 2>/dev/null || true
      - uses: actions/upload-artifact@v4
        if: inputs.task == 'build' || inputs.task == 'package' || inputs.task == 'preview'
        with:
          name: echo-\${{ inputs.task }}-\${{ github.run_number }}
          path: dist
          if-no-files-found: warn
`

export function emptyContentBuckets(): ProjectContent {
  return {
    mission: [],
    recipe: [],
    item: [],
    loot: [],
    dialogue: [],
    holomap: [],
    index: [],
    screen: []
  }
}

function pathForContent(type: ContentType, id: string): string {
  return `${CONTENT_FOLDER[type]}/${idToFileName(id)}`
}

function inferContentType(path: string): ContentType | null {
  const normalized = path.replace(/\\/g, '/')
  return CONTENT_TYPES.find((type) => normalized.startsWith(`${CONTENT_FOLDER[type]}/`) && normalized.endsWith('.json')) ?? null
}

export function parseContentFromFiles(files: Record<string, string>): ProjectContent {
  const content = emptyContentBuckets()
  for (const [path, raw] of Object.entries(files)) {
    const type = inferContentType(path)
    if (!type || !raw.trim()) continue
    try {
      const parsed = JSON.parse(raw) as ContentMap[typeof type]
      if (parsed && typeof parsed === 'object' && 'id' in parsed) {
        ;(content[type] as Array<ContentMap[typeof type]>).push(parsed)
      }
    } catch {
      // Invalid project files stay in the file map and are surfaced through validation/manual review later.
    }
  }
  return content
}

export function filesFromContent(project: EchoMobileProject): Record<string, string> {
  const files: Record<string, string> = { ...project.files, 'echo.mod.json': JSON.stringify(project.manifest, null, 2) }
  for (const type of CONTENT_TYPES) {
    for (const item of project.content[type] as Array<{ id: string }>) {
      files[pathForContent(type, item.id)] = JSON.stringify(item, null, 2)
    }
  }
  return files
}

export function createMobileProject(
  options: CreateAddonOptions,
  extraFiles: Record<string, string> = {}
): EchoMobileProject {
  const manifest = buildManifest(options)
  const files = { ...buildProjectFiles(options, manifest), ...extraFiles }
  const now = Date.now()
  const project: EchoMobileProject = {
    id: `${options.namespace}:${options.addonId}:${now}`,
    localName: options.name,
    manifest,
    content: parseContentFromFiles(files),
    files,
    dirty: true,
    conflictCount: 0,
    lastValidation: runValidationCheck(manifest),
    createdAt: now,
    updatedAt: now
  }
  return project
}

export function updateProjectManifest(project: EchoMobileProject, manifest: AddonManifest): EchoMobileProject {
  const next = {
    ...project,
    manifest,
    files: { ...project.files, 'echo.mod.json': JSON.stringify(manifest, null, 2) },
    dirty: true,
    lastValidation: runValidationCheck(manifest),
    updatedAt: Date.now()
  }
  return { ...next, files: filesFromContent(next) }
}

export function upsertContent<T extends ContentType>(
  project: EchoMobileProject,
  type: T,
  item: ContentMap[T]
): EchoMobileProject {
  const items = project.content[type] as ContentMap[T][]
  const nextItems = items.some((entry) => entry.id === item.id)
    ? items.map((entry) => (entry.id === item.id ? item : entry))
    : [...items, item]
  const next = {
    ...project,
    content: { ...project.content, [type]: nextItems },
    dirty: true,
    updatedAt: Date.now()
  }
  return { ...next, files: filesFromContent(next) }
}

export function deleteContent(project: EchoMobileProject, type: ContentType, id: string): EchoMobileProject {
  const nextContent = {
    ...project.content,
    [type]: (project.content[type] as Array<{ id: string }>).filter((item) => item.id !== id)
  }
  const nextFiles = { ...project.files }
  delete nextFiles[pathForContent(type, id)]
  const next = {
    ...project,
    content: nextContent,
    files: nextFiles,
    dirty: true,
    updatedAt: Date.now()
  }
  return { ...next, files: filesFromContent(next) }
}

export function newContentRecord<T extends ContentType>(type: T, namespace: string): ContentMap[T] {
  return emptyContent(type, namespace)
}

export function applyFilePatches(project: EchoMobileProject, patches: EchoFilePatch[]): EchoMobileProject {
  const files = { ...project.files }
  for (const patch of patches) files[patch.path] = patch.content
  const manifest = files['echo.mod.json'] ? (JSON.parse(files['echo.mod.json']) as AddonManifest) : project.manifest
  const next = {
    ...project,
    manifest,
    files,
    content: parseContentFromFiles(files),
    dirty: true,
    lastValidation: runValidationCheck(manifest),
    updatedAt: Date.now()
  }
  return { ...next, files: filesFromContent(next) }
}

function parseManifestOrFallback(files: Record<string, string>, fallback: AddonManifest): AddonManifest {
  try {
    return files['echo.mod.json'] ? (JSON.parse(files['echo.mod.json']) as AddonManifest) : fallback
  } catch {
    return fallback
  }
}

export function detectSyncConflicts(project: EchoMobileProject, remoteFiles: Record<string, string>): SyncConflict[] {
  if (!project.dirty) return []
  const localFiles = filesFromContent(project)
  const paths = new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)])
  const detectedAt = Date.now()
  return [...paths]
    .filter((path) => localFiles[path] !== undefined && remoteFiles[path] !== undefined && localFiles[path] !== remoteFiles[path])
    .map((path) => ({
      id: path,
      path,
      localContent: localFiles[path],
      remoteContent: remoteFiles[path],
      detectedAt
    }))
}

export function mergePulledFiles(project: EchoMobileProject, remoteFiles: Record<string, string>, conflicts: SyncConflict[]): EchoMobileProject {
  const files = { ...remoteFiles }
  for (const conflict of conflicts) files[conflict.path] = conflict.localContent
  const manifest = parseManifestOrFallback(files, project.manifest)
  return {
    ...project,
    files,
    manifest,
    content: parseContentFromFiles(files),
    dirty: conflicts.length > 0,
    conflicts,
    conflictCount: conflicts.length,
    lastValidation: runValidationCheck(manifest),
    lastSyncAt: Date.now(),
    updatedAt: Date.now()
  }
}

export function resolveSyncConflict(
  project: EchoMobileProject,
  conflictId: string,
  strategy: 'local' | 'remote'
): EchoMobileProject {
  const conflict = project.conflicts?.find((item) => item.id === conflictId)
  if (!conflict) return project
  const remaining = (project.conflicts ?? []).filter((item) => item.id !== conflictId)
  const files = { ...project.files, [conflict.path]: strategy === 'remote' ? conflict.remoteContent : conflict.localContent }
  const manifest = parseManifestOrFallback(files, project.manifest)
  return {
    ...project,
    files,
    manifest,
    content: parseContentFromFiles(files),
    conflicts: remaining,
    conflictCount: remaining.length,
    dirty: remaining.length > 0 || strategy === 'local',
    lastValidation: runValidationCheck(manifest),
    updatedAt: Date.now()
  }
}

export function resolveAllSyncConflicts(project: EchoMobileProject, strategy: 'local' | 'remote'): EchoMobileProject {
  return (project.conflicts ?? []).reduce(
    (current, conflict) => resolveSyncConflict(current, conflict.id, strategy),
    project
  )
}

export function installRemoteBuildWorkflow(project: EchoMobileProject): EchoMobileProject {
  return applyFilePatches(project, [{ path: REMOTE_BUILD_WORKFLOW_PATH, content: REMOTE_BUILD_WORKFLOW }])
}
