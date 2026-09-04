# PicTune Docker + k3s 배포 매뉴얼

Ubuntu 24.04가 설치된 단일 AWS EC2 `t3.xlarge` 서버에서 Docker와 k3s를 이용해 PicTune을 배포하는 절차다. `t3.xlarge`의 자원은 4 vCPU와 16 GiB 메모리다.

## 1. 확정된 배포 구성

- Web 이미지: 별도 머신에서 빌드해 Amazon ECR에 push하고, k3s가 ECR에서 pull한다.
- VLM 이미지: 별도 머신에서 빌드해 Amazon ECR에 push한다. Linux용 llama-mtmd-cli와 SmolVLM2 실행에 필요한 GGUF 파일 두 개를 이미지에 포함한다.
- Music Worker 이미지: 배포 서버에서 빌드한다.
- MusicGen 모델: 서버의 /srv/pictune/models/musicgen-hf에 내려받고 k3s hostPath로 읽기 전용 마운트한다.
- Web과 VLM 이미지 저장소로 Amazon ECR을 사용하고, PVC는 사용하지 않는다.
- EC2와 ECR은 같은 AWS 리전에 두고, EC2 인스턴스 역할에 ECR pull 권한을 부여한다.
- 호스트에 Python이나 Node.js를 설치하지 않는다. 모든 빌드 및 실행 의존성은 Docker 이미지 안에 둔다.

이 구성은 단일 k3s 노드를 전제로 한다. 노드가 늘어나면 hostPath의 모델은 자동 복제되지 않으므로 각 대상 노드의 동일 경로에 모델을 배치하거나 스토리지 전략을 변경해야 한다.


## 2. 이미지별 계약

Web:

- npm ci와 npm run build를 이미지 빌드 단계에서 실행한다.
- npm run start로 포트 3000을 연다.
- VLM_WORKER_URL과 MUSIC_WORKER_URL을 런타임 환경변수로 받는다.
- 모델을 포함하지 않는다.

VLM:

- llama.cpp는 검증한 tag 또는 commit으로 고정해 빌드한다.
- llama-mtmd-cli를 PATH에서 실행할 수 있어야 한다.
- 애플리케이션 작업 디렉터리는 /app/ai/vlm-worker로 유지한다.
- SmolVLM2 하나를 구성하는 주 모델과 멀티모달 프로젝터 GGUF 파일을 이미지에 포함한다.

      /app/ai/models/smolvlm2-gguf/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf
      /app/ai/models/smolvlm2-gguf/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf

- uvicorn main:app --host 0.0.0.0 --port 8001로 실행한다.

Music Worker:

- 작업 디렉터리는 /app/ai/music-worker다.
- uvicorn main:app --host 0.0.0.0 --port 8002로 실행한다.
- 모델은 이미지에 포함하지 않는다.
- HF_HOME=/models/huggingface를 사용한다.
- CPU 전용 PyTorch를 설치한다.

Linux에서 requirements.txt만 설치하면 CUDA 라이브러리까지 포함될 수 있다. music.Dockerfile은 CPU wheel을 먼저 설치한다.

    RUN pip install --no-cache-dir \
          --index-url https://download.pytorch.org/whl/cpu \
          torch==2.8.0 \
     && pip install --no-cache-dir -r requirements.txt

## 3. 태그 정책

latest를 사용하지 않고 Git commit 또는 릴리스 번호로 세 이미지를 같은 버전으로 태그한다.

    export PICTUNE_TAG=2026-09-04-a1b2c3d

    <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/pictune-web:<TAG>
    <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/pictune-vlm:<TAG>
    pictune-music:<TAG>

Web과 VLM은 ECR의 불변 태그를 사용하고 `imagePullPolicy: IfNotPresent`로 설정한다. 서버에서 직접 빌드해 k3s containerd로 가져오는 Music Worker만 `imagePullPolicy: Never`를 사용한다.

## 4. 외부 머신에서 Web과 VLM 빌드 후 ECR에 push

### VLM 모델 준비

    git clone <PICTUNE_REPOSITORY_URL> PicTune
    cd PicTune
    export PICTUNE_TAG=<RELEASE_TAG_OR_GIT_SHA>
    export AWS_ACCOUNT_ID=<AWS_ACCOUNT_ID>
    export AWS_REGION=<AWS_REGION>
    export ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
    mkdir -p ai/models/smolvlm2-gguf

    curl -L --fail \
      -o ai/models/smolvlm2-gguf/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf \
      "https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf"

    curl -L --fail \
      -o ai/models/smolvlm2-gguf/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf \
      "https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf"

    ls -lh ai/models/smolvlm2-gguf
    sha256sum ai/models/smolvlm2-gguf/*.gguf

운영 빌드에서는 URL의 main 대신 검증한 Hugging Face commit revision과 SHA-256을 고정한다.

### ECR 로그인과 저장소 준비

빌드 머신의 AWS 자격 증명에는 ECR 로그인과 `pictune-web`, `pictune-vlm` 저장소 push 권한이 있어야 한다.

    aws ecr get-login-password --region "$AWS_REGION" \
      | docker login --username AWS --password-stdin "$ECR_REGISTRY"

    aws ecr describe-repositories --region "$AWS_REGION" \
      --repository-names pictune-web pictune-vlm

저장소가 없다면 최초 한 번 생성한다.

    aws ecr create-repository --region "$AWS_REGION" --repository-name pictune-web
    aws ecr create-repository --region "$AWS_REGION" --repository-name pictune-vlm

### 이미지 빌드와 push

서버가 x86_64인 예시다.

    docker buildx build --platform linux/amd64 --load \
      -f docker/web.Dockerfile \
      -t "$ECR_REGISTRY/pictune-web:$PICTUNE_TAG" .

    docker buildx build --platform linux/amd64 --load \
      -f docker/vlm.Dockerfile \
      -t "$ECR_REGISTRY/pictune-vlm:$PICTUNE_TAG" .

VLM 이미지 내용을 확인한다.

    docker run --rm --entrypoint sh "$ECR_REGISTRY/pictune-vlm:$PICTUNE_TAG" -c \
      'command -v llama-mtmd-cli && ls -lh /app/ai/models/smolvlm2-gguf'

검증이 끝나면 ECR에 push한다.

    docker push "$ECR_REGISTRY/pictune-web:$PICTUNE_TAG"
    docker push "$ECR_REGISTRY/pictune-vlm:$PICTUNE_TAG"

## 5. 서버 디렉터리와 소스 준비

호스트 Python과 Node.js는 설치하지 않는다.

    sudo apt-get update
    sudo apt-get install -y ca-certificates curl git
    sudo install -d -m 0755 /opt/pictune
    sudo install -d -m 0755 /srv/pictune/models/musicgen-hf
    sudo chown -R "$(id -u):$(id -g)" /opt/pictune /srv/pictune

    git clone <PICTUNE_REPOSITORY_URL> /opt/pictune/current
    cd /opt/pictune/current
    git checkout <RELEASE_TAG_OR_GIT_SHA>
    export PICTUNE_TAG=<RELEASE_TAG_OR_GIT_SHA>

EC2에는 AWS CLI v2를 설치하고 ECR pull 권한이 있는 인스턴스 역할을 연결한다. 액세스 키를 서버 파일이나 문서에 저장하지 않는다. 호스트 Python이나 Node.js는 필요하지 않다.

## 6. k3s의 ECR 인증 준비

배포 서버의 AWS 자격 증명에는 ECR 로그인과 `pictune-web`, `pictune-vlm` pull 권한이 있어야 한다.

    export AWS_ACCOUNT_ID=<AWS_ACCOUNT_ID>
    export AWS_REGION=<AWS_REGION>
    export ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
    export ECR_PASSWORD="$(aws ecr get-login-password --region "$AWS_REGION")"

    sudo k3s kubectl create namespace pictune \
      --dry-run=client -o yaml | sudo k3s kubectl apply -f -

    sudo k3s kubectl -n pictune create secret docker-registry ecr-registry \
      --docker-server="$ECR_REGISTRY" \
      --docker-username=AWS \
      --docker-password="$ECR_PASSWORD" \
      --dry-run=client -o yaml | sudo k3s kubectl apply -f -

    unset ECR_PASSWORD

ECR 인증 토큰의 유효 시간은 12시간이다. 새 이미지를 pull하기 전에는 위 Secret을 갱신한다. 장기 운영이나 다중 노드 구성에서는 Secret 수동 갱신 대신 kubelet용 ECR credential provider를 구성한다.

## 7. 서버에서 Music Worker 빌드

    cd /opt/pictune/current
    sudo docker build -f docker/music.Dockerfile \
      -t "pictune-music:$PICTUNE_TAG" .

CPU PyTorch인지 확인한다. 현재 구성에서는 False가 정상이다.

    sudo docker run --rm --entrypoint python \
      "pictune-music:$PICTUNE_TAG" \
      -c 'import torch; print(torch.__version__); print(torch.cuda.is_available())'

Docker와 k3s containerd의 이미지 저장소는 별개이므로, 서버에서 빌드한 Music Worker 이미지만 k3s에 import한다. 파일로 저장하거나 다른 머신으로 전송할 필요는 없다.

    sudo docker save "pictune-music:$PICTUNE_TAG" \
      | sudo k3s ctr images import -
    sudo k3s ctr images list | grep pictune-music

## 8. MusicGen 모델을 hostPath에 준비

Music Worker 이미지의 huggingface_hub를 이용하므로 호스트 Python은 필요 없다.

    sudo docker run --rm \
      --user 0:0 \
      --entrypoint python \
      -e HF_HOME=/models/huggingface \
      -v /srv/pictune/models/musicgen-hf:/models/huggingface \
      "pictune-music:$PICTUNE_TAG" \
      -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='facebook/musicgen-small')"

    du -sh /srv/pictune/models/musicgen-hf
    find /srv/pictune/models/musicgen-hf -maxdepth 3 -type d | head
    sudo chmod -R a+rX /srv/pictune/models/musicgen-hf

운영에서는 검증한 MusicGen snapshot commit을 snapshot_download의 revision으로 고정한다.

## 9. 노드 라벨과 hostPath 설정

모델이 있는 노드에 라벨을 붙인다.

    export PICTUNE_NODE="$(sudo k3s kubectl get nodes -o jsonpath='{.items[0].metadata.name}')"
    sudo k3s kubectl label node "$PICTUNE_NODE" \
      pictune.ai/musicgen=true --overwrite

Music Worker Deployment의 핵심 설정:

    spec:
      template:
        spec:
          nodeSelector:
            pictune.ai/musicgen: "true"
          containers:
            - name: music-worker
              image: pictune-music:RELEASE_TAG
              imagePullPolicy: Never
              env:
                - name: HF_HOME
                  value: /models/huggingface
                - name: HF_HUB_OFFLINE
                  value: "1"
                - name: TRANSFORMERS_OFFLINE
                  value: "1"
              volumeMounts:
                - name: musicgen-model
                  mountPath: /models/huggingface
                  readOnly: true
          volumes:
            - name: musicgen-model
              hostPath:
                path: /srv/pictune/models/musicgen-hf
                type: Directory

DirectoryOrCreate는 사용하지 않는다. 경로가 잘못되면 빈 디렉터리를 만드는 대신 Pod가 즉시 실패해야 한다. 모델 디렉터리만 읽기 전용으로 마운트하고 루트, /srv 전체, Docker 또는 k3s socket은 마운트하지 않는다.

## 10. Kubernetes 설정

Web과 VLM Deployment에는 ECR의 전체 이미지 주소와 6절에서 만든 pull Secret을 지정한다.

    spec:
      template:
        spec:
          imagePullSecrets:
            - name: ecr-registry
          containers:
            - name: web
              image: <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/pictune-web:RELEASE_TAG
              imagePullPolicy: IfNotPresent

VLM Deployment도 같은 방식으로 설정한다.

    spec:
      template:
        spec:
          imagePullSecrets:
            - name: ecr-registry
          containers:
            - name: vlm-worker
              image: <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/pictune-vlm:RELEASE_TAG
              imagePullPolicy: IfNotPresent

Web Deployment는 Service DNS를 사용한다.

    env:
      - name: VLM_WORKER_URL
        value: http://pictune-vlm:8001
      - name: MUSIC_WORKER_URL
        value: http://pictune-music:8002

| 컴포넌트 | Service | 포트 | 공개 여부 |
| --- | --- | ---: | --- |
| Web | pictune-web | 3000 | NodePort 또는 Ingress |
| VLM | pictune-vlm | 8001 | ClusterIP |
| Music | pictune-music | 8002 | ClusterIP |

MusicGen은 서버가 열리기 전에 모델을 로드하므로 최대 10분의 startupProbe를 둔다.

    startupProbe:
      httpGet:
        path: /health
        port: 8002
      periodSeconds: 10
      failureThreshold: 60
    readinessProbe:
      httpGet:
        path: /health
        port: 8002
      periodSeconds: 10
    livenessProbe:
      httpGet:
        path: /health
        port: 8002
      periodSeconds: 30

`t3.xlarge` 단일 노드용 초기 resource 시작점은 다음과 같다. 합산 request를 노드 전체 4 vCPU/16 GiB보다 낮게 두어 k3s와 운영체제용 여유를 남긴다.

    # Web
    requests: { cpu: "100m", memory: 256Mi }
    limits:   { cpu: "500m", memory: 512Mi }

    # VLM
    requests: { cpu: "750m", memory: 3Gi }
    limits:   { cpu: "2", memory: 5Gi }

    # Music Worker
    requests: { cpu: "1500m", memory: 5Gi }
    limits:   { cpu: "3", memory: 8Gi }

VLM과 Music Worker replica는 각각 1로 시작한다. replica마다 모델을 별도로 메모리에 로드하므로 이 서버에서 replica를 늘리지 않는다. 실제 최대 메모리 사용량을 측정한 뒤 limits를 조정한다.

## 11. 배포와 검증

매니페스트의 ECR 주소와 RELEASE_TAG를 실제 값으로 렌더링하거나 Kustomize image override를 사용한다. ECR Secret을 갱신한 뒤 결과 YAML을 검토하고 적용한다. Web과 VLM 이미지는 Pod가 시작될 때 ECR에서 자동으로 pull된다.

    cd /opt/pictune/current
    sudo k3s kubectl apply -f infra/k8s/namespace.yaml
    sudo k3s kubectl apply -f infra/k8s/vlm.yaml
    sudo k3s kubectl apply -f infra/k8s/music.yaml
    sudo k3s kubectl apply -f infra/k8s/web.yaml

    sudo k3s kubectl -n pictune rollout status deployment/pictune-vlm --timeout=10m
    sudo k3s kubectl -n pictune rollout status deployment/pictune-music --timeout=10m
    sudo k3s kubectl -n pictune rollout status deployment/pictune-web --timeout=5m
    sudo k3s kubectl -n pictune get pods,svc -o wide

Worker 헬스 체크는 각각 포트 포워딩한 뒤 수행한다.

    sudo k3s kubectl -n pictune port-forward service/pictune-vlm 18001:8001
    curl --fail http://127.0.0.1:18001/health

    sudo k3s kubectl -n pictune port-forward service/pictune-music 18002:8002
    curl --fail http://127.0.0.1:18002/health

정상 응답:

    {"status":"ok"}

Web을 NodePort 30080으로 구성했다면 http://<SERVER_IP>:30080으로 접속한다. CPU 환경에서는 생성 요청이 수 분 걸릴 수 있으므로 Traefik, Ingress 및 외부 로드밸런서 timeout을 최초에는 5분에서 10분으로 잡는다.

## 12. 운영과 장애 진단

    sudo k3s kubectl -n pictune get all
    sudo k3s kubectl -n pictune get events --sort-by=.lastTimestamp
    sudo k3s kubectl -n pictune logs deployment/pictune-web --tail=200 -f
    sudo k3s kubectl -n pictune logs deployment/pictune-vlm --tail=200 -f
    sudo k3s kubectl -n pictune logs deployment/pictune-music --tail=200 -f
    sudo k3s kubectl top nodes
    sudo k3s kubectl top pods -n pictune

`t3.xlarge`는 버스트형 인스턴스이므로 CPU 기반 생성이 계속되면 CPU 크레딧을 소모한다. CloudWatch에서 `CPUCreditBalance`, `CPUSurplusCreditBalance`, `CPUSurplusCreditsCharged`를 확인한다. 지속 부하가 반복되면 고정 성능 인스턴스로 변경하거나 추가 요금을 고려한다.

- Web/VLM의 `ErrImagePull` 또는 `ImagePullBackOff`: ECR 전체 이미지 주소와 태그, `ecr-registry` Secret, AWS 권한 및 토큰 만료 여부를 확인한다.
- Music Worker의 `ErrImageNeverPull`: 매니페스트 태그와 `sudo k3s ctr images list` 결과를 비교한다.
- Music Worker 시작 실패: HF_HOME, hostPath, 파일 권한과 OOMKilled 여부를 확인한다.
- VLM 모델 오류: 이미지 내부의 /app/ai/models/smolvlm2-gguf와 llama-mtmd-cli를 확인한다.
- 요청 중단: Web, VLM, Music 단계별 로그와 프록시 timeout을 확인한다.

VLM 이미지의 모델이 누락됐다면 .dockerignore가 ai/models를 제외하지 않는지 확인한다. Git의 .gitignore와 Docker의 .dockerignore는 별개다.

## 13. 업데이트와 롤백

업데이트 시 새 불변 태그를 사용해 Web과 VLM을 외부에서 빌드하여 ECR에 push하고, Music Worker를 서버에서 같은 source revision으로 빌드하여 k3s containerd에 import한다. ECR Secret을 갱신하고 매니페스트의 이미지 태그를 변경하면 Web과 VLM은 ECR에서 새 이미지를 pull한다.

MusicGen 모델이 바뀌지 않았다면 hostPath는 다시 받을 필요가 없다. 모델을 변경했다면 새 snapshot을 완전히 받은 뒤 Music Worker를 재시작한다.

    sudo k3s kubectl -n pictune rollout restart deployment/pictune-music
    sudo k3s kubectl -n pictune rollout status deployment/pictune-music --timeout=10m

롤백:

    sudo k3s kubectl -n pictune rollout undo deployment/pictune-web
    sudo k3s kubectl -n pictune rollout undo deployment/pictune-vlm
    sudo k3s kubectl -n pictune rollout undo deployment/pictune-music

## 14. 참고 자료

- Amazon ECR 이미지 push: https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html
- Amazon EC2 T3 사양과 CPU 크레딧: https://aws.amazon.com/ec2/instance-types/t3/
- Kubernetes private registry pull: https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/
- K3s 이미지 import: https://docs.k3s.io/add-ons/import-images
- Kubernetes hostPath: https://kubernetes.io/docs/concepts/storage/volumes/#hostpath
- 로컬 실행: SETUP.md
- 전체 아키텍처: PicTune.md
