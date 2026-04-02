/**
 * Fetches agent config from the Creez backend and caches it.
 * Used when a contact has remote_agent_id set.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveCreezBackendBase } = require("./creezBackendBase.cjs");

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map();

function toConfig(agent) {
  const skills = agent.skills_json && typeof agent.skills_json === "object"
    ? agent.skills_json
    : {};
  return {
    id: agent.id,
    name: agent.name || "Agent",
    avatar: agent.avatar_url || null,
    systemPrompt: agent.system_prompt || "",
    greetingMessage: agent.greeting_message || "",
    skills,
    models: [],
    engineType: "pi",
    notifyChannels: Array.isArray(agent.notify_channels) ? agent.notify_channels : [],
  };
}

/**
 * Strict existence check by bot id.
 * Returns { exists, config, reason } where reason can be:
 * - "not_found"  : backend explicitly says this bot does not exist
 * - "unavailable": network/server issues
 */
export async function checkRemoteAgentById(agentId) {
  if (!agentId) return { exists: false, config: null, reason: "not_found" };
  const baseUrl = resolveCreezBackendBase();
  const url = `${baseUrl}/agents/${encodeURIComponent(agentId)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.status === 404) return { exists: false, config: null, reason: "not_found" };
    if (!res.ok) return { exists: false, config: null, reason: "unavailable" };
    const payload = await res.json();
    if (!payload.ok || !payload.data) {
      return { exists: false, config: null, reason: "unavailable" };
    }
    return { exists: true, config: toConfig(payload.data), reason: null };
  } catch (err) {
    console.warn(`[remoteAgentConfig] check failed for agent ${agentId}:`, err?.message || String(err));
    return { exists: false, config: null, reason: "unavailable" };
  }
}

/**
 * Fetch agent config by id from backend.
 * Returns normalized config compatible with local rawConfig shape, or null on failure.
 */
export async function fetchRemoteAgentConfig(agentId) {
  if (!agentId) return null;

  const cached = cache.get(agentId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.config;
  }

  const checked = await checkRemoteAgentById(agentId);
  if (!checked.exists || !checked.config) {
    return cached?.config || null;
  }
  cache.set(agentId, { config: checked.config, expiresAt: Date.now() + CACHE_TTL_MS });
  return checked.config;
}

export function invalidateRemoteAgentCache(agentId) {
  if (agentId) cache.delete(agentId);
  else cache.clear();
}

