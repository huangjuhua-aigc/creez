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
      "SELECT id, type, name, avatar_path, is_default, updated_at, remote_agent_id FROM contacts WHERE id = ?"
    );
  }

  /** Get one contact by id. Returns null if not found. For bots, config id = contact id. */
  getById(contactId) {
    if (!contactId || typeof contactId !== "string") return null;
    const row = this.getByIdStmt.get(contactId.trim());
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      avatarPath: row.avatar_path || null,
      assistantConfigId: row.id,
      isDefault: Boolean(row.is_default),
      updatedAt: row.updated_at,
      remoteAgentId: row.remote_agent_id || null,
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
   * Returns the contact id of the default bot (config id = contact id; user edits this in Settings).
   */
  getDefaultAssistantConfigId() {
    const row = this.db
      .prepare(
        "SELECT id FROM contacts WHERE type = 'bot' AND is_default = 1 LIMIT 1"
      )
      .get();
    const id = row?.id != null ? String(row.id).trim() : null;
    return id || "11111111-1111-1111-1111-111111111111";
  }

  /**
   * Returns contact ids of all bot contacts that are not the default bot (config id = contact id).
   * Used to sync model config from default bot to other bots.
   */
  getNonDefaultBotAssistantConfigIds() {
    const defaultContactId = this.getDefaultAssistantConfigId();
    const rows = this.db
      .prepare(
        `SELECT id FROM contacts WHERE type = 'bot' AND id != ?`
      )
      .all(defaultContactId);
    return rows.map((r) => String(r.id)).filter(Boolean);
  }

  createBotFromTemplate(templateId) {
    const id = String(templateId || "").trim();
    if (id !== "vc_fundraising") {
      throw new Error(`Unsupported bot template: ${id || "(empty)"}`);
    }

    const ts = nowTs();
    const defaultContactId = this.getDefaultAssistantConfigId();
    const defaultConfigRow = this.db.prepare("SELECT * FROM assistant_config WHERE id = ?").get(defaultContactId);
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
        id, name, avatar_path, system_prompt, skills_json, models_json, updated_at, engine_type
      ) VALUES (
        @id, @name, @avatarPath, @systemPrompt, @skillsJson, @modelsJson, @updatedAt, @engineType
      )
    `);
    const insertContact = this.db.prepare(`
      INSERT INTO contacts (id, type, name, avatar_path, is_default, created_at, updated_at)
      VALUES (@id, 'bot', @name, @avatarPath, 0, @createdAt, @updatedAt)
    `);
    const insertChat = this.db.prepare(`
      INSERT INTO chats (id, contact_id, channel_type, created_at, updated_at, last_message_at)
      VALUES (@id, @contactId, 'creez_app', @createdAt, @updatedAt, @lastMessageAt)
    `);
    const insertMessage = this.db.prepare(`
      INSERT INTO messages (id, chat_id, sender, bot_id, content, status, model_used, created_at, updated_at)
      VALUES (@id, @chatId, 'assistant', @botId, @content, 'done', @modelUsed, @createdAt, @updatedAt)
    `);

    const contactId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    const tx = this.db.transaction(() => {
      insertConfig.run({
        id: contactId,
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
      const welcome = "你好，我是你的 VC 融资助手。可以先从电梯陈述、融资目标和关键数据开始。";

      insertContact.run({
        id: contactId,
        name: assistantName,
        avatarPath: null,
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
      return { contactId, chatId, assistantConfigId: contactId, messageId, name: assistantName };
    });

    return tx();
  }

  /**
   * Add a remote (published) agent as a local contact.
   * Uses the agent's backend UUID as the local contact id so botId / assistantConfigId stays consistent.
   */
  addRemoteAgent({ agentId, name, avatarUrl, greetingMessage }) {
    if (!agentId) throw new Error("agentId is required");
    const existing = this.getById(agentId);
    if (existing) {
      return { contactId: existing.id, chatId: null, alreadyExists: true };
    }

    const ts = nowTs();
    const chatId = randomUUID();
    const messageId = randomUUID();

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO contacts (id, type, name, avatar_path, is_default, created_at, updated_at, remote_agent_id)
        VALUES (@id, 'bot', @name, @avatarPath, 0, @createdAt, @updatedAt, @remoteAgentId)
      `).run({
        id: agentId,
        name: name || "Agent",
        avatarPath: avatarUrl || null,
        createdAt: ts,
        updatedAt: ts,
        remoteAgentId: agentId,
      });

      this.db.prepare(`
        INSERT INTO chats (id, contact_id, channel_type, created_at, updated_at, last_message_at)
        VALUES (@id, @contactId, 'creez_app', @createdAt, @updatedAt, @lastMessageAt)
      `).run({
        id: chatId,
        contactId: agentId,
        createdAt: ts,
        updatedAt: ts,
        lastMessageAt: ts,
      });

      if (greetingMessage) {
        this.db.prepare(`
          INSERT INTO messages (id, chat_id, sender, bot_id, content, status, created_at, updated_at)
          VALUES (@id, @chatId, 'assistant', @botId, @content, 'done', @createdAt, @updatedAt)
        `).run({
          id: messageId,
          chatId,
          botId: agentId,
          content: greetingMessage,
          createdAt: ts,
          updatedAt: ts,
        });
      }

      return { contactId: agentId, chatId, alreadyExists: false };
    });

    return tx();
  }
}

module.exports = {
  ContactRepository,
};
