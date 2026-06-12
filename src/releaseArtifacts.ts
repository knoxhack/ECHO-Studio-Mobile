import { APP_INFO } from './appInfo'
import type { ReleaseArtifact, ReleaseBuildMode } from './mobileTypes'

const GENERATED = 'generated-by-release-script'

export function expectedReleaseArtifacts(mode: ReleaseBuildMode): ReleaseArtifact[] {
  const createdAt = Date.now()
  const base = `dist/android/release/echo-studio-mobile-v${APP_INFO.version}`
  const artifacts: ReleaseArtifact[] = []
  if (mode === 'debug') {
    artifacts.push({
      name: `echo-studio-mobile-v${APP_INFO.version}-debug.apk`,
      path: `${base}-debug.apk`,
      sha256: GENERATED,
      bytes: 0,
      kind: 'debug-apk',
      createdAt
    })
    return artifacts
  }
  artifacts.push(
    {
      name: `echo-studio-mobile-v${APP_INFO.version}-release.apk`,
      path: `${base}-release.apk`,
      sha256: GENERATED,
      bytes: 0,
      kind: 'release-apk',
      createdAt
    },
    {
      name: `echo-studio-mobile-v${APP_INFO.version}-release.aab`,
      path: `${base}-release.aab`,
      sha256: GENERATED,
      bytes: 0,
      kind: 'release-aab',
      createdAt
    }
  )
  return artifacts
}
