const { randomUUID } = require("node:crypto");

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function safeJsonParse(value, fallback) {
  try {
    if (typeof value !== "string" || value.trim() === "") return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

class ContactRepository {
  constructor(db) {
    this.db = db;
    this.getByIdStmt = db.prepare(
      "SELECT id, type, name, avatar_path, assistant_config_id, is_default, updated_at FROM contacts WHERE id = ?"
    );
  }

  /** Get one contact by id. Returns null if not found. */
  getById(contactId) {
    if (!contactId || typeof contactId !== "string") return null;
    const row = this.getByIdStmt.get(contactId.trim());
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      avatarPath: row.avatar_path || null,
      assistantConfigId: row.assistant_config_id != null ? Number(row.assistant_config_id) : null,
      isDefault: Boolean(row.is_default),
      updatedAt: row.updated_at,
    };
  }

  list(rawParams = {}) {
    const type = typeof rawParams.type === "string" ? rawParams.type.trim() : "";
    const where = type ? "WHERE type = @type" : "";
    const rows = this.db.prepare(`
      SELECT id, type, name, avatar_path, is_default, updated_at
      FROM contacts
      ${where}
      ORDER BY is_default DESC, updated_at DESC
    `).all(type ? { type } : {});

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        name: row.name,
        avatarPath: row.avatar_path || null,
        isDefault: Boolean(row.is_default),
      })),
      total: rows.length,
    };
  }

  /**
   * Returns assistant_config ids for all bot contacts that are not the default (config id 1).
   * Used to sync model config from default bot to other bots (e.g. RoundCloser).
   */
  getNonDefaultBotAssistantConfigIds() {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT assistant_config_id FROM contacts
         WHERE type = 'bot' AND assistant_config_id IS NOT NULL AND assistant_config_id != 1`
      )
      .all();
    return rows.map((r) => Number(r.assistant_config_id)).filter(Number.isFinite);
  }

  createBotFromTemplate(templateId) {
    const id = String(templateId || "").trim();
    if (id !== "vc_fundraising") {
      throw new Error(`Unsupported bot template: ${id || "(empty)"}`);
    }

    const ts = nowTs();
    const defaultConfigRow = this.db.prepare("SELECT * FROM assistant_config WHERE id = 1").get();
    const defaultModels = Array.isArray(safeJsonParse(defaultConfigRow?.models_json, []))
      ? safeJsonParse(defaultConfigRow?.models_json, [])
      : [];
    const activeModel = defaultModels.find((m) => m && m.active) || defaultModels[0] || null;
    const assistantName = "VC Fundraising Bot";
    const assistantSystemPrompt = [
      "You represent the founder in conversations with investors and VC partners.",
      "Focus on fundraising clarity, business narrative, traction, risks, and next actions.",
      "Be concise, professional, and data-grounded. Do not fabricate metrics.",
      "Use knowledge search skills when factual company details are needed.",
    ].join("\n");

    const insertConfig = this.db.prepare(`
      INSERT INTO assistant_config (
        name, avatar_path, system_prompt, skills_json, models_json, updated_at, engine_type
      ) VALUES (
        @name, @avatarPath, @systemPrompt, @skillsJson, @modelsJson, @updatedAt, @engineType
      )
    `);
    const insertContact = this.db.prepare(`
      INSERT INTO contacts (id, type, name, avatar_path, assistant_config_id, is_default, created_at, updated_at)
      VALUES (@id, 'bot', @name, @avatarPath, @assistantConfigId, 0, @createdAt, @updatedAt)
    `);
    const insertChat = this.db.prepare(`
      INSERT INTO chats (id, contact_id, created_at, updated_at, last_message_at)
      VALUES (@id, @contactId, @createdAt, @updatedAt, @lastMessageAt)
    `);
    const insertMessage = this.db.prepare(`
      INSERT INTO messages (id, chat_id, sender, bot_id, content, status, model_used, created_at, updated_at)
      VALUES (@id, @chatId, 'assistant', @botId, @content, 'done', @modelUsed, @createdAt, @updatedAt)
    `);

    const tx = this.db.transaction(() => {
      const insertConfigResult = insertConfig.run({
        name: assistantName,
        avatarPath: null,
        systemPrompt: assistantSystemPrompt,
        skillsJson: JSON.stringify({}),
        modelsJson: JSON.stringify(
          activeModel
            ? [{ ...activeModel, active: true }]
            : [{ id: `model_${Date.now()}`, provider: "openrouter", model: "minimax/minimax-m2.5", apiKey: "", active: true }]
        ),
        updatedAt: ts,
        engineType: "pi",
      });
      const assistantConfigId = Number(insertConfigResult.lastInsertRowid);
      const contactId = randomUUID();
      const chatId = randomUUID();
      const messageId = randomUUID();
      const welcome = "你好，我是你的 VC 融资助手。可以先从电梯陈述、融资目标和关键数据开始。";

      insertContact.run({
        id: contactId,
        name: assistantName,
        avatarPath: null,
        assistantConfigId,
        createdAt: ts,
        updatedAt: ts,
      });
      insertChat.run({
        id: chatId,
        contactId,
        createdAt: ts,
        updatedAt: ts,
        lastMessageAt: ts,
      });
      insertMessage.run({
        id: messageId,
        chatId,
        botId: contactId,
        content: welcome,
        modelUsed: activeModel?.model ? String(activeModel.model) : null,
        createdAt: ts,
        updatedAt: ts,
      });
      return { contactId, chatId, assistantConfigId, messageId, name: assistantName };
    });

    return tx();
  }
}

module.exports = {
  ContactRepository,
};
