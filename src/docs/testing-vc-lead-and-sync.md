# 测试指南：VC 留资 + Sync 拉取

## 前置条件

1. **Supabase**  
   - 已执行 `creezv2_backend/supabase/roundcloser_leads.sql` 和 `pending_bot_messages.sql`。  
   - 在 creezv2_backend 的 `.env` 中配置好 `SUPABASE_URL`、`SUPABASE_SERVICE_KEY`。

2. **后端**  
   - 在项目根目录启动：`cd creezv2_backend && npm run start`（默认端口 3001）。  
   - 或使用线上地址，则下面 curl 的 `BASE` 改为 `https://creez.lighton.video`。

3. **飞书（仅 VC 留资通知）**  
   - 可选。若需验证「发到自己」，配置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_OPEN_ID`。

---

## 一、测试 VC / RoundCloser 留资（后端 API）

### 1.1 用 curl 调 POST /roundcloser/lead

```bash
# 本地后端
BASE=http://localhost:3001

curl -X POST "$BASE/roundcloser/lead" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试VC",
    "email": "vc@test.com",
    "company": "Test Fund",
    "wechat": "test_wechat",
    "message": "想约时间聊聊"
  }'
```

预期：`{"ok":true,...}`。若 Feishu 已配置，你的飞书会收到一条通知。

### 1.2 校验数据库

在 Supabase Dashboard → Table Editor → `roundcloser_leads`，应看到刚插入的一行（name、email、company、wechat、message、created_at 等）。

### 1.3 校验飞书

若配置了 `FEISHU_OPEN_ID`，飞书私聊里应收到机器人发来的「New VC lead: 测试VC, vc@test.com, ...」类内容。

### 1.4 在 Creez 应用里做端到端测试

1. 启动 Creez 应用，确保有 RoundCloser（非默认 bot）且 `CREEZ_KNOWLEDGE_API_BASE` 指向当前后端。
2. 打开与 RoundCloser 的对话，多轮聊 Creez（或问创始人联系方式/约见面），并在对话中提供：姓名 + 邮箱或微信。
3. 当模型认为可留资时，会调用 `vc_lead_capture`，客户端会请求 `POST .../roundcloser/lead`。
4. 再次在 Supabase 和飞书中确认是否有新记录和通知。

---

## 二、测试 Sync 拉取（后端 API + 不重复下发）

### 2.1 先往表里插一条待推送消息

在 **Supabase → SQL Editor** 执行（把 `YOUR_DEVICE_ID` 换成你本机的 device_id，见下）：

```sql
INSERT INTO pending_bot_messages (id, device_id, bot_id, message, status, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'YOUR_DEVICE_ID',           -- 替换成 ~/.creez/device_id 里的 UUID
  'a3e6d3f0-9d91-4dc0-8f84-7f3ca8a0619c',  -- RoundCloser bot_id 示例
  '这是一条测试推送消息',
  'pending',
  now(),
  now()
);
```

获取本机 **device_id**：

- **Windows (PowerShell)**：  
  `Get-Content "$env:USERPROFILE\.creez\device_id"`  
  （若文件不存在，先启动一次 Creez 再执行，或随便填一个 UUID 用于本次测试。）
- **macOS/Linux**：  
  `cat ~/.creez/device_id`

### 2.2 用 curl 调 GET /sync/pull

```bash
# 把 DEVICE_ID 换成上面用的 device_id
DEVICE_ID=YOUR_DEVICE_ID
BASE=http://localhost:3001

curl -s "$BASE/sync/pull?device_id=$DEVICE_ID"
```

预期：`{"ok":true,"items":[{ "id": "...", "bot_id": "a3e6d3f0-...", "message": "这是一条测试推送消息", "created_at": "..." }]}`。

### 2.3 验证「发过了就不再发」

再执行一次同样的 curl：

```bash
curl -s "$BASE/sync/pull?device_id=$DEVICE_ID"
```

预期：`{"ok":true,"items":[]}`。  
在 Supabase 中查看该行：`status` 应从 `pending` 变为 `sent`，`updated_at` 已更新。

---

## 三、在 Creez 应用里测试 Sync（5 分钟拉取 + 前端）

1. 确保后端已启动且 Supabase 已配置；`pending_bot_messages` 表已建。
2. 按 **2.1** 插入一条 `status=pending` 的记录，`device_id` 使用本机 `~/.creez/device_id`（先启动一次 Creez 生成再查）。
3. 启动 Creez，并确保当前账号下存在**非默认 bot**（如 RoundCloser），这样 5 分钟定时任务才会请求后端。
4. 在渲染进程里订阅 IPC（若尚未接好）：
   - 例如在根组件或 Chat 入口：`window.electron?.sync?.onPendingMessages?.(payload => { console.log('sync items', payload.items); /* toast 或插入会话 */ });`
5. 等待约 30 秒（首次延迟）或 5 分钟（周期），观察：
   - 控制台是否打出 `sync items` 且 `payload.items` 含刚插入的那条；
   - 若已接好 UI，应看到 toast 或对应会话里出现该条消息。
6. 再次等待 5 分钟或刷新后再次触发拉取，确认**同一条不会再次出现**（与 2.3 一致）。

### 开发时想更快验证（可选）

可临时把 `syncPullTask.cjs` 里的 `INTERVAL_MS` 改为 `60 * 1000`（1 分钟）或更小，跑完测试再改回 `5 * 60 * 1000`。

---

## 四、自检清单

| 项目 | 检查方式 |
|------|----------|
| VC 留资 API | curl POST `/roundcloser/lead` 返回 ok，Supabase `roundcloser_leads` 有新行 |
| VC 飞书通知 | 配置 OPEN_ID 后，留资后飞书私聊收到机器人消息 |
| Sync 拉取 API | curl GET `/sync/pull?device_id=xxx` 返回 items，且该批在 DB 中变为 `sent` |
| Sync 不重复 | 同一 device_id 再次 pull 返回空 items |
| 应用内 VC 留资 | 与 RoundCloser 对话并留联系方式后，DB/飞书有记录 |
| 应用内 Sync | 有非默认 bot 时，约 30s/5min 后收到 IPC，且同一条只出现一次 |
