import io
import os

# Let MPS silently fall back to CPU for any op not yet implemented on Metal.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import scipy.io.wavfile  # noqa: E402
import torch  # noqa: E402
from transformers import AutoProcessor, MusicgenForConditionalGeneration, StoppingCriteria, StoppingCriteriaList  # noqa: E402

from job_runner import check_cancel


class CancelGeneration(StoppingCriteria):
    def __init__(self, event):
        self.event = event

    def __call__(self, input_ids, scores, **kwargs):
        # Raise instead of returning True: MusicGen would otherwise decode partial tokens.
        check_cancel(self.event)
        return False


MODEL_ID = "facebook/musicgen-small"
# MusicGen's EnCodec decoder hits "Output channels > 65536 not supported at the
# MPS device" on Apple Silicon, so this worker always runs on CPU.
DEVICE = "cpu"

print(f"[music-worker] loading {MODEL_ID} on {DEVICE} ...", flush=True)
_processor = AutoProcessor.from_pretrained(MODEL_ID)
_model = MusicgenForConditionalGeneration.from_pretrained(MODEL_ID).to(DEVICE)
print("[music-worker] model loaded, ready to generate", flush=True)


def generate_wav(prompt: str, seconds: float = 8.0, cancel_event=None) -> bytes:
    """워커 시작 시 한 번 로드한 모델로 오디오를 생성해 WAV 바이트를 메모리에서
    바로 반환한다 (파일시스템에 쓰지 않음)."""
    import threading
    cancel_event = cancel_event or threading.Event()
    check_cancel(cancel_event)
    inputs = _processor(text=[prompt], padding=True, return_tensors="pt").to(DEVICE)

    frame_rate = _model.config.audio_encoder.frame_rate
    max_new_tokens = max(1, int(seconds * frame_rate))

    check_cancel(cancel_event)
    # Temporary hooks check EnCodec boundaries and are removed before releasing the job lock.
    def checkpoint(module, args):
        check_cancel(cancel_event)
    hooks = [module.register_forward_pre_hook(checkpoint) for module in _model.audio_encoder.modules()]
    try:
        with torch.no_grad():
            audio_values = _model.generate(
                **inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=max_new_tokens,
                stopping_criteria=StoppingCriteriaList([CancelGeneration(cancel_event)])
            )

    finally:
        for hook in hooks:
            hook.remove()
    check_cancel(cancel_event)
    sampling_rate = _model.config.audio_encoder.sampling_rate
    audio = audio_values[0, 0].to("cpu").numpy()

    buffer = io.BytesIO()
    scipy.io.wavfile.write(buffer, rate=sampling_rate, data=audio)
    return buffer.getvalue()
