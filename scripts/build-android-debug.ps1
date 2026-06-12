param(
  [string]$MirrorRoot = "C:\esm",
  [string]$AndroidSdk = "$env:LOCALAPPDATA\Android\Sdk",
  [string]$JavaHome = "C:\Program Files\Android\Android Studio\jbr"
)

$ErrorActionPreference = "Stop"

$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$targetRoot = [System.IO.Path]::GetFullPath($MirrorRoot)

if ($targetRoot.Length -gt 20) {
  throw "MirrorRoot must be a short absolute path such as C:\esm. Current path is too long: $targetRoot"
}
if ([string]::IsNullOrWhiteSpace($targetRoot) -or $targetRoot -eq "\" -or $targetRoot -match "^[A-Za-z]:\\?$") {
  throw "Refusing to mirror into a drive root: $targetRoot"
}

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

robocopy $sourceRoot $targetRoot /MIR /XD node_modules .git .expo dist android\build android\.gradle android\app\build android\app\.cxx /NFL /NDL /NJH /NJS /NP
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) {
  throw "robocopy failed with exit code $robocopyExit"
}

Push-Location $targetRoot
try {
  cmd /c npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

  cmd /c npx expo prebuild --platform android --clean
  if ($LASTEXITCODE -ne 0) { throw "expo prebuild failed" }

  $gradleProperties = Join-Path $targetRoot "android\gradle.properties"
  $escapedJavaHome = $JavaHome -replace "\\", "\\"
  $gradleText = Get-Content -Raw -LiteralPath $gradleProperties
  if (-not $gradleText.EndsWith("`n")) {
    [System.IO.File]::AppendAllText($gradleProperties, [Environment]::NewLine)
  }
  Add-Content -LiteralPath $gradleProperties -Value "org.gradle.java.home=$escapedJavaHome"

  $escapedSdk = $AndroidSdk -replace "\\", "\\"
  Set-Content -LiteralPath (Join-Path $targetRoot "android\local.properties") -Value "sdk.dir=$escapedSdk"

  cmd /c npm run android:assemble
  if ($LASTEXITCODE -ne 0) { throw "Android assemble failed" }
}
finally {
  Pop-Location
}

$sourceApk = Join-Path $targetRoot "android\app\build\outputs\apk\debug\app-debug.apk"
$outDir = Join-Path $sourceRoot "dist\android"
$outApk = Join-Path $outDir "echo-studio-mobile-debug.apk"
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot "package.json") | ConvertFrom-Json
$releaseDir = Join-Path $outDir "release"
$versionedDebugApk = Join-Path $releaseDir "echo-studio-mobile-v$($packageJson.version)-debug.apk"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Copy-Item -Force -LiteralPath $sourceApk -Destination $outApk
Copy-Item -Force -LiteralPath $sourceApk -Destination $versionedDebugApk

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $outApk
$versionedHash = Get-FileHash -Algorithm SHA256 -LiteralPath $versionedDebugApk
Set-Content -LiteralPath "$versionedDebugApk.sha256" -Value "$($versionedHash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $versionedDebugApk)"
Write-Output "Built $outApk"
Write-Output "SHA256 $($hash.Hash)"
Write-Output "Built $versionedDebugApk"
Write-Output "DEBUG_SHA256 $($versionedHash.Hash.ToLowerInvariant())"
