# PicTune MusicGen 워커
# 빌드 컨텍스트는 이 파일이 있는 폴더가 아니라 상위 ai/ 이다.
# main.py가 ../job_runner.py를 import 하므로 둘 다 컨텍스트에 있어야 한다.
#   docker build -f ai/music-worker/Dockerfile -t pictune-music ai

# 1. [Base Image] 호환성과 경량화를 만족하는 표준 베이스 이미지
# scipy==1.13.1이 3.12까지 지원하므로 3.11로 고정한다.
FROM python:3.11-slim

# 2. [Environment] 허깅페이스/앱 환경 변수 통합
# HF_HOME: AI 모델 저장하는 장소. 여기에 볼륨을 붙여 재사용한다.

ENV HF_HOME=/cache 
    

# 3. [Workdir] 컨테이너 작업 디렉터리 설정
WORKDIR /app

# 4. [Layer Cache] 빌드 속도 최적화를 위한 의존성 분리 복사 및 설치
# --no-cache-dir: 의존성 설치하고 난 뒤 필요 없는 파일 제거해줘
# --index-url(CPU 전용): 안 쓰면 amd64에서 CUDA 의존성까지 받아 이미지가 수 GB 커진다.
#   이 인덱스에는 amd64/arm64 휠이 모두 있어 멀티아키 빌드도 가능하다.
COPY music-worker/requirements.txt .
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      --extra-index-url https://pypi.org/simple \
      -r requirements.txt

# 5. [Source Code] 애플리케이션 코드 복사
# 의존성(특히 torch)은 무겁고 잘 안 바뀌지만 워커 코드는 자주 바뀌므로 뒤에 둔다.
# job_runner.py는 상위 ai/ 에 있는 공용 모듈이라 따로 복사한다.
COPY job_runner.py .
COPY music-worker/. .

# 6. [Security & Permission] 최소 권한 전용 계정(10001) 생성 및 디렉터리 권한 부여
# /cache는 볼륨 마운트 지점이라 미리 만들어 권한을 넘겨야 모델을 받아 쓸 수 있다.
RUN useradd -r -u 10001 -d /app -s /sbin/nologin apisvc && \
    mkdir -p /cache && \
    chown -R apisvc:apisvc /cache /app

# 7. [User Switch] root 탈피 및 일반 서비스 계정으로 실행
USER apisvc

# 8. [Port] 서비스 포트 명시
# 실질적인 기능이 없고 문서용도
EXPOSE 8002

# 9. [Healthcheck] 표준 라이브러리 기반 헬스체크 (추가 패키지 불필요)
# 볼륨이 빈 첫 기동에는 모델(약 2GB) 다운로드 + CPU 로딩이 있어 start-period를 길게 준다.
# 그 사이 retries가 소진되면 계속 unhealthy로 남으므로 retries도 함께 늘린다.
HEALTHCHECK --interval=10s --timeout=5s --start-period=300s --retries=60 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8002/health')"

# 10. [Entrypoint] PID 1 시그널 수신을 위한 Exec Form 포그라운드 기동
# --workers 1: 모델을 프로세스당 한 번만 올리고, 취소용 작업 상태를 한 프로세스에서 관리한다.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "1"]
