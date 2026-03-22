/**
 * Feishu channel adapter (phase 1):
 * - Receive events via Feishu SDK long connection (no public callback URL)
 * - Store inbound/outbound messages in local chats/messages tables
 * - Route to default bot agent, then send reply back to Feishu
 */

const { randomUUID, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const fsp = require("node:fs/promises");

const FEISHU_RESOURCE_BASE = "https://open.feishu.cn/open-apis/im/v1/messages";
const RESOURCE_DOWNLOAD_MS = 120_000;

const MIME_FROM_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function feishuUploadsDir() {
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "uploads");
}

async function saveFeishuInboundFile(buf, suggestedName) {
  const dir = feishuUploadsDir();
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

/**
 * Walk post (富文本) content JSON; collect plain text and resource keys.
 */
function collectFromPostContent(post) {
  const textParts = [];
  const imageKeys = [];
  const fileEntries = [];

  if (post.title) textParts.push(String(post.title));

  const rows = Array.isArray(post.content) ? post.content : [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const el of row) {
      if (!el || typeof el !== "object") continue;
      const tag = el.tag;
      if (tag === "text" && el.text) textParts.push(String(el.text));
      if (tag === "a") {
        const t = el.text ? String(el.text) : "";
        const href = el.href ? String(el.href) : "";
        textParts.push(href ? `[${t}](${href})` : t);
      }
      if (tag === "at") textParts.push(el.user_name ? String(el.user_name) : "");
      if (tag === "img" && el.image_key) imageKeys.push(String(el.image_key));
      if (tag === "media" && el.file_key) {
        fileEntries.push({ fileKey: String(el.file_key), fileName: "video.mp4" });
        if (el.image_key) imageKeys.push(String(el.image_key));
      }
    }
  }

  return {
    text: textParts.filter(Boolean).join("\n").trim(),
    imageKeys,
    fileEntries,
  };
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

const FEISHU_AUTH_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";

function feishuLog(message) {
  const line = `[${new Date().toISOString()}] [channel:feishu] ${message}`;
  console.log(line);
  try {
    const logDir = path.join(os.homedir(), ".creez", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "startup.log"), line + "\n", "utf8");
  } catch (_) {}
}
const FEISHU_MSG_URL = "https://open.feishu.cn/open-apis/im/v1/messages";
const FEISHU_WS_ENDPOINT = "https://open.feishu.cn/callback/ws/endpoint";

const FEISHU_WS_DEBUG = process.env.FEISHU_WS_DEBUG === "1" || process.env.FEISHU_WS_DEBUG === "true";

/**
 * Lark SDK bug: pullConnectConfig() only returns early for ErrorCode.system_busy === 1, but Feishu HTTP
 * returns e.g. 1000040345 ("system busy"). Code then falls through and reads ClientConfig.PingInterval
 * while ClientConfig is undefined → noisy error. Fix: any non-zero code or missing URL/ClientConfig → false.
 * @param {typeof import("@larksuiteoapi/node-sdk")} lark
 */
function patchLarkWsClientPullConnectConfig(lark) {
  const WSClient = lark.WSClient;
  if (!WSClient || WSClient.__creezPullConnectPatched) return;
  const querystring = require("node:querystring");
  WSClient.prototype.pullConnectConfig = function patchedPullConnectConfig() {
    return (async () => {
      const { appId, appSecret } = this.wsConfig.getClient();
      try {
        const body = await this.httpInstance.request({
          method: "post",
          url: this.wsConfig.wsConfigUrl,
          data: {
            AppID: appId,
            AppSecret: appSecret,
          },
          headers: {
            locale: "zh",
          },
          timeout: 15000,
        });
        const code = body && body.code;
        const data = body && body.data;
        const msg = body && body.msg;
        if (code !== 0) {
          this.logger.error("[ws]", `code: ${code}, ${msg || "system busy"}`);
          return false;
        }
        if (!data || !data.URL || !data.ClientConfig) {
          this.logger.error(
            "[ws]",
            "ws endpoint returned code 0 but missing URL or ClientConfig (cannot open long connection)"
          );
          return false;
        }
        const { URL, ClientConfig } = data;
        const urlStr = String(URL);
        const queryPart = urlStr.includes("?") ? urlStr.slice(urlStr.indexOf("?") + 1) : urlStr;
        const { device_id, service_id } = querystring.parse(queryPart);
        this.wsConfig.updateWs({
          connectUrl: URL,
          deviceId: device_id,
          serviceId: service_id,
          pingInterval: ClientConfig.PingInterval * 1000,
          reconnectCount: ClientConfig.ReconnectCount,
          reconnectInterval: ClientConfig.ReconnectInterval * 1000,
          reconnectNonce: ClientConfig.ReconnectNonce * 1000,
        });
        this.logger.debug("[ws]", `get connect config success, ws url: ${URL}`);
        return true;
      } catch (e) {
        this.logger.error("[ws]", (e && e.message) || "system busy");
        return false;
      }
    })();
  };
  WSClient.__creezPullConnectPatched = true;
}

/**
 * Wraps the default HTTP instance so we log Feishu's request_id from each response (for 飞书 log 排查).
 * SDK expects request() to return the response body (same as default).
 */
function createFeishuHttpInstanceWithRequestIdLog() {
  const axios = require("axios");
  const defaultInstance = axios.create();
  defaultInstance.defaults.headers = defaultInstance.defaults.headers || {};
  defaultInstance.defaults.headers["User-Agent"] = "oapi-node-sdk/1.0.0";
  return {
    request(config) {
      return defaultInstance
        .request({
          method: config.method || "get",
          url: config.url,
          data: config.data,
          headers: { locale: "zh", ...config.headers },
          timeout: config.timeout,
        })
        .then((res) => {
          const body = res.data || {};
          const requestId = body.request_id || res.headers?.["x-request-id"] || res.headers?.["request-id"];
          if (requestId) {
            feishuLog("Feishu request_id (飞书后台日志用): " + requestId + (body.code !== undefined && body.code !== 0 ? " code=" + body.code : ""));
          }
          return body;
        })
        .catch((err) => {
          const res = err.response;
          if (res) {
            const body = res.data || {};
            const requestId = body.request_id || res.headers?.["x-request-id"] || res.headers?.["request-id"];
            if (requestId) feishuLog("Feishu request_id (飞书后台日志用): " + requestId + " (request failed)");
          }
          throw err;
        });
    },
  };
}

class FeishuChannelAdapter {
  constructor() {
    this.channelType = "feishu";
    this.running = false;
    this._token = null;
    this._tokenExpiresAt = 0;
    this._config = null;
    this._botId = null;
    this._deps = null;
    this._wsClient = null;
    this._eventDispatcher = null;
  }

  async start({ config, botId, deps }) {
    this._config = config;
    this._botId = botId;
    this._deps = deps;
    this.running = true;
    const { appId, appSecret } = config;
    if (!appId || !appSecret) {
      feishuLog("missing appId/appSecret, adapter not started");
      return;
    }
    await this._startLongConnection();
    feishuLog("started for default bot " + botId);
  }

  async _startLongConnection() {
    const lark = require("@larksuiteoapi/node-sdk");
    patchLarkWsClientPullConnectConfig(lark);
    const { appId, appSecret, verificationToken = "", encryptKey = "" } = this._config;

    const logLevel = FEISHU_WS_DEBUG ? lark.LoggerLevel.DEBUG : lark.LoggerLevel.WARN;
    if (FEISHU_WS_DEBUG) {
      console.log("[channel:feishu] DEBUG mode: FEISHU_WS_DEBUG=1, probing ws endpoint and enabling SDK debug logs");
      await this._debugFetchWsEndpoint(appId, appSecret);
    }

    const dispatcher = new lark.EventDispatcher({
      verificationToken,
      encryptKey,
      loggerLevel: logLevel,
    });
    dispatcher.register({
      "im.message.receive_v1": async (data) => {
        try {
          await this._onFeishuMessageEvent(data);
        } catch (err) {
          console.error("[channel:feishu] event handler error:", err?.message || err);
        }
      },
    });
    this._eventDispatcher = dispatcher;

    const feishuHttpInstance = createFeishuHttpInstanceWithRequestIdLog();
    const wsClient = new lark.WSClient({
      appId,
      appSecret,
      domain: lark.Domain.FeiShu,
      loggerLevel: logLevel,
      autoReconnect: true,
      httpInstance: feishuHttpInstance,
    });
    try {
      await wsClient.start({ eventDispatcher: dispatcher });
      this._wsClient = wsClient;
      feishuLog("adapter start() done; WS connects in background (if you see [ws] code 1000040345, enable 长连接 in Feishu console or retry later)");
    } catch (err) {
      const msg = err?.message || String(err);
      feishuLog("long connection failed: " + msg);
      console.error("[channel:feishu] long connection failed:", msg);
      if (
        msg.includes("PingInterval") ||
        msg.includes("1000040345") ||
        msg.includes("system busy")
      ) {
        console.warn(
          "[channel:feishu] Tip: Enable long connection in Feishu Developer Console: 事件与回调 → 长连接. " +
            "Code 1000040345 / system busy often means the app is not allowed for long connection (e.g. only 自建应用 supported) or Feishu server is busy."
        );
      }
      this._wsClient = null;
      throw err;
    }
  }

  /**
   * Debug only: POST to Feishu ws endpoint and log response (no secrets).
   * Run with FEISHU_WS_DEBUG=1 to see why pullConnectConfig might fail.
   */
  async _debugFetchWsEndpoint(appId, appSecret) {
    try {
      const res = await fetch(FEISHU_WS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", locale: "zh" },
        body: JSON.stringify({ AppID: appId, AppSecret: appSecret }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json().catch(() => ({}));
      const data = body.data || {};
      console.log("[channel:feishu] DEBUG ws endpoint response:", {
        httpStatus: res.status,
        code: body.code,
        msg: body.msg,
        hasData: !!body.data,
        hasURL: !!data.URL,
        hasClientConfig: !!data.ClientConfig,
        clientConfigKeys: data.ClientConfig ? Object.keys(data.ClientConfig) : [],
      });
    } catch (e) {
      console.warn("[channel:feishu] DEBUG ws endpoint fetch failed:", e?.message || e);
    }
  }

  async _downloadFeishuMessageResource(messageId, fileKey, resourceType) {
    const token = await this._getToken();
    if (!token) throw new Error("no tenant_access_token");
    const enc = encodeURIComponent(fileKey);
    const url = `${FEISHU_RESOURCE_BASE}/${encodeURIComponent(messageId)}/resources/${enc}?type=${resourceType}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(RESOURCE_DOWNLOAD_MS),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Feishu resource HTTP ${res.status} ${errBody.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async _onFeishuMessageEvent(data) {
    const senderType = String(data?.sender?.sender_type || "").toLowerCase();
    if (senderType && senderType !== "user") return;
    const message = data?.message || {};
    const msgType = String(message.message_type || message.msg_type || "").toLowerCase();
    const feishuMsgId = message.message_id;
    const feishuChatId = message.chat_id;
    if (!feishuMsgId || !feishuChatId) return;

    let rawContent = {};
    try {
      rawContent = message.content ? JSON.parse(message.content) : {};
    } catch {
      rawContent = {};
    }

    const textParts = [];
    const images = [];
    const attachmentPaths = [];

    if (msgType === "text") {
      const t = String(rawContent.text || "").trim();
      if (t) textParts.push(t);
    } else if (msgType === "image" && rawContent.image_key) {
      try {
        const buf = await this._downloadFeishuMessageResource(feishuMsgId, rawContent.image_key, "image");
        const savedPath = await saveFeishuInboundFile(buf, "image.png");
        attachmentPaths.push(`[Image: ##${savedPath}##]`);
        images.push({
          type: "image",
          data: buf.toString("base64"),
          mimeType: mimeFromFilename(savedPath),
        });
      } catch (err) {
        feishuLog("image resource download failed: " + (err?.message || String(err)));
        textParts.push("[用户发送了一张图片]");
      }
    } else if (msgType === "file") {
      const fk = rawContent.file_key;
      const fn = rawContent.file_name ? String(rawContent.file_name) : "file.bin";
      if (fk) {
        try {
          const buf = await this._downloadFeishuMessageResource(feishuMsgId, fk, "file");
          const savedPath = await saveFeishuInboundFile(buf, fn);
          attachmentPaths.push(`[File: ##${savedPath}##]`);
        } catch (err) {
          feishuLog("file resource download failed: " + (err?.message || String(err)));
          textParts.push(`[用户发送了文件: ${fn}]`);
        }
      }
    } else if (msgType === "audio" && rawContent.file_key) {
      const fn = `audio_${Date.now()}.mp3`;
      try {
        const buf = await this._downloadFeishuMessageResource(feishuMsgId, rawContent.file_key, "file");
        const savedPath = await saveFeishuInboundFile(buf, fn);
        attachmentPaths.push(`[File: ##${savedPath}##]`);
      } catch (err) {
        feishuLog("audio resource download failed: " + (err?.message || String(err)));
        textParts.push("[用户发送了一条语音]");
      }
    } else if (msgType === "media" && rawContent.file_key) {
      const fn = rawContent.file_name ? String(rawContent.file_name) : "video.mp4";
      try {
        const buf = await this._downloadFeishuMessageResource(feishuMsgId, rawContent.file_key, "file");
        const savedPath = await saveFeishuInboundFile(buf, fn);
        attachmentPaths.push(`[File: ##${savedPath}##]`);
      } catch (err) {
        feishuLog("video resource download failed: " + (err?.message || String(err)));
        textParts.push(`[用户发送了视频: ${fn}]`);
      }
    } else if (msgType === "post") {
      const collected = collectFromPostContent(rawContent);
      if (collected.text) textParts.push(collected.text);
      for (const ik of collected.imageKeys) {
        try {
          const buf = await this._downloadFeishuMessageResource(feishuMsgId, ik, "image");
          const savedPath = await saveFeishuInboundFile(buf, "image.png");
          attachmentPaths.push(`[Image: ##${savedPath}##]`);
          images.push({
            type: "image",
            data: buf.toString("base64"),
            mimeType: mimeFromFilename(savedPath),
          });
        } catch (err) {
          feishuLog("post image download failed: " + (err?.message || String(err)));
          textParts.push("[图片]");
        }
      }
      for (const fe of collected.fileEntries) {
        try {
          const buf = await this._downloadFeishuMessageResource(feishuMsgId, fe.fileKey, "file");
          const savedPath = await saveFeishuInboundFile(buf, fe.fileName);
          attachmentPaths.push(`[File: ##${savedPath}##]`);
        } catch (err) {
          feishuLog("post media download failed: " + (err?.message || String(err)));
          textParts.push("[附件]");
        }
      }
    } else if (msgType === "sticker") {
      textParts.push("[用户发送了表情]");
    } else {
      return;
    }

    const text = textParts.filter(Boolean).join("\n");
    const contentLines = [];
    if (text) contentLines.push(text);
    contentLines.push(...attachmentPaths);
    const content = contentLines.join("\n");
    if (!content.trim() && images.length === 0) return;

    await this._onFeishuMessage(feishuChatId, feishuMsgId, content, images);
  }

  async _onFeishuMessage(feishuChatId, feishuMsgId, content, images) {
    const { chatRepository } = this._deps;
    const defaultBotId = this._botId;

    const existing = chatRepository.db
      .prepare("SELECT id FROM messages WHERE channel_message_id = ? LIMIT 1")
      .get(feishuMsgId);
    if (existing) return;

    const { chatId } = chatRepository.getOrCreateMainChatForContact({
      contactId: defaultBotId,
    });

    const nowTs = Math.floor(Date.now() / 1000);
    const userMsgId = randomUUID();
    chatRepository.appendMessage({
      id: userMsgId,
      chatId,
      sender: "user",
      content,
      status: "done",
      createdAt: nowTs,
      updatedAt: nowTs,
      channelType: "feishu",
      channelMessageId: feishuMsgId,
    });

    this._notifyRenderer("channel:newMessage", { chatId, channelType: "feishu" });

    const reply = await this._getAgentReply(chatId, content, images || []);
    const replyText = reply && typeof reply === "object" ? reply.content : reply;
    if (replyText != null && replyText !== "") {
      const replyMsgId = randomUUID();
      const toolCalls = reply && typeof reply === "object" && Array.isArray(reply.toolCalls) && reply.toolCalls.length > 0
        ? reply.toolCalls
        : undefined;
      chatRepository.appendMessage({
        id: replyMsgId,
        chatId,
        sender: "assistant",
        botId: defaultBotId,
        content: replyText,
        status: "done",
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        channelType: "feishu",
        ...(toolCalls ? { toolCalls } : {}),
      });
      await this.sendReply(feishuChatId, replyText);
      this._notifyRenderer("channel:newMessage", { chatId, channelType: "feishu" });
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
      feishuLog("workspace dir create failed: " + (e?.message || String(e)));
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
    const listenerId = `feishu:${chatId}:${Date.now()}`;

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

  /**
   * Send outbound to the target configured in channel config (FEISHU_OPEN_ID).
   * Standard adapter interface used by ChannelManager.sendMessage.
   */
  async sendOutbound(content) {
    const openId = this._config?.openId;
    if (!openId) {
      return { ok: false, error: "FEISHU_OPEN_ID not configured. Set it in Advanced Settings → Channel → Feishu." };
    }
    return this.sendMessage(openId, content, "open_id");
  }

  async sendReply(feishuChatId, text) {
    return this.sendMessage(feishuChatId, text, "chat_id");
  }

  async sendMessage(receiveId, text, receiveIdType = "chat_id") {
    const token = await this._getToken();
    if (!token) {
      console.error("[channel:feishu] no token, cannot send");
      return { ok: false, error: "token failed" };
    }
    const url = `${FEISHU_MSG_URL}?receive_id_type=${receiveIdType}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.code !== 0) {
      console.error("[channel:feishu] send failed:", result.msg || res.status);
      return { ok: false, error: result.msg || String(res.status) };
    }
    return { ok: true, message_id: result.data?.message_id };
  }

  async _getToken() {
    if (this._token && Date.now() < this._tokenExpiresAt - 60_000) {
      return this._token;
    }
    const { appId, appSecret } = this._config || {};
    if (!appId || !appSecret) return null;
    const res = await fetch(FEISHU_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.code !== 0 || !data.tenant_access_token) return null;
    this._token = data.tenant_access_token;
    this._tokenExpiresAt = Date.now() + (data.expire || 7200) * 1000;
    return this._token;
  }

  async stop() {
    this.running = false;
    if (this._wsClient) {
      this._wsClient.close({ force: false });
      this._wsClient = null;
    }
    this._eventDispatcher = null;
    this._token = null;
    console.log("[channel:feishu] stopped");
  }
}

module.exports = { FeishuChannelAdapter };
