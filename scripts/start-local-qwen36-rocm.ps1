$ErrorActionPreference = "Stop"

$RuntimeDir = "C:\llm\llama-b9827-hip-radeon"
$AmdRocmDir = "C:\llm\llama-amd-rocm-7.1.1-gfx1151\llama-b7146-windows-rocm-7.1.1-gfx1150-gfx1151-x64"
$Runtime = Join-Path $RuntimeDir "llama-server.exe"
$Model = "C:\llm\qwen3.6-35b-a3b-mtp\Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"
$Port = if ($env:QWEN_LOCAL_PORT) { $env:QWEN_LOCAL_PORT } else { "8129" }
$Context = if ($env:QWEN_CONTEXT) { $env:QWEN_CONTEXT } else { "262144" }
$GpuLayers = if ($env:QWEN_GPU_LAYERS) { $env:QWEN_GPU_LAYERS } else { "999" }

if (!(Test-Path $Runtime)) {
  throw "llama-server not found: $Runtime"
}

if (!(Test-Path $AmdRocmDir)) {
  throw "AMD ROCm runtime dir not found: $AmdRocmDir"
}

if (!(Test-Path $Model)) {
  throw "Qwen model not found: $Model"
}

$env:PATH = "$AmdRocmDir;$RuntimeDir;$env:PATH"

Write-Host "Starting Qwen3.6 ROCm server on http://127.0.0.1:$Port"
Write-Host "Model: $Model"
Write-Host "Context: $Context, GPU layers: $GpuLayers"

& $Runtime `
  -m $Model `
  --host 127.0.0.1 `
  --port $Port `
  -c $Context `
  -np 1 `
  --cache-ram 0 `
  -ngl $GpuLayers `
  --jinja `
  --reasoning off
