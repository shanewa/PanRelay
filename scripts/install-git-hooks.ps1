$ErrorActionPreference = "Stop"
$root = git rev-parse --show-toplevel
if (-not $root) {
  Write-Error "Not inside a git repository."
}

$src = Join-Path $PSScriptRoot "git-hooks"
$dst = Join-Path $root ".git\hooks"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

git config user.name "Shane Wang"
git config user.email "shanewa@qq.com"
Write-Host "Set local git user.name=Shane Wang, user.email=shanewa@qq.com"

foreach ($hook in Get-ChildItem $src -File) {
  $content = [System.IO.File]::ReadAllText($hook.FullName) -replace "`r`n", "`n" -replace "`r", "`n"
  $dest = Join-Path $dst $hook.Name
  [System.IO.File]::WriteAllText($dest, $content, $utf8NoBom)
  Write-Host "Installed $($hook.Name)"
}

Write-Host "Git hooks installed to $dst"
