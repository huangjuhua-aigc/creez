# Creez v2 Database Schema (Draft v1.1)

This document defines the SQLite schema for Creez v2 desktop app.

## 1) Storage layout (`~/.creez`)

Use `~/.creez` as the unified local storage root for v2.

- Database: `~/.creez/app.db`
- Assistant avatar files: `~/.creez/avatars/*`
- Memory files: `~/.creez/memory/memory.md`
- Optional config files: `~/.creez/config/*`
- Optional workspace root(s): `~/.creez/workspaces/*`

Notes:
- On Windows, `~` maps to `C:/Users/<username>`.
- Path fields in DB (for example `avatar` / `avatar_path`) should prefer relative paths under `~/.creez` when possible.

## 2) Database setup

- Database location: `~/.creez/app.db`
- Recommended pragmas:
  - `PRAGMA journal_mode = WAL;`
  - `PRAGMA foreign_keys = ON;`
  - `PRAGMA busy_timeout = 3000;`
  - `PRAGMA synchronous = NORMAL;`

## 3) Tables

## 3.1 `chats`

Stores chat session metadata.

```sql
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT,
  avatar TEXT,
  model_id TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_message_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at DESC);
```

## 3.2 `messages`

Stores all messages in a chat.

`status` lifecycle:
- `pending`: message created, waiting for processing
- `streaming`: assistant response is still in progress
- `done`: completed successfully
- `error`: failed

```sql
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender TEXT NOT NULL CHECK(sender IN ('user','assistant','system')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done' CHECK(status IN ('pending','streaming','done','error')),
  model_used TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  token_prompt INTEGER,
  token_completion INTEGER,
  token_total INTEGER,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at
  ON messages(chat_id, created_at DESC);
```

## 3.3 `app_state`

Stores app UI-level persistent state (single row). This is used for restoring last tab/chat/workspace after restart.

```sql
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_tab TEXT DEFAULT 'chat',
  last_chat_id TEXT,
  workspace_root TEXT,
  is_logged_in INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO app_state (id, updated_at)
VALUES (1, strftime('%s','now'));
```

## 3.4 `assistant_config`

Stores assistant identity/system prompt/model settings (single row).

`skills_json` and `models_json` are TEXT columns that store JSON strings.

```sql
CREATE TABLE IF NOT EXISTS assistant_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  name TEXT NOT NULL DEFAULT 'Assistant',
  avatar_path TEXT,
  system_prompt TEXT,
  skills_json TEXT NOT NULL DEFAULT '{}',
  models_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO assistant_config (id, updated_at)
VALUES (1, strftime('%s','now'));
```

## 3.5 `schema_migrations`

Tracks applied schema migrations.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
```

## 4) JSON column handling

- `assistant_config.skills_json`: serialize object via `JSON.stringify`, parse with `JSON.parse` on read.
- `assistant_config.models_json`: serialize model array via `JSON.stringify`, parse with `JSON.parse` on read.
- If parsing fails, fallback to defaults (`{}` / `[]`) and return a safe validation error upstream.

## 5) Suggested migrations

- v1: create base tables (`chats`, `messages`, `app_state`, `assistant_config`, `schema_migrations`)
- v2: add new message/config columns if needed
- v3: performance indexes and optional search-related columns

Each migration should be idempotent and recorded in `schema_migrations`.

## 6) Query patterns to implement

- Chat list:
  - order by `last_message_at DESC`, fallback `updated_at DESC`
- Message history:
  - by `chat_id`, keyset pagination by `created_at < before`
- Assistant reply write strategy (v1):
  - create user message immediately
  - wait for full assistant response
  - write assistant message once with final content and `done` (or `error`)

## 7) Data integrity rules

- Every `messages.chat_id` must exist in `chats`.
- Deleting a chat cascades messages.
- `app_state` and `assistant_config` must always keep one row (`id = 1`).
- Token counts are optional and should be nullable.

## 8) Security notes

- Never store raw API key in logs.
- Prefer encrypting API keys before writing model config JSON.
- Validate and sanitize string lengths before insert/update.
