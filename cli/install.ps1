$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 的下载进度条会把控制台卡住，看起来像安装程序一直不退出
$ProgressPreference = 'SilentlyContinue'
# TrackBox AI installer for Windows. One-shot: installs files, updates PATH, then exits.
# irm https://raw.githubusercontent.com/weiduhezi/trackbox-ai/main/cli/install.ps1 | iex
# Local: powershell -ExecutionPolicy Bypass -File .\cli\install.ps1
# trackbox-ai-install-rev 3

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node is required. Install Node.js 20 or newer, then run this script again.'
}

# 安装到 trackbox-ai，避开 Programs\trackbox 里的 TrackBox.exe，并清掉旧的 trackbox-cli 目录
$legacyDirs = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\trackbox'),
  (Join-Path $env:LOCALAPPDATA 'Programs\trackbox-cli')
)
foreach ($legacyDir in $legacyDirs) {
  foreach ($staleFile in @('trackbox.cmd', 'trackbox.mjs')) {
    $stalePath = Join-Path $legacyDir $staleFile
    if (Test-Path $stalePath) {
      Remove-Item $stalePath -Force -ErrorAction SilentlyContinue
    }
  }
}

$dest = Join-Path $env:LOCALAPPDATA 'Programs\trackbox-ai'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$localScript = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'bin\trackbox.mjs' } else { '' }
$target = Join-Path $dest 'trackbox.mjs'

if ($localScript -and (Test-Path $localScript)) {
  Copy-Item $localScript $target -Force
} else {
  $source = 'https://raw.githubusercontent.com/weiduhezi/trackbox-ai/main/cli/bin/trackbox.mjs'
  Write-Output "Downloading trackbox.mjs..."
  try {
    Invoke-WebRequest -Uri $source -OutFile $target -UseBasicParsing -TimeoutSec 20
  } catch {
    if (Test-Path $target) {
      Write-Output "Download timed out. Kept the existing install at $target"
    } else {
      throw "Download timed out and trackbox is not installed yet. Check access to raw.githubusercontent.com and run the command again."
    }
  }
}

$cmd = Join-Path $dest 'trackbox.cmd'
@(
  '@echo off'
  'node "%~dp0trackbox.mjs" %*'
) | Set-Content -Path $cmd -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
$parts = $userPath -split ';' | Where-Object { $_ -and ($_ -ne $dest) -and ($legacyDirs -notcontains $_) }
$updated = (@($dest) + $parts) -join ';'
[Environment]::SetEnvironmentVariable('Path', $updated, 'User')

$sessionParts = ($env:Path -split ';') | Where-Object { $_ -and ($_ -ne $dest) -and ($legacyDirs -notcontains $_) }
$env:Path = (@($dest) + $sessionParts) -join ';'

Write-Output "Installed trackbox to $target"
Write-Output 'Run: trackbox doctor'
