/**
 * WeChat Personal channel adapter (via ilink HTTP API):
 * - QR-code login against ilinkai.weixin.qq.com
 * - Long-poll getupdates for inbound messages
 * - sendmessage for outbound replies
 * - Stores token + accountId in ~/.creez/weixin-personal/
 *
 * Protocol reference: @tencent-weixin/openclaw-weixin (MIT)
 */

const { randomUUID } = require("node:crypto");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const fsp = require("node:fs/promises");

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const BOT_TYPE = "3";
const QR_POLL_TIMEOUT_MS = 35_000;
const LONG_POLL_TIMEOUT_MS = 40_000;
const API_TIMEOUT_MS = 15_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const RETRY_DELAY_MS = 3_000;
const SESSION_EXPIRED_ERRCODE = -14;

const STATE_DIR = path.join(os.homedir(), ".creez", "weixin-personal");
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".creez", "workplace");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wxLog(message) {
  const line = `[${new Date().toISOString()}] [channel:weixin_personal] ${message}`;
  console.log(line);
  try {
    const logDir = path.join(os.homedir(), ".creez", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "startup.log"), line + "\n", "utf8");
  } catch (_) {}
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

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildHeaders(token) {
  const headers = {
    "Content-Type": "application/json",
    "AuthorizationType": "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ---------------------------------------------------------------------------
// Persistent state (token, accountId, get_updates_buf)
// ---------------------------------------------------------------------------

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function loadCredentials() {
  try {
    const p = path.join(STATE_DIR, "credentials.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return null; }
}

function saveCredentials(data) {
  ensureStateDir();
  fs.writeFileSync(path.join(STATE_DIR, "credentials.json"), JSON.stringify(data, null, 2), "utf-8");
}

function loadSyncBuf() {
  try {
    const p = path.join(STATE_DIR, "sync_buf.txt");
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf-8");
  } catch { return ""; }
}

function saveSyncBuf(buf) {
  ensureStateDir();
  fs.writeFileSync(path.join(STATE_DIR, "sync_buf.txt"), buf || "", "utf-8");
}

// ---------------------------------------------------------------------------
// ilink HTTP API — uses Electron net.fetch (Chromium network stack)
// so that DNS, proxy, and TLS behave the same as the browser.
// ---------------------------------------------------------------------------

function getNetFetch() {
  const { net } = require("electron");
  return net.fetch.bind(net);
}

async function ilinkFetch({ baseUrl, endpoint, body, token, timeoutMs, label }) {
  const netFetch = getNetFetch();
  const base = ensureTrailingSlash(baseUrl || ILINK_BASE_URL);
  const url = new URL(endpoint, base).toString();
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  const headers = buildHeaders(token);

  wxLog(`${label}: POST ${url} bodyLen=${bodyStr.length} hasToken=${Boolean(token)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || API_TIMEOUT_MS);
  try {
    const res = await netFetch(url, { method: "POST", headers, body: bodyStr, signal: controller.signal });
    clearTimeout(timer);
    const rawText = await res.text();
    wxLog(`${label}: response status=${res.status} bodyLen=${rawText.length}`);
    if (!res.ok) throw new Error(`${label} ${res.status}: ${rawText}`);
    return JSON.parse(rawText);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      wxLog(`${label}: client-side timeout after ${timeoutMs}ms`);
      return null;
    }
    wxLog(`${label}: error name=${err.name} message=${err.message} code=${err.code || ""}`);
    throw err;
  }
}

async function fetchQrCode(baseUrl) {
  const netFetch = getNetFetch();
  const base = ensureTrailingSlash(baseUrl || ILINK_BASE_URL);
  const url = `${base}ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`;
  wxLog("fetchQrCode: GET " + url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await netFetch(url, {
      headers: { "User-Agent": "Creez/1.0", "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await res.text();
    wxLog("fetchQrCode: status=" + res.status + " bodyLen=" + rawText.length);
    if (!res.ok) throw new Error(`QR fetch failed: ${res.status} ${res.statusText} body=${rawText.substring(0, 200)}`);
    return JSON.parse(rawText);
  } catch (fetchErr) {
    clearTimeout(timer);
    const code = fetchErr?.cause?.code || fetchErr?.code || "";
    const msg = fetchErr?.message || String(fetchErr);
    wxLog(`fetchQrCode: failed: ${msg} (code=${code})`);
    throw fetchErr;
  }
}

async function pollQrStatus(baseUrl, qrcode) {
  const netFetch = getNetFetch();
  const base = ensureTrailingSlash(baseUrl || ILINK_BASE_URL);
  const url = `${base}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT_MS);
  try {
    const res = await netFetch(url, { headers: { "iLink-App-ClientVersion": "1" }, signal: controller.signal });
    clearTimeout(timer);
    const rawText = await res.text();
    if (!res.ok) throw new Error(`QR status poll ${res.status}: ${rawText}`);
    return JSON.parse(rawText);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") return { status: "wait" };
    throw err;
  }
}

async function ilinkGetUpdates({ baseUrl, token, getUpdatesBuf, timeoutMs }) {
  const result = await ilinkFetch({
    baseUrl,
    endpoint: "ilink/bot/getupdates",
    body: { get_updates_buf: getUpdatesBuf || "" },
    token,
    timeoutMs: timeoutMs || LONG_POLL_TIMEOUT_MS,
    label: "getUpdates",
  });
  if (!result) return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
  return result;
}

async function ilinkSendMessage({ baseUrl, token, to, text, contextToken }) {
  const clientId = `creez-wx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: text ? [{ type: 1, text_item: { text } }] : [],
      context_token: contextToken || undefined,
    },
  };
  await ilinkFetch({ baseUrl, endpoint: "ilink/bot/sendmessage", body, token, timeoutMs: API_TIMEOUT_MS, label: "sendMessage" });
  return { ok: true, messageId: clientId };
}

// ---------------------------------------------------------------------------
// Media helpers (iLink protocol: MessageItemType IMAGE=2, FILE=4, VIDEO=5)
// ---------------------------------------------------------------------------

const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;
const MIME_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp" };
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

function uploadsDir() {
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "uploads");
}

function buildCdnDownloadUrl(encryptQueryParam) {
  return `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
}

function parseAesKey(aesKeyBase64) {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`aes_key must decode to 16 raw bytes or 32-char hex, got ${decoded.length} bytes`);
}

function decryptAesEcb(ciphertext, key) {
  const { createDecipheriv } = require("node:crypto");
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function downloadCdnBuffer(encryptQueryParam, label) {
  const netFetch = getNetFetch();
  const url = buildCdnDownloadUrl(encryptQueryParam);
  wxLog(`${label}: CDN fetch ${url.substring(0, 100)}...`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await netFetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`CDN ${res.status} ${res.statusText}`);
    const ab = await res.arrayBuffer();
    wxLog(`${label}: CDN downloaded ${ab.byteLength} bytes`);
    return Buffer.from(ab);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function downloadAndDecrypt(encryptQueryParam, aesKeyBase64, label) {
  const key = parseAesKey(aesKeyBase64);
  const encrypted = await downloadCdnBuffer(encryptQueryParam, label);
  const decrypted = decryptAesEcb(encrypted, key);
  wxLog(`${label}: decrypted ${decrypted.length} bytes`);
  return decrypted;
}

async function saveInboundAttachment(buf, suggestedName) {
  const dir = uploadsDir();
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(suggestedName) || "";
  const stem = path.basename(suggestedName, ext) || "file";
  const unique = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${stem}${ext}`;
  const fullPath = path.join(dir, unique);
  await fsp.writeFile(fullPath, buf);
  return fullPath;
}

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

class WeixinPersonalAdapter {
  constructor() {
    this.channelType = "weixin_personal";
    this.running = false;
    this._config = null;
    this._botId = null;
    this._deps = null;
    this._abortController = null;

    this._baseUrl = ILINK_BASE_URL;
    this._token = null;
    this._accountId = null;
    this._getUpdatesBuf = "";
    this._contextTokens = new Map();

    this._qrSession = null;
  }

  // -- Credential persistence ------------------------------------------------

  _loadSavedCredentials() {
    const saved = loadCredentials();
    if (saved && saved.token) {
      this._token = saved.token;
      this._accountId = saved.accountId || null;
      this._baseUrl = saved.baseUrl || ILINK_BASE_URL;
      this._getUpdatesBuf = loadSyncBuf();
      wxLog("loaded saved credentials, accountId=" + (this._accountId || "(none)"));
      return true;
    }
    return false;
  }

  _saveCurrentCredentials() {
    saveCredentials({
      token: this._token,
      accountId: this._accountId,
      baseUrl: this._baseUrl,
      savedAt: new Date().toISOString(),
    });
  }

  // -- QR Login (called from IPC) --------------------------------------------

  async startQrLogin() {
    wxLog("startQrLogin: baseUrl=" + this._baseUrl);
    try {
      const qr = await fetchQrCode(this._baseUrl);
      wxLog("startQrLogin: qrcode=" + (qr.qrcode || "").substring(0, 20) + "... img_content=" + (qr.qrcode_img_content || "").substring(0, 60));
      this._qrSession = {
        qrcode: qr.qrcode,
        qrcodeUrl: qr.qrcode_img_content,
        startedAt: Date.now(),
      };
      return { ok: true, qrcodeUrl: qr.qrcode_img_content };
    } catch (err) {
      const cause = err?.cause;
      wxLog("startQrLogin error: " + (err?.message || String(err)) + (cause ? " cause.code=" + (cause.code || cause.message || String(cause)) : ""));
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async waitForQrLogin({ timeoutMs } = {}) {
    if (!this._qrSession) return { ok: false, error: "No QR session active. Call startQrLogin first." };

    const deadline = Date.now() + (timeoutMs || 300_000);
    while (Date.now() < deadline) {
      try {
        const status = await pollQrStatus(this._baseUrl, this._qrSession.qrcode);

        if (status.status === "confirmed") {
          this._token = status.bot_token;
          this._accountId = status.ilink_bot_id || null;
          if (status.baseurl) this._baseUrl = status.baseurl;
          this._qrSession = null;
          this._saveCurrentCredentials();
          wxLog("QR login confirmed, accountId=" + this._accountId);
          return { ok: true, connected: true, accountId: this._accountId };
        }

        if (status.status === "expired") {
          try {
            const qr = await fetchQrCode(this._baseUrl);
            this._qrSession.qrcode = qr.qrcode;
            this._qrSession.qrcodeUrl = qr.qrcode_img_content;
            this._qrSession.startedAt = Date.now();
            wxLog("QR code expired, refreshed");
            return { ok: false, expired: true, qrcodeUrl: qr.qrcode_img_content };
          } catch (refreshErr) {
            return { ok: false, error: "QR refresh failed: " + (refreshErr?.message || String(refreshErr)) };
          }
        }

        if (status.status === "scaned") {
          return { ok: false, scanned: true };
        }

        // status === "wait": continue polling
      } catch (err) {
        wxLog("waitForQrLogin poll error: " + (err?.message || String(err)));
        return { ok: false, error: err?.message || String(err) };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { ok: false, error: "timeout" };
  }

  getStatus() {
    return {
      hasCredentials: Boolean(this._token),
      accountId: this._accountId,
      running: this.running,
      qrActive: Boolean(this._qrSession),
    };
  }

  // -- Adapter lifecycle (called by ChannelManager) --------------------------

  async start({ config, botId, deps }) {
    this._config = config || {};
    this._botId = botId;
    this._deps = deps;

    if (config?.token) {
      this._token = config.token;
      this._accountId = config.accountId || null;
      if (config.baseUrl) this._baseUrl = config.baseUrl;
    } else {
      this._loadSavedCredentials();
    }

    if (!this._token) {
      wxLog("no token available, adapter waiting for QR login");
      return;
    }

    this.running = true;
    this._getUpdatesBuf = loadSyncBuf();
    this._startPollLoop();
    wxLog("started for bot " + botId);
  }

  _startPollLoop() {
    this._abortController = new AbortController();
    this._pollLoop(this._abortController.signal).catch((err) => {
      wxLog("poll loop exited with error: " + (err?.message || String(err)));
    });
  }

  async _pollLoop(signal) {
    let consecutiveFailures = 0;

    while (!signal.aborted && this.running) {
      try {
        const resp = await ilinkGetUpdates({
          baseUrl: this._baseUrl,
          token: this._token,
          getUpdatesBuf: this._getUpdatesBuf,
          timeoutMs: LONG_POLL_TIMEOUT_MS,
        });

        if (resp.errcode === SESSION_EXPIRED_ERRCODE) {
          wxLog("session expired (errcode=-14), stopping poll. User needs to re-login.");
          this.running = false;
          this._token = null;
          this._notifyRenderer("weixin:sessionExpired", {});
          break;
        }

        if (resp.get_updates_buf) {
          this._getUpdatesBuf = resp.get_updates_buf;
          saveSyncBuf(this._getUpdatesBuf);
        }

        consecutiveFailures = 0;

        const msgs = resp.msgs || [];
        for (const msg of msgs) {
          if (msg.message_type === 1) {
            await this._onInboundMessage(msg);
          }
        }
      } catch (err) {
        consecutiveFailures++;
        wxLog(`poll error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err?.message || String(err)}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          wxLog("too many consecutive failures, pausing poll for 30s");
          await new Promise((r) => setTimeout(r, 30_000));
          consecutiveFailures = 0;
        } else {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
  }

  // -- Inbound message handling ----------------------------------------------

  async _onInboundMessage(msg) {
    const fromUserId = msg.from_user_id || "";
    if (!fromUserId) return;

    const items = msg.item_list || [];
    const textParts = [];
    const images = [];
    const attachmentPaths = [];

    for (const item of items) {
      if (item.type === 1 && item.text_item?.text) {
        textParts.push(String(item.text_item.text).trim());
      } else if (item.type === 3 && item.voice_item?.text) {
        textParts.push(String(item.voice_item.text).trim());
      } else if (item.type === 2 && item.image_item) {
        try {
          const buf = await this._downloadCdnMedia(item.image_item, "image");
          if (buf) {
            const savedPath = await saveInboundAttachment(buf, "image.jpg");
            attachmentPaths.push(`[Image: ##${savedPath}##]`);
            const base64 = buf.toString("base64");
            images.push({ type: "image", data: base64, mimeType: "image/jpeg" });
          } else {
            textParts.push("[用户发送了一张图片]");
          }
        } catch (err) {
          wxLog("image download/decrypt failed: " + (err?.message || String(err)));
          textParts.push("[用户发送了一张图片]");
        }
      } else if (item.type === 4 && item.file_item) {
        const fileName = item.file_item.file_name || "file";
        try {
          const buf = await this._downloadCdnMedia(item.file_item, "file");
          if (buf) {
            const savedPath = await saveInboundAttachment(buf, fileName);
            attachmentPaths.push(`[File: ##${savedPath}##]`);
          } else {
            textParts.push(`[用户发送了文件: ${fileName}]`);
          }
        } catch (err) {
          wxLog("file download/decrypt failed: " + (err?.message || String(err)));
          textParts.push(`[用户发送了文件: ${fileName}]`);
        }
      } else if (item.type === 5 && item.video_item) {
        try {
          const buf = await this._downloadCdnMedia(item.video_item, "video");
          if (buf) {
            const savedPath = await saveInboundAttachment(buf, "video.mp4");
            attachmentPaths.push(`[File: ##${savedPath}##]`);
          } else {
            textParts.push("[用户发送了一段视频]");
          }
        } catch (err) {
          wxLog("video download/decrypt failed: " + (err?.message || String(err)));
          textParts.push("[用户发送了一段视频]");
        }
      }
    }

    const text = textParts.filter(Boolean).join(" ");
    if (!text && images.length === 0 && attachmentPaths.length === 0) return;

    if (msg.context_token) {
      this._contextTokens.set(fromUserId, msg.context_token);
    }

    const contentParts = [];
    if (text) contentParts.push(text);
    contentParts.push(...attachmentPaths);
    const content = contentParts.join("\n");

    const msgId = msg.message_id != null ? String(msg.message_id) : `wx-${Date.now()}`;
    await this._onWeixinMessage(fromUserId, msgId, content, images);
  }

  async _downloadCdnMedia(mediaItem, label) {
    const eqp = mediaItem.media?.encrypt_query_param;
    if (!eqp) {
      wxLog(`${label}: no encrypt_query_param found, keys=${Object.keys(mediaItem).join(",")}`);
      return null;
    }

    let aesKeyBase64;
    if (mediaItem.aeskey) {
      aesKeyBase64 = Buffer.from(mediaItem.aeskey, "hex").toString("base64");
    } else if (mediaItem.media?.aes_key) {
      aesKeyBase64 = mediaItem.media.aes_key;
    }

    if (aesKeyBase64) {
      return downloadAndDecrypt(eqp, aesKeyBase64, label);
    }
    return downloadCdnBuffer(eqp, label);
  }

  async _onWeixinMessage(fromUserId, weixinMsgId, content, images) {
    const { chatRepository } = this._deps;
    const defaultBotId = this._botId;

    const existing = chatRepository.db
      .prepare("SELECT id FROM messages WHERE channel_message_id = ? LIMIT 1")
      .get(weixinMsgId);
    if (existing) return;

    const { chatId } = chatRepository.getOrCreateMainChatForContact({ contactId: defaultBotId });

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
      channelType: "weixin_personal",
      channelMessageId: weixinMsgId,
    });

    this._notifyRenderer("channel:newMessage", { chatId, channelType: "weixin_personal" });

    const reply = await this._getAgentReply(chatId, content, images || []);
    const replyText = reply && typeof reply === "object" ? reply.content : reply;
    if (replyText != null && replyText !== "") {
      const replyMsgId = randomUUID();
      const toolCalls =
        reply && typeof reply === "object" && Array.isArray(reply.toolCalls) && reply.toolCalls.length > 0
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
        channelType: "weixin_personal",
        ...(toolCalls ? { toolCalls } : {}),
      });

      const contextToken = this._contextTokens.get(fromUserId);
      await this._sendReply(fromUserId, replyText, contextToken);
      this._notifyRenderer("channel:newMessage", { chatId, channelType: "weixin_personal" });
    }
  }

  // -- Outbound --------------------------------------------------------------

  async _sendReply(toUserId, text, contextToken) {
    if (!this._token) {
      wxLog("no token, cannot send");
      return { ok: false, error: "not authenticated" };
    }
    try {
      return await ilinkSendMessage({
        baseUrl: this._baseUrl,
        token: this._token,
        to: toUserId,
        text,
        contextToken,
      });
    } catch (err) {
      wxLog("sendReply failed: " + (err?.message || String(err)));
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async sendOutbound(content) {
    const lastUser = this._contextTokens.keys().next().value;
    if (!lastUser) {
      return { ok: false, error: "No WeChat user available. A message must be received first." };
    }
    const contextToken = this._contextTokens.get(lastUser);
    return this._sendReply(lastUser, content, contextToken);
  }

  // -- Agent integration (same pattern as feishu/wecom) ----------------------

  async _ensureBotSession(chatId) {
    const { getEngineForContact } = require("../conversation/engineRegistry.cjs");
    const { getRunner } = require("../conversation/PiConversationEngine.cjs");
    const { contactRepository, assistantConfigRepository, chatRepository } = this._deps;
    const { engine, rawConfig, assistantConfigId, defaultContactId } = getEngineForContact(this._botId, {
      contactRepository,
      assistantConfigRepository,
    });

    const runner = await getRunner();
    if (runner.hasSession(this._botId)) return engine;

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
    try { await fsp.mkdir(workDir, { recursive: true }); } catch (_) {}
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

  async _getAgentReply(chatId, text, images) {
    const engine = await this._ensureBotSession(chatId);
    if (!engine) return null;

    const { getRunner } = require("../conversation/PiConversationEngine.cjs");
    const runner = await getRunner();

    let replyContent = "";
    const toolCallsMap = new Map();
    const listenerId = `weixin_personal:${chatId}:${Date.now()}`;

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

  // -- Renderer notification -------------------------------------------------

  _notifyRenderer(channel, data) {
    try {
      const { BrowserWindow } = require("electron");
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send(channel, data);
        }
      }
    } catch {}
  }

  // -- Stop ------------------------------------------------------------------

  async stop() {
    this.running = false;
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._qrSession = null;
    console.log("[channel:weixin_personal] stopped");
  }
}

module.exports = { WeixinPersonalAdapter };
