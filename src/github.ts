import * as Crypto from 'expo-crypto'
import { buildAddonPackageManifest, runValidationCheck } from '@echo/shared'
import { filesFromContent } from './projectModel'
import type {
  BuildArtifactSummary,
  BuildRunSummary,
  BuildTestSummary,
  EchoMobileProject,
  GitHubDeviceCodeState,
  GitHubTarget,
  MobileSettings,
  ReleaseIndexCatalogEntry,
  SyncResult
} from './mobileTypes'

const GITHUB_API = 'https://api.github.com'
const GITHUB_LOGIN = 'https://github.com/login'

function actionableGitHubError(status: number, body: string, path: string): Error {
  const detail = body ? ` ${body}` : ''
  if (status === 401) return new Error('GitHub token is invalid or expired. Reconnect in Settings, then retry.')
  if (status === 403) return new Error(`GitHub denied this action. Check token scopes for repo/workflow access or rate limits.${detail}`)
  if (status === 404) return new Error(`GitHub could not find this repo, branch, workflow, or file. Check the owner/repo/branch and token permissions. (${path})`)
  if (status === 409) return new Error('GitHub reported a conflict. Pull first, resolve conflicts, then retry the push or PR.')
  if (status === 422) return new Error(`GitHub rejected the request. Check for an existing branch/PR, duplicate tag/release, or invalid workflow input.${detail}`)
  return new Error(`GitHub ${status}: ${body || 'Request failed.'}`)
}

async function githubRequest<T>(
  settings: MobileSettings,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!settings.githubToken.trim()) throw new Error('GitHub token is not configured.')
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${settings.githubToken.trim()}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {})
    }
  })
  if (!response.ok) {
    const body = await response.text()
    throw actionableGitHubError(response.status, body || response.statusText, path)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function githubTextRequest(
  settings: MobileSettings,
  path: string,
  accept = 'application/vnd.github.raw'
): Promise<string> {
  if (!settings.githubToken.trim()) throw new Error('GitHub token is not configured.')
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${settings.githubToken.trim()}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  if (!response.ok) {
    const body = await response.text()
    throw actionableGitHubError(response.status, body || response.statusText, path)
  }
  return response.text()
}

interface RefResponse {
  object: { sha: string }
}

interface CommitResponse {
  sha: string
  html_url?: string
  tree: { sha: string }
}

interface TreeResponse {
  sha: string
  tree?: Array<{ path: string; type: string; sha: string }>
}

interface GitHubErrorBody {
  error?: string
  error_description?: string
  interval?: number
}

export interface GitHubAccessCheck {
  login: string
  scopes: string[]
  repo?: string
  branch?: string
}

function repoPath(target: GitHubTarget, suffix: string): string {
  return `/repos/${target.owner}/${target.repo}${suffix}`
}

function contentPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function releaseIndexTarget(settings: MobileSettings): GitHubTarget {
  return {
    owner: settings.releaseIndexOwner,
    repo: settings.releaseIndexRepo,
    branch: settings.defaultBranch
  }
}

async function createBranchIfMissing(settings: MobileSettings, target: GitHubTarget, branch: string, baseBranch: string): Promise<void> {
  try {
    await githubRequest(settings, repoPath(target, `/git/ref/heads/${branch}`))
    return
  } catch {
    // Missing branches are created below. Other failures surface when the create call runs.
  }
  const baseRef = await githubRequest<RefResponse>(settings, repoPath(target, `/git/ref/heads/${baseBranch}`))
  await githubRequest(settings, repoPath(target, '/git/refs'), {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha })
  })
}

async function commitFilesToTarget(
  settings: MobileSettings,
  target: GitHubTarget,
  files: Record<string, string>,
  message: string
): Promise<CommitResponse> {
  const branch = target.branch || settings.defaultBranch
  const ref = await githubRequest<RefResponse>(settings, repoPath(target, `/git/ref/heads/${branch}`))
  const baseCommit = await githubRequest<CommitResponse>(settings, repoPath(target, `/git/commits/${ref.object.sha}`))
  const tree = await githubRequest<TreeResponse>(settings, repoPath(target, '/git/trees'), {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: Object.entries(files).map(([path, content]) => ({
        path,
        mode: '100644',
        type: 'blob',
        content
      }))
    })
  })
  const commit = await githubRequest<CommitResponse>(settings, repoPath(target, '/git/commits'), {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [ref.object.sha]
    })
  })
  await githubRequest(settings, repoPath(target, `/git/refs/heads/${branch}`), {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false })
  })
  return commit
}

export async function startGitHubDeviceLogin(clientId: string): Promise<GitHubDeviceCodeState> {
  if (!clientId.trim()) throw new Error('Set a GitHub OAuth app client ID first.')
  const body = new URLSearchParams({
    client_id: clientId.trim(),
    scope: 'repo workflow'
  })
  const response = await fetch(`${GITHUB_LOGIN}/device/code`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  const json = await response.json() as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    expires_in?: number
    interval?: number
    error_description?: string
  }
  if (!response.ok || !json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error(json.error_description ?? 'Unable to start GitHub device login.')
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresAt: Date.now() + (json.expires_in ?? 900) * 1000,
    interval: json.interval ?? 5
  }
}

export async function pollGitHubDeviceLogin(clientId: string, state: GitHubDeviceCodeState): Promise<{ token?: string; nextInterval?: number; message: string }> {
  if (Date.now() > state.expiresAt) throw new Error('GitHub device login expired. Start again.')
  const body = new URLSearchParams({
    client_id: clientId.trim(),
    device_code: state.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  })
  const response = await fetch(`${GITHUB_LOGIN}/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  const json = await response.json() as GitHubErrorBody & { access_token?: string }
  if (json.access_token) return { token: json.access_token, message: 'GitHub login complete.' }
  if (json.error === 'authorization_pending') return { message: 'Waiting for GitHub authorization.' }
  if (json.error === 'slow_down') return { nextInterval: (state.interval ?? 5) + 5, message: 'GitHub asked this device to poll slower.' }
  throw new Error(json.error_description ?? json.error ?? 'GitHub login failed.')
}

export async function validateGitHubAccess(
  settings: MobileSettings,
  target?: GitHubTarget
): Promise<GitHubAccessCheck> {
  if (!settings.githubToken.trim()) throw new Error('GitHub token is not configured.')
  const userResponse = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${settings.githubToken.trim()}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  if (!userResponse.ok) {
    const body = await userResponse.text()
    throw actionableGitHubError(userResponse.status, body || userResponse.statusText, '/user')
  }
  const user = await userResponse.json() as { login?: string }
  const scopes = (userResponse.headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
  if (target?.owner && target.repo) {
    await githubRequest(settings, repoPath(target, ''))
    const branch = target.branch || settings.defaultBranch
    await githubRequest(settings, repoPath(target, `/branches/${encodeURIComponent(branch)}`))
    return { login: user.login ?? 'unknown', scopes, repo: `${target.owner}/${target.repo}`, branch }
  }
  return { login: user.login ?? 'unknown', scopes }
}

export async function pushProjectToGitHub(
  project: EchoMobileProject,
  settings: MobileSettings,
  message: string
): Promise<SyncResult> {
  const target = project.github
  if (!target?.owner || !target.repo) throw new Error('Project GitHub target is not configured.')
  const branch = target.branch || settings.defaultBranch
  const files = filesFromContent(project)
  const commit = await commitFilesToTarget(settings, { ...target, branch }, files, message)
  return {
    message: `Synced ${Object.keys(files).length} file(s) to ${target.owner}/${target.repo}@${branch}.`,
    url: commit.html_url,
    changedFiles: Object.keys(files)
  }
}

export async function pullProjectFilesFromGitHub(
  project: EchoMobileProject,
  settings: MobileSettings
): Promise<Record<string, string>> {
  const target = project.github
  if (!target?.owner || !target.repo) throw new Error('Project GitHub target is not configured.')
  const branch = target.branch || settings.defaultBranch
  const tree = await githubRequest<TreeResponse>(
    settings,
    `/repos/${target.owner}/${target.repo}/git/trees/${branch}?recursive=1`
  )
  const fileEntries = (tree.tree ?? []).filter((entry) => entry.type === 'blob' && entry.path)
  const files: Record<string, string> = {}
  for (const entry of fileEntries) {
    if (!entry.path.endsWith('.json') && !['README.md', 'CHANGELOG.md', 'LICENSE'].includes(entry.path)) continue
    files[entry.path] = await githubTextRequest(
      settings,
      `/repos/${target.owner}/${target.repo}/contents/${contentPath(entry.path)}?ref=${encodeURIComponent(branch)}`
    )
  }
  return files
}

export async function createPullRequest(
  project: EchoMobileProject,
  settings: MobileSettings,
  head: string,
  base: string,
  title: string,
  body: string
): Promise<string> {
  const target = project.github
  if (!target?.owner || !target.repo) throw new Error('Project GitHub target is not configured.')
  const result = await githubRequest<{ html_url: string }>(settings, `/repos/${target.owner}/${target.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, body, head, base, maintainer_can_modify: true })
  })
  return result.html_url
}

export async function pushProjectBranchAndCreatePullRequest(
  project: EchoMobileProject,
  settings: MobileSettings,
  headBranch: string,
  title: string,
  body: string
): Promise<string> {
  const target = project.github
  if (!target?.owner || !target.repo) throw new Error('Project GitHub target is not configured.')
  const base = target.branch || settings.defaultBranch
  await createBranchIfMissing(settings, target, headBranch, base)
  await pushProjectToGitHub({ ...project, github: { ...target, branch: headBranch } }, settings, `Update ${project.manifest.name} from ECHO Studio Mobile`)
  return createPullRequest(project, settings, headBranch, base, title, body)
}

export async function triggerRemoteBuild(
  project: EchoMobileProject,
  settings: MobileSettings,
  task: string
): Promise<void> {
  const target = project.github
  if (!target?.owner || !target.repo) throw new Error('Project GitHub target is not configured.')
  await githubRequest(settings, `/repos/${target.owner}/${target.repo}/actions/workflows/echo-remote-build.yml/dispatches`, {
    method: 'POST',
    body: JSON.stringify({
      ref: target.branch || settings.defaultBranch,
      inputs: {
        task,
        project_id: project.manifest.id,
        manifest_path: 'echo.mod.json'
      }
    })
  })
}

export async function listRemoteBuildRuns(
  project: EchoMobileProject,
  settings: MobileSettings
): Promise<BuildRunSummary[]> {
  const target = project.github
  if (!target?.owner || !target.repo) throw new Error('Project GitHub target is not configured.')
  const branch = target.branch || settings.defaultBranch
  const result = await githubRequest<{ workflow_runs: Array<Record<string, unknown>> }>(
    settings,
    `/repos/${target.owner}/${target.repo}/actions/runs?branch=${encodeURIComponent(branch)}&event=workflow_dispatch&per_page=10`
  )
  return result.workflow_runs.map((run) => ({
    id: Number(run.id),
    status: String(run.status ?? 'unknown'),
    conclusion: run.conclusion ? String(run.conclusion) : undefined,
    url: run.html_url ? String(run.html_url) : undefined,
    logsUrl: run.logs_url ? String(run.logs_url) : undefined,
    createdAt: run.created_at ? String(run.created_at) : undefined,
    updatedAt: run.updated_at ? String(run.updated_at) : undefined
  }))
}

export async function listWorkflowArtifacts(
  project: EchoMobileProject,
  settings: MobileSettings,
  runId: number
): Promise<BuildArtifactSummary[]> {
  const target = project.github
  if (!target?.owner || !target.repo) throw new Error('Project GitHub target is not configured.')
  const result = await githubRequest<{ artifacts: Array<Record<string, unknown>> }>(
    settings,
    `/repos/${target.owner}/${target.repo}/actions/runs/${runId}/artifacts`
  )
  return result.artifacts.map((artifact) => ({
    id: Number(artifact.id),
    name: String(artifact.name ?? 'artifact'),
    sizeInBytes: artifact.size_in_bytes ? Number(artifact.size_in_bytes) : undefined,
    url: artifact.archive_download_url ? String(artifact.archive_download_url) : undefined,
    expired: Boolean(artifact.expired)
  }))
}

export async function fetchWorkflowRunLogText(
  project: EchoMobileProject,
  settings: MobileSettings,
  runId: number
): Promise<string> {
  const target = project.github
  if (!target?.owner || !target.repo) throw new Error('Project GitHub target is not configured.')
  const jobs = await githubRequest<{ jobs: Array<Record<string, unknown>> }>(
    settings,
    `/repos/${target.owner}/${target.repo}/actions/runs/${runId}/jobs?per_page=20`
  )
  const selected = jobs.jobs.find((job) => job.conclusion === 'failure') ?? jobs.jobs[0]
  if (!selected?.id) return 'No workflow jobs are available yet.'
  const text = await githubTextRequest(settings, `/repos/${target.owner}/${target.repo}/actions/jobs/${Number(selected.id)}/logs`, 'text/plain')
  return text.length > 12000 ? `${text.slice(0, 12000)}\n\n[log truncated in mobile view]` : text
}

export function parseJUnitSummary(xmlText: string): BuildTestSummary {
  const suites = (xmlText.match(/<testsuite\b/g) ?? []).length
  const numberFrom = (pattern: RegExp) => [...xmlText.matchAll(pattern)].reduce((sum, match) => sum + Number(match[1] ?? 0), 0)
  return {
    suites,
    tests: numberFrom(/\btests="(\d+)"/g),
    failures: numberFrom(/\bfailures="(\d+)"/g) + numberFrom(/\berrors="(\d+)"/g),
    skipped: numberFrom(/\bskipped="(\d+)"/g)
  }
}

export async function createGitHubReleaseDraft(
  project: EchoMobileProject,
  settings: MobileSettings,
  changelog: string
): Promise<string> {
  const target = project.github
  if (!target?.owner || !target.repo) throw new Error('Project GitHub target is not configured.')
  const tag = `v${project.manifest.version}`
  const result = await githubRequest<{ html_url: string }>(settings, `/repos/${target.owner}/${target.repo}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: `${project.manifest.name} ${project.manifest.version}`,
      body: changelog,
      draft: true,
      prerelease: project.manifest.version.startsWith('0.')
    })
  })
  return result.html_url
}

export async function buildReleaseIndexEntry(project: EchoMobileProject): Promise<string> {
  const report = runValidationCheck(project.manifest)
  const packageManifest = buildAddonPackageManifest(project.manifest)
  const files = filesFromContent(project)
  const manifestHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, files['echo.mod.json'] ?? '')
  return JSON.stringify(
    {
      schemaVersion: 'echo.release.index.addon.v1',
      id: packageManifest.id,
      name: project.manifest.name,
      version: project.manifest.version,
      channel: project.manifest.version.startsWith('0.') ? 'alpha' : 'stable',
      publisher: project.manifest.publisher,
      manifestSha256: manifestHash,
      targets: packageManifest.targets,
      dependencies: packageManifest.dependencies,
      validation: {
        compatibilityScore: report.compatibilityScore,
        publishingReady: report.publishingReady,
        blockers: report.counts.BLOCKER,
        errors: report.counts.ERROR
      },
      artifacts: packageManifest.artifacts,
      source: project.github ? `https://github.com/${project.github.owner}/${project.github.repo}` : undefined,
      generatedAt: new Date().toISOString()
    },
    null,
    2
  )
}

export async function fetchReleaseIndexCatalog(settings: MobileSettings): Promise<ReleaseIndexCatalogEntry[]> {
  const target = releaseIndexTarget(settings)
  if (!target.owner || !target.repo) throw new Error('Release Index target is not configured.')
  const branch = target.branch || settings.defaultBranch
  const tree = await githubRequest<TreeResponse>(
    settings,
    `/repos/${target.owner}/${target.repo}/git/trees/${branch}?recursive=1`
  )
  const entries = (tree.tree ?? [])
    .filter((entry) => entry.type === 'blob' && entry.path.endsWith('.json') && /(^|\/)(addons|packs|channels)\//.test(entry.path))
    .slice(0, 80)
  const catalog: ReleaseIndexCatalogEntry[] = []
  for (const entry of entries) {
    try {
      const text = await githubTextRequest(
        settings,
        `/repos/${target.owner}/${target.repo}/contents/${contentPath(entry.path)}?ref=${encodeURIComponent(branch)}`
      )
      const json = JSON.parse(text) as Record<string, unknown>
      catalog.push({
        id: String(json.id ?? entry.path),
        name: String(json.name ?? json.title ?? entry.path),
        version: json.version ? String(json.version) : undefined,
        channel: json.channel ? String(json.channel) : undefined,
        description: json.description ? String(json.description) : undefined,
        source: json.source ? String(json.source) : undefined,
        validation: typeof json.validation === 'object' && json.validation
          ? json.validation as ReleaseIndexCatalogEntry['validation']
          : undefined,
        path: entry.path
      })
    } catch {
      catalog.push({ id: entry.path, name: entry.path, path: entry.path })
    }
  }
  return catalog
}

export async function createReleaseIndexPullRequest(
  project: EchoMobileProject,
  settings: MobileSettings,
  entryText: string
): Promise<string> {
  const target = releaseIndexTarget(settings)
  if (!target.owner || !target.repo) throw new Error('Release Index target is not configured.')
  const base = target.branch || settings.defaultBranch
  const safeId = project.manifest.id.replace(/[^a-zA-Z0-9._-]+/g, '-')
  const headBranch = `echo-mobile/${safeId}-${project.manifest.version}`.toLowerCase()
  const entryPath = `addons/${safeId}.json`
  await createBranchIfMissing(settings, target, headBranch, base)
  await commitFilesToTarget(
    settings,
    { ...target, branch: headBranch },
    { [entryPath]: entryText },
    `Add ${project.manifest.name} ${project.manifest.version} to Release Index`
  )
  const result = await githubRequest<{ html_url: string }>(settings, `/repos/${target.owner}/${target.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: `Add ${project.manifest.name} ${project.manifest.version}`,
      body: `Release Index entry generated by ECHO Studio Mobile.\n\nSource: ${project.github ? `https://github.com/${project.github.owner}/${project.github.repo}` : project.manifest.id}`,
      head: headBranch,
      base,
      maintainer_can_modify: true
    })
  })
  return result.html_url
}
