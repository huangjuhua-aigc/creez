const { randomUUID } = require("node:crypto");

function normalizeListParams(params = {}) {
  const limit = Number.isFinite(Number(params.limit)) ? Math.max(1, Math.min(200, Number(params.limit))) : 30;
  const offset = Number.isFinite(Number(params.offset)) ? Math.max(0, Number(params.offset)) : 0;
  const keyword = typeof params.keyword === "string" ? params.keyword.trim() : "";
  return { limit, offset, keyword };
}

function normalizeMessagesParams(params = {}) {
  const chatId = params.chatId == null ? "" : String(params.chatId);
  const limit = Number.isFinite(Number(params.limit)) ? Math.max(1, Math.min(200, Number(params.limit))) : 50;
  const before = params.before == null ? null : Number(params.before);
  return { chatId, limit, before: Number.isFinite(before) ? before : null };
}

class ChatRepository {
  constructor(db) {
    this.db = db;
  }

  /** Only list "main" chats: one per contact (creez_app, no channel_chat_id). Channel messages (e.g. Feishu) are stored in the same chat and marked by message.channel_type. */
  static MAIN_CHAT_WHERE = " (c.channel_type = 'creez_app' AND (c.channel_chat_id IS NULL OR c.channel_chat_id = '')) ";

  list(rawParams) {
    const { limit, offset, keyword } = normalizeListParams(rawParams);
    const mainWhere = "WHERE " + ChatRepository.MAIN_CHAT_WHERE;
    const where = keyword ? mainWhere + " AND ct.name LIKE @keyword" : mainWhere;
    const listSql = `
      SELECT
        c.id,
        c.contact_id,
        c.channel_type,
        c.channel_chat_id,
        c.last_message_at,
        c.updated_at,
        ct.name AS contact_name,
        ct.avatar_path AS contact_avatar_path,
        ct.bot_origin AS contact_bot_origin,
        (
          SELECT m.content
          FROM messages m
          WHERE m.chat_id = c.id
          ORDER BY m.created_at DESC, m.rowid DESC
          LIMIT 1
        ) AS last_message
        ,
        (
          SELECT m.model_used
          FROM messages m
          WHERE m.chat_id = c.id
            AND m.sender = 'assistant'
          ORDER BY m.created_at DESC, m.rowid DESC
          LIMIT 1
        ) AS last_model_used
      FROM chats c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
      ${where}
      ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
      LIMIT @limit OFFSET @offset
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM chats c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
      ${where}
    `;

    const bindings = keyword ? { keyword: `%${keyword}%`, limit, offset } : { limit, offset };
    const rows = this.db.prepare(listSql).all(bindings);
    const totalRow = this.db.prepare(countSql).get(keyword ? { keyword: `%${keyword}%` } : {});

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.contact_name || "Untitled",
        contactId: row.contact_id || null,
        contactAvatarPath: row.contact_avatar_path || null,
        contactBotOrigin: row.contact_bot_origin || null,
        lastMessage: row.last_message || null,
        lastMessageAt: row.last_message_at || null,
        unreadCount: 0,
        modelUsed: row.last_model_used || null,
        channelType: row.channel_type ?? "creez_app",
        channelChatId: row.channel_chat_id ?? null,
      })),
      total: Number(totalRow?.total || 0),
    };
  }

  getMessages(rawParams) {
    const { chatId, limit, before } = normalizeMessagesParams(rawParams);
    if (!chatId) {
      return { items: [], hasMore: false, nextBefore: null };
    }

    const whereBefore = before == null ? "" : "AND m.created_at < @before";
    const sql = `
      SELECT
        m.id,
        m.chat_id,
        m.sender,
        m.content,
        m.bot_id,
        m.status,
        m.model_used,
        m.tool_calls,
        m.channel_type,
        m.channel_message_id,
        m.created_at
      FROM messages m
      WHERE m.chat_id = @chatId
      ${whereBefore}
      ORDER BY m.created_at DESC, m.rowid DESC
      LIMIT @limitPlusOne
    `;

    const rows = this.db.prepare(sql).all({
      chatId,
      before,
      limitPlusOne: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map((row) => {
      let toolCalls = null;
      if (row.tool_calls != null && String(row.tool_calls).trim() !== "") {
        try {
          toolCalls = JSON.parse(row.tool_calls);
          if (!Array.isArray(toolCalls)) toolCalls = null;
        } catch {
          toolCalls = null;
        }
      }
      return {
        id: row.id,
        chatId: row.chat_id,
        sender: row.sender,
        content: row.content,
        botId: row.bot_id || null,
        createdAt: Number(row.created_at),
        status: row.status,
        modelUsed: row.model_used || null,
        toolCalls,
        channelType: row.channel_type ?? null,
        channelMessageId: row.channel_message_id ?? null,
      };
    });

    const nextBefore = hasMore && items.length > 0 ? items[items.length - 1].createdAt : null;
    return { items, hasMore, nextBefore };
  }

  getOrCreateByContactId(rawPayload = {}) {
    return this.getOrCreateMainChatForContact(rawPayload);
  }

  /**
   * Get or create the single "main" chat for a contact (one conversation per bot).
   * All messages (local + Feishu etc.) go into this chat; message.channel_type marks source.
   */
  getOrCreateMainChatForContact(rawPayload = {}) {
    const contactId = String(rawPayload.contactId || "").trim();
    if (!contactId) throw new Error("contactId is required.");

    const existing = this.db
      .prepare(
        `SELECT id FROM chats WHERE contact_id = ? AND channel_type = 'creez_app' AND (channel_chat_id IS NULL OR channel_chat_id = '') LIMIT 1`
      )
      .get(contactId);
    if (existing?.id) {
      return { chatId: String(existing.id), created: false };
    }

    const chatId = randomUUID();
    const nowTs = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO chats (id, contact_id, channel_type, channel_chat_id, created_at, updated_at, last_message_at)
         VALUES (@id, @contactId, 'creez_app', NULL, @createdAt, @updatedAt, @lastMessageAt)`
      )
      .run({
        id: chatId,
        contactId,
        createdAt: nowTs,
        updatedAt: nowTs,
        lastMessageAt: nowTs,
      });
    return { chatId, created: true };
  }

  /**
   * Find or create a chat for a channel (e.g. Feishu). Used so channel messages
   * are stored in the same conversation table and appear under the default bot.
   */
  getOrCreateChatForChannel(rawPayload = {}) {
    const contactId = String(rawPayload.contactId || "").trim();
    const channelType = String(rawPayload.channelType || "feishu").trim();
    const channelChatId = rawPayload.channelChatId != null ? String(rawPayload.channelChatId).trim() : "";
    if (!contactId || !channelType) throw new Error("contactId and channelType are required.");
    if (!channelChatId) throw new Error("channelChatId is required for channel chats.");

    const existing = this.db
      .prepare(
        "SELECT id FROM chats WHERE contact_id = ? AND channel_type = ? AND channel_chat_id = ? LIMIT 1"
      )
      .get(contactId, channelType, channelChatId);
    if (existing?.id) {
      return { chatId: String(existing.id), created: false };
    }

    const chatId = randomUUID();
    const nowTs = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO chats (id, contact_id, channel_type, channel_chat_id, created_at, updated_at, last_message_at)
         VALUES (@id, @contactId, @channelType, @channelChatId, @createdAt, @updatedAt, @lastMessageAt)`
      )
      .run({
        id: chatId,
        contactId,
        channelType,
        channelChatId,
        createdAt: nowTs,
        updatedAt: nowTs,
        lastMessageAt: nowTs,
      });
    return { chatId, created: true };
  }

  appendMessage(rawPayload = {}) {
    const chatId = String(rawPayload.chatId || "").trim();
    const sender = String(rawPayload.sender || "").trim();
    const content = String(rawPayload.content || "");
    const id = String(rawPayload.id || `${Date.now()}`);
    if (!chatId || !sender) throw new Error("chatId and sender are required.");
    if (!["user", "assistant", "system"].includes(sender)) throw new Error("Invalid sender.");
    const nowTs = Math.floor(Date.now() / 1000);
    const createdAt = Number.isFinite(Number(rawPayload.createdAt)) ? Number(rawPayload.createdAt) : nowTs;
    const updatedAt = Number.isFinite(Number(rawPayload.updatedAt)) ? Number(rawPayload.updatedAt) : createdAt;
    const status = String(rawPayload.status || "done");
    const modelUsed = rawPayload.modelUsed ? String(rawPayload.modelUsed) : null;
    const botId = rawPayload.botId ? String(rawPayload.botId) : null;
    const errorCode = rawPayload.errorCode ? String(rawPayload.errorCode) : null;
    const errorMessage = rawPayload.errorMessage ? String(rawPayload.errorMessage) : null;
    const channelType = rawPayload.channelType ? String(rawPayload.channelType) : null;
    const channelMessageId = rawPayload.channelMessageId ? String(rawPayload.channelMessageId) : null;
    let toolCallsJson = null;
    if (rawPayload.toolCalls != null && Array.isArray(rawPayload.toolCalls) && rawPayload.toolCalls.length > 0) {
      try {
        toolCallsJson = JSON.stringify(rawPayload.toolCalls);
      } catch {
        toolCallsJson = null;
      }
    }

    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages (
        id, chat_id, sender, bot_id, content, status, model_used, error_code, error_message, tool_calls,
        channel_type, channel_message_id, created_at, updated_at
      ) VALUES (
        @id, @chat_id, @sender, @bot_id, @content, @status, @model_used, @error_code, @error_message, @tool_calls,
        @channel_type, @channel_message_id, @created_at, @updated_at
      )
    `);
    const touchChatStmt = this.db.prepare(`
      UPDATE chats
      SET updated_at = @updated_at, last_message_at = @last_message_at
      WHERE id = @id
    `);
    insertStmt.run({
      id,
      chat_id: chatId,
      sender,
      bot_id: botId,
      content,
      status,
      model_used: modelUsed,
      error_code: errorCode,
      error_message: errorMessage,
      tool_calls: toolCallsJson,
      channel_type: channelType,
      channel_message_id: channelMessageId,
      created_at: createdAt,
      updated_at: updatedAt,
    });
    touchChatStmt.run({
      id: chatId,
      updated_at: updatedAt,
      last_message_at: createdAt,
    });
    return { id, chatId, sender, createdAt, updatedAt };
  }

  updateMessage(rawPayload = {}) {
    const id = String(rawPayload.id || "").trim();
    if (!id) throw new Error("message id is required.");
    const nowTs = Math.floor(Date.now() / 1000);
    const updatedAt = Number.isFinite(Number(rawPayload.updatedAt)) ? Number(rawPayload.updatedAt) : nowTs;
    const content = rawPayload.content == null ? undefined : String(rawPayload.content);
    const status = rawPayload.status == null ? undefined : String(rawPayload.status);
    const modelUsed = rawPayload.modelUsed == null ? undefined : String(rawPayload.modelUsed);
    const errorCode = rawPayload.errorCode == null ? undefined : String(rawPayload.errorCode);
    const errorMessage = rawPayload.errorMessage == null ? undefined : String(rawPayload.errorMessage);
    let toolCallsJson = undefined;
    if (rawPayload.toolCalls !== undefined) {
      if (rawPayload.toolCalls == null || !Array.isArray(rawPayload.toolCalls)) {
        toolCallsJson = null;
      } else {
        try {
          toolCallsJson = rawPayload.toolCalls.length > 0 ? JSON.stringify(rawPayload.toolCalls) : null;
        } catch {
          toolCallsJson = null;
        }
      }
    }

    const sets = ["updated_at = @updated_at"];
    if (content !== undefined) sets.push("content = @content");
    if (status !== undefined) sets.push("status = @status");
    if (modelUsed !== undefined) sets.push("model_used = @model_used");
    if (errorCode !== undefined) sets.push("error_code = @error_code");
    if (errorMessage !== undefined) sets.push("error_message = @error_message");
    if (toolCallsJson !== undefined) sets.push("tool_calls = @tool_calls");
    const stmt = this.db.prepare(`UPDATE messages SET ${sets.join(", ")} WHERE id = @id`);
    const result = stmt.run({
      id,
      updated_at: updatedAt,
      content,
      status,
      model_used: modelUsed,
      error_code: errorCode,
      error_message: errorMessage,
      tool_calls: toolCallsJson,
    });
    if (!result.changes) return { updated: false };

    const chatInfo = this.db.prepare("SELECT chat_id, created_at FROM messages WHERE id = ?").get(id);
    if (chatInfo?.chat_id) {
      this.db
        .prepare("UPDATE chats SET updated_at = @updated_at, last_message_at = MAX(last_message_at, @last_message_at) WHERE id = @id")
        .run({
          id: chatInfo.chat_id,
          updated_at: updatedAt,
          last_message_at: Number(chatInfo.created_at || updatedAt),
        });
    }
    return { updated: true, id };
  }
}

module.exports = {
  ChatRepository,
};
