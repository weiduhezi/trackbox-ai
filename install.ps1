# TrackBox CLI installer for Windows.
# irm https://raw.githubusercontent.com/weiduhezi/trackbox-cli/main/install.ps1 | iex
# Local: powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node is required. Install Node.js 20 or newer, then run this script again.'
}

# 独立目录，避免与桌面端 %LOCALAPPDATA%\Programs\trackbox\TrackBox.exe 在 PATH 中因 PATHEXT (.EXE > .CMD) 冲突
$legacyDesktopDir = Join-Path $env:LOCALAPPDATA 'Programs\trackbox'
foreach ($staleFile in @('trackbox.cmd', 'trackbox.mjs')) {
  $stalePath = Join-Path $legacyDesktopDir $staleFile
  if (Test-Path $stalePath) {
    Remove-Item $stalePath -Force -ErrorAction SilentlyContinue
  }
}

$dest = Join-Path $env:LOCALAPPDATA 'Programs\trackbox-cli'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$localScript = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'bin\trackbox.mjs' } else { '' }
$target = Join-Path $dest 'trackbox.mjs'

if ($localScript -and (Test-Path $localScript)) {
  Copy-Item $localScript $target -Force
} else {
  $source = 'https://raw.githubusercontent.com/weiduhezi/trackbox-cli/main/bin/trackbox.mjs'
  Invoke-WebRequest -Uri $source -OutFile $target -UseBasicParsing
}

$cmd = Join-Path $dest 'trackbox.cmd'
@(
  '@echo off'
  'node "%~dp0trackbox.mjs" %*'
) | Set-Content -Path $cmd -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
$parts = $userPath -split ';' | Where-Object { $_ -and ($_ -ne $dest) -and ($_ -ne $legacyDesktopDir) }
$updated = (@($dest) + $parts) -join ';'
[Environment]::SetEnvironmentVariable('Path', $updated, 'User')

$sessionParts = ($env:Path -split ';') | Where-Object { $_ -and ($_ -ne $dest) -and ($_ -ne $legacyDesktopDir) }
$env:Path = (@($dest) + $sessionParts) -join ';'

Write-Output "Installed trackbox to $target"
Write-Output 'Run: trackbox doctor'
