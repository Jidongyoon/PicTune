#!/usr/bin/env python3
"""Standalone MusicGen (facebook/musicgen-small) test.

Usage:
  python test_musicgen.py --prompt "lo-fi chill beat, warm and cozy, slow tempo" \
      --seconds 8 --out outputs/musicgen_out.wav
"""
import argparse
import os
import sys
import time

# Let MPS silently fall back to CPU for any op not yet implemented on Metal.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")


def parse_args():
    p = argparse.ArgumentParser(description="Quick MusicGen test")
    p.add_argument("--prompt", required=True, help="Text description of the music to generate")
    p.add_argument("--seconds", type=float, default=8.0, help="Approx. duration of generated audio")
    p.add_argument("--out", default="outputs/musicgen_out.wav", help="Output .wav path")
    p.add_argument("--model", default="facebook/musicgen-small", help="HF model id")
    p.add_argument("--device", default="cpu", choices=["mps", "cpu"],
                    help="Device to use (default: cpu -- MusicGen's EnCodec decoder hits "
                         "'Output channels > 65536 not supported at the MPS device' on this model)")
    p.add_argument("--seed", type=int, default=None)
    return p.parse_args()


def main():
    args = parse_args()
    import torch
    from transformers import AutoProcessor, MusicgenForConditionalGeneration
    import scipy.io.wavfile

    if args.seed is not None:
        torch.manual_seed(args.seed)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    print(f"[1/4] Loading '{args.model}' ...")
    processor = AutoProcessor.from_pretrained(args.model)
    model = MusicgenForConditionalGeneration.from_pretrained(args.model)

    device = args.device
    print(f"[2/4] Using device: {device}")
    model = model.to(device)
    inputs = processor(text=[args.prompt], padding=True, return_tensors="pt").to(device)

    frame_rate = model.config.audio_encoder.frame_rate  # ~50 tokens/sec
    max_new_tokens = max(1, int(args.seconds * frame_rate))
    print(f"[3/4] Generating ~{args.seconds}s ({max_new_tokens} tokens) ...")

    t0 = time.time()
    try:
        audio_values = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=max_new_tokens)
    except RuntimeError as e:
        if device == "mps":
            print(f"MPS generation failed ({e}); retrying on CPU ...", file=sys.stderr)
            model = model.to("cpu")
            inputs = inputs.to("cpu")
            audio_values = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=max_new_tokens)
        else:
            raise
    print(f"[4/4] Generation took {time.time() - t0:.1f}s")

    sampling_rate = model.config.audio_encoder.sampling_rate
    audio = audio_values[0, 0].to("cpu").numpy()
    scipy.io.wavfile.write(args.out, rate=sampling_rate, data=audio)
    print(f"Saved: {args.out} ({sampling_rate} Hz, {len(audio) / sampling_rate:.1f}s)")


if __name__ == "__main__":
    main()
