param(
  [switch]$SkipInstall,
  [string]$Python = "C:\Users\23811\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $Root ".venv-embedding"
$VenvPython = Join-Path $Venv "Scripts\python.exe"

if (!(Test-Path $Python)) {
  $Python = "python"
}

if (!(Test-Path $VenvPython)) {
  & $Python -m venv $Venv
}

if (!$SkipInstall) {
  & $VenvPython -m pip install --upgrade pip
  & $VenvPython -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  & $VenvPython -m pip install -r (Join-Path $Root "requirements-embedding.txt")
}

$LocalBgeM3 = Join-Path $Root "data\models\modelscope\BAAI\bge-m3"
if (!$env:LOCAL_EMBEDDING_MODEL) {
  if (Test-Path $LocalBgeM3) {
    $env:LOCAL_EMBEDDING_MODEL = $LocalBgeM3
  } else {
    $env:LOCAL_EMBEDDING_MODEL = "BAAI/bge-m3"
  }
}
if (!$env:LOCAL_EMBEDDING_DIMENSION) { $env:LOCAL_EMBEDDING_DIMENSION = "1024" }
if (!$env:LOCAL_EMBEDDING_CACHE_DIR) { $env:LOCAL_EMBEDDING_CACHE_DIR = Join-Path $Root "data\models\huggingface" }
if (!$env:LOCAL_EMBEDDING_PORT) { $env:LOCAL_EMBEDDING_PORT = "8000" }
if (!$env:HF_ENDPOINT) { $env:HF_ENDPOINT = "https://hf-mirror.com" }
if (!$env:HF_HUB_DISABLE_XET) { $env:HF_HUB_DISABLE_XET = "1" }
if (!$env:HF_HUB_DISABLE_SYMLINKS_WARNING) { $env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1" }

& $VenvPython (Join-Path $Root "scripts\local_embedding_server.py")
