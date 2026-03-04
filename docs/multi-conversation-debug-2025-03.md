# 多对话支持调试记录（2025-03）

本文档记录「支持多个 bot 对话同时进行」相关的调试过程、根因与修复，以及后续待办。

---

## 背景

- 主进程 agent 从**单 session**改为按 **chatId** 维护多 session（`sessionsByChatId`），见 `docs/conversation-startup-call-chain.md`。
- 前端需要：streaming 状态、发送/停止按钮、事件路由都**只作用于当前对话页面**，且切换对话时不能停掉别的 bot 的回复、不能留下空消息。

---

## 调试过程与修复

### 1. 一切换对话就停掉上一个 bot

**现象**：Bot A 在回复时，切到 Bot B 发消息，Bot A 的回复直接停了。

**根因**：`createAndSubscribe` 里每次都会 `unsubscribe()` 并清空唯一的 `sessionRef`，等于单 session 设计，init 一次就替换掉上一个。

**修复**：agent-runner 用 `sessionsByChatId`（Map）按 chatId 存 session；init 只创建/替换该 chatId 的 session；prompt/setModel/abort/hasSession 都按 chatId 路由；事件带上 chatId 发到前端。

---

### 2. RoundCloser / 默认 bot「Model config is incomplete」随机出现

**现象**：有时报「Model config is incomplete」，但 API key 实际是有的。

**根因 1**：`agent_ready` 用 `event.chatId === selectedChatId` 判断是否接受；用户发消息后、agent_ready 到达前切到另一条对话，`selectedChatId` 已变，agent_ready 被丢弃 → init 超时 → 报错。

**修复**：增加 `pendingInitChatIdRef`，记录「正在为哪个 chat 做 init」；agent_ready 时若 `event.chatId === pendingInitChatIdRef.current` 则接受并 resolve，不再用 selectedChatId 过滤。

**根因 2**：settingsIpc 里 `defaultConfigId = contactRepository.getDefaultAssistantConfigId?.() ?? 1`，DB 里默认 bot 的 id 已是 UUID，用 `1` 拿不到 config，RoundCloser 回退不到默认的 models/apiKey。

**修复**：统一用 `DEFAULT_BOT_ID = "11111111-1111-1111-1111-111111111111"`，不再用 `?? 1`。

---

### 3. RoundCloser 对话不回复（卡住）

**现象**：getModelApiKey 已返回 hasApiKey，但 RoundCloser 不发内容。

**根因**：React **过期闭包**。`handleIncomingAgentEvent` 里用 `selectedChatId`（state），但注册监听的 useEffect 依赖只有 `[botAvatar, botName]`，切到 RoundCloser 后 handler 里的 `selectedChatId` 仍是默认 bot 的 → RoundCloser 的 message_update/message_end 全被当成「别的 chat」丢弃。

**修复**：用 `selectedChatIdRef` 镜像 selectedChatId，事件处理里用 `selectedChatIdRef.current` 判断；去掉 `isForActiveStream` 例外（避免后台 chat 事件误入当前页）。

---

### 4. 发送按钮在别的对话里显示「停止」，点停止会停掉另一个 bot

**现象**：Bot A 在流式回复时切到 Bot B，Bot B 的输入框显示「停止」，点击后停掉的是 Bot A。

**根因**：`isStreaming` 是全局 state，不区分 chat；stopStreaming 用 `activeStreamChatIdRef.current` 去 abort，没有校验「当前看的 chat 是否就是正在流的 chat」。

**修复**：
- 切换对话时根据 `activeStreamChatIdRef.current === selectedChatId` 设置 `isStreaming`，只让「当前 chat 在流」时显示停止。
- stopStreaming 先校验 `activeStreamChatIdRef.current === selectedChatIdRef.current`，不匹配则只 `setIsStreaming(false)` 并 return。
- handleSend 里「点的是停止还是发送」用 `activeStreamChatIdRef.current === currentChatId` 判断，不发消息时不再用全局 isStreamingRef。
- agent_end / onAgentError 里只在「结束的是当前 chat」时才 `setIsStreaming(false)`。

---

### 5. Bot A 回复中切到 Bot B 发消息 → Bot A 留下空头像

**现象**：Bot A 在流式回复，用户切到 Bot B 并发消息；Bot A 的回复被「停掉」的错觉，切回 A 看到空头像、空内容。

**根因**：前端用一组全局 ref 跟踪「当前唯一流」。在 Bot B 发消息时直接 `activeStreamChatIdRef = B`、`activeAssistantMessageIdRef = B 的消息 id`，覆盖了 A；Bot A 的后续 message_update/agent_end 因 eventChatId !== currentSelectedChatId 被过滤，DB 里 A 的那条消息永远是 `content: "", status: "streaming"`。

**修复**：在覆盖 ref、开始 Bot B 流之前，若存在「别的 chat 的流」（prevStreamChatId !== activeChat.id 且 prevStreamChatId/prevAssistantId 有值），先把已流内容写入 DB（updateChatMessage），并更新侧边栏预览；然后再清空 ref 并开新流。对「其他 chat」的 message_end 仍做侧边栏预览更新（不更新当前页消息列表）。

---

## 涉及文件（多对话相关）

| 文件 | 改动要点 |
|------|----------|
| `electron/main/agent-runner.mjs` | sessionsByChatId、事件带 chatId、prompt/setModel/abort/hasSession(chatId) |
| `electron/main/conversation/PiConversationEngine.cjs` | prompt/setModel/abort/hasSession 传 chatId |
| `electron/main/agentIpc.cjs` | AGENT_PROMPT/SET_MODEL/ABORT 带 chatId，init 不替换其他 session |
| `electron/main/settingsIpc.cjs` | defaultConfigId 用 DEFAULT_BOT_ID，getAssistantConfig/getModelApiKey 日志 |
| `src/app/components/ChatWindow.tsx` | selectedChatIdRef、pendingInitChatIdRef、streaming 按当前 chat、切换时保存前一流到 DB |
| `src/app/services/chat.ts` | sendAgentPrompt/switchAgentModel/abortAgentPrompt 带 chatId |
| `electron/preload/index.cjs` | agent.abort(chatId) |

---

## 架构重做（2025-03-02）：per-chat stream Map

### 根因

之前用一组**全局 ref**（`activeAssistantMessageIdRef`、`streamedTextRef`、`activeStreamChatIdRef` 等）跟踪「唯一的一个流」。后台 chat 的 `message_end` / `agent_end` 被 `isForOtherChat` early return 丢弃，DB 永远不更新；切回该 chat 时消息内容已丢。

### 改动

1. **`ChatWindow.tsx` — per-chat stream Map**（`chatStreamsRef: Map<chatId, ChatStreamState>`）：
   - 每个 chat 有独立的 `{ assistantMessageId, streamedText, botId, toolCalls, toolMessageId }`。
   - `handleIncomingAgentEvent` 不再 `isForOtherChat` early return。改为 `isForCurrentChat` 判断：
     - `message_update`：**所有 chat** 更新 Map；仅当前 chat 更新 UI。
     - `message_end`：**所有 chat** 写 DB + 更新侧栏；仅当前 chat 更新 UI 消息列表。
     - `agent_end`：**所有 chat** 写 DB + 更新侧栏 + 清 Map 条目；仅当前 chat 清 ref + setIsStreaming。
     - tool events：**所有 chat** 更新 Map 里的 toolCalls；仅当前 chat 更新 UI。
   - **切换对话**时从 Map 恢复流状态（ref + isStreaming），加载消息后覆盖活跃流内容。
   - `handleSend` 不再有 prev-stream workaround（背景流自行完成），直接注册 Map 条目。
   - `stopStreaming` / error handler 都清 Map 条目。
2. **`agentIpc.cjs`**：
   - 去掉全局 `currentSender`；每次 AGENT_INIT 用 `const initSender = event.sender` 捕获到闭包。
   - 去掉 `setImmediate` 发的重复 `agent_ready`（agent-runner 里已发）。
   - AGENT_PROMPT 的 `agent_end` 用 `event.sender` 而非 `currentSender`。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `src/app/components/ChatWindow.tsx` | +`ChatStreamState`、+`chatStreamsRef`；重写事件处理、切换、发送、停止、错误 |
| `electron/main/agentIpc.cjs` | 去 `currentSender`、per-init sender 捕获、去重复 agent_ready |

---

## TODO（后续待修复/增强）

- [x] ~~**后台流完成后持久化**~~ — 已通过 per-chat Map 解决。
- [ ] **多流时的停止按钮语义**：若将来支持「当前页显示多个 bot 的流状态」，停止按钮需明确只停当前 chat。
- [ ] **RoundCloser knowledge_search 复验**：确认 defaultContactId 从 getEngineForContact 透传后，RoundCloser 的 custom tools 是否稳定包含 knowledge_search。
- [ ] **E2E 或手动用例**：把「A 流式回复中 → 切 B 发消息 → 再切回 A」写成固定用例，回归多对话与空消息修复。
- [ ] **清理 [creez:flow] 日志**：调试稳定后可将主进程/前端的 [creez:flow] 改为 DEBUG 开关或移除。
- [ ] **联系人 → 聊天用了错误 ID**：`ContactsWindow` 传 contactId 当 chatId；需加 `getOrCreateChatByContactId` API。

---

## 参考

- `docs/conversation-startup-call-chain.md`：对话启动与多会话调用链
- `.cursor/rules/root-cause-fixes.mdc`：修 bug 时先找根因、在根因处修
