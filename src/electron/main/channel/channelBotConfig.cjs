/**
 * Resolve engine + rawConfig for a channel bot (Feishu/WeCom inbound).
 *
 * - Local contact in DB → getEngineForContact + optional remote merge when remote_agent_id is set
 * - No local row (e.g. Agent Builder id only) → fetch remote agent by id and use default bot's models for API keys
 *
 * Mirrors agentIpc AGENT_INIT resolution so channel traffic uses the same prompt merge as in-app chat (non-default Pi builtins: agent-runner registry, not skills_json allowlist).
 */

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { getEngineForContact, getPiEngine } = require("../conversation/engineRegistry.cjs");

let _remoteHelpers = null;
async function getRemoteHelpers() {
  if (!_remoteHelpers) {
    const mod = await import(pathToFileURL(path.join(__dirname, "..", "remoteAgentConfig.mjs")).href);
    _remoteHelpers = {
      fetchRemoteAgentConfig: mod.fetchRemoteAgentConfig,
      checkRemoteAgentById: mod.checkRemoteAgentById,
    };
  }
  return _remoteHelpers;
}

/**
 * @param {string} botId
 * @param {{ contactRepository: object, assistantConfigRepository: object }} deps
 * @returns {Promise<{ engine: object, rawConfig: object, assistantConfigId: string, defaultContactId: string }>}
 */
async function resolveChannelBotConfig(botId, deps) {
  const { contactRepository, assistantConfigRepository } = deps;
  const id = botId != null ? String(botId).trim() : "";
  if (!id) {
    return getEngineForContact(null, deps);
  }

  const defaultContactId = contactRepository.getDefaultAssistantConfigId();
  const contact = contactRepository.getById(id);

  const mergeRemote = (baseRaw, remoteConfig) => ({
    ...baseRaw,
    id: remoteConfig.id,
    name: remoteConfig.name,
    systemPrompt: remoteConfig.systemPrompt,
    skills: remoteConfig.skills && typeof remoteConfig.skills === "object" ? remoteConfig.skills : {},
    engineType: remoteConfig.engineType || "pi",
    models: Array.isArray(baseRaw?.models) ? baseRaw.models : [],
  });

  if (contact) {
    let { engine, rawConfig, assistantConfigId, defaultContactId: defId } = getEngineForContact(id, deps);
    const remoteId = contact.remoteAgentId || null;
    if (remoteId) {
      try {
        const { checkRemoteAgentById, fetchRemoteAgentConfig } = await getRemoteHelpers();
        const checked = await checkRemoteAgentById(remoteId);
        const remoteConfig = checked.config || (await fetchRemoteAgentConfig(remoteId));
        if (remoteConfig) {
          rawConfig = mergeRemote(rawConfig, remoteConfig);
        }
      } catch (e) {
        console.warn("[channelBotConfig] remote merge failed for contact", id, e?.message || e);
      }
    }
    return { engine, rawConfig, assistantConfigId, defaultContactId: defId };
  }

  // No local contact — typical for Agent Builder agents saved only on backend
  try {
    const { checkRemoteAgentById, fetchRemoteAgentConfig } = await getRemoteHelpers();
    const checked = await checkRemoteAgentById(id);
    const remoteConfig = checked.config || (await fetchRemoteAgentConfig(id));
    if (checked.exists && remoteConfig) {
      const defaultRaw = assistantConfigRepository.getRawConfigById(defaultContactId);
      const models = Array.isArray(defaultRaw?.models) ? defaultRaw.models : [];
      const rawConfig = {
        id: remoteConfig.id,
        name: remoteConfig.name,
        systemPrompt: remoteConfig.systemPrompt,
        skills: remoteConfig.skills && typeof remoteConfig.skills === "object" ? remoteConfig.skills : {},
        engineType: "pi",
        models,
      };
      return {
        engine: getPiEngine(),
        rawConfig,
        assistantConfigId: id,
        defaultContactId,
      };
    }
  } catch (e) {
    console.warn("[channelBotConfig] remote-only resolve failed", id, e?.message || e);
  }

  return getEngineForContact(id, deps);
}

/**
 * API key for channel runs: same as agentIpc — try assistant row, then default bot for non-default agents.
 */
function resolveModelApiKey({ assistantConfigRepository, assistantConfigId, defaultContactId, activeModel }) {
  if (!activeModel?.id) return "";
  let apiKey = (activeModel.apiKey && String(activeModel.apiKey).trim()) || "";
  if (apiKey) return apiKey;
  if (assistantConfigRepository?.getModelApiKeyFromConfig) {
    apiKey = assistantConfigRepository.getModelApiKeyFromConfig(assistantConfigId, activeModel.id) || "";
  }
  if (!apiKey && assistantConfigId !== defaultContactId && assistantConfigRepository?.getModelApiKeyFromConfig) {
    apiKey = assistantConfigRepository.getModelApiKeyFromConfig(defaultContactId, activeModel.id) || "";
  }
  return apiKey || "";
}

module.exports = {
  resolveChannelBotConfig,
  resolveModelApiKey,
};
