# 部署文件

本目录存放 K8s 部署与 Ingress 的 YAML，用于 Creez Backend 的 int 环境。

| 文件 | 说明 |
|------|------|
| `deployment_int.yaml` | Deployment + Service + ConfigMap（int-creez namespace） |
| `ingress_int.yaml` | Ingress（域名 int-creez.lighton.video） |

部署步骤与详细说明见上级目录 **`../docs/DEPLOY.md`**。
