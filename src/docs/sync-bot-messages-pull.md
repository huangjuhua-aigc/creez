# Sync: 非默认 Bot 定时与后端拉取

非默认 Bot 消息由后端写入 Supabase，客户端每 5 分钟向后端拉取一次，收到后在前端展示（toast / 插入会话）。

## 设计说明

- **请求参数**：只需要 **`device_id`**，**不需要**传 `bot_id`。一次请求拉取的是「该设备上、所有 bot」的待推送消息。
- **语义**：按「设备」维度拉取：对当前 device 上所有非默认 bot 统一查一次，后端返回该 `device_id` 下所有 `status = pending` 的条目（每条带 `bot_id`、`message` 等），前端再按 `bot_id` 分发展示。
- **已发送不再下发**：后端在返回当次结果后，会把该批记录的 `status` 从 `pending` 更新为 `sent`，并更新 `updated_at`。之后同一 device 再次调用 `/sync/pull` 时，只会查询 `status = 'pending'`，因此**同一条消息不会重复返回**。

## 1. Supabase 表 SQL

在 Supabase SQL Editor 中执行建表脚本。完整 SQL 见：

- **`creezv2_backend/supabase/pending_bot_messages.sql`**

表结构概要：`id` (uuid), `device_id`, `user_id`, `bot_id`, `message`, `status` (pending/sent/read), `created_at`, `updated_at`, `expires_at`。

## 2. 环境变量（后端 creezv2_backend）

| 变量 | 说明 | 必填 |
|------|------|------|
| `SUPABASE_URL` | Supabase 项目 URL（如 `https://xxx.supabase.co`） | 是（启用 /sync/pull 时） |
| `SUPABASE_SERVICE_KEY` | Supabase service role key（用于服务端读写表） | 是（启用 /sync/pull 时） |

若未配置上述变量，后端仍可启动，但 `GET /sync/pull` 会返回 503。

## 3. 5 分钟定时任务注册与前端消费

### 3.1 注册位置与条件

- **位置**：Electron 主进程 `electron/main/index.cjs`，在 `app.whenReady()` 内、`createWindow()` 之后，调用 `startSyncPullTask(contactRepository)`。定时器在 `electron/main/syncPullTask.cjs` 中实现。
- **依赖**：`contactRepository`（判断是否有非默认 Bot）、`device_id` 存放在 `~/.creez/device_id`（首次运行时生成 UUID 并写入），`BrowserWindow.getAllWindows()` 用于向所有窗口发 IPC。
- **条件**：仅当存在至少一个非默认 Bot（`contactRepository.list({ type: 'bot' }).items` 中存在 `!isDefault`）时执行拉取；否则本 tick 不请求后端，定时器继续运行。
- **周期**：`setInterval(..., 5 * 60 * 1000)`。首次拉取在启动约 30 秒后执行，之后每 5 分钟执行一次。`before-quit` 时调用 `stopSyncPullTask()` 清除定时器。

### 3.2 主进程流程

1. 读取或生成并持久化 `device_id`（`~/.creez/device_id`，见 `syncPullTask.cjs` 的 `getOrCreateDeviceId()`）。
2. 若不存在非默认 Bot，本次不请求后端。
3. 请求后端：`GET /sync/pull?device_id=<device_id>`，使用与 knowledge API 相同的 base URL（`CREEZ_KNOWLEDGE_API_BASE` 或默认 `https://creez.lighton.video`）。
4. 若响应 `items.length > 0`，向所有 `BrowserWindow` 的 webContents 发送 IPC 通道 **`sync:pendingMessages`**，payload 为 `{ items: [ { id, bot_id, message, created_at } ] }`。

### 3.3 前端消费

- **Preload**：`window.electron.sync.onPendingMessages(callback)`，订阅 IPC 通道 `sync:pendingMessages`，返回取消订阅函数。
- **Renderer**：在 Chat 页面或 App 根组件中调用 `electron.sync.onPendingMessages((payload) => { ... })`。收到后：
  - 可选：toast 提示“您有 X 条新消息”；
  - 和/或：根据 `bot_id` 找到对应 chat，调用 `chat.appendMessage` 插入一条 `sender: 'assistant', botId: bot_id, content: message` 的消息；
  - 和/或：若当前正在该 Bot 的会话中，直接插入并滚动到底部。

### 3.4 契约（API 与 IPC）

- **Backend**  
  - `GET /sync/pull?device_id=xxx`  
  - 响应：`{ ok: true, items: [ { id, bot_id, message, created_at } ] }`  
  - 后端从 Supabase 查询 `status = 'pending'` 且 `device_id = xxx` 的记录，返回后将对应记录的 `status` 更新为 `sent`、`updated_at` 更新为当前时间。

- **IPC**  
  - 通道：**`sync:pendingMessages`**（主进程 → 渲染进程，单向）。  
  - Payload：`{ items: [ { id, bot_id, message, created_at } ] }`（与后端一致）。
