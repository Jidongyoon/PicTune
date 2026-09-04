# PicTune 로컬 실행 가이드

## 구성

- **Next.js** (레포 루트, `app/`) — UI + `/api/generate` orchestration
- **VLM Worker** (`ai/vlm-worker`) — SmolVLM2로 이미지 → 무드 분석 JSON(`musicgen_prompt` 포함)
- **Music Worker** (`ai/music-worker`) — MusicGen으로 프롬프트 → 8초 WAV

세 컴포넌트는 각각 독립 프로세스로 떠 있어야 하며, 전체 아키텍처는 `PicTune.md`를 참고하세요.

## 사전 준비

- Node.js 20 이상, npm
- Python 3.9 (macOS 시스템 기본 `/usr/bin/python3`)
- Homebrew + `brew install llama.cpp` (SmolVLM2 GGUF 실행용 `llama-mtmd-cli`)

## 1) SmolVLM2 모델 다운로드

모델 파일(약 1.6GB)은 저장소에 포함되어 있지 않습니다(`.gitignore` 처리됨). 아래 명령으로 받아주세요.

```bash
mkdir -p ai/models/smolvlm2-gguf && cd ai/models/smolvlm2-gguf
curl -L -o SmolVLM2-2.2B-Instruct-Q4_K_M.gguf \
  "https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf"
curl -L -o mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf \
  "https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf"
cd ../../..
```

## 2) VLM Worker 실행 (포트 8001)

```bash
cd ai/vlm-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8001
```

## 3) Music Worker 실행 (포트 8002)

MusicGen은 Apple Silicon MPS를 지원하지 않아(EnCodec 디코더 오류) CPU로만 동작합니다. `torch`/`transformers`/`scipy`는 Python 3.9 + macOS arm64 조합에서 동작이 확인된 버전으로 고정되어 있습니다.

```bash
cd ai/music-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8002
```

서버 시작 시 모델을 한 번만 로드합니다(로그에서 `[music-worker] model loaded` 확인). 이후 요청부터는 재로딩 없이 바로 생성해 매 요청 로딩 시간이 들지 않습니다.

## 4) Next.js 실행 (포트 3000)

```bash
cp .env.example .env.local   # 워커가 다른 호스트/포트에 있다면 값 수정
npm install
npm run dev
```

`http://localhost:3000` 접속 → 이미지 업로드 → BGM 생성. 세 서비스가 모두 로컬에 떠 있어야 동작하며, CPU 환경에서 생성 하나에 1~2분 정도 걸립니다(진행 화면에 안내 문구가 표시됩니다).

## 헬스 체크

```bash
curl http://localhost:8001/health
curl http://localhost:8002/health
```

## 참고

- `PicTune.md` — 전체 아키텍처(추후 Kubernetes/AWS 배포 구성 포함) 스펙
- `ai/SMOLVLM2_MUSICGEN_TEST.md` — SmolVLM2/MusicGen 원본 파이프라인 테스트 기록
- 이미지와 생성된 오디오는 서버에 저장되지 않고 메모리에서만 처리됩니다 (`PicTune.md` 섹션 7)
