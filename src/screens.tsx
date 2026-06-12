import { useMemo, useState } from 'react'
import { Linking, View } from 'react-native'
import {
  ActivityIndicator,
  Button,
  Chip,
  Dialog,
  FAB,
  IconButton,
  List,
  Portal,
  SegmentedButtons,
  Switch,
  Text,
  TextInput
} from 'react-native-paper'
import {
  ADDON_TYPE_LABELS,
  ALLOWED_PERMISSIONS,
  BLOCKED_PERMISSIONS,
  CONTENT_LABEL,
  ECHO_MODULE_CATALOG,
  RUNTIME_LABELS,
  TARGET_LABELS,
  TEMPLATES,
  addModuleToManifest,
  autoFixManifest,
  buildAddonPackageManifest,
  buildManifest,
  buildUnifiedTextDiff,
  createOptionsFromTemplate,
  modulesForCapability,
  resolveProjectModulePlan,
  runValidationCheck,
  templatesByCategory,
  type AddonManifest,
  type AddonType,
  type CodexTaskLane,
  type ContentMap,
  type ContentType,
  type CreateAddonOptions,
  type DeveloperRole,
  type Runtime,
  type TargetExperience,
  type TrustLevel,
  type TemplateDef
} from '@echo/shared'
import { generateMobileCodexTasks, patchesFromCodexTask } from './codexTaskModel'
import { runMobileAiChat } from './ai'
import {
  buildReleaseIndexEntry,
  createReleaseIndexPullRequest,
  createGitHubReleaseDraft,
  fetchReleaseIndexCatalog,
  fetchWorkflowRunLogText,
  listWorkflowArtifacts,
  listRemoteBuildRuns,
  parseJUnitSummary,
  pollGitHubDeviceLogin,
  pullProjectFilesFromGitHub,
  pushProjectToGitHub,
  pushProjectBranchAndCreatePullRequest,
  startGitHubDeviceLogin,
  triggerRemoteBuild
} from './github'
import {
  CONTENT_TYPES,
  applyFilePatches,
  createMobileProject,
  deleteContent,
  detectSyncConflicts,
  installRemoteBuildWorkflow,
  mergePulledFiles,
  newContentRecord,
  resolveAllSyncConflicts,
  resolveSyncConflict,
  updateProjectManifest,
  upsertContent
} from './projectModel'
import { ensureNotificationPermissions, notifyStudio } from './notifications'
import { useActiveProject, useStudioStore } from './storage'
import {
  ActionRow,
  EmptyState,
  Field,
  Hairline,
  Metric,
  PillRow,
  ProjectStrip,
  RecordCard,
  ScreenFrame,
  Section,
  styles
} from './components'
import type {
  AiChatResult,
  BuildArtifactSummary,
  BuildRunSummary,
  EchoFilePatch,
  EchoMobileProject,
  GitHubDeviceCodeState,
  MobileSettings,
  ReleaseIndexCatalogEntry
} from './mobileTypes'

const TYPE_ITEMS = Object.entries(ADDON_TYPE_LABELS).map(([key, label]) => ({ key, label }))
const TARGET_ITEMS = Object.entries(TARGET_LABELS).map(([key, label]) => ({ key, label }))
const RUNTIME_ITEMS = Object.entries(RUNTIME_LABELS).map(([key, label]) => ({ key, label }))
const DEVELOPER_ROLE_ITEMS: Array<{ key: DeveloperRole; label: string }> = [
  { key: 'addon_developer', label: 'Addon Dev' },
  { key: 'verified_addon_developer', label: 'Verified' },
  { key: 'pack_maker', label: 'Pack Maker' },
  { key: 'server_owner', label: 'Server Owner' },
  { key: 'tester', label: 'Tester' }
]
const TRUST_ITEMS: Array<{ key: TrustLevel; label: string }> = [
  { key: 'community', label: 'Community' },
  { key: 'verified', label: 'Verified' },
  { key: 'featured', label: 'Featured' },
  { key: 'local', label: 'Local' },
  { key: 'blocked', label: 'Blocked' }
]
const NATIVE_READY_ITEMS = [
  { key: 'none', label: 'None' },
  { key: 'partial', label: 'Partial' },
  { key: 'full', label: 'Full' }
]
const SETTINGS_HINT = 'Set a GitHub token and repo target first.'

function csv(values?: string[]): string {
  return (values ?? []).join(', ')
}

function fromCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function openUrl(url?: string) {
  if (url) void Linking.openURL(url)
}

function activeOrEmpty(project: EchoMobileProject | null) {
  if (!project) {
    return <EmptyState title="Create or select a project" body="The mobile workflow starts from a local project." />
  }
  return null
}

function saveAndToast(project: EchoMobileProject, message: string) {
  const saveProject = useStudioStore.getState().saveProject
  const setToast = useStudioStore.getState().setToast
  saveProject(project)
  setToast(message)
}

export function HomeScreen({ navigation }: { navigation: { navigate: (screen: string) => void } }) {
  const projects = useStudioStore((state) => state.projects)
  const activeProjectId = useStudioStore((state) => state.activeProjectId)
  const setActiveProject = useStudioStore((state) => state.setActiveProject)
  const removeProject = useStudioStore((state) => state.removeProject)
  const settings = useStudioStore((state) => state.settings)
  const saveSettings = useStudioStore((state) => state.saveSettings)

  const active = projects.find((project) => project.id === activeProjectId) ?? null
  const totals = projects.reduce(
    (acc, project) => {
      const report = project.lastValidation ?? runValidationCheck(project.manifest)
      acc.blockers += report.counts.BLOCKER
      acc.errors += report.counts.ERROR
      acc.dirty += project.dirty ? 1 : 0
      return acc
    },
    { blockers: 0, errors: 0, dirty: 0 }
  )

  return (
    <ScreenFrame
      title="ECHO Studio Mobile"
      subtitle="Field authoring for addons, modules, content, builds, and releases."
      actions={<Button mode="contained" icon="plus" onPress={() => navigation.navigate('Create')}>New</Button>}
    >
      <ProjectStrip project={active} />
      <View style={styles.rowWrap}>
        <Metric label="Projects" value={projects.length} tone="neutral" />
        <Metric label="Dirty" value={totals.dirty} tone={totals.dirty ? 'warn' : 'good'} />
        <Metric label="Blockers" value={totals.blockers} tone={totals.blockers ? 'bad' : 'good'} />
        <Metric label="Errors" value={totals.errors} tone={totals.errors ? 'warn' : 'good'} />
      </View>
      {!settings.onboardingComplete ? (
        <Section title="Start">
          <View style={styles.rowWrap}>
            {['Create', 'Author', 'Sync', 'Build', 'Release'].map((item) => <Chip key={item}>{item}</Chip>)}
          </View>
          <ActionRow>
            <Button mode="contained" icon="plus" onPress={() => navigation.navigate('Create')}>Create Project</Button>
            <Button mode="outlined" icon="cog-outline" onPress={() => navigation.navigate('Settings')}>Settings</Button>
            <Button
              mode="outlined"
              icon="check"
              onPress={() => void saveSettings({ ...settings, onboardingComplete: true })}
            >
              Done
            </Button>
          </ActionRow>
        </Section>
      ) : null}
      <Section title="Projects">
        {projects.length === 0 ? (
          <EmptyState title="No local projects yet" actionLabel="Create Project" onAction={() => navigation.navigate('Create')} />
        ) : (
          projects.map((project) => {
            const report = project.lastValidation ?? runValidationCheck(project.manifest)
            return (
              <RecordCard
                key={project.id}
                title={project.manifest.name}
                subtitle={`${project.manifest.id} / ${Object.values(project.content).flat().length} content records`}
                selected={project.id === activeProjectId}
                onPress={() => setActiveProject(project.id)}
                onDelete={() => removeProject(project.id)}
                right={
                  <View style={styles.rowWrap}>
                    <Chip compact>{report.compatibilityScore}%</Chip>
                    <Chip compact>{project.dirty ? 'dirty' : 'clean'}</Chip>
                  </View>
                }
              />
            )
          })
        )}
      </Section>
      <ActionRow>
        <Button mode="outlined" icon="text-box-edit-outline" disabled={!active} onPress={() => navigation.navigate('Content')}>Author</Button>
        <Button mode="outlined" icon="cloud-upload-outline" disabled={!active} onPress={() => navigation.navigate('Build')}>Build</Button>
        <Button mode="outlined" icon="creation-outline" onPress={() => navigation.navigate('AI')}>AI</Button>
      </ActionRow>
    </ScreenFrame>
  )
}

function defaultCreateState() {
  return {
    type: 'mission_pack' as AddonType,
    target: 'ashfall' as TargetExperience,
    namespace: 'teamnova',
    addonId: 'field_route',
    name: 'Field Route',
    description: 'A mobile-authored ECHO project.',
    runtimes: ['neoforge', 'echo_native'] as Runtime[],
    includeExample: true,
    includeHoloMap: true,
    includeIndex: true,
    includeRewards: true,
    includeLocalization: true,
    includePreviewProfile: true
  }
}

function optionsFromState(state: ReturnType<typeof defaultCreateState>): CreateAddonOptions {
  return {
    workspaceDir: 'mobile',
    type: state.type,
    target: state.target,
    namespace: state.namespace.trim() || 'teamnova',
    addonId: state.addonId.trim() || 'field_route',
    name: state.name.trim() || 'Field Route',
    description: state.description.trim(),
    runtimes: state.runtimes.length > 0 ? state.runtimes : ['neoforge'],
    options: {
      includeExample: state.includeExample,
      includeHoloMap: state.includeHoloMap,
      includeIndex: state.includeIndex,
      includeRewards: state.includeRewards,
      includeLocalization: state.includeLocalization,
      includePreviewProfile: state.includePreviewProfile
    }
  }
}

export function CreateScreen({ navigation }: { navigation: { navigate: (screen: string) => void } }) {
  const saveProject = useStudioStore((state) => state.saveProject)
  const setActiveProject = useStudioStore((state) => state.setActiveProject)
  const setToast = useStudioStore((state) => state.setToast)
  const [mode, setMode] = useState('wizard')
  const [step, setStep] = useState('type')
  const [draft, setDraft] = useState(defaultCreateState())
  const [template, setTemplate] = useState<TemplateDef | null>(null)
  const [templateIdentity, setTemplateIdentity] = useState({ namespace: 'teamnova', addonId: 'template_route', name: 'Template Route' })

  const manifestPreview = useMemo(() => buildManifest(optionsFromState(draft)), [draft])
  const modulePlan = useMemo(() => resolveProjectModulePlan(manifestPreview), [manifestPreview])
  const steps = ['type', 'target', 'identity', 'runtime', 'modules', 'options', 'generate']
  const stepIndex = steps.indexOf(step)

  const update = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }))
  const toggleRuntime = (runtime: Runtime) => {
    update({
      runtimes: draft.runtimes.includes(runtime)
        ? draft.runtimes.filter((item) => item !== runtime)
        : [...draft.runtimes, runtime]
    })
  }
  const generate = (options: CreateAddonOptions, extraFiles: Record<string, string> = {}) => {
    const project = createMobileProject(options, extraFiles)
    saveProject(project)
    setActiveProject(project.id)
    setToast(`Created ${project.manifest.name}`)
    navigation.navigate('Content')
  }

  return (
    <ScreenFrame
      title="Create"
      subtitle="Wizard and template flows share the desktop ECHO Studio contracts."
      actions={
        <SegmentedButtons
          value={mode}
          onValueChange={setMode}
          buttons={[
            { value: 'wizard', label: 'Wizard', icon: 'auto-fix' },
            { value: 'templates', label: 'Templates', icon: 'view-grid-plus-outline' }
          ]}
        />
      }
    >
      {mode === 'wizard' ? (
        <>
          <ProjectStrip project={null} compact />
          <View style={styles.rowWrap}>
            {steps.map((item) => (
              <Chip key={item} selected={item === step} onPress={() => setStep(item)}>{steps.indexOf(item) + 1}. {item}</Chip>
            ))}
          </View>
          {step === 'type' ? (
            <PillRow items={TYPE_ITEMS} selected={[draft.type]} onToggle={(key) => update({ type: key as AddonType })} />
          ) : null}
          {step === 'target' ? (
            <PillRow items={TARGET_ITEMS} selected={[draft.target]} onToggle={(key) => update({ target: key as TargetExperience })} />
          ) : null}
          {step === 'identity' ? (
            <Section title="Identity">
              <Field label="Namespace" value={draft.namespace} onChangeText={(namespace) => update({ namespace })} />
              <Field label="Addon ID" value={draft.addonId} onChangeText={(addonId) => update({ addonId })} />
              <Field label="Name" value={draft.name} onChangeText={(name) => update({ name })} />
              <Field label="Description" value={draft.description} onChangeText={(description) => update({ description })} multiline />
            </Section>
          ) : null}
          {step === 'runtime' ? (
            <PillRow items={RUNTIME_ITEMS} selected={draft.runtimes} onToggle={(key) => toggleRuntime(key as Runtime)} multi />
          ) : null}
          {step === 'modules' ? (
            <Section title="Module Plan">
              <View style={styles.rowWrap}>
                <Metric label="Target" value={modulePlan.targetModules.length} />
                <Metric label="Required" value={modulePlan.requiredModules.length} />
                <Metric label="Closure" value={modulePlan.closure.length} />
                <Metric label="Unknown" value={modulePlan.unknown.length} tone={modulePlan.unknown.length ? 'warn' : 'good'} />
              </View>
              {modulePlan.closure.map((module) => (
                <RecordCard key={module.id} title={module.name} subtitle={`${module.role} / ${module.status}`} right={<Chip compact>{module.channel}</Chip>} />
              ))}
            </Section>
          ) : null}
          {step === 'options' ? (
            <Section title="Scaffold">
              {([
                ['includeExample', 'Example content'],
                ['includeHoloMap', 'HoloMap'],
                ['includeIndex', 'Index'],
                ['includeRewards', 'Rewards'],
                ['includeLocalization', 'Localization'],
                ['includePreviewProfile', 'Preview profile']
              ] as const).map(([key, label]) => (
                <List.Item
                  key={key}
                  title={label}
                  right={() => <Switch value={draft[key]} onValueChange={(value) => update({ [key]: value })} />}
                />
              ))}
            </Section>
          ) : null}
          {step === 'generate' ? (
            <Section title="Ready">
              <Text>{manifestPreview.name}</Text>
              <Text style={styles.muted}>{manifestPreview.id}</Text>
              <ActionRow>
                <Button mode="contained" icon="package-variant-closed-plus" onPress={() => generate(optionsFromState(draft))}>Generate Project</Button>
              </ActionRow>
            </Section>
          ) : null}
          <ActionRow>
            <Button mode="outlined" icon="arrow-left" disabled={stepIndex === 0} onPress={() => setStep(steps[stepIndex - 1])}>Back</Button>
            <Button mode="contained" icon="arrow-right" disabled={stepIndex === steps.length - 1} onPress={() => setStep(steps[stepIndex + 1])}>Next</Button>
          </ActionRow>
        </>
      ) : (
        <Section title="Templates">
          {Object.entries(templatesByCategory()).map(([category, templates]) => (
            <View key={category}>
              <Text variant="titleSmall" style={{ marginVertical: 8 }}>{category}</Text>
              {templates.map((item) => {
                const opts = createOptionsFromTemplate(item, {
                  workspaceDir: 'mobile',
                  namespace: 'teamnova',
                  addonId: item.id,
                  name: item.name
                })
                const plan = resolveProjectModulePlan(buildManifest(opts))
                return (
                  <RecordCard
                    key={item.id}
                    title={item.name}
                    subtitle={item.description}
                    onPress={() => {
                      setTemplate(item)
                      setTemplateIdentity({ namespace: 'teamnova', addonId: item.id, name: item.name })
                    }}
                    right={<Chip compact>{plan.requiredModules.length} deps</Chip>}
                  />
                )
              })}
            </View>
          ))}
        </Section>
      )}
      <Portal>
        <Dialog visible={Boolean(template)} onDismiss={() => setTemplate(null)}>
          <Dialog.Title>{template?.name}</Dialog.Title>
          <Dialog.Content>
            <Field label="Namespace" value={templateIdentity.namespace} onChangeText={(namespace) => setTemplateIdentity((current) => ({ ...current, namespace }))} />
            <Field label="Addon ID" value={templateIdentity.addonId} onChangeText={(addonId) => setTemplateIdentity((current) => ({ ...current, addonId }))} />
            <Field label="Name" value={templateIdentity.name} onChangeText={(name) => setTemplateIdentity((current) => ({ ...current, name }))} />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setTemplate(null)}>Cancel</Button>
            <Button
              mode="contained"
              onPress={() => {
                if (!template) return
                const opts = createOptionsFromTemplate(template, { workspaceDir: 'mobile', ...templateIdentity })
                generate(opts, template.extraFiles?.(templateIdentity) ?? {})
                setTemplate(null)
              }}
            >
              Generate
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScreenFrame>
  )
}

type ContentView = 'manifest' | 'modules' | 'editors' | 'validation' | 'tasks' | 'sync' | 'catalog' | 'release' | 'settings'

export function ContentScreen() {
  const project = useActiveProject()
  const [view, setView] = useState<ContentView>('manifest')
  if (!project) {
    return (
      <ScreenFrame title="Content">
        {activeOrEmpty(project)}
      </ScreenFrame>
    )
  }
  return (
    <ScreenFrame title="Content" subtitle={project.manifest.id}>
      <ProjectStrip project={project} />
      <SegmentedButtons
        value={view}
        onValueChange={(value) => setView(value as ContentView)}
        buttons={[
          { value: 'manifest', label: 'Manifest', icon: 'file-document-edit-outline' },
          { value: 'modules', label: 'Modules', icon: 'graph-outline' },
          { value: 'editors', label: 'Editors', icon: 'pencil-box-outline' },
          { value: 'validation', label: 'Check', icon: 'shield-search' }
        ]}
      />
      <SegmentedButtons
        value={view}
        onValueChange={(value) => setView(value as ContentView)}
        buttons={[
          { value: 'tasks', label: 'Tasks', icon: 'clipboard-check-outline' },
          { value: 'sync', label: 'Sync', icon: 'source-branch-sync' },
          { value: 'catalog', label: 'Catalog', icon: 'archive-search-outline' },
          { value: 'release', label: 'Release', icon: 'tag-plus-outline' }
        ]}
      />
      <SegmentedButtons
        value={view}
        onValueChange={(value) => setView(value as ContentView)}
        buttons={[
          { value: 'settings', label: 'Settings', icon: 'cog-outline' }
        ]}
      />
      {view === 'manifest' ? <ManifestPanel project={project} /> : null}
      {view === 'modules' ? <ModulesPanel project={project} /> : null}
      {view === 'editors' ? <ContentEditorsPanel project={project} /> : null}
      {view === 'validation' ? <ValidationPanel project={project} /> : null}
      {view === 'tasks' ? <CodexTasksPanel project={project} /> : null}
      {view === 'sync' ? <SyncPanel project={project} /> : null}
      {view === 'catalog' ? <CatalogPanel project={project} /> : null}
      {view === 'release' ? <ReleasePanel project={project} /> : null}
      {view === 'settings' ? <SettingsPanel /> : null}
    </ScreenFrame>
  )
}

function ManifestPanel({ project }: { project: EchoMobileProject }) {
  const [manifest, setManifest] = useState(project.manifest)
  const [jsonMode, setJsonMode] = useState(false)
  const update = (patch: Partial<AddonManifest>) => setManifest((current) => ({ ...current, ...patch }))
  const save = () => saveAndToast(updateProjectManifest(project, manifest), 'Manifest saved')
  return (
    <Section title="Manifest">
      <ActionRow>
        <Button mode={jsonMode ? 'outlined' : 'contained'} icon="form-textbox" onPress={() => setJsonMode(false)}>Form</Button>
        <Button mode={jsonMode ? 'contained' : 'outlined'} icon="code-json" onPress={() => setJsonMode(true)}>JSON</Button>
        <Button mode="contained" icon="content-save" onPress={save}>Save</Button>
      </ActionRow>
      {jsonMode ? (
        <TextInput
          mode="outlined"
          multiline
          value={JSON.stringify(manifest, null, 2)}
          onChangeText={(text) => {
            try {
              setManifest(JSON.parse(text) as AddonManifest)
            } catch {
              // Keep editing until valid JSON.
            }
          }}
          style={{ minHeight: 360 }}
        />
      ) : (
        <>
          <Field label="Name" value={manifest.name} onChangeText={(name) => update({ name })} />
          <Field label="ID" value={manifest.id} onChangeText={(id) => update({ id })} />
          <Field label="Version" value={manifest.version} onChangeText={(version) => update({ version })} />
          <Field label="Description" value={manifest.description} onChangeText={(description) => update({ description })} multiline />
          <Field label="Namespace" value={manifest.namespace} onChangeText={(namespace) => update({ namespace })} />
          <Field label="Project Class" value={manifest.projectClass} onChangeText={(projectClass) => update({ projectClass })} />
          <Text variant="titleSmall">Developer Role</Text>
          <PillRow
            items={DEVELOPER_ROLE_ITEMS}
            selected={[manifest.developerType]}
            onToggle={(developerType) => update({ developerType: developerType as DeveloperRole })}
          />
          <Field label="Publisher" value={manifest.publisher.name} onChangeText={(name) => update({ publisher: { ...manifest.publisher, name } })} />
          <Field label="Publisher ID" value={manifest.publisher.id} onChangeText={(id) => update({ publisher: { ...manifest.publisher, id } })} />
          <Field label="Publisher Type" value={manifest.publisher.type} onChangeText={(type) => update({ publisher: { ...manifest.publisher, type } })} />
          <Field label="Publisher Website" value={manifest.publisher.website ?? ''} onChangeText={(website) => update({ publisher: { ...manifest.publisher, website } })} keyboardType="url" />
          <Field label="Publisher Support" value={manifest.publisher.support ?? ''} onChangeText={(support) => update({ publisher: { ...manifest.publisher, support } })} keyboardType="url" />
          <Text variant="titleSmall">Target Experiences</Text>
          <PillRow
            items={TARGET_ITEMS}
            selected={manifest.target.experiences}
            multi
            onToggle={(key) => {
              const target = key as TargetExperience
              update({
                target: {
                  ...manifest.target,
                  experiences: manifest.target.experiences.includes(target)
                    ? manifest.target.experiences.filter((item) => item !== target)
                    : [...manifest.target.experiences, target]
                }
              })
            }}
          />
          <Field label="Target Modules" value={csv(manifest.target.modules)} onChangeText={(modules) => update({ target: { ...manifest.target, modules: fromCsv(modules) } })} />
          <Field label="Issues URL" value={manifest.support.issues ?? ''} onChangeText={(issues) => update({ support: { ...manifest.support, issues } })} />
          <Field label="Support Tier" value={manifest.support.tier} onChangeText={(tier) => update({ support: { ...manifest.support, tier } })} />
          <Text variant="titleSmall">Runtimes</Text>
          <PillRow
            items={RUNTIME_ITEMS}
            selected={manifest.runtime.supports}
            multi
            onToggle={(key) => {
              const runtime = key as Runtime
              update({
                runtime: {
                  ...manifest.runtime,
                  supports: manifest.runtime.supports.includes(runtime)
                    ? manifest.runtime.supports.filter((item) => item !== runtime)
                    : [...manifest.runtime.supports, runtime]
                }
              })
            }}
          />
          <Text variant="titleSmall">Native Readiness</Text>
          <PillRow
            items={NATIVE_READY_ITEMS}
            selected={[manifest.runtime.nativeReadiness]}
            onToggle={(nativeReadiness) => update({ runtime: { ...manifest.runtime, nativeReadiness: nativeReadiness as AddonManifest['runtime']['nativeReadiness'] } })}
          />
          <Field label="Minimum ECHO SDK" value={manifest.runtime.minimumEchoSdk} onChangeText={(minimumEchoSdk) => update({ runtime: { ...manifest.runtime, minimumEchoSdk } })} />
          <Field label="Required Dependencies" value={csv(manifest.dependencies.required)} onChangeText={(required) => update({ dependencies: { ...manifest.dependencies, required: fromCsv(required) } })} />
          <Field label="Optional Dependencies" value={csv(manifest.dependencies.optional)} onChangeText={(optional) => update({ dependencies: { ...manifest.dependencies, optional: fromCsv(optional) } })} />
          <Text variant="titleSmall">Trust</Text>
          <PillRow
            items={TRUST_ITEMS}
            selected={[manifest.trust.level]}
            onToggle={(level) => update({ trust: { ...manifest.trust, level: level as TrustLevel } })}
          />
          <List.Item
            title="Signed"
            right={() => <Switch value={manifest.trust.signed} onValueChange={(signed) => update({ trust: { ...manifest.trust, signed } })} />}
          />
          <List.Item
            title="Verified"
            right={() => <Switch value={manifest.trust.verified} onValueChange={(verified) => update({ trust: { ...manifest.trust, verified } })} />}
          />
          <Field label="Tags" value={csv(manifest.tags)} onChangeText={(tags) => update({ tags: fromCsv(tags) })} />
          <Text variant="titleSmall">Permissions</Text>
          {[...ALLOWED_PERMISSIONS, ...Object.keys(BLOCKED_PERMISSIONS)].map((permission) => (
            <List.Item
              key={permission}
              title={permission}
              titleStyle={permission in BLOCKED_PERMISSIONS ? { color: '#ff8a8a' } : undefined}
              right={() => (
                <Switch
                  value={manifest.permissions.includes(permission)}
                  onValueChange={(enabled) => {
                    update({
                      permissions: enabled
                        ? [...manifest.permissions, permission]
                        : manifest.permissions.filter((item) => item !== permission)
                    })
                  }}
                />
              )}
            />
          ))}
        </>
      )}
    </Section>
  )
}

function ModulesPanel({ project }: { project: EchoMobileProject }) {
  const [filter, setFilter] = useState('all')
  const plan = resolveProjectModulePlan(project.manifest)
  const enabledIds = new Set(plan.enabled.map((module) => module.id))
  const visible = ECHO_MODULE_CATALOG.filter((module) => {
    if (filter === 'enabled') return enabledIds.has(module.id)
    if (filter === 'ui') return module.kind === 'ui_pack'
    if (filter === 'world') return module.kind === 'world' || module.role === 'world'
    if (filter === 'developer') return module.kind === 'developer_tool'
    return true
  })
  const add = (moduleId: string, kind: 'required' | 'optional') => {
    const module = ECHO_MODULE_CATALOG.find((item) => item.id === moduleId)
    if (!module) return
    saveAndToast(updateProjectManifest(project, addModuleToManifest(project.manifest, module, kind)), `${module.name} added`)
  }
  return (
    <Section title="Modules">
      <View style={styles.rowWrap}>
        <Metric label="Enabled" value={plan.enabled.length} />
        <Metric label="Closure" value={plan.closure.length} />
        <Metric label="Missing" value={plan.missingRequired.length} tone={plan.missingRequired.length ? 'warn' : 'good'} />
      </View>
      <ActionRow>
        {(['all', 'enabled', 'ui', 'world', 'developer'] as const).map((item) => (
          <Chip key={item} selected={filter === item} onPress={() => setFilter(item)}>{item}</Chip>
        ))}
      </ActionRow>
      <Text variant="titleSmall">Capability Finder</Text>
      <ActionRow>
        {(['missions', 'recipes', 'interface', 'map', 'knowledge', 'developer'] as const).map((capability) => (
          <Button
            key={capability}
            mode="outlined"
            onPress={() => {
              let manifest = project.manifest
              for (const module of modulesForCapability(capability)) manifest = addModuleToManifest(manifest, module, 'required')
              saveAndToast(updateProjectManifest(project, manifest), `${capability} modules added`)
            }}
          >
            {capability}
          </Button>
        ))}
      </ActionRow>
      {visible.map((module) => (
        <RecordCard
          key={module.id}
          title={module.name}
          subtitle={`${module.creatorUse} Requires: ${module.requires.join(', ') || 'none'}`}
          right={
            <ActionRow>
              <Chip compact>{enabledIds.has(module.id) ? 'enabled' : module.channel}</Chip>
              <IconButton icon="plus-circle-outline" size={22} onPress={() => add(module.id, 'required')} />
              <IconButton icon="plus-outline" size={22} onPress={() => add(module.id, 'optional')} />
            </ActionRow>
          }
        />
      ))}
    </Section>
  )
}

function parseJsonField<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function ContentEditorsPanel({ project }: { project: EchoMobileProject }) {
  const [type, setType] = useState<ContentType>('mission')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId
    ? (project.content[type] as Array<{ id: string }>).find((item) => item.id === selectedId)
    : null
  const [draftText, setDraftText] = useState('')

  const beginEdit = (item: unknown) => {
    setSelectedId((item as { id: string }).id)
    setDraftText(JSON.stringify(item, null, 2))
  }
  const beginNew = () => beginEdit(newContentRecord(type, project.manifest.namespace))
  const save = () => {
    const parsed = parseJsonField(draftText, selected ?? newContentRecord(type, project.manifest.namespace)) as ContentMap[typeof type]
    saveAndToast(upsertContent(project, type, parsed), `${CONTENT_LABEL[type]} saved`)
  }
  return (
    <Section title="Content Editors">
      <ActionRow>
        {CONTENT_TYPES.map((item) => (
          <Chip key={item} selected={type === item} onPress={() => { setType(item); setSelectedId(null); setDraftText('') }}>
            {CONTENT_LABEL[item]}
          </Chip>
        ))}
      </ActionRow>
      <ActionRow>
        <Button mode="contained" icon="plus" onPress={beginNew}>New {CONTENT_LABEL[type]}</Button>
      </ActionRow>
      {(project.content[type] as Array<{ id: string; title?: string; name?: string; description?: string }>).map((item) => (
        <RecordCard
          key={item.id}
          title={item.title ?? item.name ?? item.id}
          subtitle={item.description ?? item.id}
          selected={item.id === selectedId}
          onPress={() => beginEdit(item)}
          onDelete={() => saveAndToast(deleteContent(project, type, item.id), `${item.id} deleted`)}
        />
      ))}
      {draftText ? (
        <>
          <SpecializedEditor type={type} value={draftText} onChangeText={setDraftText} />
          <Button mode="contained" icon="content-save" onPress={save}>Save Record</Button>
        </>
      ) : null}
    </Section>
  )
}

function SpecializedEditor({ type, value, onChangeText }: { type: ContentType; value: string; onChangeText: (value: string) => void }) {
  const data = parseJsonField<Record<string, unknown>>(value, {})
  const patch = (next: Record<string, unknown>) => onChangeText(JSON.stringify({ ...data, ...next }, null, 2))
  const setNested = (key: string, next: Record<string, unknown>) => {
    const current = typeof data[key] === 'object' && data[key] ? data[key] as Record<string, unknown> : {}
    patch({ [key]: { ...current, ...next } })
  }
  return (
    <Section title={`Edit ${CONTENT_LABEL[type]}`}>
      <Field label="ID" value={String(data.id ?? '')} onChangeText={(id) => patch({ id })} />
      {type === 'mission' ? (
        <>
          <Field label="Title" value={String(data.title ?? '')} onChangeText={(title) => patch({ title })} />
          <Field label="Description" value={String(data.description ?? '')} onChangeText={(description) => patch({ description })} multiline />
          <Field label="Objective Type" value={String((data.objective as { type?: string } | undefined)?.type ?? '')} onChangeText={(typeValue) => setNested('objective', { type: typeValue })} />
          <Field label="Objective Target" value={String((data.objective as { target?: string } | undefined)?.target ?? '')} onChangeText={(target) => setNested('objective', { target })} />
          <Field label="Rewards JSON" value={JSON.stringify(data.rewards ?? [], null, 2)} onChangeText={(text) => patch({ rewards: parseJsonField(text, []) })} multiline />
        </>
      ) : null}
      {type === 'recipe' ? (
        <>
          <Field label="Recipe Type" value={String(data.type ?? '')} onChangeText={(recipeType) => patch({ type: recipeType })} />
          <Field label="Machine" value={String(data.machine ?? '')} onChangeText={(machine) => patch({ machine })} />
          <Field label="Inputs JSON" value={JSON.stringify(data.inputs ?? [], null, 2)} onChangeText={(text) => patch({ inputs: parseJsonField(text, []) })} multiline />
          <Field label="Output JSON" value={JSON.stringify(data.output ?? {}, null, 2)} onChangeText={(text) => patch({ output: parseJsonField(text, {}) })} multiline />
        </>
      ) : null}
      {type === 'item' ? (
        <>
          <Field label="Name" value={String(data.name ?? '')} onChangeText={(name) => patch({ name })} />
          <Field label="Texture" value={String(data.texture ?? '')} onChangeText={(texture) => patch({ texture })} />
          <Field label="Model" value={String(data.model ?? '')} onChangeText={(model) => patch({ model })} />
          <Field label="Max Stack" value={String(data.maxStack ?? 64)} onChangeText={(maxStack) => patch({ maxStack: Number(maxStack) || 1 })} keyboardType="numeric" />
        </>
      ) : null}
      {type === 'loot' ? (
        <>
          <Field label="Rolls" value={String(data.rolls ?? 1)} onChangeText={(rolls) => patch({ rolls: Number(rolls) || 1 })} keyboardType="numeric" />
          <Field label="Entries JSON" value={JSON.stringify(data.entries ?? [], null, 2)} onChangeText={(text) => patch({ entries: parseJsonField(text, []) })} multiline />
        </>
      ) : null}
      {type === 'dialogue' ? (
        <>
          <Field label="NPC" value={String(data.npc ?? '')} onChangeText={(npc) => patch({ npc })} />
          <Field label="Lines JSON" value={JSON.stringify(data.lines ?? [], null, 2)} onChangeText={(text) => patch({ lines: parseJsonField(text, []) })} multiline />
        </>
      ) : null}
      {type === 'holomap' ? (
        <>
          <Field label="Title" value={String(data.title ?? '')} onChangeText={(title) => patch({ title })} />
          <Field label="Layer Type" value={String(data.type ?? '')} onChangeText={(layerType) => patch({ type: layerType })} />
          <Field label="Markers JSON" value={JSON.stringify(data.markers ?? [], null, 2)} onChangeText={(text) => patch({ markers: parseJsonField(text, []) })} multiline />
        </>
      ) : null}
      {type === 'index' ? (
        <>
          <Field label="Title" value={String(data.title ?? '')} onChangeText={(title) => patch({ title })} />
          <Field label="Type" value={String(data.type ?? '')} onChangeText={(entryType) => patch({ type: entryType })} />
          <Field label="Category" value={String(data.category ?? '')} onChangeText={(category) => patch({ category })} />
          <Field label="Description" value={String(data.description ?? '')} onChangeText={(description) => patch({ description })} multiline />
        </>
      ) : null}
      {type === 'screen' ? (
        <>
          <Field label="Title" value={String(data.title ?? '')} onChangeText={(title) => patch({ title })} />
          <Field label="Theme" value={String(data.theme ?? '')} onChangeText={(theme) => patch({ theme })} />
          <Field label="XML" value={String(data.xml ?? '')} onChangeText={(xml) => patch({ xml })} multiline />
        </>
      ) : null}
      <Field label="Raw JSON" value={value} onChangeText={onChangeText} multiline />
    </Section>
  )
}

function ValidationPanel({ project }: { project: EchoMobileProject }) {
  const report = runValidationCheck(project.manifest)
  const applyFix = () => saveAndToast(updateProjectManifest(project, autoFixManifest(project.manifest)), 'Auto fixes applied')
  return (
    <Section title="Validation">
      <View style={styles.rowWrap}>
        <Metric label="Score" value={`${report.compatibilityScore}%`} tone={report.compatibilityScore >= 70 ? 'good' : 'warn'} />
        <Metric label="Blockers" value={report.counts.BLOCKER} tone={report.counts.BLOCKER ? 'bad' : 'good'} />
        <Metric label="Errors" value={report.counts.ERROR} tone={report.counts.ERROR ? 'warn' : 'good'} />
        <Metric label="Warnings" value={report.counts.WARNING} tone={report.counts.WARNING ? 'warn' : 'good'} />
      </View>
      <ActionRow>
        <Button mode="contained" icon="auto-fix" onPress={applyFix}>Auto Fix Manifest</Button>
      </ActionRow>
      {report.issues.length === 0 ? <EmptyState title="No validation issues" /> : null}
      {report.issues.map((issue, index) => (
        <RecordCard key={`${issue.message}-${index}`} title={`${issue.level} / ${issue.category}`} subtitle={`${issue.message}${issue.fix ? ` Fix: ${issue.fix}` : ''}`} right={issue.aiFixable ? <Chip compact>AI</Chip> : undefined} />
      ))}
    </Section>
  )
}

function CodexTasksPanel({ project }: { project: EchoMobileProject }) {
  const [lanes, setLanes] = useState<Record<string, CodexTaskLane>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const tasks = useMemo(
    () => generateMobileCodexTasks(project).map((task) => ({ ...task, lane: lanes[task.id] ?? task.lane })),
    [project, lanes]
  )
  const visible = tasks.filter((task) => task.lane !== 'rejected')
  const selected = selectedId ? tasks.find((task) => task.id === selectedId) : visible[0]
  const setLane = (id: string, lane: CodexTaskLane) => setLanes((current) => ({ ...current, [id]: lane }))
  const apply = (id: string) => {
    const task = tasks.find((item) => item.id === id)
    if (!task) return
    const patches = patchesFromCodexTask(task)
    saveAndToast(applyFilePatches(project, patches), `Applied ${patches.length} task file(s)`)
    setLane(id, 'ready')
  }
  return (
    <Section title="Codex Tasks">
      <View style={styles.rowWrap}>
        <Metric label="Suggested" value={tasks.filter((task) => task.lane === 'suggested').length} />
        <Metric label="Review" value={tasks.filter((task) => task.lane === 'waiting_review').length} tone="warn" />
        <Metric label="Ready" value={tasks.filter((task) => task.lane === 'ready').length} tone="good" />
        <Metric label="Rejected" value={tasks.filter((task) => task.lane === 'rejected').length} tone="neutral" />
      </View>
      {visible.length === 0 ? <EmptyState title="No suggested tasks" /> : null}
      {visible.map((task) => (
        <RecordCard
          key={task.id}
          title={task.title}
          subtitle={`${task.reason} ${task.affectedFiles.join(', ')}`}
          selected={selected?.id === task.id}
          onPress={() => setSelectedId(task.id)}
          right={
            <View style={styles.rowWrap}>
              <Chip compact>{task.lane}</Chip>
              <Button compact mode="outlined" onPress={() => setLane(task.id, 'waiting_review')}>Approve</Button>
              <Button compact mode="contained-tonal" onPress={() => apply(task.id)} disabled={!task.canApply}>Apply</Button>
              <IconButton icon="close" size={18} onPress={() => setLane(task.id, 'rejected')} />
            </View>
          }
        />
      ))}
      {selected ? (
        <>
          <Hairline />
          <Text variant="titleSmall">{selected.route}</Text>
          <Text style={styles.muted}>{selected.summary}</Text>
          <TextInput
            mode="outlined"
            multiline
            label="Diff"
            value={selected.fileChanges.map((change) => change.diff ?? buildUnifiedTextDiff(change.path, change.before ?? '', change.after ?? '')).join('\n\n')}
            editable={false}
            style={{ minHeight: 220 }}
          />
        </>
      ) : null}
    </Section>
  )
}

function SyncPanel({ project }: { project: EchoMobileProject }) {
  const settings = useStudioStore((state) => state.settings)
  const [owner, setOwner] = useState(project.github?.owner ?? '')
  const [repo, setRepo] = useState(project.github?.repo ?? '')
  const [branch, setBranch] = useState(project.github?.branch ?? settings.defaultBranch)
  const [prBranch, setPrBranch] = useState(`echo-mobile/${project.manifest.id.replace(/[^a-zA-Z0-9._-]+/g, '-')}`)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const withTarget = () => ({ ...project, github: { owner, repo, branch }, dirty: true, updatedAt: Date.now() })
  const conflicts = project.conflicts ?? []
  return (
    <Section title="Git / Sync">
      <Field label="Owner" value={owner} onChangeText={setOwner} />
      <Field label="Repo" value={repo} onChangeText={setRepo} />
      <Field label="Branch" value={branch} onChangeText={setBranch} />
      <Field label="PR Branch" value={prBranch} onChangeText={setPrBranch} />
      <ActionRow>
        <Button mode="outlined" icon="content-save" onPress={() => saveAndToast(withTarget(), 'GitHub target saved')}>Save Target</Button>
        <Button
          mode="contained"
          icon="cloud-upload-outline"
          disabled={busy || !owner || !repo}
          onPress={async () => {
            setBusy(true)
            try {
              const next = withTarget()
              const result = await pushProjectToGitHub(next, settings, `Update ${project.manifest.name} from ECHO Studio Mobile`)
              saveAndToast({ ...next, dirty: false, lastSyncAt: Date.now() }, result.message)
              setMessage(result.url ?? result.message)
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Push
        </Button>
        <Button
          mode="outlined"
          icon="cloud-download-outline"
          disabled={busy || !owner || !repo}
          onPress={async () => {
            setBusy(true)
            try {
              const targetProject = withTarget()
              const files = await pullProjectFilesFromGitHub(targetProject, settings)
              const detected = detectSyncConflicts(targetProject, files)
              const next = mergePulledFiles(targetProject, files, detected)
              saveAndToast(next, detected.length ? `Pulled with ${detected.length} conflict(s)` : 'Pulled project files')
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Pull
        </Button>
      </ActionRow>
      <ActionRow>
        <Button
          mode="outlined"
          icon="source-pull"
          disabled={!owner || !repo}
          onPress={async () => {
            try {
              const url = await pushProjectBranchAndCreatePullRequest(
                withTarget(),
                settings,
                prBranch,
                `Update ${project.manifest.name}`,
                'Created from ECHO Studio Mobile.'
              )
              setMessage(url)
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error))
            }
          }}
        >
          Open PR
        </Button>
        <Button
          mode="outlined"
          icon="check-all"
          disabled={conflicts.length === 0}
          onPress={() => saveAndToast(resolveAllSyncConflicts(project, 'remote'), 'All remote versions applied')}
        >
          Use Remote
        </Button>
        <Button
          mode="outlined"
          icon="content-save-check-outline"
          disabled={conflicts.length === 0}
          onPress={() => saveAndToast(resolveAllSyncConflicts(project, 'local'), 'All local versions kept')}
        >
          Keep Local
        </Button>
        {busy ? <ActivityIndicator /> : null}
      </ActionRow>
      {conflicts.length ? (
        <Section title="Conflicts">
          {conflicts.map((conflict) => (
            <RecordCard
              key={conflict.id}
              title={conflict.path}
              subtitle={`Local ${conflict.localContent.length} chars / Remote ${conflict.remoteContent.length} chars`}
              right={
                <View style={styles.rowWrap}>
                  <Button compact mode="outlined" onPress={() => saveAndToast(resolveSyncConflict(project, conflict.id, 'local'), `${conflict.path} kept local`)}>Local</Button>
                  <Button compact mode="contained-tonal" onPress={() => saveAndToast(resolveSyncConflict(project, conflict.id, 'remote'), `${conflict.path} used remote`)}>Remote</Button>
                </View>
              }
            />
          ))}
        </Section>
      ) : null}
      {message ? <RecordCard title="Sync Result" subtitle={message} onPress={() => message.startsWith('http') && openUrl(message)} /> : null}
      {!settings.githubToken ? <Text style={styles.muted}>{SETTINGS_HINT}</Text> : null}
    </Section>
  )
}

function CatalogPanel({ project }: { project: EchoMobileProject }) {
  const settings = useStudioStore((state) => state.settings)
  const [query, setQuery] = useState('')
  const [remoteEntries, setRemoteEntries] = useState<ReleaseIndexCatalogEntry[]>([])
  const [busy, setBusy] = useState(false)
  const visible = useMemo(() => {
    const lower = query.toLowerCase()
    return [...TEMPLATES.map((template) => ({ kind: 'template', id: template.id, name: template.name, description: template.description, source: undefined })),
      ...ECHO_MODULE_CATALOG.map((module) => ({ kind: 'module', id: module.id, name: module.name, description: module.creatorUse, source: undefined })),
      ...remoteEntries.map((entry) => ({
        kind: 'release',
        id: entry.id,
        name: entry.name,
        description: `${entry.version ?? 'unknown'} ${entry.channel ?? ''} ${entry.path}`,
        source: entry.source
      }))]
      .filter((item) => !lower || `${item.name} ${item.description} ${item.kind}`.toLowerCase().includes(lower))
  }, [query, remoteEntries])
  return (
    <Section title="Catalog">
      <Field label="Search" value={query} onChangeText={setQuery} />
      <ActionRow>
        <Button
          mode="contained"
          icon="cloud-refresh-outline"
          disabled={busy}
          onPress={async () => {
            setBusy(true)
            try {
              const entries = await fetchReleaseIndexCatalog(settings)
              setRemoteEntries(entries)
              saveAndToast({ ...project, lastCatalogSyncAt: Date.now() }, `Loaded ${entries.length} Release Index item(s)`)
              await notifyStudio(settings, 'Catalog refreshed', `${entries.length} Release Index item(s) loaded.`)
            } catch (error) {
              useStudioStore.getState().setToast(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Release Index
        </Button>
        {busy ? <ActivityIndicator /> : null}
      </ActionRow>
      {visible.slice(0, 60).map((item) => (
        <RecordCard
          key={`${item.kind}:${item.id}`}
          title={item.name}
          subtitle={item.description}
          right={<Chip compact>{item.kind}</Chip>}
          onPress={() => {
            if (item.kind === 'module') {
              const module = ECHO_MODULE_CATALOG.find((entry) => entry.id === item.id)
              if (module) saveAndToast(updateProjectManifest(project, addModuleToManifest(project.manifest, module, 'optional')), `${module.name} installed`)
            }
            if (item.kind === 'release') openUrl(item.source)
          }}
        />
      ))}
    </Section>
  )
}

function ReleasePanel({ project }: { project: EchoMobileProject }) {
  const settings = useStudioStore((state) => state.settings)
  const [version, setVersion] = useState(project.manifest.version)
  const [changelog, setChangelog] = useState(`## ${project.manifest.version}\n- Mobile release draft.\n`)
  const [entry, setEntry] = useState('')
  const [resultUrl, setResultUrl] = useState(project.releaseDraft?.url ?? '')
  const [busy, setBusy] = useState(false)
  const packageManifest = buildAddonPackageManifest(project.manifest)
  return (
    <Section title="Release">
      <Field label="Version" value={version} onChangeText={setVersion} />
      <Field label="Changelog" value={changelog} onChangeText={setChangelog} multiline />
      <ActionRow>
        <Button mode="outlined" icon="tag-edit-outline" onPress={() => saveAndToast(updateProjectManifest(project, { ...project.manifest, version }), 'Version updated')}>Bump Version</Button>
        <Button
          mode="contained"
          icon="github"
          disabled={busy}
          onPress={async () => {
            setBusy(true)
            try {
              const url = await createGitHubReleaseDraft(project, settings, changelog)
              const releaseIndexEntry = await buildReleaseIndexEntry(project)
              saveAndToast({
                ...project,
                releaseDraft: {
                  tag: `v${project.manifest.version}`,
                  name: project.manifest.name,
                  url,
                  createdAt: Date.now(),
                  releaseIndexEntry
                }
              }, 'GitHub release draft created')
              setEntry(releaseIndexEntry)
              setResultUrl(url)
              await notifyStudio(settings, 'Release draft created', `${project.manifest.name} ${project.manifest.version} is ready for review.`)
            } catch (error) {
              useStudioStore.getState().setToast(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Draft Release
        </Button>
        <Button mode="outlined" icon="archive-plus-outline" onPress={async () => setEntry(await buildReleaseIndexEntry(project))}>Index Entry</Button>
        <Button
          mode="outlined"
          icon="source-pull"
          disabled={busy}
          onPress={async () => {
            setBusy(true)
            try {
              const entryText = entry || await buildReleaseIndexEntry(project)
              setEntry(entryText)
              const url = await createReleaseIndexPullRequest(project, settings, entryText)
              setResultUrl(url)
              await notifyStudio(settings, 'Release Index PR created', `${project.manifest.name} is queued for catalog review.`)
            } catch (error) {
              useStudioStore.getState().setToast(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Index PR
        </Button>
      </ActionRow>
      {busy ? <ActivityIndicator /> : null}
      <TextInput mode="outlined" multiline label="Package Manifest" value={JSON.stringify(packageManifest, null, 2)} editable={false} />
      {entry ? <TextInput mode="outlined" multiline label="Release Index Entry" value={entry} onChangeText={setEntry} /> : null}
      {resultUrl ? <RecordCard title="Release Result" subtitle={resultUrl} onPress={() => openUrl(resultUrl)} /> : null}
    </Section>
  )
}

function SettingsPanel() {
  const settings = useStudioStore((state) => state.settings)
  const saveSettings = useStudioStore((state) => state.saveSettings)
  const setToast = useStudioStore((state) => state.setToast)
  const [draft, setDraft] = useState<MobileSettings>(settings)
  const [deviceLogin, setDeviceLogin] = useState<GitHubDeviceCodeState | null>(null)
  const [busy, setBusy] = useState(false)
  const update = (patch: Partial<MobileSettings>) => setDraft((current) => ({ ...current, ...patch }))
  return (
    <Section title="Settings">
      <Text variant="titleSmall">GitHub</Text>
      <Field label="GitHub OAuth Client ID" value={draft.githubClientId} onChangeText={(githubClientId) => update({ githubClientId })} />
      <Field label="GitHub Token" value={draft.githubToken} onChangeText={(githubToken) => update({ githubToken })} secureTextEntry />
      <Field label="Default Branch" value={draft.defaultBranch} onChangeText={(defaultBranch) => update({ defaultBranch })} />
      <ActionRow>
        <Button
          mode="outlined"
          icon="login"
          disabled={busy}
          onPress={async () => {
            setBusy(true)
            try {
              const state = await startGitHubDeviceLogin(draft.githubClientId)
              setDeviceLogin(state)
              openUrl(state.verificationUri)
              setToast(`Enter GitHub code ${state.userCode}`)
            } catch (error) {
              setToast(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Start Login
        </Button>
        <Button
          mode="contained-tonal"
          icon="refresh"
          disabled={busy || !deviceLogin}
          onPress={async () => {
            if (!deviceLogin) return
            setBusy(true)
            try {
              const result = await pollGitHubDeviceLogin(draft.githubClientId, deviceLogin)
              if (result.nextInterval) setDeviceLogin({ ...deviceLogin, interval: result.nextInterval })
              if (result.token) {
                const next = { ...draft, githubToken: result.token }
                setDraft(next)
                await saveSettings(next)
              }
              setToast(result.message)
            } catch (error) {
              setToast(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Poll Login
        </Button>
        {busy ? <ActivityIndicator /> : null}
      </ActionRow>
      {deviceLogin ? <RecordCard title="GitHub Device Code" subtitle={`${deviceLogin.userCode} / expires ${new Date(deviceLogin.expiresAt).toLocaleTimeString()}`} onPress={() => openUrl(deviceLogin.verificationUri)} /> : null}
      <Text variant="titleSmall">AI</Text>
      <Field label="OpenAI Base URL" value={draft.openAiBaseUrl} onChangeText={(openAiBaseUrl) => update({ openAiBaseUrl })} keyboardType="url" />
      <Field label="OpenAI Model" value={draft.openAiModel} onChangeText={(openAiModel) => update({ openAiModel })} />
      <Field label="OpenAI API Key" value={draft.openAiApiKey} onChangeText={(openAiApiKey) => update({ openAiApiKey })} secureTextEntry />
      <Text variant="titleSmall">Release Index</Text>
      <Field label="Release Index Owner" value={draft.releaseIndexOwner} onChangeText={(releaseIndexOwner) => update({ releaseIndexOwner })} />
      <Field label="Release Index Repo" value={draft.releaseIndexRepo} onChangeText={(releaseIndexRepo) => update({ releaseIndexRepo })} />
      <Text variant="titleSmall">Notifications</Text>
      <List.Item
        title="Build, release, and catalog notifications"
        right={() => <Switch value={draft.notificationsEnabled} onValueChange={(notificationsEnabled) => update({ notificationsEnabled })} />}
      />
      <List.Item
        title="Onboarding Complete"
        right={() => <Switch value={draft.onboardingComplete} onValueChange={(onboardingComplete) => update({ onboardingComplete })} />}
      />
      <ActionRow>
        <Button mode="outlined" icon="bell-check-outline" onPress={async () => setToast(await ensureNotificationPermissions(draft) ? 'Notifications enabled' : 'Notifications disabled')}>Test Permission</Button>
        <Button mode="contained" icon="content-save" onPress={async () => { await saveSettings(draft); setToast('Settings saved') }}>Save Settings</Button>
      </ActionRow>
    </Section>
  )
}

export function SettingsScreen() {
  return (
    <ScreenFrame title="Settings" subtitle="Accounts, models, Release Index, notifications, and onboarding.">
      <SettingsPanel />
    </ScreenFrame>
  )
}

export function BuildScreen() {
  const project = useActiveProject()
  const settings = useStudioStore((state) => state.settings)
  const [task, setTask] = useState('build')
  const [busy, setBusy] = useState(false)
  const [runs, setRuns] = useState<BuildRunSummary[]>([])
  const [artifacts, setArtifacts] = useState<BuildArtifactSummary[]>([])
  const [logText, setLogText] = useState(project?.lastBuild?.log ?? '')
  const [testSummary, setTestSummary] = useState(project?.lastBuild?.testSummary ?? null)
  if (!project) {
    return <ScreenFrame title="Build">{activeOrEmpty(project)}</ScreenFrame>
  }
  return (
    <ScreenFrame title="Build" subtitle="Remote GitHub Actions build, test, package, and preview scans.">
      <ProjectStrip project={project} />
      <PillRow
        items={['build', 'test', 'validate', 'package', 'preview'].map((item) => ({ key: item, label: item }))}
        selected={[task]}
        onToggle={setTask}
      />
      <ActionRow>
        <Button
          mode="outlined"
          icon="file-cog-outline"
          onPress={() => saveAndToast(installRemoteBuildWorkflow(project), 'Remote build workflow installed')}
        >
          Install Workflow
        </Button>
        <Button
          mode="contained"
          icon="play"
          disabled={busy}
          onPress={async () => {
            setBusy(true)
            try {
              await triggerRemoteBuild(project, settings, task)
              saveAndToast({ ...project, lastBuild: { task: task as 'build', status: 'queued', updatedAt: Date.now() } }, `${task} queued`)
              await notifyStudio(settings, 'Remote build queued', `${project.manifest.name}: ${task}`)
            } catch (error) {
              useStudioStore.getState().setToast(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Run
        </Button>
        <Button
          mode="outlined"
          icon="refresh"
          disabled={busy}
          onPress={async () => {
            setBusy(true)
            try {
              const nextRuns = await listRemoteBuildRuns(project, settings)
              setRuns(nextRuns)
              const latest = nextRuns[0]
              if (latest) {
                saveAndToast({
                  ...project,
                  lastBuild: {
                    task: task as 'build',
                    status: latest.status === 'completed' ? 'completed' : latest.status === 'in_progress' ? 'in_progress' : 'queued',
                    conclusion: latest.conclusion,
                    runId: latest.id,
                    url: latest.url,
                    updatedAt: Date.now()
                  }
                }, `Latest run ${latest.status}${latest.conclusion ? ` / ${latest.conclusion}` : ''}`)
                if (latest.status === 'completed') await notifyStudio(settings, 'Remote build updated', `${project.manifest.name}: ${latest.conclusion ?? latest.status}`)
              }
            } catch (error) {
              useStudioStore.getState().setToast(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Monitor
        </Button>
        {busy ? <ActivityIndicator /> : null}
      </ActionRow>
      {!project.github ? <Text style={styles.muted}>Configure a GitHub target in Content / Sync.</Text> : null}
      {runs.map((run) => (
        <RecordCard
          key={run.id}
          title={`Run ${run.id}`}
          subtitle={`${run.status}${run.conclusion ? ` / ${run.conclusion}` : ''}`}
          onPress={() => openUrl(run.url)}
          right={
            <View style={styles.rowWrap}>
              <Button
                compact
                mode="outlined"
                onPress={async () => {
                  setBusy(true)
                  try {
                    const text = await fetchWorkflowRunLogText(project, settings, run.id)
                    setLogText(text)
                    const summary = text.includes('<testsuite') ? parseJUnitSummary(text) : null
                    setTestSummary(summary)
                    saveAndToast({
                      ...project,
                      lastBuild: {
                        ...(project.lastBuild ?? { task: task as 'build', status: 'completed' }),
                        runId: run.id,
                        log: text,
                        testSummary: summary ?? undefined,
                        updatedAt: Date.now()
                      }
                    }, 'Build log loaded')
                  } catch (error) {
                    useStudioStore.getState().setToast(error instanceof Error ? error.message : String(error))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Logs
              </Button>
              <Button
                compact
                mode="contained-tonal"
                onPress={async () => {
                  setBusy(true)
                  try {
                    const nextArtifacts = await listWorkflowArtifacts(project, settings, run.id)
                    setArtifacts(nextArtifacts)
                    await notifyStudio(settings, 'Artifacts refreshed', `${nextArtifacts.length} artifact(s) for run ${run.id}.`)
                  } catch (error) {
                    useStudioStore.getState().setToast(error instanceof Error ? error.message : String(error))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Artifacts
              </Button>
            </View>
          }
        />
      ))}
      {testSummary ? (
        <View style={styles.rowWrap}>
          <Metric label="Suites" value={testSummary.suites} />
          <Metric label="Tests" value={testSummary.tests} />
          <Metric label="Failures" value={testSummary.failures} tone={testSummary.failures ? 'bad' : 'good'} />
          <Metric label="Skipped" value={testSummary.skipped} tone="neutral" />
        </View>
      ) : null}
      {artifacts.map((artifact) => (
        <RecordCard
          key={artifact.id}
          title={artifact.name}
          subtitle={`${artifact.sizeInBytes ?? 0} bytes${artifact.expired ? ' / expired' : ''}`}
          onPress={() => openUrl(artifact.url)}
        />
      ))}
      {logText ? <TextInput mode="outlined" multiline label="Build Log" value={logText} onChangeText={setLogText} style={{ minHeight: 260 }} /> : null}
    </ScreenFrame>
  )
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  files?: EchoFilePatch[]
  usedModel?: boolean
}

export function AIScreen() {
  const project = useActiveProject()
  const settings = useStudioStore((state) => state.settings)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: 'Ready for manifest, mission, recipe, dialogue, HoloMap, Index, screen, and validation fixes.' }
  ])
  const [input, setInput] = useState('Create a mission about a lost signal relay.')
  const [busy, setBusy] = useState(false)
  const send = async (text: string) => {
    if (!text.trim() || busy) return
    setMessages((current) => [...current, { role: 'user', text }])
    setInput('')
    setBusy(true)
    try {
      const result: AiChatResult = await runMobileAiChat(text, project, settings)
      setMessages((current) => [...current, { role: 'assistant', text: result.text, files: result.files, usedModel: result.usedModel }])
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', text: error instanceof Error ? error.message : String(error), usedModel: false }])
    } finally {
      setBusy(false)
    }
  }
  const apply = (files: EchoFilePatch[]) => {
    if (!project) {
      useStudioStore.getState().setToast('Select a project first')
      return
    }
    saveAndToast(applyFilePatches(project, files), `Applied ${files.length} AI file(s)`)
  }
  return (
    <ScreenFrame title="AI" subtitle={project?.manifest.name ?? 'Offline generation is available without a key.'}>
      <ProjectStrip project={project} />
      {messages.map((message, index) => (
        <RecordCard
          key={`${message.role}-${index}`}
          title={message.role === 'user' ? 'You' : message.usedModel ? 'Model' : 'Offline Assistant'}
          subtitle={message.text}
          right={message.files?.length ? <Button mode="contained-tonal" icon="file-import-outline" onPress={() => apply(message.files ?? [])}>Apply</Button> : undefined}
        />
      ))}
      {busy ? <ActivityIndicator /> : null}
      <Field label="Prompt" value={input} onChangeText={setInput} multiline />
      <ActionRow>
        <Button mode="contained" icon="send" onPress={() => void send(input)}>Send</Button>
        {['Mission', 'Recipe', 'Dialogue', 'Validation fix'].map((item) => (
          <Button key={item} mode="outlined" onPress={() => void send(item)}>{item}</Button>
        ))}
      </ActionRow>
      <FAB icon="creation-outline" label="Ask AI" onPress={() => void send(input)} style={{ alignSelf: 'flex-end', marginTop: 10 }} />
    </ScreenFrame>
  )
}
