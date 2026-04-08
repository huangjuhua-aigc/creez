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
      "SELECT id, type, name, avatar_path, is_default, updated_at, remote_agent_id, bot_origin FROM contacts WHERE id = ?"
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
      botOrigin: row.bot_origin || null,
    };
  }

  /**
   * Mark contacts that belong to this device as author-created (Agent Builder).
   * Only fills NULL/empty bot_origin — never overwrites explicit `remote` (e.g. same device
   * testing subscriber flow via discover for an agent this device also created).
   * @param {Set<string> | string[]} ownedAgentIds
   */
  backfillAuthorBotOrigin(ownedAgentIds) {
    if (!ownedAgentIds) return;
    if (ownedAgentIds instanceof Set && ownedAgentIds.size === 0) return;
    if (Array.isArray(ownedAgentIds) && ownedAgentIds.length === 0) return;
    const ids = ownedAgentIds instanceof Set ? [...ownedAgentIds] : ownedAgentIds;
    const stmt = this.db.prepare(`
      UPDATE contacts
      SET bot_origin = 'author'
      WHERE id = ?
        AND type = 'bot'
        AND is_default = 0
        AND (bot_origin IS NULL OR TRIM(bot_origin) = '')
    `);
    for (const id of ids) {
      const sid = String(id || "").trim();
      if (sid) stmt.run(sid);
    }
  }

  /** Remaining NULL bot_origin with remote_agent_id → remote (他人 / 广场添加). */
  backfillRemoteBotOrigin() {
    this.db.prepare(`
      UPDATE contacts
      SET bot_origin = 'remote'
      WHERE type = 'bot'
        AND is_default = 0
        AND (bot_origin IS NULL OR TRIM(bot_origin) = '')
        AND remote_agent_id IS NOT NULL
        AND TRIM(remote_agent_id) != ''
    `).run();
  }

  list(rawParams = {}) {
    const type = typeof rawParams.type === "string" ? rawParams.type.trim() : "";
    const where = type ? "WHERE type = @type" : "";
    const rows = this.db.prepare(`
      SELECT id, type, name, avatar_path, is_default, updated_at, remote_agent_id, bot_origin
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
        remoteAgentId: row.remote_agent_id || null,
        botOrigin: row.bot_origin || null,
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
      INSERT INTO contacts (id, type, name, avatar_path, is_default, created_at, updated_at, bot_origin)
      VALUES (@id, 'bot', @name, @avatarPath, 0, @createdAt, @updatedAt, 'template')
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
   * Delete a non-default contact and all its chats and messages.
   * Returns { deleted: true } on success.
   */
  deleteContact(contactId) {
    if (!contactId) throw new Error("contactId is required");
    const contact = this.getById(contactId);
    if (!contact) throw new Error("Contact not found");
    if (contact.isDefault) throw new Error("Cannot delete the default bot");

    const tx = this.db.transaction(() => {
      const chatRows = this.db.prepare("SELECT id FROM chats WHERE contact_id = ?").all(contactId);
      const chatIds = chatRows.map((r) => r.id);
      for (const chatId of chatIds) {
        this.db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chatId);
      }
      this.db.prepare("DELETE FROM chats WHERE contact_id = ?").run(contactId);
      this.db.prepare("DELETE FROM contacts WHERE id = ?").run(contactId);
      return { deleted: true, chatsRemoved: chatIds.length };
    });

    return tx();
  }

  updateBotMeta(contactId, patch) {
    if (!contactId) return;
    const existing = this.getById(contactId);
    if (!existing) return;
    const name = patch?.name != null ? String(patch.name).trim() : null;
    const avatarPath = patch?.avatar_path != null ? String(patch.avatar_path).trim() || null : null;
    const sets = [];
    const params = { id: contactId, updated_at: nowTs() };
    if (name) { sets.push("name = @name"); params.name = name; }
    if (avatarPath !== undefined && patch?.avatar_path != null) {
      sets.push("avatar_path = @avatar_path");
      params.avatar_path = avatarPath;
    }
    if (sets.length === 0) return;
    sets.push("updated_at = @updated_at");
    this.db.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = @id`).run(params);
  }

  /**
   * After Agent Builder creates an agent on the backend, ensure a local contact + assistant_config + creez_app chat.
   * Uses backend UUID as local contact id (same as addRemoteAgent). Idempotent if contact already exists.
   */
  ensureAuthorCreatedAgent(agentPayload) {
    const agentId = String(agentPayload?.id || "").trim();
    if (!agentId) throw new Error("agent id is required");
    if (this.getById(agentId)) {
      this.db.prepare(`
        UPDATE contacts SET bot_origin = 'author'
        WHERE id = ? AND type = 'bot' AND bot_origin != 'author'
      `).run(agentId);
      return { contactId: agentId, alreadyExists: true };
    }

    const defaultContactId = this.getDefaultAssistantConfigId();
    const defaultConfigRow = this.db.prepare("SELECT models_json FROM assistant_config WHERE id = ?").get(defaultContactId);
    const modelsJson =
      typeof defaultConfigRow?.models_json === "string" && defaultConfigRow.models_json.trim() !== ""
        ? defaultConfigRow.models_json
        : "[]";

    const ts = nowTs();
    const name = String(agentPayload.name || "Agent").trim() || "Agent";
    const avatarPath =
      agentPayload.avatar_url != null && String(agentPayload.avatar_url).trim() !== ""
        ? String(agentPayload.avatar_url)
        : null;
    const systemPrompt =
      typeof agentPayload.system_prompt === "string" ? agentPayload.system_prompt : "";
    let skills = {};
    const sj = agentPayload.skills_json;
    if (sj && typeof sj === "object" && !Array.isArray(sj)) {
      skills = sj;
    } else if (typeof sj === "string") {
      skills = safeJsonParse(sj, {});
    }
    const skillsJson = JSON.stringify(skills && typeof skills === "object" ? skills : {});
    const greeting =
      agentPayload.greeting_message != null ? String(agentPayload.greeting_message).trim() : "";

    const chatId = randomUUID();
    const messageId = randomUUID();

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO assistant_config (
          id, name, avatar_path, system_prompt, skills_json, models_json, updated_at, engine_type
        ) VALUES (@id, @name, @avatarPath, @systemPrompt, @skillsJson, @modelsJson, @updatedAt, 'pi')
      `).run({
        id: agentId,
        name,
        avatarPath,
        systemPrompt: systemPrompt,
        skillsJson,
        modelsJson,
        updatedAt: ts,
      });

      this.db.prepare(`
        INSERT INTO contacts (id, type, name, avatar_path, is_default, created_at, updated_at, remote_agent_id, bot_origin)
        VALUES (@id, 'bot', @name, @avatarPath, 0, @createdAt, @updatedAt, @remoteAgentId, 'author')
      `).run({
        id: agentId,
        name,
        avatarPath,
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

      if (greeting) {
        this.db.prepare(`
          INSERT INTO messages (id, chat_id, sender, bot_id, content, status, created_at, updated_at)
          VALUES (@id, @chatId, 'assistant', @botId, @content, 'done', @createdAt, @updatedAt)
        `).run({
          id: messageId,
          chatId,
          botId: agentId,
          content: greeting,
          createdAt: ts,
          updatedAt: ts,
        });
      }

      return { contactId: agentId, chatId, alreadyExists: false };
    });

    return tx();
  }

  /**
   * Add a remote (published) agent as a local contact.
   * Uses the agent's backend UUID as the local contact id so botId / assistantConfigId stays consistent.
   * If the contact already exists (e.g. author row from Agent Builder), mark it `remote` so chat routes via A2A.
   */
  addRemoteAgent({ agentId, name, avatarUrl, greetingMessage }) {
    if (!agentId) throw new Error("agentId is required");
    const existing = this.getById(agentId);
    if (existing) {
      if (existing.type === "bot" && !existing.isDefault) {
        const ts = nowTs();
        const nameFinal = String(name || existing.name || "Agent").trim() || "Agent";
        let avatarFinal = existing.avatarPath || null;
        if (avatarUrl != null && String(avatarUrl).trim() !== "") {
          avatarFinal = String(avatarUrl).trim();
        }
        this.db
          .prepare(
            `
          UPDATE contacts
          SET bot_origin = 'remote',
              remote_agent_id = @remoteAgentId,
              name = @name,
              avatar_path = @avatarPath,
              updated_at = @updatedAt
          WHERE id = @id AND type = 'bot' AND is_default = 0
        `
          )
          .run({
            id: agentId,
            remoteAgentId: agentId,
            name: nameFinal,
            avatarPath: avatarFinal,
            updatedAt: ts,
          });
      }
      const chatRow = this.db
        .prepare(
          `
        SELECT id FROM chats
        WHERE contact_id = ?
          AND channel_type = 'creez_app'
          AND (channel_chat_id IS NULL OR channel_chat_id = '')
        LIMIT 1
      `
        )
        .get(agentId);
      return { contactId: existing.id, chatId: chatRow?.id || null, alreadyExists: true };
    }

    const ts = nowTs();
    const chatId = randomUUID();
    const messageId = randomUUID();

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO contacts (id, type, name, avatar_path, is_default, created_at, updated_at, remote_agent_id, bot_origin)
        VALUES (@id, 'bot', @name, @avatarPath, 0, @createdAt, @updatedAt, @remoteAgentId, 'remote')
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
