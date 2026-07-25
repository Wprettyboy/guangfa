#!/usr/bin/env bash
set -euo pipefail

venv="${MINERU_WSL_VENV:-/opt/guangfa-mineru/venv}"
state_dir="${MINERU_WSL_STATE_DIR:-/opt/guangfa-mineru}"
download_source="${MINERU_DOWNLOAD_SOURCE:-modelscope}"
vlm_model_dir="${MINERU_VL_MODEL_PATH:-$state_dir/models/MinerU2.5-Pro-2605-1.2B}"
torch_wheel="${MINERU_TORCH_WHEEL:-/mnt/c/llm/torch-2.9.1+rocm7.2.1.lw.gitff65f5bc-cp312-cp312-linux_x86_64.whl}"
triton_wheel="${MINERU_TRITON_WHEEL:-/mnt/c/llm/triton-3.5.1+rocm7.2.1.gita272dfa8-cp312-cp312-linux_x86_64.whl}"
torchvision_wheel="${MINERU_TORCHVISION_WHEEL:-/mnt/c/llm/torchvision-0.24.0+rocm7.2.1.gitb919bd0c-cp312-cp312-linux_x86_64.whl}"
log_file="${MINERU_BOOTSTRAP_LOG:-/opt/guangfa-mineru/logs/bootstrap.log}"

mkdir -p "$(dirname "$log_file")"
exec > >(tee "$log_file") 2>&1

if [[ ! -x "$venv/bin/python" ]]; then
  echo "MinerU Python environment not found: $venv" >&2
  exit 1
fi
if [[ ! -f "$torch_wheel" ]]; then
  echo "ROCm PyTorch wheel not found: $torch_wheel" >&2
  exit 1
fi
if [[ ! -f "$triton_wheel" ]]; then
  echo "ROCm Triton wheel not found: $triton_wheel" >&2
  exit 1
fi
if [[ ! -f "$torchvision_wheel" ]]; then
  echo "ROCm TorchVision wheel not found: $torchvision_wheel" >&2
  exit 1
fi

export HSA_ENABLE_DXG_DETECTION=1
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"
export MINERU_TOOLS_CONFIG_JSON=/opt/guangfa-mineru/mineru.json
sudo apt-get -o DPkg::Lock::Timeout=3600 install -y \
  hipblas hipblaslt hipfft hiprand hipsolver hipsparse hipsparselt \
  miopen-hip rccl rocblas rocrand rocsolver
sudo ldconfig
"$venv/bin/python" -m pip install "$triton_wheel"
"$venv/bin/python" -m pip install "$torch_wheel" --extra-index-url https://pypi.org/simple
"$venv/bin/python" -m pip install "$torchvision_wheel"
"$venv/bin/python" -m pip install --no-cache-dir \
  "mineru[pipeline,vlm]==3.4.4" \
  "six>=1.17,<2"
"$venv/bin/python" - <<'PY'
import torch
import torchvision

assert torch.cuda.is_available()

values = torch.arange(16, device="cuda", dtype=torch.float32)
print(f"torch={torch.__version__}")
print(f"torchvision={torchvision.__version__}")
print(f"hip={torch.version.hip}")
print(f"device={torch.cuda.get_device_name(0)}")
print(f"tensor_sum={values.sum().item()}")
PY
MINERU_MODEL_SOURCE=local "$venv/bin/mineru-models-download" -s "$download_source" -m pipeline
"$venv/bin/modelscope" download OpenDataLab/MinerU2.5-Pro-2605-1.2B \
  --local-dir "$vlm_model_dir" \
  --max-workers 8
