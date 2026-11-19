$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 的下载进度条会把控制台卡住，看起来像安装程序一直不退出
$ProgressPreference = 'SilentlyContinue'
# TrackBox AI installer for Windows. One-shot: installs files, updates PATH, then exits.
# irm https://raw.githubusercontent.com/weiduhezi/trackbox-ai/main/cli/install.ps1 | iex
# Local: powershell -ExecutionPolicy Bypass -File .\cli\install.ps1
# trackbox-ai-install-rev 4

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  throw 'Node.js 20 or newer is required. Install Node.js 20+, then run this script again.'
}

$nodeMajorRaw = (& node -p "process.versions.node.split('.')[0]" 2>$null)
$nodeMajor = 0
[void][int]::TryParse("$nodeMajorRaw", [ref]$nodeMajor)
if ($nodeMajor -lt 20) {
  $nodeVer = (& node -v 2>$null)
  throw "Node.js 20 or newer is required (found $nodeVer). Upgrade Node.js, then run this script again."
}
$nodeExe = $nodeCmd.Source

# 安装到 trackbox-ai，避开 Programs\trackbox 里的 TrackBox.exe，并清掉旧的 trackbox-cli 目录
$legacyDirs = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\trackbox'),
  (Join-Path $env:LOCALAPPDATA 'Programs\trackbox-cli')
)
foreach ($legacyDir in $legacyDirs) {
  foreach ($staleFile in @('trackbox.cmd', 'trackbox.ps1', 'trackbox.mjs')) {
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
  "if exist `"$nodeExe`" ("
  "  `"$nodeExe`" `"%~dp0trackbox.mjs`" %*"
  ') else ('
  '  node "%~dp0trackbox.mjs" %*'
  ')'
) | Set-Content -Path $cmd -Encoding ASCII

# PowerShell 5.1 调用 .cmd 会剥离 JSON 参数里的双引号；在策略允许时一并写入原生 .ps1 包装器无损透传参数
$ps1 = Join-Path $dest 'trackbox.ps1'
$effectivePolicy = Get-ExecutionPolicy
if ($effectivePolicy -notin @('Restricted', 'AllSigned')) {
  @(
    '#!/usr/bin/env pwsh'
    "`$preferredNode = '$nodeExe'"
    '$nodeBin = if (Test-Path $preferredNode) { $preferredNode } else { "node" }'
    '$prevArgsJson = $env:TRACKBOX_CLI_ARGS_JSON'
    'try {'
    '  $items = foreach ($item in $args) { ConvertTo-Json -Compress ([string]$item) }'
    '  $env:TRACKBOX_CLI_ARGS_JSON = "[" + ($items -join ",") + "]"'
    '  if ($MyInvocation.ExpectingInput) {'
    '    $input | & $nodeBin "$PSScriptRoot\trackbox.mjs"'
    '  } else {'
    '    & $nodeBin "$PSScriptRoot\trackbox.mjs"'
    '  }'
    '  exit $LASTEXITCODE'
    '} finally {'
    '  $env:TRACKBOX_CLI_ARGS_JSON = $prevArgsJson'
    '}'
  ) | Set-Content -Path $ps1 -Encoding UTF8
} elseif (Test-Path $ps1) {
  Remove-Item $ps1 -Force -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
$parts = $userPath -split ';' | Where-Object { $_ -and ($_ -ne $dest) -and ($legacyDirs -notcontains $_) }
$updated = (@($dest) + $parts) -join ';'
[Environment]::SetEnvironmentVariable('Path', $updated, 'User')

$sessionParts = ($env:Path -split ';') | Where-Object { $_ -and ($_ -ne $dest) -and ($legacyDirs -notcontains $_) }
$env:Path = (@($dest) + $sessionParts) -join ';'

$escapedNode = $nodeExe -replace '\\', '\\'
$escapedTarget = $target -replace '\\', '\\'

Write-Output "Installed trackbox to $target"
Write-Output ''
Write-Output 'Next:'
Write-Output '  trackbox login  # default scope: canvas:read canvas:write canvas:run'
Write-Output '  trackbox login --scope "canvas:read canvas:write"  # read/write only'
Write-Output ''
Write-Output 'Desktop MCP config (absolute paths for Cursor / Claude Desktop):'
Write-Output @"
{
  "mcpServers": {
    "trackbox": {
      "command": "$escapedNode",
      "args": ["$escapedTarget", "mcp"]
    }
  }
}
"@
