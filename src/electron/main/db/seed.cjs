const path = require("path");
const fs = require("fs");
const os = require("os");

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

const ASSETS_DIR = path.join(__dirname, "..", "..", "..", "assets");

/** Copy bundled avatar from assets/ to ~/.creez/avatars/; return target path or null. */
function copyBundledAvatar(homeDir, filename) {
  const bundledPath = path.join(ASSETS_DIR, filename);
  if (!fs.existsSync(bundledPath)) return null;
  const baseDir = homeDir || os.homedir();
  const avatarDir = path.join(baseDir, ".creez", "avatars");
  const targetPath = path.join(avatarDir, filename);
  try {
    fs.mkdirSync(avatarDir, { recursive: true });
    fs.copyFileSync(bundledPath, targetPath);
    return targetPath;
  } catch {
    return null;
  }
}

/** Default bot default avatar: creezv2/assets/bot_avatar_256x256.png → ~/.creez/avatars/bot_avatar_256x256.png */
function resolveDefaultBotAvatarPath(homeDir) {
  return copyBundledAvatar(homeDir, "bot_avatar_256x256.png");
}

/** Fixed UUID for default assistant bot (config id = contact id). */
const BOT_CONTACT_ID = "11111111-1111-1111-1111-111111111111";
const BOT_CHAT_ID = "1f2e3d4c-5b6a-47d8-9c01-23456789abcd";
const BOT_WELCOME_MESSAGE_ID = "2a3b4c5d-6e7f-48a9-b012-3456789abcde";

/** Creez Round Closer: canonical backend agent UUID (`contacts.id` === `remote_agent_id`, same as server). */
const ROUNDCLOSER_BACKEND_AGENT_ID = "a7234742-761a-49ba-9deb-2eef7b5ae55b";
const ROUNDCLOSER_CHAT_ID = "rc000001-0001-4000-8000-000000000001";
const ROUNDCLOSER_MSG_ID = "rc000001-0001-4000-8000-000000000002";
const ROUNDCLOSER_NAME = "Creez Round Closer";
const ROUNDCLOSER_GREETING = "Hi, I'm Round Closer — your fundraising assistant for Creez. Ask me anything about the product, metrics, or fundraising.";

function safeJsonParse(value, fallback) {
  try {
    if (typeof value !== "string" || value.trim() === "") return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function seedIfEmpty(db, options = {}) {
  const base = nowTs();
  const homeDir = options.homeDir || os.homedir();
  const defaultBotAvatarPath = resolveDefaultBotAvatarPath(homeDir);
  const assistantRow = db
    .prepare("SELECT name, avatar_path, models_json FROM assistant_config WHERE id = ?")
    .get(BOT_CONTACT_ID);
  const assistantName = String(assistantRow?.name || "Assistant");
  const assistantAvatarPath = (defaultBotAvatarPath || (assistantRow?.avatar_path ? String(assistantRow.avatar_path) : null));
  const models = safeJsonParse(assistantRow?.models_json, []);
  const activeModel = Array.isArray(models)
    ? models.find((model) => model && model.active) || models[0]
    : null;
  const activeModelId = String(activeModel?.model || "gpt-4o");
  const greeting = `Hi，我是 ${assistantName}。请先完成配置以便开始使用。点击 [去配置](settings) 进入设置页面。`;

  const insertChat = db.prepare(`
    INSERT OR IGNORE INTO chats (id, contact_id, created_at, updated_at, last_message_at)
    VALUES (@id, @contactId, @createdAt, @updatedAt, @lastMessageAt)
  `);
  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO contacts (id, type, name, avatar_path, is_default, created_at, updated_at, remote_agent_id)
    VALUES (@id, @type, @name, @avatarPath, @isDefault, @createdAt, @updatedAt, @remoteAgentId)
  `);
  const updateContact = db.prepare(`
    UPDATE contacts
    SET name = @name,
        avatar_path = @avatarPath,
        updated_at = @updatedAt
    WHERE id = @id
  `);
  const updateChatMeta = db.prepare(`
    UPDATE chats
    SET updated_at = @updatedAt,
        last_message_at = (
          SELECT MAX(created_at)
          FROM messages
          WHERE chat_id = @id
        )
    WHERE id = @id
  `);
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (
      id, chat_id, sender, content, status, model_used, bot_id, created_at, updated_at
    ) VALUES (
      @id, @chatId, @sender, @content, @status, @modelUsed, @botId, @createdAt, @updatedAt
    )
  `);
  const insertAssistantConfig = db.prepare(`
    INSERT OR IGNORE INTO assistant_config (
      id, name, avatar_path, system_prompt, skills_json, models_json, updated_at, engine_type
    ) VALUES (
      @id, @name, @avatarPath, @systemPrompt, @skillsJson, @modelsJson, @updatedAt, @engineType
    )
  `);
  const updateAssistantConfigAvatar = db.prepare(`
    UPDATE assistant_config SET avatar_path = @avatarPath, updated_at = @updatedAt WHERE id = @id
  `);
  const deleteLegacyDemoChats = db.prepare(`DELETE FROM chats WHERE id LIKE 'chat_demo_%'`);

  const tx = db.transaction(() => {
    const createdAt = base - 30;
    deleteLegacyDemoChats.run();
    insertAssistantConfig.run({
      id: BOT_CONTACT_ID,
      name: assistantName,
      avatarPath: assistantAvatarPath,
      systemPrompt: "",
      skillsJson: JSON.stringify({}),
      modelsJson: assistantRow?.models_json ?? "[]",
      updatedAt: base,
      engineType: "pi",
    });
    const contactInserted = insertContact.run({
      id: BOT_CONTACT_ID,
      type: "bot",
      name: assistantName,
      avatarPath: assistantAvatarPath,
      isDefault: 1,
      createdAt,
      updatedAt: base,
      remoteAgentId: null,
    }).changes;
    updateContact.run({
      id: BOT_CONTACT_ID,
      name: assistantName,
      avatarPath: assistantAvatarPath,
      updatedAt: base,
    });
    if (defaultBotAvatarPath) {
      updateAssistantConfigAvatar.run({
        id: BOT_CONTACT_ID,
        avatarPath: defaultBotAvatarPath,
        updatedAt: base,
      });
    }
    const chatInserted = insertChat.run({
      id: BOT_CHAT_ID,
      contactId: BOT_CONTACT_ID,
      createdAt,
      updatedAt: base,
      lastMessageAt: createdAt,
    }).changes;
    const messageInserted = insertMessage.run({
      id: BOT_WELCOME_MESSAGE_ID,
      chatId: BOT_CHAT_ID,
      sender: "assistant",
      content: greeting,
      status: "done",
      modelUsed: activeModelId,
      botId: BOT_CONTACT_ID,
      createdAt,
      updatedAt: createdAt,
    }).changes;
    updateChatMeta.run({
      id: BOT_CHAT_ID,
      updatedAt: base,
    });

    const rcContactInserted = insertContact.run({
      id: ROUNDCLOSER_BACKEND_AGENT_ID,
      type: "bot",
      name: ROUNDCLOSER_NAME,
      avatarPath: null,
      isDefault: 0,
      createdAt: createdAt + 1,
      updatedAt: base,
      remoteAgentId: ROUNDCLOSER_BACKEND_AGENT_ID,
    }).changes;
    const rcChatInserted = insertChat.run({
      id: ROUNDCLOSER_CHAT_ID,
      contactId: ROUNDCLOSER_BACKEND_AGENT_ID,
      createdAt: createdAt + 1,
      updatedAt: base,
      lastMessageAt: createdAt + 1,
    }).changes;
    // Unique (contact_id, channel_type, channel_chat_id): if this contact already had a creez_app
    // chat (e.g. addRemoteAgent), INSERT OR IGNORE skips the row above — resolve real chat id.
    const rcChatRow = db
      .prepare(
        `SELECT id FROM chats WHERE contact_id = ? AND channel_type = 'creez_app'
         AND (channel_chat_id IS NULL OR TRIM(channel_chat_id) = '')
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(ROUNDCLOSER_BACKEND_AGENT_ID);
    const effectiveRcChatId = rcChatRow?.id || null;
    const rcMessageInserted =
      effectiveRcChatId != null
        ? insertMessage.run({
            id: ROUNDCLOSER_MSG_ID,
            chatId: effectiveRcChatId,
            sender: "assistant",
            content: ROUNDCLOSER_GREETING,
            status: "done",
            modelUsed: activeModelId,
            botId: ROUNDCLOSER_BACKEND_AGENT_ID,
            createdAt: createdAt + 1,
            updatedAt: createdAt + 1,
          }).changes
        : 0;

    return {
      contactInserted,
      chatInserted,
      messageInserted,
      rcContactInserted,
      rcChatInserted,
      rcMessageInserted,
    };
  });
  const result = tx();

  return {
    seeded: Boolean(
      result.chatInserted ||
      result.messageInserted ||
      result.rcContactInserted
    ),
    botContactId: BOT_CONTACT_ID,
    botChatId: BOT_CHAT_ID,
    botMessageId: BOT_WELCOME_MESSAGE_ID,
  };
}

module.exports = {
  seedIfEmpty,
};
