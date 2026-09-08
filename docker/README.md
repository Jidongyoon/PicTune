# PicTune VLM 컨테이너 배포

VLM 계층은 하나의 Kubernetes Pod에서 다음 순서로 실행합니다.

- `model-init`: SmolVLM GGUF 파일을 조건부 다운로드
- `llama-server`: 공식 CPU 전용 llama.cpp 서버 이미지
- `vlm-api`: 작업 잠금과 취소를 담당하는 FastAPI 어댑터

llama-server Dockerfile은 공식 `ghcr.io/ggml-org/llama.cpp:server` 이미지를
그대로 상속하고 PicTune용 기본 실행 인자만 설정합니다. `server`는 이동 태그이므로
배포 버전을 완전히 고정해야 한다면 `LLAMA_CPP_IMAGE` 빌드 인자에 공식 이미지의
digest를 지정합니다. 모델 파일은 이미지에 포함하지 않습니다.

## 로컬 이미지 빌드

프로젝트 루트에서 Kubernetes 노드와 동일한 `linux/amd64` 플랫폼으로
빌드합니다.

```bash
docker build --platform linux/amd64 -f docker/llama-server/Dockerfile \
  -t pictune-llama-server:server docker/llama-server

docker build --platform linux/amd64 -f docker/model-init/Dockerfile \
  -t pictune-vlm-model-init:smolvlm2-1bc3c9f docker/model-init

docker build --platform linux/amd64 -f docker/smolvlm/Dockerfile \
  -t pictune-vlm-api:v1 .
```

VLM API만 저장소의 `ai/` 소스를 복사하므로 프로젝트 루트를 build context로
사용합니다. 해당 Dockerfile 전용 ignore 파일이 필요한 소스만 포함합니다.

## Amazon ECR에 push

```bash
export AWS_ACCOUNT_ID=000000000000
export AWS_REGION=ap-northeast-2
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

docker tag pictune-llama-server:server \
  "${ECR_REGISTRY}/pictune-llama-server:server"
docker tag pictune-vlm-model-init:smolvlm2-1bc3c9f \
  "${ECR_REGISTRY}/pictune-vlm-model-init:smolvlm2-1bc3c9f"
docker tag pictune-vlm-api:v1 \
  "${ECR_REGISTRY}/pictune-vlm-api:v1"

docker push "${ECR_REGISTRY}/pictune-llama-server:server"
docker push "${ECR_REGISTRY}/pictune-vlm-model-init:smolvlm2-1bc3c9f"
docker push "${ECR_REGISTRY}/pictune-vlm-api:v1"
```

ECR 저장소가 없다면 먼저 생성합니다.

```bash
aws ecr create-repository --repository-name pictune-llama-server --region "${AWS_REGION}"
aws ecr create-repository --repository-name pictune-vlm-model-init --region "${AWS_REGION}"
aws ecr create-repository --repository-name pictune-vlm-api --region "${AWS_REGION}"
```

## 단일 노드 캐시 준비

initContainer가 UID `10001`로 `/cache/vlm`에 쓸 수 있도록 노드에서 한 번
준비합니다.

```bash
sudo install -d -o 10001 /cache/vlm
```

`model-init`은 아래 파일명을 각각 확인하고 없는 파일만 다운로드합니다.

- `/cache/vlm/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf`
- `/cache/vlm/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf`

검사는 의도적으로 파일명 존재 여부만 사용하므로, 같은 이름의 손상된 파일이나
다른 내용의 파일까지 판별하지는 않습니다.

## Kubernetes 배포 예시

AWS 계정 ID와 리전을 실제 ECR 주소로 바꿔 사용합니다. VLM API와
llama-server는 취소 스트림이 프록시를 거치지 않도록 같은 Pod에서 localhost로
통신하며, Service는 VLM API의 8001 포트만 공개합니다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pictune-vlm
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: pictune-vlm
  template:
    metadata:
      labels:
        app: pictune-vlm
    spec:
      terminationGracePeriodSeconds: 180
      initContainers:
        - name: model-init
          image: 000000000000.dkr.ecr.ap-northeast-2.amazonaws.com/pictune-vlm-model-init:smolvlm2-1bc3c9f
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            runAsNonRoot: true
          volumeMounts:
            - name: vlm-cache
              mountPath: /cache/vlm
      containers:
        - name: llama-server
          image: 000000000000.dkr.ecr.ap-northeast-2.amazonaws.com/pictune-llama-server:server
          imagePullPolicy: IfNotPresent
          args:
            - -m
            - /cache/vlm/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf
            - --mmproj
            - /cache/vlm/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf
            - --host
            - 0.0.0.0
            - --port
            - "8003"
            - --parallel
            - "1"
            - --slots
            - -c
            - "4096"
          ports:
            - name: llama-http
              containerPort: 8003
          resources:
            requests:
              cpu: "2"
              memory: 4Gi
            limits:
              cpu: "8"
              memory: 6Gi
          securityContext:
            allowPrivilegeEscalation: false
            runAsNonRoot: true
          startupProbe:
            httpGet:
              path: /health
              port: llama-http
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 60
          readinessProbe:
            httpGet:
              path: /health
              port: llama-http
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          volumeMounts:
            - name: vlm-cache
              mountPath: /cache/vlm
              readOnly: true
        - name: vlm-api
          image: 000000000000.dkr.ecr.ap-northeast-2.amazonaws.com/pictune-vlm-api:v1
          imagePullPolicy: IfNotPresent
          env:
            - name: LLAMA_SERVER_URL
              value: http://127.0.0.1:8003
          ports:
            - name: vlm-http
              containerPort: 8001
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: "1"
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            runAsNonRoot: true
          readinessProbe:
            httpGet:
              path: /health
              port: vlm-http
            periodSeconds: 5
            timeoutSeconds: 6
            failureThreshold: 3
          livenessProbe:
            tcpSocket:
              port: vlm-http
            periodSeconds: 30
            timeoutSeconds: 3
            failureThreshold: 5
      volumes:
        - name: vlm-cache
          hostPath:
            path: /cache/vlm
            type: Directory
---
apiVersion: v1
kind: Service
metadata:
  name: pictune-vlm
spec:
  selector:
    app: pictune-vlm
  ports:
    - name: http
      port: 8001
      targetPort: vlm-http
```

Next.js에는 `VLM_WORKER_URL=http://pictune-vlm:8001`을 설정합니다. VLM Pod와
llama-server 슬롯은 각각 하나만 유지하고 `--parallel 1 --slots`를 제거하지
마세요. 이 조건에서 VLM API는 스트림을 닫은 뒤 `/slots`의
`is_processing: false`를 확인하고 작업 잠금을 해제합니다.

EKS는 일반적으로 노드 IAM 역할을 통해 ECR 이미지를 가져옵니다. 다른
Kubernetes 환경에서 private ECR을 사용한다면 `imagePullSecrets`가 필요할 수
있습니다. initContainer의 최초 다운로드에는 Hugging Face로 향하는 아웃바운드
네트워크가 필요합니다.
