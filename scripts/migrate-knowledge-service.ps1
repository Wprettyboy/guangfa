param(
  [string]$SourceDataDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "data"),
  [string]$RuntimeDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "data\knowledge-service")
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$composeFile = Join-Path $repoRoot "docker\knowledge\compose.yaml"
$envFile = Join-Path $RuntimeDir "service.env"
$clientConfigPath = Join-Path $RuntimeDir "client-config.json"
$backupDir = Join-Path $RuntimeDir "backups"
$volumeName = "guangfa-knowledge-data"
$containerName = "guangfa-knowledge-api"
$imageName = "guangfa/knowledge-api:1.0.0"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupName = "knowledge-data-$timestamp.tar.gz"
$backupPath = Join-Path $backupDir $backupName
$migrationSucceeded = $false

function Invoke-Compose([string[]]$Arguments) {
  & docker compose --env-file $envFile -f $composeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed: $($Arguments -join ' ')" }
}

function Wait-KnowledgeService {
  for ($attempt = 1; $attempt -le 60; $attempt += 1) {
    try {
      $ready = Invoke-RestMethod -Uri "http://127.0.0.1:8787/readyz" -TimeoutSec 3
      if ($ready.ok) { return }
    } catch {}
    Start-Sleep -Seconds 2
  }
  throw "Knowledge API did not become ready."
}

function Restore-Backup {
  Write-Warning "Migration failed. Restoring the Docker volume backup."
  & docker stop $containerName 2>$null | Out-Null
  $restoreCommand = 'rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null || true; tar -C /data -xzf /backup/{0}' -f $backupName
  & docker run --rm --mount "source=$volumeName,target=/data" --mount "type=bind,source=$backupDir,target=/backup" alpine:3.20 sh -c $restoreCommand
  if ($LASTEXITCODE -ne 0) { throw "Automatic restore failed. Backup retained at $backupPath" }
  Invoke-Compose -Arguments @("up", "-d")
  Wait-KnowledgeService
}

function Set-DotEnvValues([string]$Path, [hashtable]$Values) {
  $lines = New-Object "System.Collections.Generic.List[string]"
  if (Test-Path $Path) {
    Get-Content $Path | ForEach-Object { [void]$lines.Add([string]$_) }
  }
  foreach ($Name in $Values.Keys) {
    $index = -1
    for ($i = 0; $i -lt $lines.Count; $i += 1) {
      if ($lines[$i] -match "^$([regex]::Escape($Name))=") { $index = $i; break }
    }
    $entry = "$Name=$($Values[$Name])"
    if ($index -ge 0) { $lines[$index] = $entry } else { $lines.Add($entry) }
  }
  $tempPath = "$Path.tmp"
  [System.IO.File]::WriteAllLines($tempPath, $lines, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tempPath -Destination $Path -Force
}

if (-not (Test-Path $envFile) -or -not (Test-Path $clientConfigPath)) {
  throw "Run npm run knowledge:docker before migration to create the service runtime configuration."
}
if (-not (Test-Path (Join-Path $SourceDataDir "guangfa.sqlite"))) {
  throw "Source database does not exist: $SourceDataDir\guangfa.sqlite"
}
if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
  throw "The main Web service is listening on port 5173. Stop it before migration to freeze knowledge writes."
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Invoke-Compose -Arguments @("build")
& docker run --rm --mount "source=$volumeName,target=/data" --mount "type=bind,source=$backupDir,target=/backup" alpine:3.20 tar -C /data -czf "/backup/$backupName" .
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $backupPath)) { throw "Docker volume backup failed." }

try {
  & docker stop $containerName 2>$null | Out-Null
  & docker run --rm `
    --mount "type=bind,source=$SourceDataDir,target=/legacy,readonly" `
    --mount "source=$volumeName,target=/data" `
    $imageName node scripts/migrate-knowledge-to-service.mjs
  if ($LASTEXITCODE -ne 0) { throw "Knowledge data import failed." }

  Invoke-Compose -Arguments @("up", "-d")
  Wait-KnowledgeService

  $client = Get-Content -Raw $clientConfigPath | ConvertFrom-Json
  $headers = @{}
  $headers[$client.apiKeyHeader] = $client.apiKey
  $bases = Invoke-RestMethod -Uri "$($client.baseUrl)/knowledge-bases" -Headers $headers -TimeoutSec 30
  $probeJson = & docker run --rm --mount "type=bind,source=$SourceDataDir,target=/legacy,readonly" --mount "source=$volumeName,target=/data" $imageName node scripts/migrate-knowledge-to-service.mjs --verify-only
  if ($LASTEXITCODE -ne 0) { throw "Post-migration count verification failed." }
  $probe = $probeJson | Select-Object -Last 1 | ConvertFrom-Json
  if ($bases.Count -ne $probe.counts.knowledge_bases) { throw "Knowledge base count returned by the API differs from the source." }

  Invoke-RestMethod -Method Post -Uri "$($client.baseUrl)/knowledge-bases/$($probe.reindexKbId)/reindex" -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 900 | Out-Null
  if ($probe.searchQuery) {
    $searchBody = @{ query = $probe.searchQuery; kbIds = @($probe.reindexKbId); projectId = "default-project"; topK = 1 } | ConvertTo-Json -Depth 5
    $search = Invoke-RestMethod -Method Post -Uri "$($client.baseUrl)/knowledge-bases/search" -Headers $headers -ContentType "application/json" -Body $searchBody -TimeoutSec 30
    if (-not $search.items -or $search.diagnostics.indexVersion -ne 4 -or $search.diagnostics.degradedReasons.Count -gt 0) {
      throw "Post-migration V4 search probe failed."
    }
  }

  Set-DotEnvValues (Join-Path $repoRoot ".env.local") @{
    KNOWLEDGE_SERVICE_BASE_URL = $client.baseUrl
    KNOWLEDGE_SERVICE_API_KEY = $client.apiKey
  }
  $migrationSucceeded = $true
  Write-Host "Knowledge migration completed. Backup: $backupPath"
} catch {
  Restore-Backup
  throw
} finally {
  if (-not $migrationSucceeded) { Write-Warning "The main project was not switched to the standalone Knowledge API." }
}
