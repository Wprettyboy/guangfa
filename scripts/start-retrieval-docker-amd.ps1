param(
  [string]$Distro = "Ubuntu-24.04"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $Root "docker\retrieval\compose.amd.yaml"
$HealthUrl = "http://127.0.0.1:8000/health"
$DockerContext = "C:\llm\guangfa-repo"

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not ready." }

if (!(Test-Path $DockerContext)) {
  New-Item -ItemType Junction -Path $DockerContext -Target $Root | Out-Null
}
if (!(Test-Path (Join-Path $DockerContext "docker\retrieval\Dockerfile.amd"))) {
  throw "The ASCII Docker build context does not point to this project: $DockerContext"
}

& wsl.exe -d $Distro -- bash "/mnt/c/llm/guangfa-repo/scripts/bootstrap-retrieval-wsl.sh"
if ($LASTEXITCODE -ne 0) { throw "Retrieval WSL runtime bootstrap failed." }
& (Join-Path $PSScriptRoot "prepare-retrieval-docker-amd.ps1") -Distro $Distro
if ($LASTEXITCODE -ne 0) { throw "Retrieval Docker volume preparation failed." }

docker compose -f $ComposeFile build
if ($LASTEXITCODE -ne 0) { throw "Retrieval AMD Docker image build failed." }
docker compose -f $ComposeFile run --rm --no-deps --entrypoint /opt/guangfa-retrieval/venv/bin/python retrieval -c `
  "import torch; assert torch.cuda.is_available(); x=torch.arange(16,device='cuda'); assert x.sum().item()==120; print(torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) { throw "Retrieval Docker GPU tensor probe failed." }

$listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  $legacyEmbeddingScript = (Join-Path $Root "scripts\local_embedding_server.py").ToLowerInvariant()
  $commandLine = "$($processInfo.CommandLine)".ToLowerInvariant()
  if ($process -and ($process.Path -like "*\.venv-embedding\*" -or $commandLine.Contains($legacyEmbeddingScript))) {
    Write-Host "Stopping legacy host Embedding service, pid=$($process.Id)"
    Stop-Process -Id $process.Id -Force
    Start-Sleep -Seconds 2
  } elseif ($process -and $process.ProcessName -notlike "com.docker*") {
    throw "Port 8000 is occupied by an unrelated process: $($process.Path)"
  }
}

docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) { throw "Retrieval AMD Docker service failed to start." }

Write-Host "Waiting for Retrieval models to load..."
$encodeBody = [Text.Encoding]::UTF8.GetBytes('{"input":["ISO27001 qualification"],"deadline_ms":60000}')
$rerankBody = [Text.Encoding]::UTF8.GetBytes('{"query":"qualification","documents":["supplier construction qualification","monthly payment terms"],"deadline_ms":30000}')
for ($index = 0; $index -lt 180; $index += 1) {
  try {
    $health = Invoke-RestMethod $HealthUrl -TimeoutSec 5
    if ($health.status -eq "healthy" -and $health.embedding_loaded -and $health.reranker_loaded) {
      $encode = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/retrieval/encode" -ContentType "application/json; charset=utf-8" -Body $encodeBody -TimeoutSec 90
      if ($encode.data[0].dense_embedding.Count -ne 1024 -or !$encode.data[0].sparse_embedding) { throw "Retrieval encode smoke test failed." }
      $rerank = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/rerank" -ContentType "application/json; charset=utf-8" -Body $rerankBody -TimeoutSec 45
      if ($rerank.data.Count -ne 2) { throw "Retrieval rerank smoke test failed." }
      Write-Host "Retrieval AMD Docker is ready: $HealthUrl"
      exit 0
    }
  } catch {}
  Start-Sleep -Seconds 5
}

docker compose -f $ComposeFile ps
throw "Retrieval Docker did not become healthy. Check Docker Compose logs."
