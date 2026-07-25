#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv="${MINERU_WSL_VENV:-/opt/guangfa-mineru/venv}"
state_dir="${MINERU_WSL_STATE_DIR:-/opt/guangfa-mineru}"
vlm_port="${MINERU_VLM_PORT:-30000}"
api_port="${MINERU_API_PORT:-8010}"

export HSA_ENABLE_DXG_DETECTION=1
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"
export MINERU_TOOLS_CONFIG_JSON="$state_dir/mineru.json"
export MINERU_MODEL_SOURCE=local
export MINERU_VL_MODEL_PATH="${MINERU_VL_MODEL_PATH:-$state_dir/models/MinerU2.5-Pro-2605-1.2B}"
export MINERU_API_OUTPUT_ROOT="${MINERU_API_OUTPUT_ROOT:-$state_dir/output}"

if [[ ! -x "$venv/bin/mineru-api" || ! -f "$MINERU_TOOLS_CONFIG_JSON" ]]; then
  echo "MinerU is not bootstrapped. Run bootstrap-mineru-wsl.sh first." >&2
  exit 1
fi

mkdir -p "$state_dir/logs" "$MINERU_API_OUTPUT_ROOT"
if ! curl -fsS "http://127.0.0.1:$vlm_port/health" >/dev/null; then
  nohup "$venv/bin/python" -m uvicorn mineru_transformers_server:app \
    --app-dir "$root/scripts" --host 127.0.0.1 --port "$vlm_port" \
    >"$state_dir/logs/vlm.log" 2>&1 &
fi

for _ in $(seq 1 360); do
  if curl -fsS "http://127.0.0.1:$vlm_port/health" >/dev/null; then
    break
  fi
  sleep 5
done
curl -fsS "http://127.0.0.1:$vlm_port/health" >/dev/null

if ! curl -fsS "http://127.0.0.1:$api_port/health" >/dev/null; then
  nohup "$venv/bin/mineru-api" --host 127.0.0.1 --port "$api_port" \
    >"$state_dir/logs/api.log" 2>&1 &
fi

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$api_port/health" >/dev/null; then
    exit 0
  fi
  sleep 5
done

echo "MinerU API did not become healthy. Check $state_dir/logs/api.log" >&2
exit 1
