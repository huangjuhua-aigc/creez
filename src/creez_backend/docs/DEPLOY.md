# Creez Backend 部署说明

部署相关 YAML 在 **`deployment/`** 目录，本文档在 **`docs/`** 目录。

## 一、Docker 命令

在 **Creez_backend 项目根目录** 下执行。

### 构建镜像

```bash
docker build -t lighton-cn-beijing.cr.volces.com/lighton/creez-backend:latest -f Dockerfile .
```

指定 tag（推荐用日期或版本号）：

```bash
docker build -t lighton-cn-beijing.cr.volces.com/lighton/creez-backend:20250213 -f Dockerfile .
```

### 推送镜像

```bash
docker push lighton-cn-beijing.cr.volces.com/lighton/creez-backend:latest
```

或指定 tag：

```bash
docker push lighton-cn-beijing.cr.volces.com/lighton/creez-backend:20250213
```

### 本地跑容器（可选）

```bash
docker run --rm -p 8081:8081 \
  -e ConfigRole=Int \
  lighton-cn-beijing.cr.volces.com/lighton/creez-backend:latest
```

---

## 二、K8s 命令

以下命令在 **Creez_backend 项目根目录** 下执行，YAML 路径为 `deployment/`。

### 1. 创建 namespace（首次）

```bash
kubectl create namespace int-creez
```

### 2. 创建环境变量 Secret（必做，否则 Pod 会因缺 Supabase 等配置而 CrashLoopBackOff）

用本地 **.int.env** 生成 Secret（不要提交 .int.env 到仓库）：

```bash
kubectl create secret generic creez-backend-secret \
  --from-env-file=.int.env \
  -n int-creez
```

若 Secret 已存在需更新：

```bash
kubectl delete secret creez-backend-secret -n int-creez
kubectl create secret generic creez-backend-secret \
  --from-env-file=.int.env \
  -n int-creez
```

### 3. 应用部署与 Ingress

```bash
kubectl apply -f deployment/deployment_int.yaml -n int-creez
kubectl apply -f deployment/ingress_int.yaml -n int-creez
```

### 4. 更新镜像 tag 后滚动重启

若改了 `deployment/deployment_int.yaml` 里的镜像 tag：

```bash
kubectl rollout restart deployment/creez-backend -n int-creez
```

或直接 apply 再重启：

```bash
kubectl apply -f deployment/deployment_int.yaml -n int-creez
kubectl rollout status deployment/creez-backend -n int-creez
```

### 5. 查看状态

```bash
kubectl get deployment,svc,ingress -n int-creez -l app=creez-backend
kubectl get pods -n int-creez -l app=creez-backend
kubectl logs -f deployment/creez-backend -n int-creez
```

### 6. 删除部署

```bash
kubectl delete -f deployment/deployment_int.yaml -n int-creez
kubectl delete -f deployment/ingress_int.yaml -n int-creez
```

---

## 三、一键脚本

在项目根目录执行：

```bash
chmod +x deploy.sh
./deploy.sh              # 使用 tag: latest
./deploy.sh 20250213     # 使用 tag: 20250213
```

脚本会依次：构建镜像 → 推送 → 应用 deployment 与 ingress（使用 `deployment/` 下 YAML）。

---

## 四、注意

- **TLS**：Ingress 使用 `secretName: creez-backend-tls`，需在 `int-creez` namespace 下存在该 TLS Secret（或修改 `deployment/ingress_int.yaml` 中的 secret 名）。
- **敏感配置**：Deployment 通过 `envFrom: secretRef: creez-backend-secret` 注入环境变量。需用本地 `.int.env` 执行 `kubectl create secret generic creez-backend-secret --from-env-file=.int.env -n int-creez`，不要将 .int.env 提交到仓库。
- **镜像仓库登录**：推送前需 `docker login lighton-cn-beijing.cr.volces.com`。
