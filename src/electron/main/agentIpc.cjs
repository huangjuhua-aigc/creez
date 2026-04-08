const os = require("node:os");
const path = require("node:path");
const { resolveCreezHome } = require("./creezPaths.cjs");
const { CHANNELS } = require("./channels.cjs");
const { getPiEngine } = require("./conversation/engineRegistry.cjs");
const { AgentConfigBuilder } = require("./AgentConfigBuilder.cjs");

/** Engine used for the current session (set on init, used for prompt/setModel/abort). */
let currentEngine = null;

const DEBUG_AGENT = true;

function log(scope, details) {
  if (!DEBUG_AGENT) return;
  const ts = new Date().toISOString();
  try {
    console.log(`[creezv2 agent][${ts}][${scope}]`, details || "");
  } catch {
    // no-op
  }
}

function normalizeProvider(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const alias = {
    OpenRouter: "openrouter",
    OpenAI: "openai",
    Anthropic: "anthropic",
    Google: "google",
  };
  return alias[value] || value.toLowerCase();
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((item) => item && item.type === "image")
    .map((item) => ({
      type: "image",
      data: item.data || "",
      mimeType: item.mimeType || "image/png",
    }));
}

function registerAgentIpc(ipcMain, deps = {}) {
  const { assistantConfigRepository, appStateStore, memoryStore, contactRepository, chatRepository, creezHome } = deps;
  const agentDir = creezHome || resolveCreezHome(os.homedir());

  ipcMain.on(CHANNELS.AGENT_INIT, async (event, payload) => {
    log("agent:init:recv", {
      contactId: payload?.contactId ?? null,
      chatId: payload?.chatId || null,
      hasApiKey: Boolean(payload?.apiKey),
    });
    try {
      let chatHistory = "";
      if (chatRepository && payload?.chatId) {
        try {
          const historyRows = chatRepository.getMessages({ chatId: payload.chatId, limit: 50 });
          chatHistory = (historyRows?.items || [])
            .map((m) => `${m.sender === "user" ? "User" : "Assistant"}: ${m.content}`)
            .join("\n");
        } catch { /* ignore */ }
      }

      const initSender = event.sender;
      const cm = deps.channelManager;
      const channelSend =
        cm && typeof cm.sendMessage === "function"
          ? (channelType, opts) => cm.sendMessage(channelType, opts)
          : undefined;

      const config = await new AgentConfigBuilder()
        .setContactId(payload?.contactId)
        .setScenario("desktop_chat")
        .setDeps({ contactRepository, assistantConfigRepository, memoryStore, appStateStore, chatRepository })
        .setChatId(payload?.chatId ?? null)
        .setModelOverride({
          provider: payload?.provider,
          modelId: payload?.modelId,
          apiKey: payload?.apiKey,
          modelConfigId: payload?.modelConfigId,
        })
        .setWorkDirOverride(payload?.workDir)
        .setMemoryPath(payload?.memoryPath)
        .setChatHistory(chatHistory)
        .setChannelSend(channelSend)
        .setCreezHome(agentDir)
        .setSendEvent((data) => {
          if (initSender && typeof initSender.isDestroyed === "function" && !initSender.isDestroyed()) {
            initSender.send(CHANNELS.AGENT_EVENT, data);
          }
        })
        .setSendError((message) => {
          if (initSender && typeof initSender.isDestroyed === "function" && !initSender.isDestroyed()) {
            initSender.send(CHANNELS.AGENT_EVENT_ERROR, message);
          }
        })
        .build();

      currentEngine = config.engine;

      if (!config.provider || !config.modelId || !config.apiKey) {
        console.warn("[agentIpc] AGENT_INIT:missingCredentials");
        event.sender.send(CHANNELS.AGENT_EVENT_ERROR, "Agent init requires provider/model/apiKey.");
        return;
      }

      log("agent:init:callingEngine", { provider: config.provider, modelId: config.modelId, chatId: config.chatId, contactId: config.contactId });
      await currentEngine.init(config);
      log("agent:init:ok", { provider: config.provider, modelId: config.modelId, chatId: config.chatId });
    } catch (error) {
      const message = error?.message || String(error);
      console.error("[creezv2] agent:init error:", message);
      log("agent:init:error", message);
      event.sender.send(CHANNELS.AGENT_EVENT_ERROR, message);
    }
  });

  ipcMain.on(CHANNELS.AGENT_PROMPT, async (event, payload) => {
    const chatId = payload?.chatId ?? "";
    const userText = String(payload?.text || "");
    const textLen = userText.length;
    const imageCount = Array.isArray(payload?.images) ? payload.images.length : 0;
    const textPreview = userText.slice(0, 400).replace(/\s+/g, " ").trim();
    log("agent:prompt:recv", { chatId: chatId || null, textLen, imageCount, textPreview: textPreview.slice(0, 120) });
    try {
      const engine = currentEngine || getPiEngine();
      const hasSession = await engine.hasSession(chatId);
      log("agent:prompt:session", { hasSession, chatId: chatId || null });
      if (!hasSession) {
        console.warn("[agentIpc] AGENT_PROMPT:noSession", { chatId: chatId || null });
        log("agent:prompt:no-session", { chatId: chatId || null });
        event.sender.send(CHANNELS.AGENT_EVENT_ERROR, "Agent not initialized.");
        return;
      }
      log("agent:prompt:engine.prompt:start", "");
      await engine.prompt({
        chatId,
        text: payload?.text || "",
        images: normalizeImages(payload?.images),
      });
      log("agent:prompt:engine.prompt:done", "");
      log("agent:prompt:done", "prompt resolved");
    } catch (error) {
      const message = error?.message || String(error);
      console.error("[creezv2] agent:prompt error:", message);
      log("agent:prompt:error", message);
      event.sender.send(CHANNELS.AGENT_EVENT_ERROR, message);
    }
  });

  ipcMain.handle(CHANNELS.AGENT_SET_MODEL, async (_event, payload) => {
    try {
      const chatId = payload?.chatId ?? "";
      const provider = normalizeProvider(payload?.provider);
      const modelId = String(payload?.modelId || "").trim();
      const apiKey = String(payload?.apiKey || "").trim();
      log("agent:setModel:recv", { chatId: chatId || null, provider, modelId, hasApiKey: Boolean(apiKey) });
      if (!provider || !modelId || !apiKey) {
        return {
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "provider/modelId/apiKey required for setModel." },
        };
      }
      const engine = currentEngine || getPiEngine();
      if (!(await engine.hasSession(chatId))) {
        return {
          ok: false,
          error: { code: "NO_SESSION", message: "Agent not initialized." },
        };
      }
      const changed = await engine.setModel(chatId, { provider, modelId, apiKey });
      if (!changed) {
        return {
          ok: false,
          error: { code: "MODEL_UNSUPPORTED", message: `Unsupported model: ${provider}/${modelId}` },
        };
      }
      return {
        ok: true,
        data: { changed: true, provider, modelId },
      };
    } catch (error) {
      const message = error?.message || String(error);
      log("agent:setModel:error", message);
      return {
        ok: false,
        error: { code: "SET_MODEL_ERROR", message },
      };
    }
  });

  ipcMain.on(CHANNELS.AGENT_ABORT, async (_event, chatId) => {
    log("agent:abort:recv", { chatId: chatId ?? null });
    try {
      const engine = currentEngine || getPiEngine();
      engine.abort(chatId ?? "");
      log("agent:abort:ok", "");
    } catch {
      // Ignore abort failure.
      log("agent:abort:ignore-error", "");
    }
  });
}

module.exports = {
  registerAgentIpc,
};
