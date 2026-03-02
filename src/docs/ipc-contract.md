# Creez v2 IPC Contract (Draft v1)

This document defines the IPC interfaces between `renderer` and `main` in Electron for Creez v2.
It is a baseline contract for v1 implementation and can be refined as details evolve during development.

## 1) Conventions

### 1.1 Channel naming

- Use `domain:action` format.
- Examples: `chat:list`, `settings:saveAssistantConfig`, `workspace:getTree`.

### 1.2 Request/response wrapper

Use a unified response envelope for all `ipcRenderer.invoke` calls.

```ts
type IpcOk<T> = { ok: true; data: T; requestId?: string };
type IpcErr = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
};
type IpcResult<T> = IpcOk<T> | IpcErr;
```

### 1.3 Error code catalog

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `PERMISSION_DENIED`
- `FS_ERROR`
- `DB_ERROR`
- `AI_PROVIDER_ERROR`
- `NETWORK_ERROR`
- `TIMEOUT`
- `UNKNOWN_ERROR`

### 1.4 Transport patterns

- `invoke/handle` for request-response APIs.
- `send/on` can be used for optional event push (for example workspace file change notifications).

## 2) API Surface

## 2.1 app

### `app:getState`

- Request:

```json
{}
```

- Response data:

```json
{
  "lastTab": "chat",
  "lastChatId": "chat_123",
  "workspaceRoot": "D:/workspace/project",
  "isLoggedIn": false
}
```

### `app:setState`

- Request:

```json
{
  "lastTab": "workspace",
  "lastChatId": "chat_123",
  "workspaceRoot": "D:/workspace/project",
  "isLoggedIn": true
}
```

- Response data:

```json
{ "updated": true }
```

## 2.2 chat

### `chat:list`

- Implementation status: implemented in Day3 (main IPC + preload + renderer read path).

- Request:

```json
{ "limit": 30, "offset": 0, "keyword": "" }
```

- Response data:

```json
{
  "items": [
    {
      "id": "chat_123",
      "title": "Project discussion",
      "lastMessage": "Hello!",
      "lastMessageAt": 1740473000,
      "unreadCount": 2,
      "modelUsed": "openrouter:gpt-4o"
    }
  ],
  "total": 1
}
```

### `chat:create`

- Request:

```json
{ "title": "New chat", "modelId": "openrouter:gpt-4o" }
```

- Response data:

```json
{ "chatId": "chat_456", "createdAt": 1740473000 }
```

### `chat:getMessages`

- Implementation status: implemented in Day3 (main IPC + preload + renderer read path).

- Request:

```json
{ "chatId": "chat_123", "limit": 50, "before": 1740474000 }
```

- Response data:

```json
{
  "items": [
    {
      "id": "msg_1",
      "chatId": "chat_123",
      "sender": "user",
      "content": "Hello",
      "createdAt": 1740473000,
      "status": "done",
      "modelUsed": "openrouter:gpt-4o"
    }
  ],
  "hasMore": false,
  "nextBefore": null
}
```

### `chat:send`

- Request:

```json
{
  "chatId": "chat_123",
  "content": "Explain this file",
  "attachments": [{ "path": "D:/workspace/a.ts", "type": "text/plain" }],
  "modelId": "openrouter:gpt-4o"
}
```

- Response data:

```json
{
  "userMessageId": "msg_user_10",
  "assistantMessageId": "msg_assistant_10",
  "status": "done"
}
```

### `chat:updateSessionModel`

- Request:

```json
{ "chatId": "chat_123", "modelId": "openrouter:gpt-4o-mini" }
```

- Response data:

```json
{ "updated": true }
```

### `chat:markRead`

- Request:

```json
{ "chatId": "chat_123" }
```

- Response data:

```json
{ "updated": true }
```

### `chat:delete`

- Request:

```json
{ "chatId": "chat_123" }
```

- Response data:

```json
{ "deleted": true }
```

## 2.3 settings

### `settings:getAssistantConfig`

- Request:

```json
{}
```

- Response data:

```json
{
  "name": "My Assistant",
  "avatar": "D:/app-data/avatar.png",
  "systemPrompt": "You are a helpful assistant.",
  "skills": {
    "webSearch": true,
    "codeRunner": false
  },
  "models": [
    {
      "id": "openrouter:gpt-4o",
      "provider": "openrouter",
      "apiBase": "https://openrouter.ai/api/v1",
      "apiKeyMasked": "sk-***",
      "active": true
    }
  ]
}
```

### `settings:saveAssistantConfig`

- Request:

```json
{
  "name": "My Assistant",
  "avatar": "D:/app-data/avatar.png",
  "systemPrompt": "You are a helpful assistant.",
  "skills": { "webSearch": true, "codeRunner": false },
  "models": [
    {
      "id": "openrouter:gpt-4o",
      "provider": "openrouter",
      "apiBase": "https://openrouter.ai/api/v1",
      "apiKey": "sk-xxxx",
      "active": true
    }
  ]
}
```

- Response data:

```json
{ "updated": true, "updatedAt": 1740473000 }
```

### `settings:uploadAvatar`

- Request:

```json
{ "sourcePath": "C:/Users/user/Desktop/avatar.png" }
```

- Response data:

```json
{ "avatarPath": "D:/app-data/avatars/avatar.png" }
```

### `model:testConnection`

- Request:

```json
{
  "provider": "openrouter",
  "apiBase": "https://openrouter.ai/api/v1",
  "apiKey": "sk-xxxx",
  "model": "gpt-4o"
}
```

- Response data:

```json
{ "ok": true, "latencyMs": 240 }
```

## 2.4 memory

### `memory:read`

- Request:

```json
{ "path": "D:/workspace/memory.md" }
```

- Response data:

```json
{
  "content": "# Notes",
  "path": "D:/workspace/memory.md",
  "updatedAt": 1740473000
}
```

### `memory:write`

- Request:

```json
{ "content": "# Updated notes", "path": "D:/workspace/memory.md" }
```

- Response data:

```json
{
  "updated": true,
  "path": "D:/workspace/memory.md",
  "updatedAt": 1740474000
}
```

## 2.5 workspace

### `workspace:getTree`

- Request:

```json
{ "rootPath": "D:/workspace/project", "depth": 3 }
```

- Response data:

```json
{
  "rootPath": "D:/workspace/project",
  "nodes": [
    {
      "name": "src",
      "path": "D:/workspace/project/src",
      "type": "folder",
      "children": []
    }
  ]
}
```

### `workspace:create`

- Request:

```json
{
  "parentPath": "D:/workspace/project/src",
  "name": "new-file.ts",
  "type": "file",
  "content": ""
}
```

- Response data:

```json
{ "path": "D:/workspace/project/src/new-file.ts" }
```

### `workspace:rename`

- Request:

```json
{
  "path": "D:/workspace/project/src/new-file.ts",
  "newName": "renamed-file.ts"
}
```

- Response data:

```json
{ "path": "D:/workspace/project/src/renamed-file.ts" }
```

### `workspace:delete`

- Request:

```json
{
  "path": "D:/workspace/project/src/renamed-file.ts",
  "recursive": false
}
```

- Response data:

```json
{ "deleted": true }
```

### `workspace:readFile`

- Request:

```json
{
  "path": "D:/workspace/project/src/index.ts",
  "encoding": "utf8"
}
```

- Response data:

```json
{
  "content": "console.log('hello')",
  "encoding": "utf8",
  "stat": { "size": 20, "mtimeMs": 1740473000 }
}
```

### `workspace:writeFile`

- Request:

```json
{
  "path": "D:/workspace/project/src/index.ts",
  "content": "console.log('updated')",
  "encoding": "utf8",
  "createIfMissing": true
}
```

- Response data:

```json
{
  "updated": true,
  "stat": { "size": 22, "mtimeMs": 1740474000 }
}
```

### `workspace:upload`

- Request:

```json
{
  "sourcePath": "C:/Users/user/Desktop/example.png",
  "targetDir": "D:/workspace/project/assets"
}
```

- Response data:

```json
{ "path": "D:/workspace/project/assets/example.png" }
```

### `workspace:openInExplorer`

- Request:

```json
{ "path": "D:/workspace/project" }
```

- Response data:

```json
{ "opened": true }
```

## 3) Optional push events

For v1, chat uses `invoke/handle` only and returns once the full assistant response is ready.

## 3.1 workspace events (optional)

- `workspace:changed`

```json
{
  "type": "rename",
  "path": "D:/workspace/project/src/new.ts",
  "oldPath": "D:/workspace/project/src/old.ts"
}
```

## 4) Security and validation checklist

- Reject any workspace path outside configured root.
- Normalize all paths before access.
- Validate payload shape in main process for every channel.
- Mask API keys in logs and read APIs.
- Do not expose raw Node APIs to renderer; only expose whitelisted preload APIs.

## 5) Implementation notes

- Keep channel constants in one file (example: `src/main/ipc/channels.ts`).
- Keep shared DTO types in one file (example: `src/shared/ipc.ts`).
- Add integration tests for critical channels:
  - `chat:send` (full-response write path)
  - `settings:saveAssistantConfig`
  - `workspace:*` path validation
