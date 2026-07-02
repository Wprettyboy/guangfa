$ErrorActionPreference = "Stop"

$Runtime = "C:\llm\llama-b9827-vulkan\llama-server.exe"
$Model = "C:\llm\qwen3.6-35b-a3b-mtp\Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"
$Port = if ($env:QWEN_LOCAL_PORT) { $env:QWEN_LOCAL_PORT } else { "8129" }

if (!(Test-Path $Runtime)) {
  throw "llama-server not found: $Runtime"
}

if (!(Test-Path $Model)) {
  throw "Qwen model not found: $Model"
}

Write-Host "Starting Qwen3.6 CPU server on http://127.0.0.1:$Port"
& $Runtime `
  -m $Model `
  --host 127.0.0.1 `
  --port $Port `
  -c 2048 `
  -np 1 `
  --cache-ram 0 `
  -dev none `
  -ngl 0 `
  --jinja `
  --reasoning off
