#!/usr/bin/env bash
set -euo pipefail

state_dir="${RETRIEVAL_WSL_STATE_DIR:-/opt/guangfa-retrieval}"
venv="$state_dir/venv"
models_dir="$state_dir/models"
runtime_version="retrieval-runtime-v1"
repo="${RETRIEVAL_REPO_PATH:-/mnt/c/llm/guangfa-repo}"
torch_wheel="${RETRIEVAL_TORCH_WHEEL:-/mnt/c/llm/torch-2.9.1+rocm7.2.1.lw.gitff65f5bc-cp312-cp312-linux_x86_64.whl}"
triton_wheel="${RETRIEVAL_TRITON_WHEEL:-/mnt/c/llm/triton-3.5.1+rocm7.2.1.gita272dfa8-cp312-cp312-linux_x86_64.whl}"
torchvision_wheel="${RETRIEVAL_TORCHVISION_WHEEL:-/mnt/c/llm/torchvision-0.24.0+rocm7.2.1.gitb919bd0c-cp312-cp312-linux_x86_64.whl}"

sudo mkdir -p "$state_dir" "$models_dir"
sudo chown -R "$(id -u):$(id -g)" "$state_dir"

if [[ "$(cat "$state_dir/.guangfa-retrieval-runtime-version" 2>/dev/null || true)" == "$runtime_version" \
  && -s "$models_dir/bge-m3/pytorch_model.bin" \
  && -s "$models_dir/bge-reranker-v2-m3/model.safetensors" ]]; then
  echo "Retrieval WSL runtime is ready: $state_dir"
  exit 0
fi

if [[ ! -x "$venv/bin/python" ]]; then
  python3.12 -m venv "$venv"
fi

"$venv/bin/python" -m pip install --upgrade pip
if ! "$venv/bin/python" -c 'import torch; assert "+rocm7.2.1" in torch.__version__' 2>/dev/null; then
  "$venv/bin/python" -m pip install "$torch_wheel" "$triton_wheel" "$torchvision_wheel"
fi
"$venv/bin/python" -m pip install -r "$repo/requirements-retrieval.txt"

if [[ ! -s "$models_dir/bge-m3/config.json" || ! -s "$models_dir/bge-m3/pytorch_model.bin" ]]; then
  source_model="$repo/data/models/modelscope/BAAI/bge-m3"
  if [[ -f "$source_model/config.json" ]]; then
    mkdir -p "$models_dir/bge-m3"
    cp -a "$source_model/." "$models_dir/bge-m3/"
  else
    rm -rf "$models_dir/bge-m3"
    "$venv/bin/modelscope" download BAAI/bge-m3 --local-dir "$models_dir/bge-m3" --max-workers 4
  fi
fi

if [[ ! -s "$models_dir/bge-reranker-v2-m3/config.json" || ! -s "$models_dir/bge-reranker-v2-m3/model.safetensors" ]]; then
  rm -rf "$models_dir/bge-reranker-v2-m3"
  "$venv/bin/modelscope" download BAAI/bge-reranker-v2-m3 --local-dir "$models_dir/bge-reranker-v2-m3" --max-workers 4
fi

export HSA_ENABLE_DXG_DETECTION=1
export LD_LIBRARY_PATH="/opt/rocm-7.2.1/lib:/usr/lib/wsl/lib:${LD_LIBRARY_PATH:-}"
"$venv/bin/python" - <<'PY'
import torch
from FlagEmbedding import BGEM3FlagModel, FlagReranker
assert torch.cuda.is_available()
x = torch.arange(16, device="cuda")
assert x.sum().item() == 120
print(torch.__version__, torch.cuda.get_device_name(0))
print(BGEM3FlagModel.__name__, FlagReranker.__name__)
PY

cat > "$state_dir/.guangfa-retrieval-runtime-version" <<'EOF'
retrieval-runtime-v1
EOF
echo "Retrieval WSL runtime is ready: $state_dir"
