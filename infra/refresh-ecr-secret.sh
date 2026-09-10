#!/usr/bin/env bash

set -Eeuo pipefail

# 필요하면 실행 시 환경변수로 덮어쓸 수 있습니다.
# 예: PICTUNE_AWS_PROFILE=ecr-puller ./refresh-ecr-secret.sh
PICTUNE_AWS_PROFILE="${PICTUNE_AWS_PROFILE:-ecr}"
PICTUNE_AWS_REGION="${PICTUNE_AWS_REGION:-ap-northeast-2}"
PICTUNE_AWS_ACCOUNT_ID="${PICTUNE_AWS_ACCOUNT_ID:-508266022472}"
PICTUNE_K8S_NAMESPACE="${PICTUNE_K8S_NAMESPACE:-pictune}"
PICTUNE_ECR_SECRET="${PICTUNE_ECR_SECRET:-ecr-secret}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "오류: '$1' 명령을 찾을 수 없습니다." >&2
    exit 1
  fi
}

require_command aws

# 일반 kubectl을 우선 사용하고, 사용할 수 없으면 k3s kubectl을 사용합니다.
if command -v kubectl >/dev/null 2>&1; then
  KUBECTL=(kubectl)
elif command -v k3s >/dev/null 2>&1; then
  KUBECTL=(sudo k3s kubectl)
else
  echo "오류: kubectl 또는 k3s 명령을 찾을 수 없습니다." >&2
  exit 1
fi

echo "[1/5] AWS 자격 증명을 확인합니다. (profile: ${PICTUNE_AWS_PROFILE})"

if ! AWS_CALLER_ARN="$(
  aws --profile "${PICTUNE_AWS_PROFILE}" sts get-caller-identity \
    --query Arn \
    --output text 2>/dev/null
)"; then
  echo "AWS 인증 정보가 없거나 사용할 수 없습니다."
  echo "IAM User의 Access Key와 Secret Access Key를 입력하세요."
  aws configure --profile "${PICTUNE_AWS_PROFILE}"

  AWS_CALLER_ARN="$(
    aws --profile "${PICTUNE_AWS_PROFILE}" sts get-caller-identity \
      --query Arn \
      --output text
  )"
fi

echo "AWS 호출자: ${AWS_CALLER_ARN}"

echo "[2/5] Kubernetes namespace를 확인합니다."
if ! "${KUBECTL[@]}" get namespace "${PICTUNE_K8S_NAMESPACE}" >/dev/null 2>&1; then
  echo "오류: '${PICTUNE_K8S_NAMESPACE}' namespace가 없거나 접근할 수 없습니다." >&2
  echo "k3s kubeconfig 권한 문제라면 스크립트를 sudo로 실행하지 말고," >&2
  echo "kubectl 부분에 접근 가능한 kubeconfig를 설정하세요." >&2
  exit 1
fi

PICTUNE_ECR_REGISTRY="${PICTUNE_AWS_ACCOUNT_ID}.dkr.ecr.${PICTUNE_AWS_REGION}.amazonaws.com"

echo "[3/5] ECR 로그인 비밀번호를 발급합니다."
ECR_PASSWORD="$(
  aws --profile "${PICTUNE_AWS_PROFILE}" ecr get-login-password \
    --region "${PICTUNE_AWS_REGION}"
)"
trap 'unset ECR_PASSWORD' EXIT

if [[ -z "${ECR_PASSWORD}" ]]; then
  echo "오류: ECR 로그인 비밀번호가 비어 있습니다." >&2
  exit 1
fi

echo "[4/5] Kubernetes imagePullSecret을 생성하거나 갱신합니다."
"${KUBECTL[@]}" create secret docker-registry "${PICTUNE_ECR_SECRET}" \
  --docker-server="${PICTUNE_ECR_REGISTRY}" \
  --docker-username=AWS \
  --docker-password="${ECR_PASSWORD}" \
  --namespace="${PICTUNE_K8S_NAMESPACE}" \
  --dry-run=client \
  -o yaml |
  "${KUBECTL[@]}" apply -f -

unset ECR_PASSWORD
trap - EXIT

echo "[5/5] 갱신 결과를 확인합니다."
"${KUBECTL[@]}" get secret "${PICTUNE_ECR_SECRET}" \
  --namespace="${PICTUNE_K8S_NAMESPACE}"

echo "완료: ${PICTUNE_K8S_NAMESPACE}/${PICTUNE_ECR_SECRET}"
echo "ECR registry: ${PICTUNE_ECR_REGISTRY}"
