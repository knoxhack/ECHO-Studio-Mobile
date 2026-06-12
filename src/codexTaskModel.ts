import {
  addRequiredModuleClosureToManifest,
  autoFixManifest,
  buildUnifiedTextDiff,
  jsonDocument,
  runValidationCheck,
  validationSnapshot,
  resolveProjectModulePlan,
  type CodexTask,
  type CodexTaskKind
} from '@echo/shared'
import { REMOTE_BUILD_WORKFLOW, REMOTE_BUILD_WORKFLOW_PATH, filesFromContent } from './projectModel'
import type { EchoFilePatch, EchoMobileProject } from './mobileTypes'

function manifestTask(
  project: EchoMobileProject,
  id: string,
  title: string,
  kind: CodexTaskKind,
  reason: string,
  nextManifest: EchoMobileProject['manifest']
): CodexTask | null {
  const before = jsonDocument(project.manifest)
  const after = jsonDocument(nextManifest)
  if (before === after) return null
  const beforeReport = runValidationCheck(project.manifest)
  const afterReport = runValidationCheck(nextManifest)
  return {
    id,
    title,
    kind,
    lane: 'suggested',
    summary: title,
    reason,
    route: 'Content / Manifest',
    affectedFiles: ['echo.mod.json'],
    fileChanges: [{
      path: 'echo.mod.json',
      before,
      after,
      diff: buildUnifiedTextDiff('echo.mod.json', before, after)
    }],
    canApply: true,
    applyLabel: 'Apply',
    rejectable: true,
    validationBefore: validationSnapshot(beforeReport),
    validationAfter: validationSnapshot(afterReport)
  }
}

function fileTask(
  id: string,
  title: string,
  kind: CodexTaskKind,
  reason: string,
  path: string,
  before: string,
  after: string,
  route: string
): CodexTask | null {
  if (before === after) return null
  return {
    id,
    title,
    kind,
    lane: 'suggested',
    summary: title,
    reason,
    route,
    affectedFiles: [path],
    fileChanges: [{
      path,
      before,
      after,
      diff: buildUnifiedTextDiff(path, before, after)
    }],
    canApply: true,
    applyLabel: 'Apply',
    rejectable: true
  }
}

function namespacedKey(id: string): string {
  return id.replace(':', '.')
}

function localizationTask(project: EchoMobileProject): CodexTask | null {
  const files = filesFromContent(project)
  const before = files['lang/en_us.json'] ?? '{}'
  let existing: Record<string, string> = {}
  try {
    existing = JSON.parse(before) as Record<string, string>
  } catch {
    existing = {}
  }
  const next = {
    ...existing,
    [`addon.${namespacedKey(project.manifest.id)}.name`]: project.manifest.name,
    [`addon.${namespacedKey(project.manifest.id)}.description`]: project.manifest.description
  }
  for (const mission of project.content.mission) next[`mission.${namespacedKey(mission.id)}.title`] = mission.title
  for (const item of project.content.item) next[`item.${namespacedKey(item.id)}.name`] = item.name
  return fileTask(
    'localization:en_us',
    'Fill English localization keys',
    'localization_fix',
    'Catalog and in-game surfaces need stable display keys.',
    'lang/en_us.json',
    before,
    jsonDocument(next),
    'Content / Editors'
  )
}

function missionCrossLinkTask(project: EchoMobileProject): CodexTask | null {
  const mission = project.content.mission.find((item) => !item.indexEntry || !item.holomapMarker)
  if (!mission) return null
  const files = filesFromContent(project)
  const missionPath = `missions/${mission.id.split(':').pop()}.json`
  const indexId = mission.indexEntry ?? `${project.manifest.namespace}:${mission.id.split(':').pop()}_index`
  const markerId = mission.holomapMarker ?? `${project.manifest.namespace}:${mission.id.split(':').pop()}_marker`
  const nextMission = { ...mission, indexEntry: indexId, holomapMarker: markerId }
  const changes = [{
    path: missionPath,
    before: files[missionPath] ?? jsonDocument(mission),
    after: jsonDocument(nextMission)
  }]
  if (!project.content.index.some((item) => item.id === indexId)) {
    changes.push({
      path: `index/${indexId.split(':').pop()}.json`,
      before: '',
      after: jsonDocument({
        id: indexId,
        title: mission.title,
        type: 'mission',
        category: project.manifest.name,
        description: mission.description ?? project.manifest.description,
        relatedMissions: [mission.id],
        relatedMarkers: [markerId],
        tags: project.manifest.tags ?? ['echo', 'addon']
      })
    })
  }
  if (!project.content.holomap.some((layer) => layer.markers.some((marker) => marker.id === markerId))) {
    const layerId = `${project.manifest.namespace}:mobile_layer`
    changes.push({
      path: `holomap/${layerId.split(':').pop()}.json`,
      before: files[`holomap/${layerId.split(':').pop()}.json`] ?? '',
      after: jsonDocument({
        id: layerId,
        title: `${project.manifest.name} Map`,
        type: 'points_of_interest',
        markers: [{
          id: markerId,
          title: mission.title,
          description: mission.description ?? '',
          icon: 'marker',
          x: 0,
          z: 0,
          linkedMission: mission.id,
          linkedIndex: indexId,
          visibleByDefault: true
        }]
      })
    })
  }
  return {
    id: `mission-crosslink:${mission.id}`,
    title: `Connect ${mission.title}`,
    kind: 'index_entry_fix',
    lane: 'suggested',
    summary: 'Create Index and HoloMap links for a mission.',
    reason: 'Missions are easier to discover when they are linked into Index and HoloMap content.',
    route: 'Content / Editors',
    affectedFiles: changes.map((change) => change.path),
    fileChanges: changes.map((change) => ({ ...change, diff: buildUnifiedTextDiff(change.path, change.before, change.after) })),
    canApply: true,
    applyLabel: 'Apply Links',
    rejectable: true
  }
}

export function generateMobileCodexTasks(project: EchoMobileProject): CodexTask[] {
  const tasks: Array<CodexTask | null> = []
  tasks.push(manifestTask(
    project,
    'manifest:auto-fix',
    'Apply manifest auto-fixes',
    'manifest_fix',
    'Validation can fix catalog tags, runtime defaults, permissions, and missing dependency closure.',
    autoFixManifest(project.manifest)
  ))
  const missing = resolveProjectModulePlan(project.manifest).missingRequired
  if (missing.length > 0) {
    tasks.push(manifestTask(
      project,
      'modules:closure',
      'Add missing module closure',
      'module_closure',
      `${missing.length} required module(s) are missing from the manifest.`,
      addRequiredModuleClosureToManifest(project.manifest, missing)
    ))
  }
  const supportUrl = project.github
    ? `https://github.com/${project.github.owner}/${project.github.repo}/issues`
    : project.manifest.support.issues
  if (!project.manifest.support.issues && supportUrl) {
    tasks.push(manifestTask(
      project,
      'manifest:support-url',
      'Add support link',
      'manifest_fix',
      'Published addons should include a support/issues URL.',
      { ...project.manifest, support: { ...project.manifest.support, issues: supportUrl } }
    ))
  }
  const files = filesFromContent(project)
  tasks.push(fileTask(
    'workflow:remote-build',
    'Install remote build workflow',
    'dev_workspace_setup',
    'GitHub Actions needs a workflow before mobile can queue and monitor builds.',
    REMOTE_BUILD_WORKFLOW_PATH,
    files[REMOTE_BUILD_WORKFLOW_PATH] ?? '',
    REMOTE_BUILD_WORKFLOW,
    'Build'
  ))
  tasks.push(localizationTask(project))
  tasks.push(missionCrossLinkTask(project))
  return tasks.filter(Boolean) as CodexTask[]
}

export function patchesFromCodexTask(task: CodexTask): EchoFilePatch[] {
  return task.fileChanges
    .filter((change) => change.after !== undefined)
    .map((change) => ({ path: change.path, content: change.after ?? '' }))
}
