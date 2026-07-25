param(
  [string]$Distro = "Ubuntu-24.04"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RepoLink = "C:\llm\guangfa-repo"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RepoLink) | Out-Null
if (!(Test-Path -LiteralPath $RepoLink)) {
  New-Item -ItemType Junction -Path $RepoLink -Target $Root | Out-Null
}

$ResolvedRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd("\")
$LinkTarget = (Get-Item -LiteralPath $RepoLink).Target | Select-Object -First 1
if (!$LinkTarget -or (Resolve-Path -LiteralPath $LinkTarget).Path.TrimEnd("\") -ne $ResolvedRoot) {
  throw "MinerU WSL repository junction points to another project: $RepoLink"
}

& wsl.exe -d $Distro -- bash /mnt/c/llm/guangfa-repo/scripts/start-mineru-wsl.sh
if ($LASTEXITCODE -ne 0) {
  throw "MinerU WSL services failed to start. Check /opt/guangfa-mineru/logs/*.log."
}

$Vlm = Invoke-RestMethod "http://127.0.0.1:30000/health" -TimeoutSec 15
$Api = Invoke-RestMethod "http://127.0.0.1:8010/health" -TimeoutSec 15
if ($Vlm.status -ne "healthy" -or $Api.status -ne "healthy") {
  throw "MinerU WSL health check returned an unexpected result."
}

Write-Host "MinerU WSL Hybrid is ready: http://127.0.0.1:8010"
