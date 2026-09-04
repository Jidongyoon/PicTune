#!/usr/bin/env bash
# Raw SmolVLM2-2.2B-Instruct (GGUF) captioning test via llama.cpp's llama-mtmd-cli.
# Usage: ./run_smolvlm_caption.sh downloaded_images/0001.jpg [outputs/custom_caption.txt]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL_DIR="$SCRIPT_DIR/models/smolvlm2-gguf"
MODEL="$MODEL_DIR/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf"
MMPROJ="$MODEL_DIR/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf"
OUT_DIR="$SCRIPT_DIR/outputs"
mkdir -p "$OUT_DIR"

IMAGE="${1:?Usage: $0 <path-to-image> [output-caption-file]}"
BASE="$(basename "${IMAGE%.*}")"
OUT_FILE="${2:-$OUT_DIR/${BASE}_caption.txt}"
LOG_FILE="$OUT_DIR/${BASE}_log.txt"

PROMPT="Describe this image in detail. Focus specifically on: (1) overall mood and atmosphere, (2) dominant colors and color palette, (3) lighting quality (bright/dim, warm/cool, harsh/soft, direction), (4) sense of energy or pace (calm and slow vs. dynamic and fast). Answer in 3-5 sentences."

llama-mtmd-cli \
  -m "$MODEL" \
  --mmproj "$MMPROJ" \
  --image "$IMAGE" \
  -p "$PROMPT" \
  -c 4096 \
  -ngl 99 \
  2> "$LOG_FILE" \
  | tee "$OUT_FILE"

echo
echo "Caption saved to: $OUT_FILE"
echo "Load/warning log saved to: $LOG_FILE"
