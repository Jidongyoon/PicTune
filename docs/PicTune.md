# Image-to-BGM MVP Architecture

## 1. 목표

사용자가 웹 화면에서 이미지를 업로드하면, 이미지의 분위기에 맞는 BGM을 자동 생성하고 웹 플레이어에서 즉시 재생할 수 있도록 한다.

MVP에서는 Frontend와 Backend API를 분리하지 않고 **Next.js 애플리케이션 하나에서 UI와 API orchestration을 함께 처리**한다.

전체 처리 흐름은 다음과 같다.

```text
User Browser
    │
    │ Image Upload
    ▼
Next.js App
(UI + API)
    │
    ▼
VLM Worker
SmolVLM2-2.2B
    │
    │ MusicGen Prompt
    ▼
Music Worker
MusicGen-small
    │
    │ Audio Binary
    ▼
Next.js App
    │
    ▼
User Browser
    │
    ├── Audio Player
    └── Download
```

MVP에서는 SQS 등의 Message Queue나 Object Storage를 사용하지 않고, 전체 처리를 synchronous HTTP 기반으로 구성한다.

---

# 2. Kubernetes 구성

MVP에서는 크게 다음 3개의 Deployment를 사용한다.

```text
Kubernetes Cluster

┌────────────────────────┐
│ Next.js Deployment     │
│ UI + API               │
│                        │
│ Image Upload           │
│ Pipeline Orchestration │
│ Audio Response         │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ VLM Worker             │
│ replicas: 1            │
│ SmolVLM2-2.2B          │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Music Worker           │
│ replicas: 1 ~ 2        │
│ MusicGen-small         │
│ HPA 적용               │
└────────────────────────┘
```

각 Deployment는 Kubernetes Service를 통해 통신한다.

```text
Next.js Service
      │
      ▼
VLM Service
      │
      ▼
Music Service
```

---

# 3. Next.js Application

Next.js Pod는 Frontend와 Backend 역할을 동시에 수행한다.

주요 역할은 다음과 같다.

### Frontend 역할

- 이미지 업로드
    
- 이미지 Preview
    
- BGM 생성 요청
    
- 생성 진행 상태 표시
    
- 생성된 BGM 재생
    
- 생성된 BGM 다운로드
    

### Backend 역할

- 업로드된 이미지 수신
    
- VLM Worker 호출
    
- MusicGen Prompt 수신
    
- Music Worker 호출
    
- 생성된 Audio Binary 수신
    
- Browser로 Audio Response 전달
    

전체 orchestration은 Next.js Server 영역에서 처리한다.

예를 들어 Route Handler를 사용할 수 있다.

```text
POST /api/generate
```

요청:

```text
Content-Type: multipart/form-data

image=<binary>
```

처리 흐름:

```text
Browser
   │
   │ POST /api/generate
   ▼
Next.js Route Handler
   │
   ├── VLM Worker 호출
   │
   ├── MusicGen Prompt 수신
   │
   ├── Music Worker 호출
   │
   └── Audio Binary 수신
   │
   ▼
Browser
```

---

# 4. Browser Audio 처리

Music Worker가 생성한 오디오는 Next.js 서버를 통해 Browser로 전달한다.

응답 예:

```text
HTTP 200

Content-Type: audio/wav
Content-Disposition: inline

<WAV binary>
```

Frontend에서는 응답을 Blob으로 변환한다.

```javascript
const response = await fetch("/api/generate", {
  method: "POST",
  body: formData,
});

const blob = await response.blob();

const audioUrl = URL.createObjectURL(blob);

audioPlayer.src = audioUrl;
```

동일한 Blob URL을 Audio Player와 Download 기능에서 함께 사용할 수 있다.

```text
[ ▶ Play BGM ]

[ Download ]
```

따라서 생성된 오디오를 서버에 저장하지 않고도 사용자가 재생하거나 다운로드할 수 있다.

---

# 5. VLM Worker

VLM Worker는 하나의 replica만 사용한다.

```text
replicas: 1
```

사용 모델:

```text
SmolVLM2-2.2B
```

VLM의 역할은 단순 Image Captioning이 아니라 이미지의 분위기를 음악적인 표현으로 변환하는 것이다.

입력:

```text
Image
```

출력 예:

```json
{
  "scene": "an empty rain-soaked city street at night",
  "mood": [
    "melancholic",
    "reflective"
  ],
  "energy": "low",
  "genre": "cinematic ambient",
  "tempo": "slow",
  "instruments": [
    "soft piano",
    "warm synth pads",
    "subtle percussion"
  ],
  "texture": "soft and atmospheric",
  "musicgen_prompt":
    "Slow melancholic cinematic ambient music with soft piano, warm synth pads and subtle percussion, reflective and atmospheric."
}
```

MVP에서는 별도의 rule-based semantic mapping을 사용하지 않는다.

즉 다음 단계까지 모두 VLM에 맡긴다.

```text
Image
   ↓
SmolVLM
   ↓
Scene Understanding
   ↓
Mood Analysis
   ↓
Genre / Instruments / Tempo Selection
   ↓
MusicGen Prompt
```

Next.js 서버는 응답의 `musicgen_prompt`를 추출해 Music Worker에 전달한다.

---

# 6. Music Worker

사용 모델:

```text
facebook/musicgen-small
```

입력:

```text
MusicGen Prompt
```

예:

```text
Slow melancholic cinematic ambient music with soft piano,
warm synth pads and subtle percussion,
reflective and atmospheric.
```

출력:

```text
Audio Tensor
    ↓
WAV Encoding
    ↓
Audio Binary
```

가능하면 WAV 파일을 filesystem에 생성하지 않고 memory buffer에서 직접 encoding한다.

```text
MusicGen Tensor
      ↓
Memory Buffer
      ↓
WAV Binary
      ↓
HTTP Response
```

기본적으로 다음과 같은 임시 파일 생성도 사용하지 않는다.

```text
/tmp/output.wav
```

Music Worker는 생성된 WAV binary를 Next.js 서버에 HTTP response로 반환한다.

---

# 7. Storage 정책

MVP에서는 입력 이미지와 생성 오디오를 서버 측 persistent storage에 저장하지 않는다.

사용하지 않는 구성:

```text
S3
PVC output directory
Local output directory
Database BLOB
```

입력 이미지는 다음 경로로 메모리에서 처리한다.

```text
Browser
   │
   │ image binary
   ▼
Next.js
   │
   ▼
VLM Worker
```

오디오는 다음 경로로 전달된다.

```text
Music Worker
   │
   │ WAV binary
   ▼
Next.js
   │
   │ HTTP response
   ▼
Browser Memory
   │
   ├── Player
   └── Download
```

사용자가 Download 버튼을 선택하면 Browser가 이미 가지고 있는 audio Blob을 파일로 다운로드한다.

따라서 Download 기능을 제공하기 위해 서버가 오디오 파일을 보관할 필요는 없다.

페이지를 새로고침하거나 Browser Blob이 제거되면 생성 결과 역시 사라지는 구조를 MVP의 기본 동작으로 한다.

---

# 8. Music Worker HPA

Music Worker에는 필수 요구사항을 충족하기 위해 Kubernetes HPA를 적용한다.

```text
minReplicas: 1
maxReplicas: 2
```

MVP에서는 Queue depth 기반 autoscaling을 구현하지 않기 때문에 CPU와 Memory metric을 사용한다.

예:

```yaml
minReplicas: 1
maxReplicas: 2

CPU target:
  averageUtilization: 90%

Memory target:
  averageUtilization: 90%
```

실제 threshold는 성능 테스트 후 조정한다.

MVP에서는 HPA가 적극적으로 scale-out 하는 것이 목적이라기보다는, Kubernetes autoscaling 요구사항을 만족하면서 기본적인 scale-out 구조를 갖추는 것이 목적이다.

주의할 점은 HPA의 `averageUtilization`이 Pod의 CPU / Memory limit이 아니라 **resource request 대비 실제 사용량**을 기준으로 계산된다는 것이다.

따라서 다음 값은 실제 benchmark 결과를 기반으로 설정해야 한다.

```text
resources.requests.cpu
resources.requests.memory

resources.limits.cpu
resources.limits.memory
```

HPA threshold만 높이고 resource request를 지나치게 낮게 설정하면 MusicGen이 정상적으로 하나의 작업을 실행하는 것만으로도 높은 utilization이 계산되어 예상하지 않은 scale-out이 발생할 수 있다.

---

# 9. Music Worker 동시 처리 제한

MusicGen은 CPU 및 Memory 사용량이 크기 때문에 하나의 Music Worker Pod가 여러 generation을 동시에 수행하지 않도록 한다.

기본 정책:

```text
1 Pod
=
1 MusicGen model
=
1 concurrent generation
```

Music Worker가 2개로 확장되면 최대 두 개의 Music generation을 병렬 처리할 수 있다.

```text
Music Worker #1
└── Job A

Music Worker #2
└── Job B
```

하나의 Pod 내부에서는 application-level semaphore 등의 방식으로 concurrent inference를 1로 제한한다.

---
# 10. Next.js Request Timeout 고려

현재 MVP는 synchronous HTTP 구조이므로 MusicGen 생성 시간이 길어질 경우 HTTP timeout을 반드시 고려해야 한다.

처리 흐름:

```text
Browser
   │
   ▼
Next.js
   │
   ▼
VLM
   │
   ▼
MusicGen
   │
   ▼
Next.js
   │
   ▼
Browser
```

이 전체 과정 동안 하나의 요청이 유지되어야 한다.

따라서 다음 요소의 timeout 설정을 확인해야 한다.

- Browser request timeout
    
- Next.js server timeout
    
- Kubernetes Ingress timeout
    
- Load Balancer timeout
    
- Music Worker HTTP timeout
    

특히 MusicGen을 CPU 환경에서 실행하는 경우 생성 시간이 길어질 수 있으므로, MVP 배포 전에 실제 generation latency를 측정하고 timeout 값을 충분히 확보해야 한다.

---

# 12. Develop 사양

향후 Develop 단계에서는 다음 기능을 추가한다.

## 12.1 SQS 기반 비동기 처리

동기 HTTP 구조를 다음과 같이 변경한다.

```text
Next.js
   │
   ▼
VLM Queue
   │
   ▼
VLM Worker
   │
   ▼
Music Queue
   │
   ▼
Music Worker
```

AWS 환경을 사용하고 있으므로 자체 RabbitMQ를 Kubernetes 내부에서 운영하기보다는 AWS SQS 사용을 우선 고려한다.

## 12.2 KEDA 기반 Music Worker Scaling

Music Worker의 CPU / Memory를 보고 scale하는 대신 Music Queue의 backlog를 기반으로 scale한다.

```text
SQS music-jobs
      │
      │ Queue Depth
      ▼
     KEDA
      │
      ▼
Music Worker
replicas: 1 ~ 2
```

이는 MusicGen과 같은 long-running inference workload에서 HPA CPU / Memory metric보다 훨씬 적합하다.

MVP에서는 HPA를 유지하고, Develop 단계에서 KEDA + SQS 기반 scaling으로 전환하는 것을 권장한다.

## 12.3 Rule-based Semantic Mapping

MVP:

```text
Image
   ↓
SmolVLM
   ↓
Genre / Tempo / Instruments
   ↓
MusicGen Prompt
```

Develop:

```text
Image
   ↓
SmolVLM
   ↓
Visual / Mood Semantics
   ↓
Semantic Mapping Layer
   ↓
Genre / Tempo / Instruments
   ↓
MusicGen Prompt
```

VLM의 음악적 해석이 불안정하거나 같은 계열 이미지에 대한 결과 일관성이 부족할 경우 rule-based semantic mapping layer를 추가한다.

# 13. 최종 MVP 구조

```text
                        User Browser
                             │
                       Image Upload
                             │
                             ▼
                 ┌───────────────────────┐
                 │ Next.js Deployment    │
                 │                       │
                 │ UI                    │
                 │ API Route             │
                 │ Pipeline Orchestrator │
                 └───────────┬───────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ VLM Worker      │
                    │ SmolVLM2-2.2B   │
                    │ replicas = 1    │
                    └────────┬────────┘
                             │
                     MusicGen Prompt
                             │
                             ▼
               ┌──────────────────────────┐
               │ Music Worker Deployment │
               │ MusicGen-small           │
               │ replicas = 1 ~ 2         │
               │ HPA: CPU / Memory        │
               └────────────┬─────────────┘
                            │
                        Audio Binary
                            │
                            ▼
                 ┌───────────────────────┐
                 │ Next.js Deployment    │
                 └───────────┬───────────┘
                             │
                         WAV Response
                             │
                             ▼
                       User Browser
                             │
                    ┌────────┴────────┐
                    │                 │
                   Play            Download
```

## MVP

- Next.js Pod
    
    - Frontend UI
        
    - API
        
    - Pipeline orchestration
        
- SmolVLM2-2.2B Worker 1개
    
- MusicGen-small Worker 1~2개
    
- Music Worker HPA 적용
    
- CPU / Memory 기반 HPA
    
- Synchronous HTTP 처리
    
- 이미지 persistent storage 없음
    
- 오디오 persistent storage 없음
    
- Browser Audio Player 제공
    
- Browser Download 제공
    

## Develop

- AWS SQS
    
- VLM / Music Queue 분리
    
- KEDA 기반 Music Worker autoscaling
    
- 비동기 Job 처리
    
- Rule-based semantic mapping
    
- 필요 시 결과 저장 및 Job History 기능