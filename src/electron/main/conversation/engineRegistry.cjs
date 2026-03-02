/**
 * Resolves the conversation engine and assistant config for a contact.
 * Engine type is read from assistant_config.engine_type (default 'pi').
 */

const { PiConversationEngine } = require("./PiConversationEngine.cjs");

const ENGINES = new Map();
function getPiEngine() {
  if (!ENGINES.has("pi")) {
    ENGINES.set("pi", new PiConversationEngine());
  }
  return ENGINES.get("pi");
}

/**
 * Register an engine for a given type (e.g. 'api'). Used when adding non-pi engines.
 * @param {string} engineType
 * @param {object} engineInstance - Object with init, prompt, setModel?, abort?, hasSession?
 */
function registerEngine(engineType, engineInstance) {
  if (engineType && typeof engineType === "string" && engineInstance) {
    ENGINES.set(engineType.trim().toLowerCase(), engineInstance);
  }
}

/**
 * Get the conversation engine and raw assistant config for the given contact.
 * If contactId is missing or contact not found, falls back to default config (id=1).
 *
 * @param {string|null|undefined} contactId - Contact id (optional)
 * @param {{ contactRepository: { getById: (id) => any }, assistantConfigRepository: { getRawConfigById: (id) => any, getRawConfig: () => any } }} deps
 * @returns {{ engine: object, rawConfig: object, assistantConfigId: number }}
 */
function getEngineForContact(contactId, deps) {
  const contactRepo = deps?.contactRepository;
  const configRepo = deps?.assistantConfigRepository;
  const defaultRaw = configRepo ? configRepo.getRawConfig() : { id: 1, engineType: "pi", models: [], skills: {}, name: "Assistant", avatar: null, systemPrompt: "" };

  let assistantConfigId = 1;
  let rawConfig = defaultRaw;
  let contactResolved = false;

  if (contactId && contactRepo) {
    const contact = contactRepo.getById(contactId);
    if (contact && contact.assistantConfigId != null) {
      assistantConfigId = contact.assistantConfigId;
      contactResolved = true;
      if (configRepo) {
        const byId = configRepo.getRawConfigById(assistantConfigId);
        if (byId) rawConfig = byId;
      }
    }
  } else if (configRepo) {
    rawConfig = configRepo.getRawConfig();
    assistantConfigId = rawConfig.id != null ? rawConfig.id : 1;
  }

  const engineType = (rawConfig.engineType && String(rawConfig.engineType).trim()) || "pi";
  const key = engineType.toLowerCase();
  let engine = ENGINES.get(key);
  if (!engine) {
    if (key === "pi") engine = getPiEngine();
    else engine = getPiEngine(); // fallback to pi for unknown type
  }

  if (typeof console?.log === "function") {
    console.log("[creezv2 engineRegistry] getEngineForContact", {
      contactId: contactId ?? null,
      contactResolved,
      assistantConfigId,
      engineType,
      modelCount: rawConfig?.models?.length ?? 0,
    });
  }

  return { engine, rawConfig, assistantConfigId };
}

module.exports = {
  getEngineForContact,
  registerEngine,
  getPiEngine,
};
