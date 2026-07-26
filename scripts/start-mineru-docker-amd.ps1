param([switch]$WithVlm)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $Root "docker\mineru\compose.amd.yaml"
$HealthUrl = "http://127.0.0.1:8010/health"
$VlmHealthUrl = "http://127.0.0.1:30000/health"
$DockerContext = "C:\llm\guangfa-repo"

function Test-DockerReady {
  docker info *> $null
  return $LASTEXITCODE -eq 0
}

if (!(Test-DockerReady)) { throw "Docker Desktop is not ready." }

if (!(Test-Path $DockerContext)) {
  New-Item -ItemType Junction -Path $DockerContext -Target $Root | Out-Null
}
if (!(Test-Path (Join-Path $DockerContext "docker\mineru\Dockerfile.amd"))) {
  throw "The ASCII Docker build context does not point to this project: $DockerContext"
}

& (Join-Path $PSScriptRoot "prepare-mineru-docker-amd.ps1")
if ($LASTEXITCODE -ne 0) { throw "MinerU Docker volumes are not ready." }

docker compose -f $ComposeFile build
if ($LASTEXITCODE -ne 0) { throw "MinerU AMD Docker image build failed." }

Write-Host "Checking Radeon GPU access from Docker..."
docker compose -f $ComposeFile run --rm --no-deps --entrypoint /opt/guangfa-mineru/venv/bin/python mineru-api -c `
  "import torch; assert torch.cuda.is_available(); x=torch.arange(16,device='cuda'); assert x.sum().item()==120; print(torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) { throw "Docker cannot execute a PyTorch tensor on the Radeon GPU." }

& wsl.exe -d Ubuntu-24.04 -- bash -lc "pkill -f '[m]ineru_transformers_server:app' || true; pkill -x mineru-api || true"
Start-Sleep -Seconds 2

if ($WithVlm) {
  docker compose -f $ComposeFile --profile local-vlm up -d mineru-vlm mineru-api
} else {
  docker compose -f $ComposeFile --profile local-vlm stop mineru-vlm
  docker compose -f $ComposeFile up -d mineru-api
}
if ($LASTEXITCODE -ne 0) { throw "MinerU AMD Docker services failed to start." }

Write-Host "Waiting for MinerU Docker services..."
for ($i = 0; $i -lt 180; $i++) {
  try {
    $health = Invoke-RestMethod $HealthUrl -TimeoutSec 5
    $vlmReady = !$WithVlm
    if ($WithVlm) {
      try {
        $vlmHealth = Invoke-RestMethod $VlmHealthUrl -TimeoutSec 5
        $vlmReady = $vlmHealth.status -eq "healthy"
      } catch {
        $vlmReady = $false
      }
    }
    if ($health.status -eq "healthy" -and $vlmReady) {
      Write-Host "MinerU AMD Docker is ready: $HealthUrl"
      if ($WithVlm) { Write-Host "Official MinerU2.5 VLM is ready: $VlmHealthUrl" }
      exit 0
    }
  } catch {}
  Start-Sleep -Seconds 5
}

docker compose -f $ComposeFile ps
throw "MinerU Docker services did not become healthy. Check Docker Compose logs."
