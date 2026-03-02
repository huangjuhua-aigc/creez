# Phase 5: Knowledge Base — 实施计划

本文档描述 Phase 5（Knowledge Base as Skill）的总体设计、Qdrant 数据结构、Node 后端服务、以及 Creez 侧集成的分步实施计划。

---

## 1. 目标与范围

- **目标**：对话中由 agent 决定是否调用 `knowledge_search`，对 query 做 embedding 后在 Qdrant 中检索，将结果返回给模型/前端；每个 bot 拥有独立的知识库。Memory 暂不做，仅后端预留。
- **范围**：
  - **Node 后端服务**：独立进程（creezv2_backend），Doubao embedding、双 collection（knowledge / memory）按 bot 隔离的 CRUD + search；memory 业务未接入。
  - **Qdrant**：`creez_knowledge`、`creez_memory` 两 collection，payload 含 `bot_id` 等，keyword 索引。
  - **Creez 客户端**：内建 skill `knowledge_search`，系统注入 contactId 请求 `POST /knowledge/search`；agent 在对话中决定何时调用。

---

## 2. Qdrant 数据结构设计（当前实现）

### 2.1 策略：双 Collection + Payload 隔离

- 使用 **两个 collection**：`creez_knowledge`（知识库）、`creez_memory`（记忆；**暂不实现业务**，仅后端预留路由与 collection）。
- 每个 collection 内通过 **payload** 的 `bot_id` 做 bot 级隔离；查询时用 filter 限定 `bot_id`。

### 2.2 Payload 字段约定

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bot_id` | keyword | 是 | 与 Creez `contacts.id` 一致（如 default bot UUID、RoundCloser contact id），用于隔离 |
| `source_id` | keyword | 否 | 来源标识（如文档 id、URL、chunk 批次 id），便于追溯与去重 |
| `text` | 存 payload | 是 | 原始文本片段，向量由 `text` 经 embedding 生成 |
| `metadata` | object | 否 | 自定义键值，便于扩展 |
| `updated_at` | number | 否 | 写入/更新时间戳 |

- **向量**：由 `text` 经 Doubao embedding 得到，维度 1024，`distance` = `Cosine`。

### 2.3 Collection 创建参数（当前）

- **knowledge**：`creez_knowledge`，vector size = 1024，payload 对 `bot_id`、`source_id` 建 keyword 索引。
- **memory**：`creez_memory`，同上；**memory 业务暂不做**，仅预留。

### 2.4 未来扩展（Memory）

- memory 的 search/upsert 等 API 已预留（`/memory/search`、`/memory/upsert` 等），业务逻辑后续再接。

---

## 3. Node 后端服务设计

### 3.1 职责

- **Knowledge**：接收 query → Doubao embedding → 在 `creez_knowledge` 中 search（按 `bot_id` 过滤）→ 返回 topK 结果（snippets + score、payload）。
- **按 bot 的 CRUD**：`/knowledge/upsert`、`/knowledge/list`、`/knowledge/delete`，均按 `bot_id` 限定范围；upsert 时对 `text` 做 embedding，point id 由服务端生成（UUID）。
- **Memory**：collection `creez_memory` 与路由 `/memory/*` 已预留，**业务暂不做**。

### 3.2 技术选型（当前）

- **运行时**：Node.js（Express），端口可配置（如 8081，生产见 creezv2_backend 部署）。
- **Embedding**：Doubao multimodal embedding，维度 1024；storage 与 search 使用不同 instruction prompt。
- **Qdrant 客户端**：`@qdrant/js-client-rest`，连接 Qdrant（支持 HTTPS，可配置端口）。

### 3.3 API 设计（REST，当前）

所有接口均在 body 中传 **botId**（与 Creez `contacts.id` 一致），后端仅按当前请求的 botId 过滤，不开放跨 bot 查询。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/knowledge/search` | Body: `{ "botId": string, "query": string, "topK"?: number }`；返回 `{ ok, data: { matches } }`（含 id、score、payload.text 等）。 |
| POST | `/knowledge/upsert` | Body: `{ "botId": string, "items": [{ "text": string, "sourceId"?: string, "metadata"?: object }] }`；服务端生成 point id、做 embedding 后 upsert 到 `creez_knowledge`。 |
| POST | `/knowledge/list` | Body: `{ "botId": string, "limit"?: number, "offset"?: number }`；列出该 bot 的 knowledge points（含 payload，不带向量）。 |
| POST | `/knowledge/delete` | Body: `{ "botId": string, "pointIds"?: string[], "sourceId"?: string }`；按 pointIds 或 sourceId 删除该 bot 的 points。 |

**Memory**：`/memory/search`、`/memory/upsert`、`/memory/list`、`/memory/delete` 路由已存在，业务暂不接入；与 knowledge 共用同一套向量与 CRUD 模式。

### 3.4 部署与配置

- 后端独立进程（见 `creezv2_backend`），可 Docker 部署；K8s 示例见 `deployment/`。
- 配置：`QDRANT_URL`、`QDRANT_PORT`（HTTPS 时多为 443）、embedding 相关环境变量（Doubao API 等）、服务端口。
- Creez 客户端通过环境变量 `CREEZ_KNOWLEDGE_API_BASE` 或默认 `https://creez.lighton.video` 调用后端。

---

## 4. Creez 侧集成（对话中 knowledge search，当前实现）

### 4.1 数据流

1. 用户发消息 → Creez 发往 agent（Pi/engine）。
2. Agent 若认为需要“查知识库”，则调用 **tool**：`knowledge_search({ query: string, topK?: number })`。
3. **系统接管**：Electron main 的 builtin skill executor 识别 `knowledge_search`，用当前会话的 **contactId** 作为 botId，与 query、topK 一起请求后端 `POST /knowledge/search`。
4. 后端返回 matches → handler 格式化为统一错误协议（成功/空结果/网络错误等）并带 `isError` 回传给 agent。
5. Agent 根据 tool 结果继续生成回复；前端展示回复及可选 tool 调用信息。

### 4.2 实现要点（当前）

- **Builtin skill**：`knowledge_search` 为内建 skill，不写入 DB `skills_json`（做法一）；是否启用由 runtime 的 `assistantConfigId` 决定（默认 bot id=1 不启用，RoundCloser 等非 1 启用）。
- **执行链路**：registry → executor → `knowledgeSearchHandler`；contactId/chatId/assistantConfigId 由 init 时注入，agent 无需传 botId。
- **权限**：仅传当前会话 contactId 作为 botId，不开放查其他 bot。
- **错误协议**：统一 envelope（code、message、retryable、nextAction）；空结果、超时、后端错误等均返回可被 agent 识别的结构化错误，避免瞎编。

### 4.3 Prompt 引导

- RoundCloser 的 system prompt 中已有：“When company factual details are needed, use knowledge-search capabilities before answering.”
- Builtin skill 文档位于 `skills/builtin/skills/knowledge-search/SKILL.md`，描述何时调用及参数。

---

## 5. 分步实施计划（当前状态）

- **Step 1**：Qdrant 双 collection `creez_knowledge`、`creez_memory`，payload 含 `bot_id`、`source_id` 等，keyword 索引。✅
- **Step 2**：Node 后端 `creezv2_backend`，Express、健康检查、环境变量配置。✅
- **Step 3**：Doubao embedding（storage/search 双 prompt），`POST /knowledge/upsert`，point id 服务端生成。✅
- **Step 4**：`POST /knowledge/search`，按 botId 过滤，返回 matches。✅
- **Step 5**：`POST /knowledge/list`、`POST /knowledge/delete`，按 botId 过滤。✅
- **Step 6**：Creez 内建 skill：registry + executor + knowledgeSearchHandler，contactId 注入，请求 `POST /knowledge/search`，错误协议与事件流。✅
- **Step 7**：E2E 与边界：空结果、默认 bot 不暴露 tool、非默认 bot 成功路径等已有测试。✅
- **Step 8**：本文档与 `multi-bot-kb-implementation-plan.md` Phase 5 已对齐当前架构。✅

**Memory**：后端 `/memory/*` 与 collection `creez_memory` 已预留，业务暂不做。

---

## 6. 验收标准（Phase 5）— 当前状态

- [x] Qdrant 中每个 bot 的 knowledge 通过 `bot_id` 严格隔离；memory 为独立 collection，业务暂不做。
- [x] Node 后端提供 `/knowledge/search`、`/knowledge/upsert`、`/knowledge/list`、`/knowledge/delete`，均按 botId 限定范围。
- [x] Creez 对话中 agent 可调用 `knowledge_search`，仅能查询当前会话 bot 的知识库；空结果与错误有统一协议反馈。
- [x] RoundCloser（非默认 bot）可基于检索结果回答事实性问题；默认 bot 不暴露 knowledge_search，切换 chat 时按 scope 重新 init 避免误用。

---

## 7. 风险与依赖

- **Embedding 模型**：维度 1024 与 Doubao 一致；若换模型需 re-embed 或 migration。
- **后端可用性**：Creez 通过 `CREEZ_KNOWLEDGE_API_BASE` 调用后端；网络/后端不可用时 knowledge_search 返回明确错误（如 NETWORK_ERROR、TIMEOUT），不静默跳过。
- **Id 一致性**：botId 与 Creez `contacts.id` 一致（如 RoundCloser contact id），避免错库。
