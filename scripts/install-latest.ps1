# Installs or updates the CodeTour IA VS Code extension in one command.
#
# Downloads the platform-matching VSIX from a GitHub release of
# ${CODETOUR_REPO:-maurice30120/codetour} — the release assets are the VSIX
# files the Release workflow builds and attaches in CI — then runs
# `code --install-extension` on it. Rerun with the same settings to update.
# Source selection via $env:CODETOUR_TAG (exact release),
# $env:CODETOUR_CHANNEL = "beta" (accept pre-releases),
# $env:CODETOUR_VSIX_URL (explicit VSIX), $env:CODETOUR_REPO (fork).
# See README.md >> Install or update with one command.

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSVersion.Major -le 5) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

$repo = if ($env:CODETOUR_REPO) { $env:CODETOUR_REPO } else { "maurice30120/codetour" }
$releasesUrl = "https://github.com/$repo/releases"

$vsixArch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$target = "win32-$vsixArch"

$codeCommand = Get-Command code -ErrorAction SilentlyContinue
if (-not $codeCommand) {
  throw "The VS Code 'code' command is not on PATH. Add VS Code's bin folder to PATH, then retry."
}

try {
  $vsixUrl = $env:CODETOUR_VSIX_URL
  if (-not $vsixUrl) {
    $apiPath = "/releases/latest"
    if ($env:CODETOUR_TAG) {
      $apiPath = "/releases/tags/$($env:CODETOUR_TAG)"
    } elseif ($env:CODETOUR_CHANNEL -eq "beta") {
      $apiPath = "/releases"
    }
    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo$apiPath"
    $release = @($response)[0]
    $tag = $release.tag_name
    $asset = $release.assets |
      Where-Object { $_.name -like "codetour-$target-*.vsix" } |
      Select-Object -First 1
    if (-not $asset) {
      $assets = ($release.assets |
        Where-Object { $_.name -like "codetour-*.vsix" } |
        Select-Object -ExpandProperty name) -join "`n"
      if ($assets) {
        throw "Release $tag has no 'codetour-$target-*.vsix' asset. Available VSIX assets:`n$assets"
      }
      $hint = "Retry in a few minutes once the Release workflow finishes."
      if ($env:CODETOUR_CHANNEL -eq "beta") {
        $hint += " Or pin one with `$env:CODETOUR_TAG."
      }
      throw "Release $tag has no CodeTour VSIX asset yet. $hint"
    }
    $vsixUrl = $asset.browser_download_url
  }

  $work = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $vsix = Join-Path $work ($vsixUrl -split "/")[-1]
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $vsixUrl -OutFile $vsix
    Write-Host "Installing CodeTour IA from $(Split-Path -Leaf $vsix) (release $tag)..."
    & code --install-extension $vsix --force
    if ($LASTEXITCODE -ne 0) {
      throw "VS Code refused to install the downloaded VSIX. Try manually from $releasesUrl with 'Extensions: Install from VSIX...'."
    }
    Write-Host "Done. Reload the VS Code window to load the installed version."
  } finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  }
} catch {
  Write-Error "install-latest: $_"
  exit 1
}
