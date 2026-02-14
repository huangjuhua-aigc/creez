# Creez 用户对话发送与处理全过程

本文档描述从用户点击发送到流式回复展示、历史写入的完整数据流与代码位置。

---

## 一、流程总览

```
用户输入 → 点击发送/回车
    → 渲染进程：组装消息、校验配置、创建气泡、IPC 发送 agent:prompt
    → 预加载层：ipcRenderer.send("agent:prompt", payload)
    → 主进程：接收 agent:prompt，请求 LLM 流式接口，按 AgentEvent 形态发送 agent:event
    → 渲染进程：订阅 agent:event，更新流式气泡与 chatHistory
```

---

## 二、渲染进程（Renderer）— 用户侧

### 2.1 触发入口

| 方式 | 位置 | 说明 |
|------|------|------|
| 点击发送按钮 | `app.js` 约 1071 行 `sendMessageButton.addEventListener("click", ...)` | 点击后执行同一段发送逻辑 |
| 回车发送 | `app.js` 约 1112 行 `chatInput.addEventListener("keydown", ...)` | `Enter` 且非 `Shift` 时 `sendMessageButton.click()` |

### 2.2 发送前处理（同一段逻辑）

1. **取输入并校验**  
   - `message = chatInput.value.trim()`  
   - `hasAttachments = chatAttachments.length > 0`  
   - 若 `!message && !hasAttachments && !pendingMentions.length` 则直接 return，不发送。

2. **组装用户可见文案**  
   - `finalMessage = buildUserMessage(message)`（约 935 行）  
   - 若有 `pendingMentions`，会拼上 `\n引用文件: xxx, xxx`。

3. **立刻渲染用户气泡**  
   - `appendChatMessage(finalMessage, "user")`（约 636 行：创建 `div.chat-message.user`，追加到 `#chat-messages`，滚动到底部）。  
   - 若有附件，在最后一个子元素下追加预览图（`chat-message-attachments`）。

4. **清空输入区**  
   - `chatInput.value = ""`，清空 `chatAttachments`、`pendingMentions`，并调用 `renderChatAttachments()`、`renderMentionChips()`。

5. **调用发送**  
   - `sendMessageToAgent(finalMessage, attachmentsToSend)`（约 1097 行）。

### 2.3 sendMessageToAgent（app.js 约 961–1004 行）

- **取消上一轮**：若有 `activeStreamController`，先 `window.creez.send("agent:abort")`，并清空 `activeStreamController`、`currentStream`。
- **配置校验**：从 `currentConfig` 取 `modelProvider`、`modelName`、`apiKey`；缺任一则 `appendChatMessage("请先在设置中配置...", "assistant")` 并 return。
- **组装 LLM 消息**：  
  - 纯文本：`userContent = text`。  
  - 带图：`userContent = [{ type: "text", text }, { type: "image_url", image_url: { url: dataUrl } }, ...]`。  
  - `messages = chatHistory.map(...)` 再 `push({ role: "user", content: userContent })`。
- **modelId**：多数情况等于 `modelName`；若 provider 为 `anthropic` 且未带前缀，则加 `anthropic/`。
- **创建助理流式气泡**：`assistantMsg = appendChatMessage("", "assistant")`，并设 `currentStream = { assistantMsg, fullText: "", userContent }`、`activeStreamController = { active: true }`。
- **发 IPC**：`window.creez.send("agent:prompt", { provider, modelId, apiKey, messages })`。

---

## 三、预加载层（Preload）

- `preload.js` 暴露 `window.creez.send(channel, ...args)`，内部为 `ipcRenderer.send(channel, ...args)`。
- 故 `send("agent:prompt", payload)` 会发到主进程的 `agent:prompt` 通道；`send("agent:abort")` 发到 `agent:abort`。
- 渲染进程通过 `window.creez.on("agent:event", fn)` / `on("agent:eventError", fn)` 订阅主进程发来的事件（对应 `ipcRenderer.on`）。

---

## 四、主进程（Main）— agent:prompt 与 agent:abort

### 4.1 agent:prompt（main.js 约 277–379 行）

1. **取消上一次请求**：若存在 `agentAbortController`，先 `abort()`，再新建 `AbortController`，供本次 `fetch` 使用。

2. **解析参数**：从 IPC 参数取 `provider`、`modelId`、`apiKey`、`messages`。

3. **确定请求 URL**：  
   - `baseUrl = PROVIDER_CHAT_URL[provider]`（openai / doubao / anthropic / openrouter 对应不同根 URL）。  
   - 若无该 provider：先 `emitAgentEvent(sender, { type: "agent_end", messages: [] })`，再 `sender.send("agent:eventError", "不支持的供应商...")`，return。

4. **发起流式请求**：  
   - `url = baseUrl + "/chat/completions"`  
   - `body = { model: modelId, messages, stream: true }`  
   - `fetch(url, { method: "POST", headers: Content-Type + Authorization: Bearer apiKey, body, signal })`  
   - 先 `emitAgentEvent(sender, { type: "agent_start" })`。

5. **响应处理**：  
   - 若 `!response.ok` 或 `!response.body`：发 `agent_end` + `agent:eventError`，return。  
   - 否则用 `response.body.getReader()` 读流，按行解析 SSE（`data:` 行），从 `choices[0].delta.content` 取字符串 chunk，累加到 `fullText`。

6. **按 chunk 发事件**：  
   - 每收到一段文本：先发一次 `message_start`（仅首 chunk），再发 `message_update`，payload 为 `{ role: "assistant", content: [{ type: "text", text: fullText }] }`。  
   - 流读完：发 `message_end`（同一结构的 finalMessage），再发 `agent_end`（`messages: []`）。

7. **异常**：  
   - 非 AbortError：发 `agent_end` + `agent:eventError`。  
   - `finally` 里将 `agentAbortController` 置空。

### 4.2 agent:abort（main.js 约 381–385 行）

- 收到 `agent:abort` 时，若有 `agentAbortController` 则 `abort()`，当前轮 fetch 被中断，主进程仍会走 catch/finally，不会向渲染进程再发新事件（或仅已发出的事件会到达）。

---

## 五、渲染进程 — 接收 agent 事件并更新 UI

### 5.1 agent:event（app.js 约 1217–1256 行）

- 全局 `window.creez.on("agent:event", (ev) => { ... })`，根据 `ev.type` 分支：

| 事件类型 | 行为 |
|----------|------|
| `agent_start` / `message_start` | 不做事（流式气泡已在 sendMessageToAgent 里创建）。 |
| `message_update` | 若存在 `currentStream` 且 `ev.message?.content?.[0]?.text != null`，则 `currentStream.fullText = ...`，`currentStream.assistantMsg.textContent = currentStream.fullText`，实现打字机效果。 |
| `message_end` | 从 `ev.message` 取出最终文本（支持 `content` 为 string 或 `content[0].text`）；若文本非空或存在 user 内容，则 `chatHistory.push({ role: "user", content: currentStream.userContent })`、`push({ role: "assistant", content: text || currentStream.fullText })`；清空 `currentStream`、`activeStreamController`。 |
| `agent_end` | 若仍有 `currentStream`（例如未收到 message_end）：把当前 `fullText` 写入助理气泡，并把 user/assistant 写入 `chatHistory`，再清空 `currentStream`、`activeStreamController`。 |

### 5.2 agent:eventError（app.js 约 1257–1263 行）

- 收到错误时：若有 `currentStream`，则把 `currentStream.assistantMsg.textContent` 设为错误文案（或 "请求失败"），并清空 `currentStream`、`activeStreamController`。

---

## 六、涉及文件与通道小结

| 层级 | 文件 | 关键点 |
|------|------|--------|
| 渲染进程 | `src/renderer/app.js` | 发送按钮/回车 → buildUserMessage → appendChatMessage(user) → sendMessageToAgent → creez.send("agent:prompt", ...)；creez.on("agent:event") / ("agent:eventError") 更新气泡与 chatHistory。 |
| 预加载 | `src/preload.js` | creez.send / creez.on 转发 IPC。 |
| 主进程 | `src/main.js` | agent:prompt：PROVIDER_CHAT_URL、fetch 流式、解析 SSE、emitAgentEvent(agent_start / message_start / message_update / message_end / agent_end)；agent:abort 取消请求。 |

---

## 七、数据流简图

```
[用户] 输入 + 附件/引用
    ↓
[Renderer] buildUserMessage → appendChatMessage(user) → sendMessageToAgent
    → currentStream = { assistantMsg, fullText: "", userContent }
    → ipcRenderer.send("agent:prompt", { provider, modelId, apiKey, messages })
    ↓
[Main] agent:prompt
    → agent_start
    → fetch(baseUrl/chat/completions, stream: true)
    → 每 chunk → message_start(仅首) + message_update
    → 流结束 → message_end → agent_end
    ↓ (ipcRenderer 收到 agent:event)
[Renderer] agent:event
    → message_update: 更新 currentStream.assistantMsg
    → message_end / agent_end: 写入 chatHistory，清空 currentStream
```

以上即为 Creez 中用户对话发送与处理的完整过程。

---

## 六、调试：如何查看大模型直接回复与报错

- **主进程（终端）**  
  - 开发时 `npm run dev` 的终端里会打印：  
    - `[Creez main] agent:prompt`：每次发送请求  
    - `[Creez agent-runner] event message_* role=...`：Pi 发出的 message 事件（含 role、是否有 content）  
    - `[Creez agent-runner] prompt error:` 或 `[Creez main] agent:prompt 错误:`：接口/模型报错（含错误信息与堆栈）

- **渲染进程（DevTools 控制台）**  
  - 在窗口按 **F12** 打开开发者工具，切到 Console：  
    - `[Creez] 发送对话:`：发出的用户内容  
    - `[Creez] agent:event`：收到的事件类型与 `role`  
    - `[Creez] 前端收到 message 事件:`：`message_update` / `message_end` 的结构（type、role、contentPreview）  
    - `[Creez] 模型回复(流式):` / `[Creez] 模型回复(完整):`：解析出的助理文本  
    - `[Creez] 跳过 message_*: ...`：因 role 或 currentStream 为 null 被跳过，可据此排查「无回复」  
    - `[Creez] agent:eventError`：主进程发来的错误（会同步显示在聊天气泡里）

- **关闭前端详细 dump**  
  - 在 `app.js` 里把 `DEBUG_DUMP_MESSAGE_EVENTS` 改为 `false` 可关闭「前端收到 message 事件」等详细日志。

---

## 七、如何打断点调试 (Debug)

### 渲染进程（前端：app.js、preload.js）

- 在 Creez 窗口按 **F12** 打开开发者工具。
- 切到 **Sources**（来源）面板，左侧用 **Page → top → …** 找到并打开 `src/renderer/app.js`（或你的脚本）。
- 在行号左侧点击即可下断点；或代码里写 `debugger;`，运行到该行会暂停。
- 刷新或重新发消息触发逻辑即可命中断点。

### 主进程（main.js、agent-runner.mjs）

1. **先以调试模式启动应用**  
   在项目根目录（Creez）下执行：
   ```bash
   npm run dev:debug
   ```
   会同时起 Vite 和带 `--inspect=9229` 的 Electron，主进程在 9229 端口等待调试器连接。

2. **在 Cursor/VS Code 里附加调试器**  
   - 打开 **运行和调试**（Run and Debug，或 Ctrl+Shift+D）。  
   - 在顶部下拉选 **「Creez: 附加到主进程 (Main)」**。  
   - 按 **F5** 或点绿色开始，即可附加到已运行的 Electron 主进程。

3. **下断点**  
   - 在左侧文件树打开 `src/main.js` 或 `src/agent-runner.mjs`，在行号左侧点击设断点。  
   - 或在代码里加 `debugger;`。  
   - 在应用里执行会触发主进程的操作（如发消息、保存配置），即可命中断点。

**提示**：若工作区打开的是 `LightOn/src` 而不是 `Creez`，请用「在终端中打开」到 `Creez` 目录再执行 `npm run dev:debug`，launch 配置中的 `${workspaceFolder}` 需能解析到包含 `src/main.js` 的目录（可在 `.vscode/launch.json` 里把 `localRoot` 改为实际 Creez 路径）。
