# Installs or updates the CodeTour IA VS Code extension in one command.
#
# Downloads the platform-matching VSIX from the latest GitHub release of
# ${CODETOUR_REPO:-maurice30120/codetour} — the release assets are the VSIX
# files the Release workflow builds and attaches in CI — then runs
# `code --install-extension` on it. Run it again to upgrade to the latest
# published version. See README.md >> Install or update with one command.

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
  throw "The VS Code 'code' command is not on PATH. Add VS Code's bin folder to PATH (Command Palette >> 'Shell Command: install code command in PATH' has no PowerShell equivalent on Windows), then retry."
}

try {
  $vsixUrl = $env:CODETOUR_VSIX_URL
  $tag = "pinned URL override"
  if (-not $vsixUrl) {
    $apiUrl = "https://api.github.com/repos/$repo/releases/latest"
    $release = Invoke-RestMethod -Uri $apiUrl
    $tag = $release.tag_name
    $asset = $release.assets | Where-Object { $_.name -like "codetour-$target-*.vsix" } | Select-Object -First 1
    if (-not $asset) {
      $assets = ($release.assets |
        Where-Object { $_.name -like "codetour-*.vsix" } |
        Select-Object -ExpandProperty name) -join "`n"
      if ($assets) {
        throw "Release $tag has no 'codetour-$target-*.vsix' asset. Available VSIX assets:`n$assets"
      }
      throw "Release $tag has no CodeTour VSIX asset yet; the Release workflow may still be building. Retry in a few minutes."
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
