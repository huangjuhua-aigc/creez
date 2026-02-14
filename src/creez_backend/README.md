# Creez Backend

Creez 专用后端，提供 AI 图片生成、视频生成、prompt 生成接口。

## 功能

- **生成 prompt**：`POST /creez/images/generate_prompt`，根据场景描述 AI 生成生图参数
- **图片生成**：`POST /creez/images/async_generations` 创建任务，`POST /creez/images/pollimages` 轮询结果
- **视频生成**：`POST /creez/videos/async_generations` 创建任务，`POST /creez/videos/pollvideos` 轮询结果

## 认证

所有创建任务、生成 prompt 的接口需要在请求头中携带：

```
X-User-Id: <user_id>
```

缺少该 header 将返回 401。轮询接口（poll）可不带。

## 环境变量

Creez_backend 需要与 mcp_host_backend 相同的环境变量（Supabase、Volc TOS、Doubao API 等）。

**方式一**：复制 `mcp_host_backend/.env` 到 `Creez_backend/.env`，或复用同一 `.env` 文件。

**方式二**：在 `Creez_backend/` 下新建 `.env`，填入相同变量。

**环境加载**（与 mcp_host_backend 一致）：
- 通过 `configmap_utils.get_configmap_value("ConfigRole")` 读取 K8s 配置（本地默认 `"localhost"`）
- `ConfigRole == "Int"` → 加载 `.int.env`
- `ConfigRole == "Prod"` → 加载 `.prod.env`
- 否则 → 加载 `.env`

## 运行

```bash
cd Creez_backend
uv sync   # 或 pip install -e .
uvicorn main:app --host 0.0.0.0 --port 8081
```

## 数据库

使用 Supabase，需存在以下表：

- `user_balance`：用户余额
- `token_usage`：用量记录
- `image_tasks`：图片任务（task_id, status, image_urls, created_at）
- `video_tasks`：视频任务（task_id, status, video_urls, created_at）

结构与 mcp_host_backend 一致。

## 部署

- **部署文件**：`deployment/`（K8s Deployment、Service、ConfigMap、Ingress）
- **部署文档**：`docs/DEPLOY.md`（Docker 构建、K8s 命令、一键脚本说明）

## Creez 客户端对接

1. 请求时添加 `X-User-Id` header
2. 图片接口路径：`/creez/images/...`（与原 `/lightonmodel/images/...` 不同）
3. 参考图支持 `{ url: "..." }` 或 `{ type: "base64", data: "data:image/..." }`
