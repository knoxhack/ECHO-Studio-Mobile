import * as SecureStore from 'expo-secure-store'
import * as SQLite from 'expo-sqlite'
import { create } from 'zustand'
import { filesFromContent } from './projectModel'
import type { EchoMobileProject, MobileSettings } from './mobileTypes'

const db = SQLite.openDatabaseSync('echo-studio-mobile.db')

db.execSync(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`)

const SETTINGS_KEY = 'echo-studio-mobile-settings'

export const DEFAULT_SETTINGS: MobileSettings = {
  githubToken: '',
  githubClientId: '',
  openAiApiKey: '',
  openAiBaseUrl: 'https://api.openai.com/v1',
  openAiModel: 'gpt-4.1-mini',
  releaseIndexOwner: 'knoxhack',
  releaseIndexRepo: 'ECHO-Release-Index',
  defaultBranch: 'main',
  notificationsEnabled: true,
  onboardingComplete: false,
  releaseBuildMode: 'signed',
  lastReleaseUrl: '',
  dismissedPolishHints: []
}

interface ProjectRow {
  id: string
  payload: string
  updatedAt: number
}

interface AppStateRow {
  value: string
}

function loadProjects(): EchoMobileProject[] {
  const rows = db.getAllSync<ProjectRow>('SELECT id, payload, updatedAt FROM projects ORDER BY updatedAt DESC')
  return rows.map((row) => JSON.parse(row.payload) as EchoMobileProject)
}

function persistProject(project: EchoMobileProject): void {
  const next = { ...project, files: filesFromContent(project), updatedAt: Date.now() }
  db.runSync(
    'INSERT OR REPLACE INTO projects (id, payload, updatedAt) VALUES (?, ?, ?)',
    next.id,
    JSON.stringify(next),
    next.updatedAt
  )
}

function deleteProjectRow(id: string): void {
  db.runSync('DELETE FROM projects WHERE id = ?', id)
}

function getAppState(key: string): string | null {
  return db.getFirstSync<AppStateRow>('SELECT value FROM app_state WHERE key = ?', key)?.value ?? null
}

function setAppState(key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', key, value)
}

async function loadSettings(): Promise<MobileSettings> {
  const [secureSettings, githubToken, openAiApiKey] = await Promise.all([
    SecureStore.getItemAsync(SETTINGS_KEY),
    SecureStore.getItemAsync('githubToken'),
    SecureStore.getItemAsync('openAiApiKey')
  ])
  const parsed = secureSettings ? JSON.parse(secureSettings) as Partial<MobileSettings> : {}
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    githubToken: githubToken ?? parsed.githubToken ?? '',
    openAiApiKey: openAiApiKey ?? parsed.openAiApiKey ?? ''
  }
}

async function persistSettings(settings: MobileSettings): Promise<void> {
  const safeSettings = { ...settings, githubToken: '', openAiApiKey: '' }
  await Promise.all([
    SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(safeSettings)),
    SecureStore.setItemAsync('githubToken', settings.githubToken),
    SecureStore.setItemAsync('openAiApiKey', settings.openAiApiKey)
  ])
}

interface StudioStore {
  hydrated: boolean
  projects: EchoMobileProject[]
  activeProjectId: string | null
  settings: MobileSettings
  toast: string
  hydrate: () => Promise<void>
  setToast: (message: string) => void
  setActiveProject: (id: string | null) => void
  saveProject: (project: EchoMobileProject) => void
  removeProject: (id: string) => void
  saveSettings: (settings: MobileSettings) => Promise<void>
}

export const useStudioStore = create<StudioStore>((set, get) => ({
  hydrated: false,
  projects: [],
  activeProjectId: null,
  settings: DEFAULT_SETTINGS,
  toast: '',
  hydrate: async () => {
    const settings = await loadSettings()
    const projects = loadProjects()
    const activeProjectId = getAppState('activeProjectId') ?? projects[0]?.id ?? null
    set({ hydrated: true, settings, projects, activeProjectId })
  },
  setToast: (toast) => set({ toast }),
  setActiveProject: (activeProjectId) => {
    if (activeProjectId) setAppState('activeProjectId', activeProjectId)
    set({ activeProjectId })
  },
  saveProject: (project) => {
    persistProject(project)
    const projects = loadProjects()
    set({
      projects,
      activeProjectId: get().activeProjectId ?? project.id
    })
  },
  removeProject: (id) => {
    deleteProjectRow(id)
    const projects = loadProjects()
    const activeProjectId = get().activeProjectId === id ? projects[0]?.id ?? null : get().activeProjectId
    set({ projects, activeProjectId })
  },
  saveSettings: async (settings) => {
    await persistSettings(settings)
    set({ settings })
  }
}))

export function useActiveProject(): EchoMobileProject | null {
  const projects = useStudioStore((state) => state.projects)
  const activeProjectId = useStudioStore((state) => state.activeProjectId)
  return projects.find((project) => project.id === activeProjectId) ?? null
}
