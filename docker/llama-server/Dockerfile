ARG LLAMA_CPP_IMAGE=ghcr.io/ggml-org/llama.cpp:server
FROM ${LLAMA_CPP_IMAGE}


USER root

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin pictune

USER 10001

EXPOSE 8003

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=5 \
    CMD curl --fail --silent http://127.0.0.1:8003/health >/dev/null || exit 1

CMD ["-m", "/cache/vlm/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf", "--mmproj", "/cache/vlm/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf", "--host", "0.0.0.0", "--port", "8003", "--parallel", "1", "--slots", "-c", "4096", "--no-cache-prompt", "--no-cache-idle-slots"]
