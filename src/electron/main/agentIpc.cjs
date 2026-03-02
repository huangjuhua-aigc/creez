const os = require("node:os");
const path = require("node:path");
const { CHANNELS } = require("./channels.cjs");
const { getEngineForContact, getPiEngine } = require("./conversation/engineRegistry.cjs");

/** Engine used for the current session (set on init, used for prompt/setModel/abort). */
let currentEngine = null;
/** WebContents to send agent events to (set on init so prompt-phase events reach the same window). */
let currentSender = null;

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
  const { assistantConfigRepository, appStateStore, memoryStore, contactRepository, creezHome } = deps;
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
      const { engine, rawConfig, assistantConfigId } = getEngineForContact(payload?.contactId, {
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
      if (!apiKey && payload?.modelConfigId && assistantConfigRepository?.getModelApiKey) {
        apiKey = assistantConfigRepository.getModelApiKey(payload.modelConfigId);
        if (apiKey) apiKeySource = "getModelApiKey(default)";
      }

      log("agent:init:apiKey", {
        source: apiKeySource,
        hasApiKey: Boolean(apiKey),
        activeModelId: activeModel?.id ?? null,
        rawConfigModelCount: rawConfig?.models?.length ?? 0,
      });
      const workDir = payload?.workDir || appState?.workspaceRoot || os.homedir();
      const memory = memoryStore ? await memoryStore.read(payload?.memoryPath) : { content: "", path: "" };
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

      currentSender = event.sender;
      const context = {
        chatId: payload?.chatId ?? null,
        contactId: payload?.contactId ?? null,
        assistantConfigId,
        assistantConfig: rawConfig,
        workDir,
        agentDir,
        memoryContent: memory.content || "",
        memoryPath: memory.path || "",
        provider,
        modelId,
        apiKey,
        sendEvent: (data) => {
          if (currentSender && typeof currentSender.isDestroyed === "function" && !currentSender.isDestroyed()) {
            currentSender.send(CHANNELS.AGENT_EVENT, data);
          }
        },
        sendError: (message) => {
          if (currentSender && typeof currentSender.isDestroyed === "function" && !currentSender.isDestroyed()) {
            currentSender.send(CHANNELS.AGENT_EVENT_ERROR, message);
          }
        },
      };
      await currentEngine.init(context);
      log("agent:init:ok", { provider, modelId });
      setImmediate(() => {
        if (currentSender && typeof currentSender.isDestroyed === "function" && !currentSender.isDestroyed()) {
          currentSender.send(CHANNELS.AGENT_EVENT, { type: "agent_ready" });
          log("agent:init:agent_ready:sent", "explicit agent_ready (setImmediate) from agentIpc");
        } else {
          log("agent:init:agent_ready:skip", "sender destroyed or missing");
        }
      });
    } catch (error) {
      const message = error?.message || String(error);
      console.error("[creezv2] agent:init error:", message);
      log("agent:init:error", message);
      event.sender.send(CHANNELS.AGENT_EVENT_ERROR, message);
    }
  });

  ipcMain.on(CHANNELS.AGENT_PROMPT, async (event, payload) => {
    const textLen = String(payload?.text || "").length;
    const imageCount = Array.isArray(payload?.images) ? payload.images.length : 0;
    log("agent:prompt:recv", { textLen, imageCount });
    try {
      const engine = currentEngine || getPiEngine();
      const hasSession = await engine.hasSession();
      log("agent:prompt:session", { hasSession });
      if (!hasSession) {
        log("agent:prompt:no-session", "Agent not initialized");
        event.sender.send(CHANNELS.AGENT_EVENT_ERROR, "Agent not initialized.");
        return;
      }
      log("agent:prompt:engine.prompt:start", "");
      await engine.prompt({
        text: payload?.text || "",
        images: normalizeImages(payload?.images),
      });
      log("agent:prompt:engine.prompt:done", "");
      log("agent:prompt:done", "prompt resolved");
      if (currentSender && typeof currentSender.isDestroyed === "function" && !currentSender.isDestroyed()) {
        currentSender.send(CHANNELS.AGENT_EVENT, { type: "agent_end" });
        log("agent:prompt:agent_end:sent", "fallback agent_end after prompt done");
      }
    } catch (error) {
      const message = error?.message || String(error);
      console.error("[creezv2] agent:prompt error:", message);
      log("agent:prompt:error", message);
      event.sender.send(CHANNELS.AGENT_EVENT_ERROR, message);
    }
  });

  ipcMain.handle(CHANNELS.AGENT_SET_MODEL, async (_event, payload) => {
    try {
      const provider = normalizeProvider(payload?.provider);
      const modelId = String(payload?.modelId || "").trim();
      const apiKey = String(payload?.apiKey || "").trim();
      log("agent:setModel:recv", { provider, modelId, hasApiKey: Boolean(apiKey) });
      if (!provider || !modelId || !apiKey) {
        return {
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "provider/modelId/apiKey required for setModel." },
        };
      }
      const engine = currentEngine || getPiEngine();
      if (!(await engine.hasSession())) {
        return {
          ok: false,
          error: { code: "NO_SESSION", message: "Agent not initialized." },
        };
      }
      const changed = await engine.setModel({ provider, modelId, apiKey });
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

  ipcMain.on(CHANNELS.AGENT_ABORT, async () => {
    log("agent:abort:recv", "");
    try {
      const engine = currentEngine || getPiEngine();
      engine.abort();
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
