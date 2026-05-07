/**
 * Unified builder for agent init config across all scenarios.
 *
 * Usage:
 *   const config = await new AgentConfigBuilder()
 *     .setContactId(id)
 *     .setDeps({ contactRepository, assistantConfigRepository, memoryStore, appStateStore, chatRepository })
 *     .setScenario('desktop_chat')
 *     .setChatId(chatId)
 *     .build();
 *
 * Scenarios: default | default_assistant | trusted_desktop | desktop_chat | channel | remote_user | a2a_agent | auto_discovery | headless | summary
 */

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { resolveCreezHome, ensureBotDir } = require("./creezPaths.cjs");
const { getEngineForContact } = require("./conversation/engineRegistry.cjs");

const TAG = "[AgentConfigBuilder]";

const VALID_SCENARIOS = new Set([
  "default",
  "default_assistant",
  "trusted_desktop",
  "desktop_chat",
  "channel",
  "remote_user",
  "a2a_agent",
  "auto_discovery",
  "headless",
  "summary",
]);

const DEFAULT_WORKSPACE_ROOT = path.join(resolveCreezHome(os.homedir()), "workplace");

function resolveWorkDir(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const home = os.homedir();
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) {
    return path.join(home, s.slice(1).replace(/\//g, path.sep));
  }
  return path.resolve(s);
}

function pickActiveModel(models, preferredId) {
  const list = Array.isArray(models) ? models : [];
  if (preferredId) {
    const found = list.find((m) => m && m.id === preferredId);
    if (found) return found;
  }
  return list.find((m) => m && m.active) || list[0] || null;
}

function normalizeProvider(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const alias = { OpenRouter: "openrouter", OpenAI: "openai", Anthropic: "anthropic", Google: "google" };
  return alias[value] || value.toLowerCase();
}

class AgentConfigBuilder {
  constructor() {
    this._contactId = null;
    this._scenario = null;
    this._deps = {};
    this._chatId = null;
    this._sessionKey = null;
    this._modelOverride = {};
    this._workDirOverride = null;
    this._channelSend = undefined;
    this._sendEvent = () => {};
    this._sendError = () => {};
    this._memoryPath = undefined;
    this._chatHistory = "";
    this._systemPromptOverride = null;
    this._assistantConfigOverride = null;
    this._creezHome = null;
  }

  setContactId(id) { this._contactId = id; return this; }
  setScenario(s) {
    if (!VALID_SCENARIOS.has(s)) throw new Error(`${TAG} invalid scenario: ${s}`);
    this._scenario = s;
    return this;
  }
  setDeps(deps) { this._deps = deps || {}; return this; }
  setChatId(id) { this._chatId = id; return this; }
  setSessionKey(key) { this._sessionKey = key; return this; }
  setModelOverride(o) { this._modelOverride = o || {}; return this; }
  setWorkDirOverride(dir) { this._workDirOverride = dir; return this; }
  setChannelSend(fn) { this._channelSend = fn; return this; }
  setSendEvent(fn) { this._sendEvent = fn; return this; }
  setSendError(fn) { this._sendError = fn; return this; }
  setMemoryPath(p) { this._memoryPath = p; return this; }
  setChatHistory(text) { this._chatHistory = text; return this; }
  setSystemPromptOverride(p) { this._systemPromptOverride = p; return this; }
  setAssistantConfigOverride(c) { this._assistantConfigOverride = c; return this; }
  setCreezHome(h) { this._creezHome = h; return this; }

  async build() {
    if (!this._scenario) throw new Error(`${TAG} scenario is required`);
    const { contactRepository, assistantConfigRepository, memoryStore, appStateStore, chatRepository } = this._deps;

    // 1. Engine + raw config
    const { engine, rawConfig: baseConfig, assistantConfigId, defaultContactId } = getEngineForContact(
      this._contactId,
      { contactRepository, assistantConfigRepository },
    );
    let rawConfig = this._assistantConfigOverride || baseConfig;

    const isDefaultBot = assistantConfigId != null && defaultContactId != null
      && String(assistantConfigId) === String(defaultContactId);

    const effectiveScenario = this._scenario === "desktop_chat" ? "trusted_desktop" : this._scenario;

    // 2. Remote config overlay (trusted desktop only, when contact has remoteAgentId)
    const contact = contactRepository ? contactRepository.getById(this._contactId) : null;
    const remoteAgentId = contact?.remoteAgentId || null;
    if (remoteAgentId && effectiveScenario === "trusted_desktop") {
      rawConfig = await this._fetchRemoteConfig(remoteAgentId, rawConfig);
    }

    // 3. Model + API key
    const activeModel = pickActiveModel(rawConfig?.models, this._modelOverride.modelConfigId);
    const provider = this._modelOverride.provider
      ? normalizeProvider(this._modelOverride.provider)
      : normalizeProvider(activeModel?.provider);
    const modelId = this._modelOverride.modelId || activeModel?.model || "";
    const apiKey = this._resolveApiKey(
      this._modelOverride.apiKey,
      activeModel,
      assistantConfigId,
      defaultContactId,
      assistantConfigRepository,
      this._modelOverride.modelConfigId,
    );

    // 4. Paths
    const creezHome = this._creezHome || resolveCreezHome(os.homedir());
    const agentDir = creezHome;
    const workDir = await this._resolveWorkDir(isDefaultBot, creezHome, appStateStore);

    // 5. Memory
    const memory = memoryStore
      ? await memoryStore.read(this._memoryPath).catch(() => ({ content: "", path: "" }))
      : { content: "", path: "" };
    const memoryContent = [memory.content || "", this._chatHistory].filter(Boolean).join("\n");

    // 6. Derived flags
    const isExternalUser = effectiveScenario === "remote_user"
      || effectiveScenario === "a2a_agent"
      || effectiveScenario === "auto_discovery";

    // 7. System prompt
    let assistantConfig = { ...rawConfig };
    if (this._systemPromptOverride != null) {
      assistantConfig = { ...assistantConfig, systemPrompt: this._systemPromptOverride };
    }

    // 8. Session key
    const chatId = this._chatId;
    const sessionKey = this._sessionKey || null;

    const config = Object.freeze({
      scenario: effectiveScenario,
      chatId,
      sessionKey,
      contactId: this._contactId || null,
      assistantConfigId,
      defaultContactId: defaultContactId ?? null,
      isDefaultBot,
      isExternalUser,
      assistantConfig,
      provider,
      modelId,
      apiKey,
      workDir,
      agentDir,
      memoryContent,
      memoryPath: memory.path || "",
      channelSend: this._channelSend,
      sendEvent: this._sendEvent,
      sendError: this._sendError,
      engine,
    });

    this._debugLog(config);
    return config;
  }

  // ── private helpers ──

  _resolveApiKey(payloadKey, activeModel, assistantConfigId, defaultContactId, repo, modelConfigId) {
    if (payloadKey) return payloadKey;
    if (activeModel) {
      const inline = (activeModel.apiKey && String(activeModel.apiKey).trim()) || "";
      if (inline) return inline;
      if (repo?.getModelApiKeyFromConfig) {
        const k = repo.getModelApiKeyFromConfig(assistantConfigId, activeModel.id);
        if (k) return k;
      }
    }
    if (modelConfigId && defaultContactId && repo?.getModelApiKey) {
      const k = repo.getModelApiKey(modelConfigId, defaultContactId);
      if (k) return k;
    }
    if (assistantConfigId !== defaultContactId && activeModel?.id && repo?.getModelApiKeyFromConfig) {
      const k = repo.getModelApiKeyFromConfig(defaultContactId, activeModel.id);
      if (k) return k;
    }
    return "";
  }

  async _resolveWorkDir(isDefaultBot, creezHome, appStateStore) {
    if (this._workDirOverride) {
      const d = resolveWorkDir(this._workDirOverride);
      if (d) {
        try { await fs.mkdir(d, { recursive: true }); } catch { /* ignore */ }
        return d;
      }
    }
    if (!isDefaultBot && this._contactId) {
      return ensureBotDir(creezHome, this._contactId);
    }
    const appState = appStateStore ? await appStateStore.getState() : {};
    const raw = appState?.workspaceRoot || null;
    const d = resolveWorkDir(raw) || DEFAULT_WORKSPACE_ROOT;
    try { await fs.mkdir(d, { recursive: true }); } catch { /* ignore */ }
    return d;
  }

  async _fetchRemoteConfig(remoteAgentId, fallbackConfig) {
    try {
      const { pathToFileURL } = require("node:url");
      const mod = await import(pathToFileURL(path.join(__dirname, "remoteAgentConfig.mjs")).href);
      const checked = await mod.checkRemoteAgentById(remoteAgentId);
      if (!checked.exists && checked.reason === "not_found") {
        throw new Error("This bot has been deleted by the author.");
      }
      const remote = checked.config || await mod.fetchRemoteAgentConfig(remoteAgentId);
      if (!remote) throw new Error(`Remote agent config not found (agentId=${remoteAgentId}).`);
      return {
        id: remote.id,
        name: remote.name,
        systemPrompt: remote.systemPrompt,
        skills: remote.skills,
        engineType: remote.engineType || "pi",
        models: fallbackConfig?.models || [],
      };
    } catch (e) {
      console.error(TAG, `_fetchRemoteConfig failed for ${remoteAgentId}:`, e?.message || String(e));
      throw e;
    }
  }

  _debugLog(config) {
    const safe = {
      scenario: config.scenario,
      chatId: config.chatId,
      sessionKey: config.sessionKey,
      contactId: config.contactId,
      assistantConfigId: config.assistantConfigId,
      defaultContactId: config.defaultContactId,
      isDefaultBot: config.isDefaultBot,
      isExternalUser: config.isExternalUser,
      provider: config.provider,
      modelId: config.modelId,
      hasApiKey: Boolean(config.apiKey),
      workDir: config.workDir,
      agentDir: config.agentDir,
      systemPromptLength: config.assistantConfig?.systemPrompt?.length || 0,
      systemPromptPreview: (config.assistantConfig?.systemPrompt || "").slice(0, 200),
      memoryContentLength: config.memoryContent?.length || 0,
    };
    console.log(`${TAG} config:`, JSON.stringify(safe, null, 2));
  }
}

module.exports = { AgentConfigBuilder, VALID_SCENARIOS };
