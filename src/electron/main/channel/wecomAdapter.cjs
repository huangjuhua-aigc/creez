/**
 * WeCom (企业微信) channel adapter:
 * - Receive messages via @wecom/aibot-node-sdk WebSocket persistent connection
 * - Store inbound/outbound messages in local chats/messages tables
 * - Route to default bot agent, then send reply back to WeCom
 *
 * SDK: @wecom/aibot-node-sdk (WSClient, WebSocket long connection)
 * Reference: https://github.com/WecomTeam/wecom-openclaw-plugin
 */

const { randomUUID, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const fsp = require("node:fs/promises");

const MIME_FROM_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function wecomUploadsDir() {
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "uploads");
}

async function saveWecomInboundFile(buf, suggestedName) {
  const dir = wecomUploadsDir();
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(suggestedName) || "";
  const stem = path.basename(suggestedName, ext) || "file";
  const unique = `${Date.now()}-${randomBytes(4).toString("hex")}-${stem}${ext}`;
  const fullPath = path.join(dir, unique);
  await fsp.writeFile(fullPath, buf);
  return fullPath;
}

function mimeFromFilename(name) {
  const ext = path.extname(name || "").toLowerCase();
  return MIME_FROM_EXT[ext] || "application/octet-stream";
}

function resolveWorkDir(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const home = os.homedir();
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) {
    return path.join(home, s.slice(1).replace(/\//g, path.sep));
  }
  return path.resolve(s);
}

const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".creez", "workplace");

function wecomLog(message) {
  const line = `[${new Date().toISOString()}] [channel:wecom] ${message}`;
  console.log(line);
  try {
    const logDir = path.join(os.homedir(), ".creez", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "startup.log"), line + "\n", "utf8");
  } catch (_) {}
}

class WeComChannelAdapter {
  constructor() {
    this.channelType = "wecom";
    this.running = false;
    this._config = null;
    this._botId = null;
    this._deps = null;
    this._wsClient = null;
    this._lastChatId = null;
    this._lastFrame = null;
  }

  async start({ config, botId, deps }) {
    this._config = config;
    this._botId = botId;
    this._deps = deps;
    this.running = true;
    const { botId: wecomBotId, secret } = config;
    if (!wecomBotId || !secret) {
      wecomLog("missing botId/secret, adapter not started");
      return;
    }
    await this._startWebSocket();
    wecomLog("started for bot " + botId);
  }

  async _startWebSocket() {
    const { botId: wecomBotId, secret } = this._config;

    let AiBot;
    try {
      AiBot = require("@wecom/aibot-node-sdk");
    } catch (err) {
      wecomLog("failed to require @wecom/aibot-node-sdk: " + (err?.message || String(err)));
      throw err;
    }

    const WSClient = AiBot.WSClient || AiBot.default?.WSClient;
    const genReqId = AiBot.generateReqId || AiBot.default?.generateReqId;
    if (!WSClient) {
      throw new Error("WSClient not found in @wecom/aibot-node-sdk exports");
    }
    this._generateReqId = genReqId || (() => `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    const wsClient = new WSClient({
      botId: wecomBotId,
      secret,
      logger: {
        debug(msg, ...args) {
          if (typeof msg === "string" && /heartbeat/i.test(msg)) return;
          wecomLog("[DEBUG] " + msg);
        },
        info(msg, ...args) {
          wecomLog("[INFO] " + msg);
        },
        warn(msg, ...args) {
          console.warn("[channel:wecom]", msg, ...args);
        },
        error(msg, ...args) {
          console.error("[channel:wecom]", msg, ...args);
        },
      },
    });

    wsClient.on("connected", () => {
      wecomLog("WebSocket connected");
    });

    wsClient.on("authenticated", () => {
      wecomLog("authentication successful");
    });

    wsClient.on("disconnected", (reason) => {
      wecomLog("WebSocket disconnected: " + (reason || "unknown"));
    });

    wsClient.on("reconnecting", (attempt) => {
      wecomLog("reconnecting attempt " + attempt);
    });

    wsClient.on("error", (error) => {
      wecomLog("WebSocket error: " + (error?.message || String(error)));
    });

    wsClient.on("message", async (frame) => {
      try {
        await this._onWecomMessageEvent(frame);
      } catch (err) {
        console.error("[channel:wecom] message handler error:", err?.message || err);
      }
    });

    try {
      wsClient.connect();
      this._wsClient = wsClient;
      wecomLog("WSClient.connect() called; connection establishing in background");
    } catch (err) {
      const msg = err?.message || String(err);
      wecomLog("WebSocket connect failed: " + msg);
      console.error("[channel:wecom] WebSocket connect failed:", msg);
      this._wsClient = null;
      throw err;
    }
  }

  async _onWecomMessageEvent(frame) {
    const body = frame?.body;
    if (!body) return;

    const chatId = body.chatid || body.from?.userid;
    const msgId = body.msgid;
    if (!chatId || !msgId) return;

    const msgType = String(body.msgtype || "").toLowerCase();
    const textParts = [];
    const images = [];
    const attachmentPaths = [];

    const stripGroupMentions = (s) =>
      body.chattype === "group" ? String(s || "").replace(/@\S+/g, "").trim() : String(s || "").trim();

    if (msgType === "text") {
      textParts.push(stripGroupMentions(body.text?.content || ""));
    } else if (msgType === "voice" && body.voice?.content) {
      textParts.push(stripGroupMentions(body.voice.content));
    } else if (msgType === "image" && body.image?.url && this._wsClient?.downloadFile) {
      try {
        const { buffer, filename } = await this._wsClient.downloadFile(body.image.url, body.image.aeskey);
        const name = filename && String(filename).trim() ? filename : "image.jpg";
        const savedPath = await saveWecomInboundFile(buffer, name);
        attachmentPaths.push(`[Image: ##${savedPath}##]`);
        images.push({
          type: "image",
          data: buffer.toString("base64"),
          mimeType: mimeFromFilename(name),
        });
      } catch (err) {
        wecomLog("image download failed: " + (err?.message || String(err)));
        textParts.push("[用户发送了一张图片]");
      }
    } else if (msgType === "file" && body.file?.url && this._wsClient?.downloadFile) {
      try {
        const { buffer, filename } = await this._wsClient.downloadFile(body.file.url, body.file.aeskey);
        const name = filename && String(filename).trim() ? filename : "file.bin";
        const savedPath = await saveWecomInboundFile(buffer, name);
        attachmentPaths.push(`[File: ##${savedPath}##]`);
      } catch (err) {
        wecomLog("file download failed: " + (err?.message || String(err)));
        textParts.push("[用户发送了一个文件]");
      }
    } else if (msgType === "mixed" && Array.isArray(body.mixed?.msg_item)) {
      for (const item of body.mixed.msg_item) {
        const mt = String(item?.msgtype || "").toLowerCase();
        if (mt === "text" && item.text?.content) {
          textParts.push(stripGroupMentions(item.text.content));
        } else if (mt === "image" && item.image?.url && this._wsClient?.downloadFile) {
          try {
            const { buffer, filename } = await this._wsClient.downloadFile(item.image.url, item.image.aeskey);
            const name = filename && String(filename).trim() ? filename : "image.jpg";
            const savedPath = await saveWecomInboundFile(buffer, name);
            attachmentPaths.push(`[Image: ##${savedPath}##]`);
            images.push({
              type: "image",
              data: buffer.toString("base64"),
              mimeType: mimeFromFilename(name),
            });
          } catch (err) {
            wecomLog("mixed image download failed: " + (err?.message || String(err)));
            textParts.push("[图片]");
          }
        }
      }
    } else if (body.content) {
      let text = "";
      try {
        const parsed = typeof body.content === "string" ? JSON.parse(body.content) : body.content;
        text = String(parsed.text || parsed.content || "").trim();
      } catch {
        text = String(body.content).trim();
      }
      if (text) textParts.push(stripGroupMentions(text));
    }

    const text = textParts.filter(Boolean).join(" ");
    const contentLines = [];
    if (text) contentLines.push(text);
    contentLines.push(...attachmentPaths);
    const content = contentLines.join("\n");

    if (!content.trim() && images.length === 0) return;

    this._lastChatId = chatId;
    this._lastFrame = frame;

    await this._onWecomMessage(chatId, msgId, content, images, frame);
  }

  _isDefaultBot() {
    const { contactRepository } = this._deps;
    const defaultId = contactRepository?.getDefaultAssistantConfigId?.() ?? "11111111-1111-1111-1111-111111111111";
    return String(this._botId) === String(defaultId);
  }

  async _onWecomMessage(wecomChatId, wecomMsgId, content, images, frame) {
    if (this._isDefaultBot()) {
      await this._handleDefaultBotMessage(wecomChatId, wecomMsgId, content, images, frame);
    } else {
      await this._handleExternalBotMessage(wecomChatId, wecomMsgId, content, images, frame);
    }
  }

  async _handleDefaultBotMessage(wecomChatId, wecomMsgId, content, images, frame) {
    const { chatRepository } = this._deps;
    const defaultBotId = this._botId;

    const existing = chatRepository.db
      .prepare("SELECT id FROM messages WHERE channel_message_id = ? LIMIT 1")
      .get(wecomMsgId);
    if (existing) return;

    const { chatId } = chatRepository.getOrCreateMainChatForContact({
      contactId: defaultBotId,
    });

    const nowTs = Math.floor(Date.now() / 1000);
    chatRepository.appendMessage({
      id: randomUUID(),
      chatId,
      sender: "user",
      content,
      status: "done",
      createdAt: nowTs,
      updatedAt: nowTs,
      channelType: "wecom",
      channelMessageId: wecomMsgId,
    });

    this._notifyRenderer("channel:newMessage", { chatId, channelType: "wecom" });

    const reply = await this._getAgentReply(chatId, content, images || []);
    const replyText = reply && typeof reply === "object" ? reply.content : reply;
    if (replyText != null && replyText !== "") {
      const toolCalls = reply && typeof reply === "object" && Array.isArray(reply.toolCalls) && reply.toolCalls.length > 0
        ? reply.toolCalls
        : undefined;
      chatRepository.appendMessage({
        id: randomUUID(),
        chatId,
        sender: "assistant",
        botId: defaultBotId,
        content: replyText,
        status: "done",
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        channelType: "wecom",
        ...(toolCalls ? { toolCalls } : {}),
      });
      await this._sendReply(frame, replyText);
      this._notifyRenderer("channel:newMessage", { chatId, channelType: "wecom" });
    }
  }

  async _handleExternalBotMessage(wecomChatId, wecomMsgId, content, images, frame) {
    const { chatRepository } = this._deps;
    const botId = this._botId;

    const existing = chatRepository.db
      .prepare("SELECT id FROM messages WHERE channel_message_id = ? LIMIT 1")
      .get(wecomMsgId);
    if (existing) return;

    const { chatId } = chatRepository.getOrCreateChatForChannel({
      contactId: botId,
      channelType: "wecom",
      channelChatId: wecomChatId,
    });

    const nowTs = Math.floor(Date.now() / 1000);
    chatRepository.appendMessage({
      id: randomUUID(),
      chatId,
      sender: "user",
      content,
      status: "done",
      createdAt: nowTs,
      updatedAt: nowTs,
      channelType: "wecom",
      channelMessageId: wecomMsgId,
    });

    const sessionKey = `${botId}:wecom:${wecomChatId}`;
    const reply = await this._getExternalAgentReply(sessionKey, chatId, content, images || []);
    const replyText = reply && typeof reply === "object" ? reply.content : reply;
    if (replyText != null && replyText !== "") {
      chatRepository.appendMessage({
        id: randomUUID(),
        chatId,
        sender: "assistant",
        botId,
        content: replyText,
        status: "done",
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        channelType: "wecom",
      });
      await this._sendReply(frame, replyText);
    }

    if (this._deps.sessionTracker) {
      this._deps.sessionTracker.touch({
        sessionKey,
        botId,
        channelType: "wecom",
        externalChatId: wecomChatId,
        chatId,
      });
    }
  }

  async _sendReply(frame, text) {
    if (!this._wsClient) {
      wecomLog("no WSClient, cannot send reply");
      return { ok: false, error: "WSClient not connected" };
    }
    try {
      const streamId = this._generateReqId("stream");
      await this._wsClient.replyStream(frame, streamId, text, true);
      return { ok: true };
    } catch (err) {
      wecomLog("replyStream failed: " + (err?.message || String(err)));
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /**
   * Send outbound message via WSClient.sendMessage.
   * Uses the last known chatId from an inbound message as the target.
   */
  async sendOutbound(content) {
    if (!this._wsClient) {
      return { ok: false, error: "WeCom WSClient not connected." };
    }
    const targetChatId = this._lastChatId;
    if (!targetChatId) {
      return { ok: false, error: "No WeCom chat available. A message must be received from WeCom first before sending outbound." };
    }
    try {
      const result = await this._wsClient.sendMessage(targetChatId, {
        msgtype: "markdown",
        markdown: { content },
      });
      const messageId = result?.headers?.req_id || `wecom-${Date.now()}`;
      return { ok: true, message_id: messageId };
    } catch (err) {
      wecomLog("sendMessage failed: " + (err?.message || String(err)));
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async _ensureBotSession(chatId) {
    const { getEngineForContact } = require("../conversation/engineRegistry.cjs");
    const { getRunner } = require("../conversation/PiConversationEngine.cjs");
    const { contactRepository, assistantConfigRepository, chatRepository } = this._deps;
    const { engine, rawConfig, assistantConfigId, defaultContactId } = getEngineForContact(this._botId, {
      contactRepository,
      assistantConfigRepository,
    });

    const runner = await getRunner();
    if (runner.hasSession(this._botId)) {
      return engine;
    }

    const models = Array.isArray(rawConfig?.models) ? rawConfig.models : [];
    const activeModel = models.find((m) => m && m.active) || models[0];
    if (!activeModel?.provider || !activeModel?.model) return null;
    let apiKey = (activeModel.apiKey && String(activeModel.apiKey).trim()) || "";
    if (!apiKey && assistantConfigRepository?.getModelApiKeyFromConfig) {
      apiKey = assistantConfigRepository.getModelApiKeyFromConfig(assistantConfigId, activeModel.id) || "";
    }
    if (!apiKey) return null;

    const appStateStore = this._deps.appStateStore;
    const appState = appStateStore ? await appStateStore.getState() : {};
    const rawRoot = appState?.workspaceRoot ?? null;
    const workDir = resolveWorkDir(rawRoot) || DEFAULT_WORKSPACE_ROOT;
    try {
      await fsp.mkdir(workDir, { recursive: true });
    } catch (e) {
      wecomLog("workspace dir create failed: " + (e?.message || String(e)));
    }
    const agentDir = path.join(os.homedir(), ".creez");

    const historyRows = chatRepository.getMessages({ chatId, limit: 50 });
    const memoryContent = (historyRows?.items || [])
      .map((m) => `${m.sender === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    await engine.init({
      chatId,
      contactId: this._botId,
      assistantConfigId,
      defaultContactId,
      assistantConfig: rawConfig,
      provider: activeModel.provider,
      modelId: activeModel.model,
      apiKey,
      workDir,
      agentDir,
      memoryContent,
      memoryPath: "",
      sendEvent: () => {},
      sendError: () => {},
    });
    return engine;
  }

  async _getAgentReply(chatId, text, images = []) {
    const engine = await this._ensureBotSession(chatId);
    if (!engine) return null;

    const { getRunner } = require("../conversation/PiConversationEngine.cjs");
    const runner = await getRunner();

    let replyContent = "";
    const toolCallsMap = new Map();
    const listenerId = `wecom:${chatId}:${Date.now()}`;

    const collector = {
      send(channel, data) {
        if (channel === "agent:eventError") return;
        if (data.type === "tool_call" || data.type === "tool_result") {
          const toolName = data.toolName || data.message?.toolName || "";
          const toolCallId = data.toolCallId || data.message?.toolCallId || "";
          if (!toolName) return;
          const id = toolCallId || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const hasResult = data.result !== undefined || data.isError;
          if (hasResult) {
            const status = data.isError ? "failure" : "success";
            const result = data.result !== undefined
              ? (typeof data.result === "string" ? data.result : JSON.stringify(data.result))
              : (data.message?.errorMessage || "");
            const existing = toolCallsMap.get(id);
            if (existing) { existing.status = status; existing.result = result; }
            else toolCallsMap.set(id, { id, toolName, parameters: {}, status, result });
          } else {
            const args = data.args && typeof data.args === "object" ? data.args : {};
            const existing = toolCallsMap.get(id);
            if (existing) { if (Object.keys(args).length > 0) existing.parameters = args; }
            else toolCallsMap.set(id, { id, toolName, parameters: args, status: "running" });
          }
          return;
        }
        if (data.type === "message_end" && data.message?.content) {
          const c = data.message.content;
          replyContent = typeof c === "string" ? c : (Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join("") : "");
        }
      },
      isDestroyed() { return false; },
    };

    runner.addListener(this._botId, listenerId, collector);
    try {
      await engine.prompt({ chatId: this._botId, text, images: images || [] });
    } finally {
      runner.removeListener(this._botId, listenerId);
    }

    const toolCalls = Array.from(toolCallsMap.values());
    return { content: replyContent || null, toolCalls };
  }

  async _ensureExternalBotSession(sessionKey, chatId) {
    const { resolveChannelBotConfig, resolveModelApiKey } = require("./channelBotConfig.cjs");
    const { getRunner } = require("../conversation/PiConversationEngine.cjs");
    const { contactRepository, assistantConfigRepository, chatRepository } = this._deps;
    const { engine, rawConfig, assistantConfigId, defaultContactId } = await resolveChannelBotConfig(this._botId, {
      contactRepository,
      assistantConfigRepository,
    });

    const runner = await getRunner();
    if (runner.hasSession(sessionKey)) {
      return engine;
    }

    const models = Array.isArray(rawConfig?.models) ? rawConfig.models : [];
    const activeModel = models.find((m) => m && m.active) || models[0];
    if (!activeModel?.provider || !activeModel?.model) return null;
    const apiKey = resolveModelApiKey({
      assistantConfigRepository,
      assistantConfigId,
      defaultContactId,
      activeModel,
    });
    if (!apiKey) return null;

    const appStateStore = this._deps.appStateStore;
    const appState = appStateStore ? await appStateStore.getState() : {};
    const rawRoot = appState?.workspaceRoot ?? null;
    const workDir = resolveWorkDir(rawRoot) || DEFAULT_WORKSPACE_ROOT;
    try {
      await fsp.mkdir(workDir, { recursive: true });
    } catch (e) {
      wecomLog("workspace dir create failed: " + (e?.message || String(e)));
    }
    const agentDir = path.join(os.homedir(), ".creez");

    const historyRows = chatRepository.getMessages({ chatId, limit: 50 });
    const memoryContent = (historyRows?.items || [])
      .map((m) => `${m.sender === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    await engine.init({
      chatId: sessionKey,
      sessionKey,
      contactId: this._botId,
      assistantConfigId,
      defaultContactId,
      assistantConfig: rawConfig,
      provider: activeModel.provider,
      modelId: activeModel.model,
      apiKey,
      workDir,
      agentDir,
      memoryContent,
      memoryPath: "",
      sendEvent: () => {},
      sendError: () => {},
    });
    return engine;
  }

  async _getExternalAgentReply(sessionKey, chatId, text, images = []) {
    const engine = await this._ensureExternalBotSession(sessionKey, chatId);
    if (!engine) return null;

    const { getRunner } = require("../conversation/PiConversationEngine.cjs");
    const runner = await getRunner();

    let replyContent = "";
    const listenerId = `wecom-ext:${sessionKey}:${Date.now()}`;

    const collector = {
      send(channel, data) {
        if (channel === "agent:eventError") return;
        if (data.type === "message_end" && data.message?.content) {
          const c = data.message.content;
          replyContent = typeof c === "string" ? c : (Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join("") : "");
        }
      },
      isDestroyed() { return false; },
    };

    runner.addListener(sessionKey, listenerId, collector);
    try {
      await engine.prompt({ chatId: sessionKey, text, images: images || [] });
    } finally {
      runner.removeListener(sessionKey, listenerId);
    }

    return { content: replyContent || null };
  }

  _notifyRenderer(channel, data) {
    try {
      const { BrowserWindow } = require("electron");
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send(channel, data);
        }
      }
    } catch {
      // ignore
    }
  }

  async stop() {
    this.running = false;
    if (this._wsClient) {
      try {
        this._wsClient.disconnect();
      } catch (_) {}
      this._wsClient = null;
    }
    this._lastChatId = null;
    this._lastFrame = null;
    console.log("[channel:wecom] stopped");
  }
}

module.exports = { WeComChannelAdapter };
