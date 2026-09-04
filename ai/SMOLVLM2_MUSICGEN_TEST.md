# SmolVLM2 + MusicGen 이미지→BGM 테스트

이미지를 SmolVLM2로 캡셔닝하고, 그 캡션을 MusicGen에 넣어 BGM을 생성하는 파이프라인을 테스트하기 위한 셋업 기록. 캡션→음악 프롬프트 자동 변환 로직은 아직 미정(두 모델 raw 출력을 먼저 확인하는 단계).

## 환경
- macOS, Apple Silicon (arm64)
- Python은 시스템 기본 `/usr/bin/python3` (3.9.6) 하나뿐 → MusicGen용은 전용 venv로 격리
- Homebrew로 `llama.cpp` 설치 (SmolVLM2 GGUF 실행용)

## 파일 구조
```
Crawling_Test/
├── crawler.py                          # 기존 이미지 크롤러
├── downloaded_images/                  # 크롤링된 테스트 이미지
├── models/smolvlm2-gguf/
│   ├── SmolVLM2-2.2B-Instruct-Q4_K_M.gguf      (~1.0GB)
│   └── mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf (~565MB)
├── run_smolvlm_caption.sh              # SmolVLM2 캡셔닝 스크립트
├── test_musicgen.py                    # MusicGen 생성 스크립트
├── .venv-musicgen/                     # MusicGen 전용 Python venv
└── outputs/
    ├── <이미지명>_caption.txt          # SmolVLM2 캡션 결과
    ├── <이미지명>_log.txt              # SmolVLM2 로드/실행 로그
    └── <이미지명>_music.wav            # MusicGen 생성 오디오
```

## 셋업

```bash
# 1. SmolVLM2 실행용 llama.cpp 설치
brew install llama.cpp

# 2. GGUF 모델 다운로드
mkdir -p models/smolvlm2-gguf && cd models/smolvlm2-gguf
curl -L -o SmolVLM2-2.2B-Instruct-Q4_K_M.gguf \
  "https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf"
curl -L -o mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf \
  "https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf"
cd ../..

# 3. MusicGen용 venv (Python 3.9 제약으로 버전 고정 필요)
python3 -m venv .venv-musicgen
source .venv-musicgen/bin/activate
pip install --upgrade pip
pip install torch==2.8.0 transformers==4.57.5 scipy==1.13.1
```

**버전 고정 이유**: `torch`는 2.9+부터 Python 3.9용 macOS arm64 wheel이 없어서 `2.8.0` 고정. `transformers`는 5.x부터 Python 3.10+ 요구라 3.9를 지원하는 마지막 4.x인 `4.57.5` 고정. `scipy`도 같은 이유로 `1.13.1` 고정.

## 사용법

```bash
# 1) 이미지 캡셔닝
./run_smolvlm_caption.sh downloaded_images/0002.jpg
# → outputs/0002_caption.txt, outputs/0002_log.txt 생성

# 2) 캡션을 MusicGen 프롬프트로 그대로 사용해 BGM 생성
source .venv-musicgen/bin/activate
python test_musicgen.py --prompt "$(cat outputs/0002_caption.txt)" --seconds 8 --out outputs/0002_music.wav

# 재생
afplay outputs/0002_music.wav
```

`test_musicgen.py` 옵션: `--prompt`(필수), `--seconds`(기본 8), `--out`(기본 `outputs/musicgen_out.wav`), `--device`(기본 `cpu`), `--seed`.

## 테스트 결과 / 알게 된 것

- **MPS 미지원**: MusicGen을 Apple Silicon MPS로 돌리면 EnCodec 디코더에서 `Output channels > 65536 not supported at the MPS device` 오류 발생 → `--device` 기본값을 `cpu`로 고정함.
- **소요시간** (0002.jpg, 8초 분량 BGM 기준):
  | 단계 | 총 소요시간 |
  |---|---|
  | SmolVLM2 캡셔닝 | ~54초 |
  | MusicGen 생성 (모델 로딩 포함) | ~83초 |

  캡션+생성 합쳐 8초짜리 BGM 하나에 약 2분 20초.
- SmolVLM2 캡션 프롬프트는 분위기/색감/조명/에너지 위주로 설계(`run_smolvlm_caption.sh` 내 `PROMPT` 변수 참고) — MusicGen에 바로 넣기 좋은 형태를 노림.

## 다음 단계 (미정)
- 캡션 텍스트를 MusicGen 프롬프트로 그대로 쓸지, 압축/재구성할지, 장르·악기·템포 키워드를 추가할지 결정 필요 → 여러 이미지로 raw 출력을 더 모아본 뒤 결정.
