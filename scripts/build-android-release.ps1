param(
  [string]$MirrorRoot = "C:\esmr",
  [string]$AndroidSdk = "$env:LOCALAPPDATA\Android\Sdk",
  [string]$JavaHome = "C:\Program Files\Android\Android Studio\jbr",
  [string]$KeystoreRoot = "$env:USERPROFILE\.echo-studio-mobile\release"
)

$ErrorActionPreference = "Stop"

function New-Secret {
  $chars = ([char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789')
  -join (1..36 | ForEach-Object { $chars | Get-Random })
}

function Read-Properties($path) {
  $props = @{}
  if (Test-Path -LiteralPath $path) {
    Get-Content -LiteralPath $path | ForEach-Object {
      if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $props[$matches[1].Trim()] = $matches[2].Trim()
      }
    }
  }
  $props
}

function Ensure-Newline($path) {
  $text = Get-Content -Raw -LiteralPath $path
  if (-not $text.EndsWith("`n")) {
    [System.IO.File]::AppendAllText($path, [Environment]::NewLine)
  }
}

function Write-HashFile($path) {
  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $path
  $hashLine = "$($hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $path)"
  Set-Content -LiteralPath "$path.sha256" -Value $hashLine
  $hash.Hash.ToLowerInvariant()
}

$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$targetRoot = [System.IO.Path]::GetFullPath($MirrorRoot)

if ($targetRoot.Length -gt 24) {
  throw "MirrorRoot must be a short absolute path such as C:\esmr. Current path is too long: $targetRoot"
}
if ([string]::IsNullOrWhiteSpace($targetRoot) -or $targetRoot -eq "\" -or $targetRoot -match "^[A-Za-z]:\\?$") {
  throw "Refusing to mirror into a drive root: $targetRoot"
}

$packageJson = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot "package.json") | ConvertFrom-Json
$version = $packageJson.version

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
New-Item -ItemType Directory -Force -Path $KeystoreRoot | Out-Null

$keystorePath = Join-Path $KeystoreRoot "echo-studio-mobile-upload-v2.jks"
$secretsPath = Join-Path $KeystoreRoot "keystore.properties"
$secrets = Read-Properties $secretsPath

if (-not $secrets.ContainsKey("storePassword")) { $secrets["storePassword"] = New-Secret }
if (-not $secrets.ContainsKey("keyAlias")) { $secrets["keyAlias"] = "echo-studio-mobile" }
$secrets["keyPassword"] = $secrets["storePassword"]

Set-Content -LiteralPath $secretsPath -Value @(
  "storePassword=$($secrets["storePassword"])",
  "keyPassword=$($secrets["keyPassword"])",
  "keyAlias=$($secrets["keyAlias"])",
  "storeType=JKS"
)

if (-not (Test-Path -LiteralPath $keystorePath)) {
  $keytool = Join-Path $JavaHome "bin\keytool.exe"
  if (-not (Test-Path -LiteralPath $keytool)) {
    throw "keytool.exe was not found at $keytool"
  }
  & $keytool -genkeypair -v `
    -keystore $keystorePath `
    -storetype JKS `
    -storepass $secrets["storePassword"] `
    -keypass $secrets["keyPassword"] `
    -alias $secrets["keyAlias"] `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -dname "CN=ECHO Studio Mobile,O=ECHO Platform,C=US"
  if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
}

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
  Ensure-Newline $gradleProperties

  $escapedJavaHome = $JavaHome -replace "\\", "\\"
  $escapedSdk = $AndroidSdk -replace "\\", "\\"
  Add-Content -LiteralPath $gradleProperties -Value "org.gradle.java.home=$escapedJavaHome"
  Set-Content -LiteralPath (Join-Path $targetRoot "android\local.properties") -Value "sdk.dir=$escapedSdk"

  $mirrorKeystore = Join-Path $targetRoot "android\app\echo-release.jks"
  Copy-Item -Force -LiteralPath $keystorePath -Destination $mirrorKeystore
  Add-Content -LiteralPath $gradleProperties -Value @(
    "ECHO_RELEASE_STORE_FILE=echo-release.jks",
    "ECHO_RELEASE_STORE_PASSWORD=$($secrets["storePassword"])",
    "ECHO_RELEASE_KEY_ALIAS=$($secrets["keyAlias"])",
    "ECHO_RELEASE_KEY_PASSWORD=$($secrets["keyPassword"])"
  )

  $appGradle = Join-Path $targetRoot "android\app\build.gradle"
  Add-Content -LiteralPath $appGradle -Value @"

android {
    signingConfigs {
        release {
            storeFile file(findProperty("ECHO_RELEASE_STORE_FILE") ?: "echo-release.jks")
            storePassword findProperty("ECHO_RELEASE_STORE_PASSWORD")
            keyAlias findProperty("ECHO_RELEASE_KEY_ALIAS")
            keyPassword findProperty("ECHO_RELEASE_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
"@

  $env:NODE_ENV = "production"
  cmd /c "cd android && gradlew.bat assembleRelease bundleRelease"
  if ($LASTEXITCODE -ne 0) { throw "Android release build failed" }
}
finally {
  Pop-Location
}

$sourceApk = Join-Path $targetRoot "android\app\build\outputs\apk\release\app-release.apk"
$sourceAab = Join-Path $targetRoot "android\app\build\outputs\bundle\release\app-release.aab"
$outDir = Join-Path $sourceRoot "dist\android\release"
$outApk = Join-Path $outDir "echo-studio-mobile-v$version-release.apk"
$outAab = Join-Path $outDir "echo-studio-mobile-v$version-release.aab"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item -Force -LiteralPath $sourceApk -Destination $outApk
Copy-Item -Force -LiteralPath $sourceAab -Destination $outAab

$apkHash = Write-HashFile $outApk
$aabHash = Write-HashFile $outAab

Write-Output "Built $outApk"
Write-Output "APK_SHA256 $apkHash"
Write-Output "Built $outAab"
Write-Output "AAB_SHA256 $aabHash"
Write-Output "Keystore stored outside the repository at $keystorePath"
