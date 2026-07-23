$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $Root "docker\mineru\compose.yaml"
$HealthUrl = "http://127.0.0.1:8010/health"
$CudaProbeImage = if ($env:MINERU_CUDA_PROBE_IMAGE) { $env:MINERU_CUDA_PROBE_IMAGE } else { "nvidia/cuda:12.8.1-base-ubuntu22.04" }

function Test-DockerReady {
  try {
    docker info *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

if (!(Test-DockerReady)) {
  $DockerDesktop = @(
    "C:\Program Files\Docker\Docker\Docker Desktop.exe",
    "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (!$DockerDesktop) { throw "Docker Desktop was not found. MinerU cannot start." }
  Start-Process -FilePath $DockerDesktop -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 90; $i++) {
    if (Test-DockerReady) { break }
    Start-Sleep -Seconds 2
  }
}

if (!(Test-DockerReady)) { throw "Docker Desktop is not ready. MinerU cannot start." }

Write-Host "Checking NVIDIA GPU access from Docker..."
$PreviousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
docker run --rm --gpus all $CudaProbeImage nvidia-smi *> $null
$GpuProbeExitCode = $LASTEXITCODE
$ErrorActionPreference = $PreviousErrorActionPreference
if ($GpuProbeExitCode -ne 0) {
  throw "Docker cannot access an NVIDIA GPU. MinerU Hybrid requires an NVIDIA GPU visible inside Docker; run 'docker run --rm --gpus all $CudaProbeImage nvidia-smi' for details."
}

docker compose -f $ComposeFile up -d --build
if ($LASTEXITCODE -ne 0) { throw "MinerU Docker services failed to start." }

Write-Host "Waiting for MinerU Hybrid services..."
for ($i = 0; $i -lt 180; $i++) {
  try {
    $health = Invoke-RestMethod $HealthUrl -TimeoutSec 5
    if ($health.status -eq "healthy") {
      Write-Host "MinerU Hybrid is ready: $HealthUrl"
      exit 0
    }
  } catch {}
  Start-Sleep -Seconds 5
}

docker compose -f $ComposeFile ps
throw "MinerU did not become healthy in time. Check: docker compose -f `"$ComposeFile`" logs"
