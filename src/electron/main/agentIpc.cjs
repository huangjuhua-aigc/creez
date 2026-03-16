const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CHANNELS } = require("./channels.cjs");
const { getEngineForContact, getPiEngine } = require("./conversation/engineRegistry.cjs");

/** Expand ~ to homedir; leave other paths unchanged. */
function resolveWorkDir(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const home = os.homedir();
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) {
    return path.join(home, s.slice(1).replace(/\//g, path.sep));
  }
  return path.resolve(s);
}

/** Default workspace when user has not chosen one in Settings. */
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".creez", "workplace");

/** Engine used for the current session (set on init, used for prompt/setModel/abort). */
let currentEngine = null;

const DEBUG_AGENT = false;

function log(scope, details) {
  if (!DEBUG_AGENT) return;
  const ts = new Date().toISOString();
  try {
    console.log(`[creezv2 agent][${ts}][${scope}]`, details || "");
  } catch {
    // no-op
  }
}

function pickActiveModel(models, preferredId) {
  const list = Array.isArray(models) ? models : [];
  if (preferredId) {
    const preferred = list.find((item) => String(item.id) === String(preferredId));
    if (preferred) return preferred;
  }
  return list.find((item) => item && item.active) || list[0] || null;
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
  const agentDir = creezHome ? path.join(creezHome, ".creez") : path.join(os.homedir(), ".creez");

  ipcMain.on(CHANNELS.AGENT_INIT, async (event, payload) => {
    log("agent:init:recv", {
      contactId: payload?.contactId ?? null,
      modelConfigId: payload?.modelConfigId || null,
      provider: payload?.provider || null,
      modelId: payload?.modelId || null,
      chatId: payload?.chatId || null,
      hasApiKey: Boolean(payload?.apiKey),
    });
    try {
      const { engine, rawConfig, assistantConfigId, defaultContactId } = getEngineForContact(payload?.contactId, {
        contactRepository,
        assistantConfigRepository,
      });
      currentEngine = engine;

      const appState = appStateStore ? await appStateStore.getState() : {};
      const activeModel = pickActiveModel(rawConfig?.models, payload?.modelConfigId);

      const provider = payload?.provider
        ? normalizeProvider(payload.provider)
        : normalizeProvider(activeModel?.provider);
      const modelId = payload?.modelId || activeModel?.model;
      let apiKey = payload?.apiKey || "";
      let apiKeySource = "none";
      if (apiKey) apiKeySource = "payload";
      else if (activeModel?.id) {
        apiKey = (activeModel.apiKey && String(activeModel.apiKey).trim()) || "";
        if (apiKey) apiKeySource = "rawConfig.model";
        else if (assistantConfigRepository?.getModelApiKeyFromConfig) {
          apiKey = assistantConfigRepository.getModelApiKeyFromConfig(assistantConfigId, activeModel.id);
          if (apiKey) apiKeySource = "getModelApiKeyFromConfig";
        }
      }
      if (!apiKey && payload?.modelConfigId && defaultContactId && assistantConfigRepository?.getModelApiKey) {
        apiKey = assistantConfigRepository.getModelApiKey(payload.modelConfigId, defaultContactId);
        if (apiKey) apiKeySource = "getModelApiKey(default)";
      }
      // New/non-default agent may have config without apiKey (e.g. created before key was saved); always try default config
      if (!apiKey && assistantConfigId !== defaultContactId && activeModel?.id && assistantConfigRepository?.getModelApiKeyFromConfig) {
        apiKey = assistantConfigRepository.getModelApiKeyFromConfig(defaultContactId, activeModel.id);
        if (apiKey) apiKeySource = "getModelApiKeyFromConfig(default)";
      }

      log("agent:init:resolved", {
        assistantConfigId,
        provider,
        modelId,
        hasApiKey: Boolean(apiKey),
        apiKeySource,
      });
      log("agent:init:apiKey", {
        source: apiKeySource,
        hasApiKey: Boolean(apiKey),
        activeModelId: activeModel?.id ?? null,
        rawConfigModelCount: rawConfig?.models?.length ?? 0,
      });
      const rawRoot = payload?.workDir || appState?.workspaceRoot || null;
      const workDir = resolveWorkDir(rawRoot) || DEFAULT_WORKSPACE_ROOT;
      try {
        await fs.mkdir(workDir, { recursive: true });
      } catch (e) {
        console.warn("[creez:agent] workspace dir create failed:", e?.message || String(e));
      }
      const memory = memoryStore ? await memoryStore.read(payload?.memoryPath) : { content: "", path: "" };

      let chatHistory = "";
      if (chatRepository && payload?.chatId) {
        try {
          const historyRows = chatRepository.getMessages({ chatId: payload.chatId, limit: 50 });
          chatHistory = (historyRows?.items || [])
            .map((m) => `${m.sender === "user" ? "User" : "Assistant"}: ${m.content}`)
            .join("\n");
        } catch { /* ignore */ }
      }
      log("agent:init:resolved", {
        provider,
        modelId,
        workDir,
        agentDir,
        engineType: rawConfig?.engineType ?? "pi",
        assistantConfigId,
        memoryPath: memory?.path || "",
        memoryLen: memory?.content?.length || 0,
        activeModelId: activeModel?.id || null,
      });

      if (!provider || !modelId || !apiKey) {
        log("agent:init:invalid", {
          hasProvider: Boolean(provider),
          hasModelId: Boolean(modelId),
          hasApiKey: Boolean(apiKey),
          apiKeySource,
        });
        event.sender.send(CHANNELS.AGENT_EVENT_ERROR, "Agent init requires provider/model/apiKey.");
        return;
      }

      const initSender = event.sender;
      const cm = deps.channelManager;
      const channelSend =
        cm && typeof cm.sendMessage === "function"
          ? (channelType, opts) => cm.sendMessage(channelType, opts)
          : undefined;
      const context = {
        chatId: payload?.chatId ?? null,
        contactId: payload?.contactId ?? null,
        assistantConfigId,
        defaultContactId: defaultContactId ?? null,
        assistantConfig: rawConfig,
        workDir,
        agentDir,
        memoryContent: [memory.content || "", chatHistory].filter(Boolean).join("\n"),
        memoryPath: memory.path || "",
        provider,
        modelId,
        apiKey,
        channelSend,
        sendEvent: (data) => {
          if (initSender && typeof initSender.isDestroyed === "function" && !initSender.isDestroyed()) {
            initSender.send(CHANNELS.AGENT_EVENT, data);
          }
        },
        sendError: (message) => {
          if (initSender && typeof initSender.isDestroyed === "function" && !initSender.isDestroyed()) {
            initSender.send(CHANNELS.AGENT_EVENT_ERROR, message);
          }
        },
      };
      await currentEngine.init(context);
      log("agent:init:ok", { provider, modelId, chatId: context.chatId ?? null });
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
    log("agent:prompt:recv", { chatId: chatId || null, textLen, imageCount });
    try {
      const engine = currentEngine || getPiEngine();
      const hasSession = await engine.hasSession(chatId);
      log("agent:prompt:session", { hasSession, chatId: chatId || null });
      if (!hasSession) {
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
