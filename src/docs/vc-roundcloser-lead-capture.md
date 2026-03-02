# VC / RoundCloser 信息互换 (Lead Capture)

This feature lets RoundCloser collect contact info from serious VC leads and notify the product owner via Supabase + Feishu.

## Overview

- **Trigger (any of):** ~10 rounds of substantive Creez conversation, deep questions not in KB, or user explicitly asks for founder contact / meeting.
- **Flow:** If contact is not yet collected → RoundCloser (via skill/prompt) asks for name, email, company, WeChat, availability. If contact is already collected → the built-in skill `vc_lead_capture` sends it to the backend.
- **Backend:** Stores the lead in Supabase and sends a Feishu notification to the product owner.

---

## 1. Supabase: Create the leads table

Run the following SQL in the **Supabase Dashboard → SQL Editor** (project used by `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`):

```sql
-- File: creezv2_backend/supabase/roundcloser_leads.sql

CREATE TABLE IF NOT EXISTS roundcloser_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  name TEXT NOT NULL,
  email TEXT,
  company TEXT,
  wechat TEXT,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'roundcloser',

  device_id TEXT,
  chat_id TEXT,
  raw_payload JSONB,

  CONSTRAINT roundcloser_leads_email_or_wechat CHECK (
    email IS NOT NULL AND email != '' OR wechat IS NOT NULL AND wechat != ''
  )
);

CREATE INDEX IF NOT EXISTS idx_roundcloser_leads_created_at ON roundcloser_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roundcloser_leads_source ON roundcloser_leads (source);
```

Full script is in `creezv2_backend/supabase/roundcloser_leads.sql`.

---

## 2. Feishu (飞书) bot setup

### 2.1 Create an app and get credentials

1. Go to [Feishu Open Platform](https://open.feishu.cn/app).
2. Create an app (自建应用) or use an existing one.
3. In **Credentials & Basics** (凭证与基础信息):
   - Copy **App ID** → `FEISHU_APP_ID`
   - Copy **App Secret** → `FEISHU_APP_SECRET`

### 2.2 Enable bot and choose: 发给自己（推荐）或 发到群

**方式一：直接发给自己（不需要加群）**

1. In the app console, open **Features** (能力) → **Bot** (机器人), enable “Enable Bot”.
2. 在 **Permissions** (权限管理) 中为应用申请并开通：
   - `im:message:send_as_bot`（以应用身份发单聊/群消息）
   - 若需通过手机号查 open_id：`contact:user.base:readonly` 等通讯录权限（见飞书文档）。
3. **获取你自己的 open_id**（用于接收单聊消息）：
   - 飞书文档：[如何获取 open_id](https://open.feishu.cn/document/faq/trouble-shooting/how-to-obtain-openid)。
   - 或调用 [通过手机号/邮箱获取用户 ID](https://open.feishu.cn/document/server-docs/contact-v3/user/batch_get_id) 接口：传入你的手机号或邮箱，返回结果中的 `open_id`。
   - 将得到的 open_id 配置为环境变量 **`FEISHU_OPEN_ID`**。
4. 确保应用“可用范围”包含你自己（在开发者后台 版本管理与发布 中配置），发布或启用后，机器人即可给你发单聊消息。

后端逻辑：若配置了 `FEISHU_OPEN_ID`，使用 `receive_id_type=open_id`、`receive_id=FEISHU_OPEN_ID` 发送；未配置则使用下面的群聊方式。

**方式二：发到群聊（可选）**

1. 在飞书中创建一个群，把机器人加进该群。
2. 通过 [获取群列表](https://open.feishu.cn/document/server-docs/im-v1/chat/list) 等接口或开发者工具拿到该群的 **chat_id**。
3. 配置环境变量 **`FEISHU_CHAT_ID`**。

若同时配置了 `FEISHU_OPEN_ID` 和 `FEISHU_CHAT_ID`，后端**优先使用 open_id**（发给自己）。

### 2.3 Permissions

In the app console, **Permissions** (权限管理), ensure the app has:

- `im:message:send_as_bot` – 以应用身份发送消息（单聊与群聊均需要）

Then publish the app or request approval if in sandbox.

### 2.4 Backend implementation

Implementation: `creezv2_backend/src/services/feishuService.cjs`. It uses:

1. **Get tenant_access_token:**  
   `POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`  
   Body: `{ "app_id": "<FEISHU_APP_ID>", "app_secret": "<FEISHU_APP_SECRET>" }`

2. **Send message:**  
   - 若配置了 `FEISHU_OPEN_ID`：`POST .../im/v1/messages?receive_id_type=open_id`，Body 中 `receive_id` 为你的 open_id（单聊发给自己）。
   - 否则：`POST .../im/v1/messages?receive_id_type=chat_id`，Body 中 `receive_id` 为 `FEISHU_CHAT_ID`（发到群）。

---

## 3. Environment variables

### Backend (creezv2_backend)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes (for lead) | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes (for lead) | Supabase service role key |
| `FEISHU_APP_ID` | No | Feishu app ID (needed for notifications) |
| `FEISHU_APP_SECRET` | No | Feishu app secret |
| `FEISHU_OPEN_ID` | No | **推荐** 你的飞书 open_id，机器人直接发单聊给你（不需加群） |
| `FEISHU_CHAT_ID` | No | 可选：飞书群 chat_id；若未配置 OPEN_ID 则发到该群 |

若同时配置了 `FEISHU_OPEN_ID` 与 `FEISHU_CHAT_ID`，优先使用 open_id（发给自己）。若 Feishu 相关变量都未配置，留资仍会写入 Supabase，仅不发送飞书通知。

### Client (Creez Electron app)

The skill handler calls the same backend as knowledge search:

- `CREEZ_KNOWLEDGE_API_BASE` – base URL of creezv2_backend (e.g. `https://creez.lighton.video`). Used for both `knowledge_search` and `vc_lead_capture` (POST `/roundcloser/lead`).

---

## 4. Skill and API summary

- **Skill:** `vc_lead_capture` (built-in). Enabled for non-default bots (e.g. RoundCloser). See `creezv2/skills/builtin/skills/vc_lead_capture/SKILL.md`.
- **When to call:** After substantive conversation / deep questions / explicit meeting request, and only when contact (name + email or wechat) is already collected.
- **API:** `POST /roundcloser/lead`  
  Body: `name`, `email?`, `company?`, `wechat?`, `message?`, `source?`, `device_id?`, `chat_id?`, `raw_payload?`.
