const DEFAULT_CONFIG = Object.freeze({
  name: "Assistant",
  avatar: null,
  systemPrompt: "",
  skills: {},
  models: [],
  engineType: "pi",
});

function safeJsonParse(value, fallback) {
  try {
    if (typeof value !== "string" || value.trim() === "") return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function maskApiKey(value) {
  if (!value || typeof value !== "string") return "";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function normalizeModel(model) {
  return {
    id: model?.id ? String(model.id) : `model_${Date.now()}`,
    provider: model?.provider ? String(model.provider) : "openrouter",
    model: model?.model ? String(model.model) : "gpt-4o",
    apiBase: model?.apiBase ? String(model.apiBase) : "",
    apiKey: model?.apiKey ? String(model.apiKey) : "",
    active: Boolean(model?.active),
  };
}

class AssistantConfigRepository {
  constructor(db) {
    this.db = db;
    this.getByIdStmt = db.prepare("SELECT * FROM assistant_config WHERE id = ?");
    this.insertIfMissingStmt = db.prepare(`
      INSERT OR IGNORE INTO assistant_config (
        id, name, avatar_path, system_prompt, skills_json, models_json, engine_type, a2a_strategy_json, updated_at
      ) VALUES (
        @id, @name, @avatar_path, @system_prompt, @skills_json, @models_json, @engine_type, @a2a_strategy_json, @updated_at
      )
    `);
    this.updateByIdStmt = db.prepare(`
      UPDATE assistant_config
      SET name = @name,
          avatar_path = @avatar_path,
          system_prompt = @system_prompt,
          skills_json = @skills_json,
          models_json = @models_json,
          engine_type = @engine_type,
          a2a_strategy_json = @a2a_strategy_json,
          updated_at = @updated_at
      WHERE id = @id
    `);
  }

  _rowToRawConfig(row) {
    if (!row) return null;
    const skills = safeJsonParse(row.skills_json, {});
    const models = safeJsonParse(row.models_json, []).map(normalizeModel);
    const engineType = typeof row.engine_type === "string" && row.engine_type.trim() ? row.engine_type.trim() : "pi";
    return {
      id: row.id,
      name: row.name || DEFAULT_CONFIG.name,
      avatar: row.avatar_path || null,
      systemPrompt: row.system_prompt || "",
      skills: skills && typeof skills === "object" ? skills : {},
      models: Array.isArray(models) ? models : [],
      engineType,
      a2a_strategy_json: safeJsonParse(row.a2a_strategy_json, null),
    };
  }

  /**
   * Get config by id (contact id = config id for bots). Returns null if not found.
   * @param {string|number|null} configOrContactId - Bot contact id (TEXT) or legacy integer id.
   */
  getRawConfigById(configOrContactId) {
    const id = configOrContactId != null ? String(configOrContactId) : null;
    if (!id || id.trim() === "") return null;
    const row = this.getByIdStmt.get(id);
    return this._rowToRawConfig(row);
  }

  /** Get config by id for frontend/settings (masked apiKey). Returns null if not found. */
  getConfigById(assistantConfigId) {
    const raw = this.getRawConfigById(assistantConfigId);
    if (!raw) return null;
    return this._configWithMaskedModels(raw);
  }

  _configWithMaskedModels(raw) {
    return {
      ...raw,
      models: raw.models.map((model) => ({
        ...model,
        apiKeyMasked: maskApiKey(model.apiKey),
        apiKey: "",
      })),
    };
  }

  getModelApiKey(modelId, defaultContactId) {
    const id = modelId != null ? String(modelId) : "";
    if (!id) return "";
    const raw = defaultContactId ? this.getRawConfigById(defaultContactId) : null;
    if (!raw) return "";
    const matched = raw.models.find((model) => model.id === id);
    return matched?.apiKey || "";
  }

  /** Get model API key from a specific config (by assistant_config_id). */
  getModelApiKeyFromConfig(assistantConfigId, modelId) {
    const raw = this.getRawConfigById(assistantConfigId);
    if (!raw || !modelId) return "";
    const matched = raw.models.find((model) => String(model.id) === String(modelId));
    return matched?.apiKey || "";
  }

  saveConfigById(configOrContactId, patch) {
    const id = configOrContactId != null ? String(configOrContactId) : null;
    if (!id || id.trim() === "") {
      throw new Error("configOrContactId (bot contact id) is required.");
    }
    const current = this.getRawConfigById(id) || { id, ...DEFAULT_CONFIG };
    const incoming = patch && typeof patch === "object" ? patch : {};

    const nextModelsInput = Array.isArray(incoming.models) ? incoming.models : current.models;
    const currentById = new Map(current.models.map((m) => [m.id, m]));
    const nextModels = nextModelsInput.map((model) => {
      const normalized = normalizeModel(model);
      if (!normalized.apiKey) {
        const prev = currentById.get(normalized.id);
        if (prev?.apiKey) normalized.apiKey = prev.apiKey;
      }
      return normalized;
    });

    const engineType =
      incoming.engineType != null && String(incoming.engineType).trim()
        ? String(incoming.engineType).trim()
        : (current.engineType || "pi");

    const a2aStrategy = incoming.a2a_strategy_json !== undefined
      ? incoming.a2a_strategy_json
      : (current.a2a_strategy_json || null);

    const merged = {
      name: incoming.name != null ? String(incoming.name) : current.name,
      avatar: incoming.avatar != null ? String(incoming.avatar) : current.avatar,
      systemPrompt: incoming.systemPrompt != null ? String(incoming.systemPrompt) : current.systemPrompt,
      skills: incoming.skills && typeof incoming.skills === "object" ? incoming.skills : current.skills,
      models: nextModels,
      engineType,
      a2a_strategy_json: a2aStrategy,
    };

    const updatedAt = Math.floor(Date.now() / 1000);
    const writePayload = {
      id,
      name: merged.name,
      avatar_path: merged.avatar,
      system_prompt: merged.systemPrompt,
      skills_json: JSON.stringify(merged.skills),
      models_json: JSON.stringify(merged.models),
      engine_type: merged.engineType,
      a2a_strategy_json: a2aStrategy ? JSON.stringify(a2aStrategy) : null,
      updated_at: updatedAt,
    };
    this.insertIfMissingStmt.run(writePayload);
    this.updateByIdStmt.run(writePayload);

    return this.getConfigById(id);
  }
}

module.exports = {
  AssistantConfigRepository,
  DEFAULT_CONFIG,
};
