FROM python:3.12-slim-bookworm

ARG HUGGINGFACE_HUB_VERSION=0.36.0

RUN pip install --no-cache-dir "huggingface_hub==${HUGGINGFACE_HUB_VERSION}"

COPY download_models.py /usr/local/bin/download_models.py

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin pictune \
    && mkdir -p /cache/vlm \
    && chown -R pictune /cache

ENV HF_HOME=/cache/vlm/.huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    VLM_REPO_ID=ggml-org/SmolVLM2-2.2B-Instruct-GGUF \
    VLM_REVISION=1bc3c9f74ceafd4c8d4411cc9cf188bba3798f91 \
    VLM_MODEL_DIR=/cache/vlm

USER 10001
 
ENTRYPOINT ["python", "/usr/local/bin/download_models.py"]
