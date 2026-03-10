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
 * Config id = contact id for bots.
 *
 * @param {string|null|undefined} contactId - Contact id (optional)
 * @param {{ contactRepository: { getById: (id) => any, getDefaultAssistantConfigId: () => string } }, assistantConfigRepository: { getRawConfigById: (id) => any } }} deps
 * @returns {{ engine: object, rawConfig: object, assistantConfigId: string, defaultContactId: string }}
 */
function getEngineForContact(contactId, deps) {
  const contactRepo = deps?.contactRepository;
  const configRepo = deps?.assistantConfigRepository;
  const defaultContactId = contactRepo?.getDefaultAssistantConfigId?.() ?? "11111111-1111-1111-1111-111111111111";
  const defaultRaw = configRepo ? configRepo.getRawConfigById(defaultContactId) : null;
  const fallbackRaw = { id: defaultContactId, engineType: "pi", models: [], skills: {}, name: "Assistant", avatar: null, systemPrompt: "" };

  let assistantConfigId = defaultContactId;
  let rawConfig = defaultRaw || fallbackRaw;
  let contactResolved = false;

  if (contactId && contactRepo) {
    const contact = contactRepo.getById(contactId);
    if (contact) {
      assistantConfigId = contact.id;
      contactResolved = true;
      if (configRepo) {
        const byId = configRepo.getRawConfigById(assistantConfigId);
        if (byId) rawConfig = byId;
      }
    }
  } else if (configRepo && defaultRaw) {
    rawConfig = defaultRaw;
    assistantConfigId = defaultContactId;
  }

  const engineType = (rawConfig.engineType && String(rawConfig.engineType).trim()) || "pi";
  const key = engineType.toLowerCase();
  let engine = ENGINES.get(key);
  if (!engine) {
    if (key === "pi") engine = getPiEngine();
    else engine = getPiEngine(); // fallback to pi for unknown type
  }

  return { engine, rawConfig, assistantConfigId, defaultContactId };
}

module.exports = {
  getEngineForContact,
  registerEngine,
  getPiEngine,
};
