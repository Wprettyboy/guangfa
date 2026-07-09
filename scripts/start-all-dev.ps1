$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$LogDir = "C:\llm"
$EmbeddingPort = 8000
$QwenPort = 8129
$OfficePort = 8080
$PlantumlPort = 8090
$WebPort = 5173

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-PortListening {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Start-HiddenPowerShell {
  param(
    [string]$Name,
    [string]$Command,
    [string]$Stdout,
    [string]$Stderr
  )

  Remove-Item $Stdout, $Stderr -ErrorAction SilentlyContinue
  $process = Start-Process `
    -FilePath powershell.exe `
    -WorkingDirectory $Root `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
    -RedirectStandardOutput $Stdout `
    -RedirectStandardError $Stderr `
    -WindowStyle Hidden `
    -PassThru
  Write-Host "$Name started, pid=$($process.Id)"
}

Write-Host "Starting Guangfa tender agent stack..."
Write-Host "Root: $Root"

if (Test-PortListening $OfficePort) {
  Write-Host "OnlyOffice already listening on http://127.0.0.1:$OfficePort"
} else {
  Start-HiddenPowerShell `
    -Name "OnlyOffice" `
    -Command "powershell -ExecutionPolicy Bypass -File `"$Root\scripts\start-onlyoffice.ps1`"" `
    -Stdout "$LogDir\guangfa-onlyoffice.log" `
    -Stderr "$LogDir\guangfa-onlyoffice.err.log"
}

if (Test-PortListening $PlantumlPort) {
  Write-Host "PlantUML already listening on http://127.0.0.1:$PlantumlPort"
} else {
  Start-HiddenPowerShell `
    -Name "PlantUML" `
    -Command "powershell -ExecutionPolicy Bypass -File `"$Root\scripts\start-plantuml.ps1`"" `
    -Stdout "$LogDir\guangfa-plantuml.log" `
    -Stderr "$LogDir\guangfa-plantuml.err.log"
}

if (Test-PortListening $EmbeddingPort) {
  Write-Host "Embedding server already listening on http://127.0.0.1:$EmbeddingPort"
} else {
  Start-HiddenPowerShell `
    -Name "Embedding server" `
    -Command "powershell -ExecutionPolicy Bypass -File `"$Root\scripts\start-local-embedding.ps1`" -SkipInstall" `
    -Stdout "$LogDir\guangfa-embedding.log" `
    -Stderr "$LogDir\guangfa-embedding.err.log"
}

if (Test-PortListening $QwenPort) {
  Write-Host "Qwen local LLM already listening on http://127.0.0.1:$QwenPort"
} else {
  Start-HiddenPowerShell `
    -Name "Qwen local LLM" `
    -Command "powershell -ExecutionPolicy Bypass -File `"$Root\scripts\start-local-qwen36-rocm.ps1`"" `
    -Stdout "$LogDir\qwen36-rocm-server.log" `
    -Stderr "$LogDir\qwen36-rocm-server.err.log"
}

if (Test-PortListening $WebPort) {
  Write-Host "Web app already listening on http://127.0.0.1:$WebPort"
} else {
  Start-HiddenPowerShell `
    -Name "Web app" `
    -Command "npm run dev -- --host 127.0.0.1 --port $WebPort" `
    -Stdout "$LogDir\guangfa-vite.log" `
    -Stderr "$LogDir\guangfa-vite.err.log"
}

Write-Host ""
Write-Host "Waiting for services..."
for ($i = 0; $i -lt 60; $i++) {
  $webReady = Test-PortListening $WebPort
  $officeReady = Test-PortListening $OfficePort
  $plantumlReady = Test-PortListening $PlantumlPort
  $qwenReady = Test-PortListening $QwenPort
  $embeddingReady = Test-PortListening $EmbeddingPort
  if ($webReady -and $officeReady -and $plantumlReady -and $qwenReady -and $embeddingReady) { break }
  Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Service status:"
Write-Host "  OnlyOffice: $(if (Test-PortListening $OfficePort) { "OK http://127.0.0.1:$OfficePort" } else { "NOT READY, see $LogDir\guangfa-onlyoffice.err.log" })"
Write-Host "  PlantUML:   $(if (Test-PortListening $PlantumlPort) { "OK http://127.0.0.1:$PlantumlPort" } else { "NOT READY, see $LogDir\guangfa-plantuml.err.log" })"
Write-Host "  Web app:   $(if (Test-PortListening $WebPort) { "OK http://127.0.0.1:$WebPort" } else { "NOT READY, see $LogDir\guangfa-vite.err.log" })"
Write-Host "  Qwen LLM:  $(if (Test-PortListening $QwenPort) { "OK http://127.0.0.1:$QwenPort" } else { "NOT READY, see $LogDir\qwen36-rocm-server.err.log" })"
Write-Host "  Embedding: $(if (Test-PortListening $EmbeddingPort) { "OK http://127.0.0.1:$EmbeddingPort" } else { "NOT READY, see $LogDir\guangfa-embedding.err.log" })"

if (Test-PortListening $WebPort) {
  Start-Process "http://127.0.0.1:$WebPort"
}
