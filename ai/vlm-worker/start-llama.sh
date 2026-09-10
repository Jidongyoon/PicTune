#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
model_dir="${VLM_MODEL_DIR:-$script_dir/../models/smolvlm2-gguf}"
# Run once per VLM instance, never from a request handler.
exec llama-server \
  -m "$model_dir/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf" \
  --mmproj "$model_dir/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf" \
  --host "${LLAMA_HOST:-127.0.0.1}" --port "${LLAMA_PORT:-8003}" \
  --parallel 1 --slots -c 4096 -ngl "${VLM_GPU_LAYERS:-99}" \
  --no-cache-prompt --no-cache-idle-slots
