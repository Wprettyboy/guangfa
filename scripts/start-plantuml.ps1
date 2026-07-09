$ErrorActionPreference = "Stop"

$name = "guangfa-plantuml"
$image = "plantuml/plantuml-server:jetty"
$port = 8090
$containerPort = 8080
$fontDir = "/usr/share/fonts/truetype/guangfa"
$fontFiles = @(
  "simhei.ttf",
  "msyh.ttc",
  "msyhbd.ttc",
  "simkai.ttf",
  "simsun.ttc"
)

function Invoke-Docker {
  param([string[]]$Arguments)
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker command failed: docker $($Arguments -join ' ')"
  }
}

function Test-DockerReady {
  try {
    docker info *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

if (!(Test-DockerReady)) {
  $dockerDesktop = @(
    "C:\Program Files\Docker\Docker\Docker Desktop.exe",
    "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if (!$dockerDesktop) {
    throw "Docker Desktop was not found. PlantUML cannot start."
  }

  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null

  for ($i = 0; $i -lt 90; $i++) {
    if (Test-DockerReady) { break }
    Start-Sleep -Seconds 2
  }
}

if (!(Test-DockerReady)) {
  throw "Docker Desktop is not ready. PlantUML cannot start."
}

Invoke-Docker @("pull", $image)

$existing = docker ps -a --filter "name=^/$name$" --format "{{.Names}}"
if ($existing -eq $name) {
  Invoke-Docker @("start", $name) | Out-Null
} else {
  Invoke-Docker @("run", "-d", "--name", $name, "-p", "${port}:${containerPort}", "--restart", "unless-stopped", $image) | Out-Null
}

Invoke-Docker @("exec", "-u", "0", $name, "sh", "-lc", "mkdir -p '$fontDir'")
foreach ($fontFile in $fontFiles) {
  $fontPath = Join-Path "C:\Windows\Fonts" $fontFile
  if (Test-Path $fontPath) {
    Invoke-Docker @("cp", $fontPath, "${name}:$fontDir/$fontFile") | Out-Null
  }
}
Invoke-Docker @("exec", "-u", "0", $name, "sh", "-lc", "chmod 644 '$fontDir'/* && fc-cache -f '$fontDir'")
Invoke-Docker @("restart", $name) | Out-Null

for ($i = 0; $i -lt 60; $i++) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port" -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -eq 200) {
      Write-Host "PlantUML ready: http://127.0.0.1:$port"
      docker exec $name sh -lc "fc-match SimHei && fc-match 'Microsoft YaHei'" | Write-Host
      exit 0
    }
  } catch {}
  Start-Sleep -Seconds 2
}

throw "PlantUML did not become ready on http://127.0.0.1:$port"
