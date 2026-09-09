# PicTune 로컬 실행 가이드

## 구성

- **Next.js** (레포 루트, `app/`) — UI + `/api/analyze`, `/api/music`, `/api/cancel`
- **VLM Worker** (`ai/vlm-worker`) — SmolVLM2로 이미지 → 무드 분석 JSON(`musicgen_prompt` 포함)
- **Music Worker** (`ai/music-worker`) — 상주 MusicGen으로 프롬프트 → 1~30초 WAV

Next.js, VLM API, llama-server, Music API의 네 프로세스가 실행되어야 하며, 전체 아키텍처는 `PicTune.md`를 참고하세요.

## 사전 준비

- Node.js 20 이상, npm
- Python 3.9 (macOS 시스템 기본 `/usr/bin/python3`)
- Homebrew + `brew install llama.cpp` (상주 추론용 `llama-server`; 검증 버전 0.3.0 / c1d0e7a00)

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

## 2) 상주 VLM 서버 및 API 실행 (포트 8003, 8001)

프로젝트 루트에서 별도 터미널로 실행합니다. 모델은 이 서버가 종료될 때까지 유지됩니다.

```bash
bash ai/vlm-worker/start-llama.sh
```

다른 터미널에서 VLM API를 실행합니다. 기본 `LLAMA_SERVER_URL`은
`http://127.0.0.1:8003`입니다. llama-server는 이 API 전용으로 사용하고 직접 외부에 공개하지 않습니다.


```bash
cd ai/vlm-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8001 --workers 1
```

## 3) Music Worker 실행 (포트 8002)

MusicGen은 Apple Silicon MPS를 지원하지 않아(EnCodec 디코더 오류) CPU로만 동작합니다. `torch`/`transformers`/`scipy`는 Python 3.9 + macOS arm64 조합에서 동작이 확인된 버전으로 고정되어 있습니다.

```bash
cd ai/music-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8002 --workers 1
```

음악 모델은 API 프로세스 시작 시 한 번 로드합니다. 생성은 같은 프로세스의 스레드에서 실행하고, 정상 완료·취소 후에도 같은 모델을 재사용합니다. 캐시가 준비된 오프라인 실행은 `HF_HUB_OFFLINE=1`을 설정합니다.

## 4) Next.js 실행 (포트 3000)

```bash
cp .env.example .env.local   # 워커가 다른 호스트/포트에 있다면 값 수정
npm install
npm run dev
```

`http://localhost:3000` 접속 → 이미지 업로드 → BGM 생성. 네 프로세스가 모두 실행되어야 합니다. 소요 시간은 이미지와 음악 길이·장비에 따라 달라집니다.

## 헬스 체크

```bash
curl http://localhost:8003/health
curl http://localhost:8003/slots
curl http://localhost:8001/health
curl http://localhost:8002/health
```

## 참고

- `PicTune.md` — 전체 아키텍처(추후 Kubernetes/AWS 배포 구성 포함) 스펙
- `ai/SMOLVLM2_MUSICGEN_TEST.md` — SmolVLM2/MusicGen 원본 파이프라인 테스트 기록
- 이미지는 HTTP로 전송하고 WAV는 메모리에서 반환합니다. 요청별 AI 실행 파일이나 영구 결과 파일을 만들지 않습니다.


## 서버 작업 취소

프론트엔드가 UUID를 `x-job-id` 헤더로 두 단계에 전달합니다.
`POST /api/cancel`에 `{"jobId":"작업 UUID"}`를 보내면 두 워커에 취소를 전달합니다.

- MusicGen: 작업별 `threading.Event`를 확인해 생성·디코딩 경계에서 예외로 중단합니다. 모델은 유지합니다.
- VLM: 수락된 HTTP 스트림을 닫고, llama-server의 단일 슬롯이 유휴 상태가 될 때까지 기다립니다. 서버는 유지합니다.
- 현재 native CPU/GPU 연산은 다음 확인 지점까지 진행될 수 있습니다. 중단 확인이 5초 이상 걸리면 워커는 202를 반환하고 UI가 계속 확인합니다.
- 실제 연산·정리가 끝나기 전에는 작업 잠금을 해제하거나 취소 완료(200)를 반환하지 않습니다.
- 취소한 ID는 1시간 동안 차단합니다. 대기 작업 취소는 실행 중인 다른 작업에 영향을 주지 않습니다.

워커별 `--workers 1`, VLM 서버 `--parallel 1 --slots`가 필요합니다.
`ai/job_runner.py`를 포함한 디렉터리 구조를 배포에서도 유지하세요.
여러 API 복제본을 사용할 경우 작업 소유권을 공유하는 큐와 취소 라우팅을 추가해야 합니다.

검증: `ai/vlm-worker/.venv/bin/python -m unittest discover -s ai/tests -v`
상세 설계와 검증 범위: [상주 추론](docs/RESIDENT_INFERENCE.md)
