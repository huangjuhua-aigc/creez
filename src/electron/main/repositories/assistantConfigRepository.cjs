const DEFAULT_CONFIG = Object.freeze({
  name: "Assistant",
  avatar: null,
  systemPrompt: "",
  greetingMessage: "",
  knowledge: "",
  skills: {},
  models: [],
  engineType: "pi",
  agentCardJson: null,
  a2aStrategyJson: null,
  visibility: "public",
  status: "draft",
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

const ALL_COLUMNS = [
  "id", "name", "avatar_path", "system_prompt", "greeting_message",
  "knowledge", "skills_json", "models_json", "engine_type",
  "agent_card_json", "a2a_strategy_json", "visibility", "status", "updated_at",
];

const UPSERT_SQL = `
  INSERT INTO assistant_config (${ALL_COLUMNS.join(", ")})
  VALUES (${ALL_COLUMNS.map((c) => "@" + c).join(", ")})
  ON CONFLICT(id) DO UPDATE SET
    ${ALL_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = @${c}`).join(",\n    ")}
`;

class AssistantConfigRepository {
  constructor(db) {
    this.db = db;
    this.getByIdStmt = db.prepare("SELECT * FROM assistant_config WHERE id = ?");
    this.upsertStmt = db.prepare(UPSERT_SQL);
    this.deleteByIdStmt = db.prepare("DELETE FROM assistant_config WHERE id = ?");
  }

  _rowToRawConfig(row) {
    if (!row) return null;
    const skills = safeJsonParse(row.skills_json, {});
    const models = safeJsonParse(row.models_json, []).map(normalizeModel);
    return {
      id: row.id,
      name: row.name || DEFAULT_CONFIG.name,
      avatar: row.avatar_path || null,
      systemPrompt: row.system_prompt || "",
      greetingMessage: row.greeting_message || "",
      knowledge: row.knowledge || "",
      skills: skills && typeof skills === "object" ? skills : {},
      models: Array.isArray(models) ? models : [],
      engineType: (row.engine_type || "pi").trim(),
      agentCardJson: safeJsonParse(row.agent_card_json, null),
      a2aStrategyJson: safeJsonParse(row.a2a_strategy_json, null),
      visibility: row.visibility || "public",
      status: row.status || "draft",
      updatedAt: row.updated_at || null,
    };
  }

  getRawConfigById(configOrContactId) {
    const id = configOrContactId != null ? String(configOrContactId) : null;
    if (!id || id.trim() === "") return null;
    const row = this.getByIdStmt.get(id);
    return this._rowToRawConfig(row);
  }

  getConfigById(assistantConfigId) {
    const raw = this.getRawConfigById(assistantConfigId);
    if (!raw) return null;
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

  getModelApiKeyFromConfig(assistantConfigId, modelId) {
    const raw = this.getRawConfigById(assistantConfigId);
    if (!raw || !modelId) return "";
    const matched = raw.models.find((model) => String(model.id) === String(modelId));
    return matched?.apiKey || "";
  }

  /**
   * Upsert full config. Patch semantics: undefined fields keep current value.
   */
  saveConfigById(configOrContactId, patch) {
    const id = configOrContactId != null ? String(configOrContactId) : null;
    if (!id || id.trim() === "") {
      throw new Error("configOrContactId (bot contact id) is required.");
    }
    const current = this.getRawConfigById(id) || { id, ...DEFAULT_CONFIG };
    const p = patch && typeof patch === "object" ? patch : {};

    const nextModelsInput = Array.isArray(p.models) ? p.models : current.models;
    const currentById = new Map((current.models || []).map((m) => [m.id, m]));
    const nextModels = nextModelsInput.map((model) => {
      const normalized = normalizeModel(model);
      if (!normalized.apiKey) {
        const prev = currentById.get(normalized.id);
        if (prev?.apiKey) normalized.apiKey = prev.apiKey;
      }
      return normalized;
    });

    const merged = {
      name: p.name != null ? String(p.name) : current.name,
      avatar: p.avatar != null ? String(p.avatar) : current.avatar,
      systemPrompt: p.systemPrompt != null ? String(p.systemPrompt) : current.systemPrompt,
      greetingMessage: p.greetingMessage != null ? String(p.greetingMessage) : current.greetingMessage,
      knowledge: p.knowledge != null ? String(p.knowledge) : current.knowledge,
      skills: p.skills && typeof p.skills === "object" ? p.skills : current.skills,
      models: nextModels,
      engineType: (p.engineType != null && String(p.engineType).trim()) || current.engineType || "pi",
      agentCardJson: p.agentCardJson !== undefined ? p.agentCardJson : current.agentCardJson,
      a2aStrategyJson: p.a2aStrategyJson !== undefined ? p.a2aStrategyJson : current.a2aStrategyJson,
      visibility: p.visibility || current.visibility || "public",
      status: p.status || current.status || "draft",
    };

    this.upsertStmt.run({
      id,
      name: merged.name,
      avatar_path: merged.avatar,
      system_prompt: merged.systemPrompt,
      greeting_message: merged.greetingMessage,
      knowledge: merged.knowledge,
      skills_json: JSON.stringify(merged.skills),
      models_json: JSON.stringify(merged.models),
      engine_type: merged.engineType,
      agent_card_json: merged.agentCardJson ? JSON.stringify(merged.agentCardJson) : null,
      a2a_strategy_json: merged.a2aStrategyJson ? JSON.stringify(merged.a2aStrategyJson) : null,
      visibility: merged.visibility,
      status: merged.status,
      updated_at: Math.floor(Date.now() / 1000),
    });

    return this.getConfigById(id);
  }

  deleteById(id) {
    if (!id) return;
    this.deleteByIdStmt.run(String(id));
  }
}

module.exports = {
  AssistantConfigRepository,
  DEFAULT_CONFIG,
};
