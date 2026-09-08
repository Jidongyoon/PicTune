import os
from pathlib import Path

from huggingface_hub import hf_hub_download


FILES = (
    "SmolVLM2-2.2B-Instruct-Q4_K_M.gguf",
    "mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf",
)

repo_id = os.environ["VLM_REPO_ID"]
revision = os.environ["VLM_REVISION"]
model_dir = Path(os.environ["VLM_MODEL_DIR"])
model_dir.mkdir(parents=True, exist_ok=True)

for filename in FILES:
    target = model_dir / filename
    if target.is_file():
        print(f"[model-init] using cached {target}", flush=True)
        continue

    print(f"[model-init] downloading {repo_id}/{filename}", flush=True)
    hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        revision=revision,
        local_dir=model_dir,
    )

missing = [filename for filename in FILES if not (model_dir / filename).is_file()]
if missing:
    raise RuntimeError(f"model download did not produce required files: {missing}")

print("[model-init] SmolVLM files are ready", flush=True)
