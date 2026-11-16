# TrackBox CLI installer for Windows.
# irm https://raw.githubusercontent.com/liuheng3580/trackbox-cli/main/install.ps1 | iex
# Local: powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node is required. Install Node.js 20 or newer, then run this script again.'
}

$dest = Join-Path $env:LOCALAPPDATA 'Programs\trackbox'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$localScript = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'bin\trackbox.mjs' } else { '' }
$target = Join-Path $dest 'trackbox.mjs'

if ($localScript -and (Test-Path $localScript)) {
  Copy-Item $localScript $target -Force
} else {
  $source = 'https://raw.githubusercontent.com/liuheng3580/trackbox-cli/main/bin/trackbox.mjs'
  Invoke-WebRequest -Uri $source -OutFile $target -UseBasicParsing
}

$cmd = Join-Path $dest 'trackbox.cmd'
@(
  '@echo off'
  'node "%~dp0trackbox.mjs" %*'
) | Set-Content -Path $cmd -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
$parts = $userPath -split ';' | Where-Object { $_ -and ($_ -ne $dest) }
$updated = (@($dest) + $parts) -join ';'
[Environment]::SetEnvironmentVariable('Path', $updated, 'User')
if (($env:Path -split ';') -notcontains $dest) {
  $env:Path = "$dest;$env:Path"
}

Write-Output "Installed trackbox to $target"
Write-Output 'Open a new terminal, then run: trackbox doctor'
