# PicTune Kubernetes 매니페스트 공동 작업 가이드

3명이 나눠서 작성한다.
참고 원본: [`docker/README.md`](../docker/README.md) — 이미지 빌드·ECR 푸시·VLM Pod 설계

---

## 0. 설계 원칙 — 먼저 읽을 것

### vlm-api와 llama-server는 **하나의 Pod에 두 컨테이너**로 둔다

나누고 싶은 유혹이 있지만 나누면 안 된다. 이유:

1. **취소 기능이 localhost 통신을 전제로 설계됐다.**
   `docs/incidents/RESIDENT_INFERENCE.md`에 명시되어 있다 — *"수락 응답 헤더 이후에 스트림을 닫아 늦은 요청 시작과 취소의 경합을 줄이고, `/slots`의 `is_processing=false`를 확인한 뒤 작업 잠금을 해제한다"*, *"서버를 다른 클라이언트와 공유하거나 API를 여러 프로세스로 늘리는 것은 이 구현의 범위 밖이다"*.
   Service를 끼우면 kube-proxy가 중간에 들어가 연결 종료 전파 타이밍이 달라진다.

2. **둘은 1:1로 묶여야 정합성이 유지된다.**
   `ai/vlm-worker/caption.py:57`은 `/slots` 응답이 정확히 1개가 아니면 에러를 낸다. `job_runner.py`의 락은 "이 llama-server 인스턴스의 단일 슬롯"을 보호한다. 별도 Deployment로 나누면 이 보장이 K8s 레벨에서 깨진다.

3. **수명주기가 같다.** llama-server 없이 vlm-api는 health조차 통과하지 못한다. 사이드카 패턴의 정석적 조건(강한 결합 / 같은 수명주기 / 같은 노드 필수)에 정확히 부합한다.

> 따라서 **llama-server용 Service는 만들지 않는다.** vlm-api가 Pod 내부에서 `127.0.0.1:8003`으로만 호출한다.

### 그 외 원칙

- 외부에 노출되는 것은 **web 하나뿐**이다. vlm/music은 ClusterIP로 클러스터 내부에서만 접근한다.
- 대상 환경은 **16GB / 4 vCPU EC2 단일 노드, CPU 전용(GPU 사용 불가)**이다.

---

## 1. 담당 분배

| 담당 | 매니페스트 | 난이도 |
|---|---|---|
| **A** | `web` Deployment + Service, **Namespace**, **Ingress** | ★★★ |
| **B** | `vlm` Deployment(initContainer 1 + 컨테이너 2) + Service, **vlm ConfigMap** | ★★★★★ |
| **C** | `music` Deployment + Service, **HPA**, **Secret**, `kubectl top` 실측 | ★★★ |

B가 가장 복잡해서 공통 항목을 A·C가 나눠 갖는다.
A의 Ingress는 타임아웃 함정이 있고, C의 HPA는 전제조건 확인이 필요해 둘 다 가볍지 않다.

### 이미 작성된 참고 예시

`infra/music/` 아래 C 담당분이 먼저 작성되어 있다. **작성 방식·주석 수준의 기준으로 참고**할 것.

```
infra/music/01-deployment.yaml
infra/music/02-service.yaml
```

---

## 2. 공통 규칙 — 여기가 어긋나면 합칠 때 깨진다

각자 따로 작성하므로 **이름·라벨·포트는 아래 표를 그대로 복사**한다. 임의로 바꾸지 않는다.

### 2.1 고정 값

| 항목 | 값 |
|---|---|
| Namespace | `pictune` (모든 리소스에 `metadata.namespace: pictune` 명시) |
| 라벨 키 | `app` |

| 담당 | 라벨값 (`app:`) | Deployment명 | Service명 | Service port | 컨테이너 | 포트명 | 포트 |
|---|---|---|---|---|---|---|---|
| A | `pictune-web` | `pictune-web` | `pictune-web` | 3000 | web | `web-http` | 3000 |
| B | `pictune-vlm` | `pictune-vlm` | `pictune-vlm` | 8001 | vlm-api | `vlm-http` | 8001 |
| B | — | (같은 Pod) | **Service 없음** | — | llama-server | `llama-http` | 8003 |
| C | `pictune-music` | `pictune-music` | `pictune-music` | 8002 | music-worker | `music-http` | 8002 |

**llama-server는 Service를 만들지 않는다.** 만들면 인증 없는 추론 서버가 클러스터에 공개되고, 취소 로직이 프록시를 타면서 깨진다.

### 2.2 서비스 간 호출 주소

| 호출 주체 | 대상 | 값 | 설정 위치 |
|---|---|---|---|
| web | vlm | `http://pictune-vlm:8001` | web env `VLM_WORKER_URL` |
| web | music | `http://pictune-music:8002` | web env `MUSIC_WORKER_URL` |
| vlm-api | llama-server | `http://127.0.0.1:8003` | ConfigMap `LLAMA_SERVER_URL` |

마지막 항목이 **Service 이름이 아니라 localhost**인 점에 주의. 같은 Pod이기 때문이다.

### 2.3 라벨 3곳 일치 규칙

```yaml
# Deployment
spec:
  selector:
    matchLabels:
      app: pictune-xxx        # ①
  template:
    metadata:
      labels:
        app: pictune-xxx      # ② ①과 반드시 동일

# Service
spec:
  selector:
    app: pictune-xxx          # ③ ②와 반드시 동일
```

### 2.4 이미지 태그

`:latest` 금지. 빌드한 태그를 그대로 쓴다.

| 용도 | 이미지 |
|---|---|
| web | `<registry>/pictune-web:v1` |
| vlm-api | `<registry>/pictune-vlm-api:v1` |
| llama-server | `<registry>/pictune-llama-server:server` |
| model-init (initContainer) | `<registry>/pictune-vlm-model-init:smolvlm2-1bc3c9f` |
| music | `<registry>/pictune-music:v1` |

### 2.5 모든 컨테이너에 공통으로 넣을 것

```yaml
imagePullPolicy: IfNotPresent
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
```

---

## 3. 자원 예산 — 16GB / 4 vCPU 단일 노드

```
물리          16 GB / 4000m
- OS/kubelet  -1.0 GB / -300m
- K8s 시스템   -1.0 GB / -200m   (kube-proxy, CNI, CoreDNS, metrics-server)
────────────────────────────
할당 가능      ~14 GB / ~3500m
```

**배정값을 초과하지 않는다.** requests 합이 할당 가능량을 넘으면 Pod가 `Pending`에서 멈춘다.

| 담당 | 컨테이너 | CPU req | CPU limit | Mem req | Mem limit |
|---|---|---|---|---|---|
| A | web | 100m | 500m | 256Mi | 512Mi |
| B | llama-server | 1000m | 2000m | 3Gi | 4Gi |
| B | vlm-api | 100m | 500m | 128Mi | 256Mi |
| B | model-init (init) | 100m | 500m | 256Mi | 512Mi |
| C | music | 800m | 2000m | 3Gi | 4Gi |
| | **합계** | **2000m** | 5000m | **6.4Gi** | 8.75Gi |
| | 할당 가능 | 3500m | — | 14Gi | — |

initContainer의 요청량은 본 컨테이너와 동시에 계산되지 않으므로(둘 중 큰 값 적용) 합계에서 제외했다.

메모리 값은 **아직 실측이 아니다.** 배포 후 C가 `kubectl top`으로 확인해 조정한다(6절).

### GPU 사용 불가 — 반드시 지킬 것

| 담당 | 설정 | 안 하면 |
|---|---|---|
| B | llama `args`에 `-ngl 0` | 기본값이 GPU 오프로드를 가정. 환경에 따라 조용히 다르게 동작 |
| B | llama `args`에 `--threads 2` | 노드 4코어를 전부 점유해 music과 충돌 |
| C | music env `OMP_NUM_THREADS=2`, `MKL_NUM_THREADS=2` | torch가 전 코어 점유 |

---

## 4. 담당별 작성 지침

### A. web + Namespace + Ingress

**Namespace** — 가장 먼저 적용되어야 한다. 이름만 `pictune`으로 정하면 끝.

**web Deployment**
- env 2개 필수: `VLM_WORKER_URL`, `MUSIC_WORKER_URL` (2.2 표의 값)
  - 빠뜨리면 코드 기본값 `http://localhost:8001`로 붙어 **에러 로그 없이 502**가 난다
- probe: readiness `httpGet /`, liveness `tcpSocket`. startupProbe는 불필요(기동이 빠름)
- 볼륨 없음, `terminationGracePeriodSeconds: 60`

**Ingress** — 이 프로젝트에서 가장 위험한 파일

작성 전 반드시 컨트롤러 종류를 확인한다. 어노테이션 이름이 완전히 다르다.
```bash
kubectl get ingressclass
```

| 필수 항목 | 값 | 안 하면 |
|---|---|---|
| 타임아웃 연장 | 300초 | **기본 60초 → BGM 생성(실측 66초)이 502로 끊김** |
| 업로드 크기 | 10m | 기본 1MB → 이미지 업로드 실패 |
| 백엔드 | `pictune-web`만 | vlm/music을 넣으면 추론 API가 공개됨 |

```yaml
# nginx ingress
nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
nginx.ingress.kubernetes.io/proxy-body-size: "10m"

# AWS Load Balancer Controller
alb.ingress.kubernetes.io/load-balancer-attributes: idle_timeout.timeout_seconds=300
alb.ingress.kubernetes.io/scheme: internet-facing
alb.ingress.kubernetes.io/target-type: ip
```

### B. vlm (가장 복잡 — initContainer 1 + 컨테이너 2)

**Pod 구조**

```
initContainer: model-init          GGUF 2개를 /cache/vlm에 다운로드, 끝나야 다음 단계
        ↓
├── llama-server   8003            /cache/vlm 읽기전용 마운트
└── vlm-api        8001            볼륨 마운트 없음, 127.0.0.1:8003 호출
```

세 이미지 모두 UID 10001로 실행되므로 볼륨 권한 문제는 없다(확인 완료).

**ConfigMap `pictune-vlm-config`** — B가 함께 작성한다

```yaml
VLM_REPO_ID: ggml-org/SmolVLM2-2.2B-Instruct-GGUF
VLM_REVISION: 1bc3c9f74ceafd4c8d4411cc9cf188bba3798f91
VLM_MODEL_DIR: /cache/vlm
HF_HOME: /cache/vlm/.huggingface
LLAMA_SERVER_URL: http://127.0.0.1:8003
```

- 앞의 3개(`VLM_REPO_ID`/`VLM_REVISION`/`VLM_MODEL_DIR`)는 **model-init 이미지의 Dockerfile ENV에도 같은 값이 들어 있어서, ConfigMap이 없어도 initContainer는 동작한다.** 그래도 ConfigMap으로 관리하는 이유는 `docker/README.md`의 방침 때문이다 — *"Dockerfile의 ENV는 로컬 실행용 기본값으로만 두고, 배포 환경에 따라 달라지는 값은 별도 ConfigMap으로 관리한다"*
- **`LLAMA_SERVER_URL`은 성격이 다르다. 반드시 덮어써야 한다.** vlm-api 이미지에 `http://llama-server:8003`이 기본값으로 박혀 있는데(`docker/smolvlm/Dockerfile:6`), 우리 구조에는 `llama-server`라는 이름의 Service가 없다. 덮어쓰지 않으면 DNS 조회 실패로 **모든 이미지 분석 요청이 실패**한다

**model-init (initContainer)**
- `envFrom`으로 위 ConfigMap 연결
- 볼륨 `/cache/vlm`에 RW 마운트

**llama-server 컨테이너**
- `args`는 Dockerfile CMD를 **전부 다시 작성**한다. K8s의 `args`는 CMD를 부분 수정할 수 없고 통째로 대체한다

```yaml
args:
  - -m
  - /cache/vlm/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf
  - --mmproj
  - /cache/vlm/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf
  - --host
  - "0.0.0.0"
  - --port
  - "8003"
  - --parallel
  - "1"          # 제거 금지 — caption.py가 슬롯 1개를 전제로 검증한다
  - --slots      # 제거 금지 — 취소 시 /slots 조회에 필요
  - -c
  - "4096"
  - -ngl
  - "0"
  - --threads
  - "2"
```
- 볼륨 `/cache/vlm`을 `readOnly: true`로 마운트
- startupProbe `failureThreshold: 30` 이상 (모델 로딩 최대 5분)

**vlm-api 컨테이너**
- `envFrom`으로 ConfigMap 연결
- **liveness는 반드시 `tcpSocket`** — `/health`가 내부적으로 llama의 `/slots`를 호출하므로(`caption.py:53`), httpGet으로 하면 llama 기동 중에 vlm-api가 재시작 루프에 빠진다
- readiness는 `httpGet /health`, `timeoutSeconds: 6` (llama 왕복 포함)
- **볼륨 마운트 없음** — 모델 파일을 직접 읽지 않는다

**Deployment 공통**
- `replicas: 1` 고정, `strategy: Recreate` (모델 상주라 롤링 시 메모리 2배)
- `terminationGracePeriodSeconds: 180`
- 볼륨: `hostPath: /cache/vlm`, `type: Directory`
  - **노드에서 1회 준비**: `sudo install -d -o 10001 /cache/vlm`
  - `DirectoryOrCreate`를 쓰면 kubelet이 root 소유로 만들어 UID 10001이 쓰지 못한다

**Service** — 8001만 노출. 8003은 넣지 않는다.

### C. music + HPA + Secret + 실측

**Deployment / Service** — `infra/music/`에 작성 완료. 아래를 확인만 하면 된다.
- env `OMP_NUM_THREADS=2`, `MKL_NUM_THREADS=2`
- startupProbe `periodSeconds 10 × failureThreshold 40` (약 6분 40초) — 첫 기동에 모델 약 2GB 다운로드+로딩
- 볼륨 `hostPath: /cache/music`, `type: Directory`
  - **노드에서 1회 준비**: `sudo install -d -o 10001 /cache/music`

**Secret** — 코드에 필수 비밀값은 없다. 유일한 실효 항목은 `HF_TOKEN`이다.

```yaml
apiVersion: v1
kind: Secret
metadata: { name: pictune-hf-token, namespace: pictune }
type: Opaque
stringData:
  HF_TOKEN: "<토큰>"
```
`huggingface_hub` 라이브러리가 자동으로 읽으므로 코드 수정이 필요 없다. 실제로 music-worker 로그에 다음 경고가 찍히고 있어 효용이 있다:
> `You are sending unauthenticated requests to the HF Hub. Please set a HF_TOKEN to enable higher rate limits and faster downloads.`

model-init(B)과 music(C) 양쪽에 `env`의 `secretKeyRef`로 주입한다.

**HPA** — 전제조건 2개를 먼저 확인한다. 하나라도 없으면 그냥 동작하지 않는다.

```bash
kubectl get deployment metrics-server -n kube-system    # ① metrics-server 설치 여부
kubectl get deploy pictune-music -n pictune -o jsonpath='{.spec.template.spec.containers[0].resources.requests}'   # ② requests 존재 여부
```
사용률 = 사용량 ÷ requests 이므로 requests가 없으면 계산 자체가 불가능하다.

```yaml
minReplicas: 1
maxReplicas: 2
metrics:
  - type: Resource
    resource: { name: cpu, target: { type: Utilization, averageUtilization: 90 } }
```
`maxReplicas: 2`가 상한인 이유: requests 기준으론 2개까지 스케줄되지만, limits 합이 물리 자원을 초과해 동시에 피크를 치면 노드 OOM 위험이 있다.

**실측** — 전원 배포 후 C가 담당한다.
```bash
kubectl top pods -n pictune --containers
```
이 결과로 각 담당이 `resources`를 조정한다(deploy-v2).

---

## 5. 작업·통합 순서

```
1. A: Namespace 적용
2. B: vlm ConfigMap, C: Secret 적용
3. B(vlm) → C(music) → A(web) 순으로 Deployment/Service 적용
   ※ web은 vlm/music Service 이름을 참조하므로 마지막
4. kubectl get pods -n pictune -w 로 전부 Running/Ready 확인
5. C: kubectl top 으로 실제 사용량 측정 → 각자 resources 조정
6. A: Ingress 연결 (타임아웃 300초 확인 필수)
7. C: HPA 추가
8. 통합 테스트 — 이미지 업로드 → BGM 생성 → 취소
```

### 확인 명령어

```bash
kubectl get pods -n pictune -o wide
kubectl describe pod <pod명> -n pictune              # Pending/CrashLoop 원인
kubectl logs <pod명> -n pictune -c model-init        # initContainer 로그
kubectl logs <pod명> -n pictune -c llama-server      # 컨테이너 지정 필수(vlm은 2개)
kubectl logs <pod명> -n pictune -c vlm-api
kubectl top pods -n pictune --containers             # metrics-server 필요
kubectl get svc,ingress,hpa -n pictune
kubectl apply --dry-run=client -f <파일>              # 제출 전 문법 검증
```

---

## 6. 제출 전 체크리스트

```
□ metadata.namespace: pictune 이 있는가
□ selector.matchLabels ↔ template.labels ↔ Service.selector 세 곳이 같은가
□ Deployment명·Service명·포트가 2절 표와 정확히 일치하는가
□ 이미지 태그가 :latest 가 아닌가
□ resources requests/limits가 3절 배정값 이내인가
□ securityContext(runAsNonRoot, allowPrivilegeEscalation) 가 있는가
□ probe의 timeoutSeconds가 기본값(1초)이 아닌가
□ (A) Ingress 타임아웃 300초, body-size 10m 이 있는가
□ (B) -ngl 0, --threads 2, --parallel 1, --slots 가 args에 있는가
□ (B) vlm-api의 liveness가 tcpSocket 인가
□ (B) llama-server용 Service를 만들지 않았는가
□ (C) OMP_NUM_THREADS, MKL_NUM_THREADS 가 env에 있는가
□ kubectl apply --dry-run=client 로 검증했는가
```

---

## 7. 알려진 함정 모음

| 증상 | 원인 | 담당 |
|---|---|---|
| Pod가 `CrashLoopBackOff` | startupProbe가 짧아 모델 로딩 중 재시작 | B, C |
| Pod가 계속 `Pending` | requests 합이 노드 할당 가능량 초과 | 전원 |
| 이미지 분석이 전부 실패 (DNS 오류) | vlm ConfigMap 미연결 → `LLAMA_SERVER_URL`이 이미지 기본값(`llama-server:8003`)으로 남음 | B |
| 볼륨 마운트 실패 | 노드에 `/cache/*` 디렉터리 미준비 (UID 10001 소유) | B, C |
| vlm-api가 계속 재시작 | liveness를 httpGet으로 설정함 → tcpSocket으로 | B |
| 502인데 에러 로그가 없음 | web의 env 미설정 → localhost로 자기 자신 호출 | A |
| BGM 생성이 60초쯤 끊김 | Ingress 타임아웃 기본값 → 300초로 | A |
| 이미지 업로드 실패 | nginx `proxy-body-size` 기본 1MB → 10m으로 | A |
| Ingress를 만들었는데 아무 일도 없음 | Ingress Controller 미설치 (에러도 안 남) | A |
| HPA가 동작 안 함 | metrics-server 미설치 또는 requests 미설정 | C |
| 취소했는데 다음 요청이 안 받아짐 | `--parallel 1 --slots` 제거함 | B |
