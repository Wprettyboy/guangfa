param(
  [switch]$RecreateCredentials
)

function New-RandomSecret {
  $bytes = [byte[]]::new(48)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Read-JsonFile([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { return [pscustomobject]@{} }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Read-EnvValue([string]$Path, [string]$Name) {
  if (!(Test-Path -LiteralPath $Path)) { return "" }
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -Last 1
  if (!$line) { return "" }
  return ($line -split "=", 2)[1].Trim()
}

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$DockerContext = "C:\llm\guangfa-repo"
$ComposeFile = Join-Path $Root "docker\knowledge\compose.yaml"
$RuntimeDir = Join-Path $Root "data\knowledge-service"
$ServiceEnv = Join-Path $RuntimeDir "service.env"
$ClientConfig = Join-Path $RuntimeDir "client-config.json"
$HealthUrl = "http://127.0.0.1:8787/readyz"

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not ready." }

if (!(Test-Path -LiteralPath $DockerContext)) {
  New-Item -ItemType Junction -Path $DockerContext -Target $Root | Out-Null
}
if (!(Test-Path -LiteralPath (Join-Path $DockerContext "docker\knowledge\Dockerfile"))) {
  throw "The ASCII Docker build context does not point to this project: $DockerContext"
}

New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
if ($RecreateCredentials -or !(Test-Path -LiteralPath $ServiceEnv)) {
  $apiKey = New-RandomSecret
  $capabilitySecret = New-RandomSecret
  $credentials = ConvertTo-Json -Compress -InputObject @(@{
    key = $apiKey
    id = "default-project-service"
    roles = @("editor")
    projectIds = @("default-project")
  })

  $modelConfig = Read-JsonFile (Join-Path $Root "data\settings\model-config.json")
  $cloud = $modelConfig.cloud
  $geminiBaseUrl = if ($cloud.baseUrl -match "generativelanguage\.googleapis\.com") { "$($cloud.baseUrl)" } else { "" }
  $geminiModel = if ($cloud.model -match "gemini") { "$($cloud.model)" } else { "" }
  $geminiApiKey = if ($geminiBaseUrl -and $geminiModel) { "$($cloud.apiKey)" } else { "" }
  $onlyOfficeSecret = Read-EnvValue (Join-Path $Root ".env.local") "ONLYOFFICE_JWT_SECRET"
  if (!$onlyOfficeSecret) { $onlyOfficeSecret = New-RandomSecret }

  $lines = @(
    "KNOWLEDGE_API_PORT=8787",
    "API_AUTH_API_KEYS=$credentials",
    "API_CAPABILITY_SECRET=$capabilitySecret",
    "API_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173",
    "KNOWLEDGE_GEMINI_BASE_URL=$geminiBaseUrl",
    "KNOWLEDGE_GEMINI_MODEL=$geminiModel",
    "KNOWLEDGE_GEMINI_API_KEY=$geminiApiKey",
    "KNOWLEDGE_GEMINI_PROXY_URL=$($modelConfig.proxyUrl)",
    "ONLYOFFICE_JWT_SECRET=$onlyOfficeSecret"
  )
  [IO.File]::WriteAllLines($ServiceEnv, $lines, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($ClientConfig, (@{
    baseUrl = "http://127.0.0.1:8787/api/v1"
    apiKeyHeader = "X-API-Key"
    apiKey = $apiKey
    projectIds = @("default-project")
  } | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
}

docker compose --env-file $ServiceEnv -f $ComposeFile up -d --build
if ($LASTEXITCODE -ne 0) { throw "Knowledge API Docker service failed to start." }

for ($index = 0; $index -lt 60; $index += 1) {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
    if ($health.ok) {
      $client = Get-Content -LiteralPath $ClientConfig -Raw | ConvertFrom-Json
      $headers = @{ "X-API-Key" = $client.apiKey }
      Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/v1/knowledge-bases" -Headers $headers -TimeoutSec 10 | Out-Null
      Write-Host "Knowledge API is ready: http://127.0.0.1:8787"
      Write-Host "Client configuration: $ClientConfig"
      exit 0
    }
  } catch {}
  Start-Sleep -Seconds 2
}

docker compose --env-file $ServiceEnv -f $ComposeFile ps
docker compose --env-file $ServiceEnv -f $ComposeFile logs --tail 80 knowledge-api
throw "Knowledge API did not become healthy."
