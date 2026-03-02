# 对话启动：按 contact id 的调用链路

本文档描述「用户在某条对话里发第一条消息」时，从渲染进程到 agent 会话建立的完整调用链，以及 **不同 contact id**（默认 bot vs RoundCloser 等）下的数据流。

---

## 1. 入口：当前会话的 contactId 从哪来

- 用户选中的对话：`selectedChatId`（即 `chatId`）。
- 当前对话对应的 contact：`currentChat = chatList.find(c => c.id === selectedChatId)`，`contactId = currentChat?.contactId ?? null`。
- `chatList` 来自后端/DB，每条 chat 带有 `contact_id`，前端映射为 `contactId`。所以 **默认 bot 的对话** 的 `contactId` 是默认 contact 的 id，**RoundCloser 对话** 的 `contactId` 是 RoundCloser 的 id。

---

## 2. 调用链总览（按 contact id 区分）

```
[渲染进程] 用户发消息
  → ensureAgentInitialized()
      取 currentChat.contactId、selectedChatId、fetchAssistantConfig(contactId)、fetchModelApiKey(…)
  → initAgent({ contactId, chatId: selectedChatId, provider, modelId, apiKey, … })
  → window.electron.agent.init(payload)   // payload.contactId = 当前对话的 contactId

[主进程] agentIpc 收到 AGENT_INIT
  → getEngineForContact(payload?.contactId, { contactRepository, assistantConfigRepository })
      根据 contactId 解析：
        - defaultContactId = contactRepository.getDefaultAssistantConfigId()（或固定默认 UUID）
        - 若 contactId 有对应 contact：assistantConfigId = contact.id，rawConfig = getRawConfigById(assistantConfigId)
        - 否则：assistantConfigId = defaultContactId，rawConfig = 默认 config
      return { engine, rawConfig, assistantConfigId, defaultContactId }
  → 用 rawConfig 选 model、解析 apiKey（含从 default 兜底）
  → context = { chatId, contactId, assistantConfigId, defaultContactId, … }
  → currentEngine.init(context)   // 当前为 PiConversationEngine

[PiConversationEngine] init(context)
  → config = { contactId, assistantConfigId, defaultContactId, chatId, provider, modelId, apiKey, … }
  → runner.createAndSubscribe(sender, config)

[agent-runner] createAndSubscribe(sender, config)
  → runtimeContext = { contactId, assistantConfigId, defaultContactId, chatId }   // 来自 config，即来自 context
  → builtinExecutor = createBuiltinSkillExecutor({ registry, runtimeContext, … })
  → customTools = builtinExecutor.listEnabledToolDefinitions()
       内部对每个 builtin（如 knowledge_search）调 definition.isEnabled(runtimeContext)
       knowledge_search 启用条件：assistantConfigId !== defaultContactId（且非 null）
  → createAgentSession({ …, customTools })
  → 后续 systemPrompt、subscribe 等
```

---

## 3. 不同 contact id 下的行为

| 场景 | payload.contactId | getEngineForContact 结果 | runtimeContext | customTools 中的 knowledge_search |
|------|-------------------|--------------------------|----------------|-----------------------------------|
| 默认 bot 对话 | 默认 contact 的 id（或 null） | assistantConfigId = defaultContactId | 二者相等 | 不启用 |
| RoundCloser 对话 | RoundCloser 的 id | assistantConfigId = RoundCloser id，defaultContactId = 默认 id | 二者不等 | 启用 |

要点：

- **assistantConfigId** 和 **defaultContactId** 必须来自同一套解析逻辑（都在 `getEngineForContact` 里得到），并一路传到 `runtimeContext`，这样「是否默认 bot」的判断才一致。
- 若 `defaultContactId` 在别处单独取且可能为 null，则 `isKnowledgeSearchEnabled` 会误判，导致 RoundCloser 也拿不到 knowledge_search。

---

## 4. 涉及文件速查

| 层级 | 文件 | 作用 |
|------|------|------|
| 渲染进程 | `src/app/components/ChatWindow.tsx` | `ensureAgentInitialized`、`initAgent({ contactId, chatId, … })` |
| 渲染进程 | `src/app/services/chat.ts` | `initAgent` 调 `window.electron.agent.init(payload)` |
| 主进程 | `electron/main/agentIpc.cjs` | 收 `AGENT_INIT`，调 `getEngineForContact(payload?.contactId)`，组 `context`，`engine.init(context)` |
| 主进程 | `electron/main/conversation/engineRegistry.cjs` | `getEngineForContact(contactId)` → `engine, rawConfig, assistantConfigId, defaultContactId` |
| 主进程 | `electron/main/conversation/PiConversationEngine.cjs` | `init(context)` → 拼 `config` → `createAndSubscribe(sender, config)` |
| 主进程 | `electron/main/agent-runner.mjs` | `createAndSubscribe(sender, config)` → `runtimeContext`、builtin executor、`customTools`、`createAgentSession` |
| 主进程 | `electron/main/agent-tools/builtin/registry.mjs` | `listEnabled(runtimeContext)`、各 builtin 的 `isEnabled(runtimeContext)`（如 knowledge_search） |

---

## 5. 多会话（多 bot 同时回复）

- **agent-runner** 按 **chatId** 维护多个 session（`sessionsByChatId`）。`createAndSubscribe` 只创建/替换该 chatId 的 session，不会关掉其他 chat 的 session。
- **AGENT_PROMPT**、**AGENT_SET_MODEL**、**AGENT_ABORT** 的 payload 里带 **chatId**，主进程按 chatId 路由到对应 session。
- 主进程发出的 **agent 事件**（含 `agent_ready`、`message_update`、`message_end`、`agent_end`）都带上 **chatId**；前端只把事件应用到 `event.chatId === selectedChatId` 的对话，避免切到另一条对话时当前视图被别的 bot 刷掉，也避免一条对话发消息时停掉另一条里正在回复的 bot。

## 6. 小结

- **contactId** 来自当前选中的 chat 的 `contactId`，随 `AGENT_INIT` 传到主进程。
- **getEngineForContact(contactId)** 是「当前 bot + 默认 bot」的唯一解析点，返回的 **defaultContactId** 应和 **assistantConfigId** 一起传入 **context → config → runtimeContext**，这样 builtin 的「是否默认 bot」判断一致，RoundCloser 的 knowledge search 等 custom tools 才能正确加载。
- **多会话**：init 不再覆盖其他 chat 的 session；prompt/setModel/abort 都带 chatId；事件带 chatId，前端按 chatId 路由。
