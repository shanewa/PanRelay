# Cursor hook 入口：无窗口运行 node（避免每次保存弹出 CMD）
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [string[]]$ExtraArgs = @()
)
$ErrorActionPreference = "Stop"
$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { exit 1 }
Set-Location $root
$nodeArgs = @($Script) + $ExtraArgs
& node @nodeArgs
exit $LASTEXITCODE
