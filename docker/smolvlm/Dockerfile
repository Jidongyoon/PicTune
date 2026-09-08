FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    LLAMA_SERVER_URL=http://llama-server:8003

WORKDIR /app

COPY ai/vlm-worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt

COPY ai/job_runner.py ./job_runner.py
COPY ai/vlm-worker/main.py ai/vlm-worker/caption.py ./

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin pictune \
    && chown -R pictune /app

USER 10001

EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=6s --start-period=10s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=5).read()" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
