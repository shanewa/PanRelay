# Cursor hook 入口：无窗口运行 node（避免弹出 CMD / PowerShell 窗口）
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [string[]]$ExtraArgs = @()
)
$ErrorActionPreference = "Stop"
$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { exit 1 }
Set-Location $root

$scriptPath = Join-Path $root ($Script -replace '/', '\')
if (-not (Test-Path -LiteralPath $scriptPath)) { exit 1 }

function Quote-ProcessArg([string]$Value) {
  if ($Value -match '[\s"]') {
    return '"' + ($Value -replace '"', '\"') + '"'
  }
  return $Value
}

$argList = @($scriptPath) + $ExtraArgs
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = ($argList | ForEach-Object { Quote-ProcessArg $_ }) -join ' '
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

$p = [System.Diagnostics.Process]::Start($psi)
$p.WaitForExit()
exit $p.ExitCode
