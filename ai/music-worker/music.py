import io
import os

# Let MPS silently fall back to CPU for any op not yet implemented on Metal.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import scipy.io.wavfile  # noqa: E402
import torch  # noqa: E402
from transformers import AutoProcessor, MusicgenForConditionalGeneration  # noqa: E402

MODEL_ID = "facebook/musicgen-small"
# MusicGen's EnCodec decoder hits "Output channels > 65536 not supported at the
# MPS device" on Apple Silicon, so this worker always runs on CPU.
DEVICE = "cpu"

print(f"[music-worker] loading {MODEL_ID} on {DEVICE} ...", flush=True)
_processor = AutoProcessor.from_pretrained(MODEL_ID)
_model = MusicgenForConditionalGeneration.from_pretrained(MODEL_ID).to(DEVICE)
print("[music-worker] model loaded, ready to generate", flush=True)


def generate_wav(prompt: str, seconds: float = 8.0) -> bytes:
    """프로세스 시작 시 1회 로드된 모델로 오디오를 생성해 WAV 바이트를 메모리에서
    바로 반환한다 (파일시스템에 쓰지 않음)."""
    inputs = _processor(text=[prompt], padding=True, return_tensors="pt").to(DEVICE)

    frame_rate = _model.config.audio_encoder.frame_rate
    max_new_tokens = max(1, int(seconds * frame_rate))

    with torch.no_grad():
        audio_values = _model.generate(
            **inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=max_new_tokens
        )

    sampling_rate = _model.config.audio_encoder.sampling_rate
    audio = audio_values[0, 0].to("cpu").numpy()

    buffer = io.BytesIO()
    scipy.io.wavfile.write(buffer, rate=sampling_rate, data=audio)
    return buffer.getvalue()
