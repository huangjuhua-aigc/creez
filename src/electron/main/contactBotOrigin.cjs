/**
 * Resolves contacts.bot_origin for UI: assistant | author | remote | template.
 * Fetches /agents/mine once to backfill author rows where bot_origin is still NULL.
 * Does not overwrite explicit `remote` (see ContactRepository.backfillAuthorBotOrigin).
 */

const { resolveCreezBackendBase } = require("./creezBackendBase.cjs");

const FETCH_MS = 12_000;

/**
 * @param {object} contactRepository
 * @param {{ getState: () => Promise<object> } | null | undefined} appStateStore
 */
async function syncContactBotOrigins(contactRepository, appStateStore) {
  if (!contactRepository || typeof contactRepository.backfillAuthorBotOrigin !== "function") return;
  const owned = await fetchOwnedAgentIds(appStateStore);
  contactRepository.backfillAuthorBotOrigin(owned);
  contactRepository.backfillRemoteBotOrigin();
}

/**
 * @param {{ getState: () => Promise<object> } | null | undefined} appStateStore
 * @returns {Promise<Set<string>>}
 */
async function fetchOwnedAgentIds(appStateStore) {
  const out = new Set();
  if (!appStateStore || typeof appStateStore.getState !== "function") return out;
  let deviceId = "";
  try {
    const state = await appStateStore.getState();
    deviceId = String(state?.deviceId || "").trim();
  } catch {
    return out;
  }
  if (!deviceId) return out;
  const baseUrl = resolveCreezBackendBase().replace(/\/+$/, "");
  const url = `${baseUrl}/agents/mine?device_id=${encodeURIComponent(deviceId)}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (!body?.ok || !Array.isArray(body.data?.items)) return out;
    for (const a of body.data.items) {
      const id = String(a?.id || "").trim();
      if (id) out.add(id);
    }
    return out;
  } catch {
    return out;
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  syncContactBotOrigins,
  fetchOwnedAgentIds,
};
