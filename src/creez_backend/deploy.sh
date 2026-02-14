#!/bin/bash
# Creez Backend - Docker 构建 / 推送 / K8s 部署
# 用法: ./deploy.sh [镜像 tag，默认 latest]

set -e
IMAGE_NAME="lighton-cn-beijing.cr.volces.com/lighton/creez-backend"
TAG="${1:-latest}"
FULL_IMAGE="${IMAGE_NAME}:${TAG}"
NAMESPACE="int-creez"

echo "=== 1. Docker 构建 ==="
docker build -t "${FULL_IMAGE}" -f Dockerfile .

echo "=== 2. 打 tag（可选，与上面一致则跳过）==="
# docker tag "${FULL_IMAGE}" "${IMAGE_NAME}:${TAG}"

echo "=== 3. 推送镜像 ==="
docker push "${FULL_IMAGE}"

echo "=== 4. 若 tag 非 latest，请先修改 deployment/deployment_int.yaml 中 image 为 ${FULL_IMAGE} ==="

echo "=== 5. K8s 应用（需已创建 namespace int-creez）==="
kubectl apply -f deployment/deployment_int.yaml -n "${NAMESPACE}"
kubectl apply -f deployment/ingress_int.yaml -n "${NAMESPACE}"

echo "=== 6. 查看部署状态 ==="
kubectl get deployment,svc,ingress -n "${NAMESPACE}" -l app=creez-backend
