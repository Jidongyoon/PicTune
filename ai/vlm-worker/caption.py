import json
import os
import subprocess
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_DIR = SCRIPT_DIR.parent / "models" / "smolvlm2-gguf"
MODEL = MODEL_DIR / "SmolVLM2-2.2B-Instruct-Q4_K_M.gguf"
MMPROJ = MODEL_DIR / "mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf"

PROMPT = (
    "Analyze this image for the purpose of generating background music. "
    "Respond with ONLY a single JSON object (no markdown, no code fences, no extra text) "
    "with exactly these fields: "
    'scene (string, brief description of the scene), '
    'mood (array of 1-3 short mood words), '
    'energy (one of "low", "medium", "high"), '
    'genre (string, a music genre that fits the image), '
    'tempo (string, e.g. "slow", "moderate", "fast"), '
    'instruments (array of 2-4 instrument names), '
    'texture (string, short description of the sound texture), '
    'musicgen_prompt (string, one sentence combining tempo, mood, genre and instruments, '
    "written as a prompt for a text-to-music model). "
    "Example format: "
    '{"scene": "...", "mood": ["..."], "energy": "low", "genre": "...", '
    '"tempo": "...", "instruments": ["..."], "texture": "...", "musicgen_prompt": "..."}'
)

REQUIRED_FIELDS = [
    "scene",
    "mood",
    "energy",
    "genre",
    "tempo",
    "instruments",
    "texture",
    "musicgen_prompt",
]


class CaptionError(RuntimeError):
    pass


def _extract_json(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("no JSON object found in model output")
    return json.loads(text[start : end + 1])


def analyze_image(image_bytes: bytes, suffix: str = ".jpg") -> dict:
    """이미지를 SmolVLM2(GGUF, llama-mtmd-cli)에 넣어 무드/장르/musicgen_prompt를 담은
    구조화 JSON을 얻는다. 모델이 유효한 JSON을 내지 못하면 원문 텍스트를
    musicgen_prompt로 사용하는 fallback을 반환한다."""
    if not MODEL.exists() or not MMPROJ.exists():
        raise CaptionError(f"SmolVLM2 model files not found under {MODEL_DIR}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            [
                "llama-mtmd-cli",
                "-m", str(MODEL),
                "--mmproj", str(MMPROJ),
                "--image", tmp_path,
                "-p", PROMPT,
                "-c", "4096",
                "-ngl", "99",
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
    finally:
        os.remove(tmp_path)

    if result.returncode != 0:
        raise CaptionError(f"llama-mtmd-cli failed: {result.stderr[-2000:]}")

    raw_output = result.stdout.strip()

    try:
        data = _extract_json(raw_output)
        musicgen_prompt = str(data.get("musicgen_prompt", "")).strip()
        if not musicgen_prompt:
            raise ValueError("musicgen_prompt missing or empty")
        data["musicgen_prompt"] = musicgen_prompt
        for field in REQUIRED_FIELDS:
            data.setdefault(field, None)
        return data
    except (ValueError, json.JSONDecodeError):
        fallback = {field: None for field in REQUIRED_FIELDS}
        fallback["musicgen_prompt"] = raw_output or "ambient background music"
        return fallback
