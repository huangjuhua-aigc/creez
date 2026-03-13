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

/** RoundCloser default avatar: creezv2/assets/roundcloser.png → ~/.creez/avatars/roundcloser.png */
function resolveRoundCloserAvatarPath(homeDir) {
  return copyBundledAvatar(homeDir, "roundcloser.png");
}

/** Default bot default avatar: creezv2/assets/bot_avatar_256x256.png → ~/.creez/avatars/bot_avatar_256x256.png */
function resolveDefaultBotAvatarPath(homeDir) {
  return copyBundledAvatar(homeDir, "bot_avatar_256x256.png");
}

/** Fixed UUID for default assistant bot (config id = contact id). */
const BOT_CONTACT_ID = "11111111-1111-1111-1111-111111111111";
const BOT_CHAT_ID = "1f2e3d4c-5b6a-47d8-9c01-23456789abcd";
const BOT_WELCOME_MESSAGE_ID = "2a3b4c5d-6e7f-48a9-b012-3456789abcde";
const ROUND_CLOSER_CONTACT_ID = "a3e6d3f0-9d91-4dc0-8f84-7f3ca8a0619c";
const ROUND_CLOSER_CHAT_ID = "2a946572-93e6-4f9d-95bc-c6658ee319cd";
const ROUND_CLOSER_WELCOME_MESSAGE_ID = "2de4e355-c80d-4aea-b510-ed45d5f5647d";

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
  const roundCloserAvatarPath = resolveRoundCloserAvatarPath(homeDir);
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
  const roundCloserName = "RoundCloser";
  const roundCloserPrompt = [
    "You are RoundCloser, the fundraising proxy for the Creez project.",
    "Represent the founder in investor conversations with concise, factual, and professional communication.",
    "Focus on fundraising narrative, traction, market, roadmap, and ask.",
    "Do not fabricate metrics, customers, contracts, legal statements, or timelines.",
    "When data is missing, state uncertainty and request specific missing details.",
    "When company factual details are needed, use knowledge-search capabilities before answering."
  ].join("\n");
  const roundCloserWelcome = [
    "Hi, I’m RoundCloser, the fundraising proxy for Creez. We are currently raising our Angel Round.",
    "",
    "I provide direct, factual data about Creez to help you evaluate the deal quickly.",
    "",
    "Where should we start?",
    "",
    "The Narrative: Problem, Solution, and our Technical Edge.",
    "",
    "The Data: Current traction & market scale.",
    "",
    "The Deal: Use of funds, Roadmap, and the Ask.",
    "",
    "If you are interested in Creez, please leave your contact details and available time. I will notify the founder immediately to schedule a deep-dive meeting with you.",
  ].join("\n");

  const insertChat = db.prepare(`
    INSERT OR IGNORE INTO chats (id, contact_id, created_at, updated_at, last_message_at)
    VALUES (@id, @contactId, @createdAt, @updatedAt, @lastMessageAt)
  `);
  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO contacts (id, type, name, avatar_path, is_default, created_at, updated_at)
    VALUES (@id, @type, @name, @avatarPath, @isDefault, @createdAt, @updatedAt)
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
  const updateAssistantConfigSkills = db.prepare(`
    UPDATE assistant_config SET skills_json = @skillsJson, updated_at = @updatedAt WHERE id = @id
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
    const roundCloserSkills = { knowledge_search: true, vc_lead_capture: true };
    insertAssistantConfig.run({
      id: ROUND_CLOSER_CONTACT_ID,
      name: roundCloserName,
      avatarPath: roundCloserAvatarPath,
      systemPrompt: roundCloserPrompt,
      skillsJson: JSON.stringify(roundCloserSkills),
      modelsJson: JSON.stringify(Array.isArray(models) ? models : []),
      updatedAt: base,
      engineType: "pi",
    });
    if (roundCloserAvatarPath != null) {
      updateAssistantConfigAvatar.run({
        id: ROUND_CLOSER_CONTACT_ID,
        avatarPath: roundCloserAvatarPath,
        updatedAt: base,
      });
    }
    updateAssistantConfigSkills.run({
      id: ROUND_CLOSER_CONTACT_ID,
      skillsJson: JSON.stringify(roundCloserSkills),
      updatedAt: base,
    });

    const roundContactInserted = insertContact.run({
      id: ROUND_CLOSER_CONTACT_ID,
      type: "bot",
      name: roundCloserName,
      avatarPath: roundCloserAvatarPath,
      isDefault: 0,
      createdAt,
      updatedAt: base,
    }).changes;
    updateContact.run({
      id: ROUND_CLOSER_CONTACT_ID,
      name: roundCloserName,
      avatarPath: roundCloserAvatarPath,
      updatedAt: base,
    });
    const roundChatInserted = insertChat.run({
      id: ROUND_CLOSER_CHAT_ID,
      contactId: ROUND_CLOSER_CONTACT_ID,
      createdAt,
      updatedAt: base,
      lastMessageAt: createdAt,
    }).changes;
    const roundMessageInserted = insertMessage.run({
      id: ROUND_CLOSER_WELCOME_MESSAGE_ID,
      chatId: ROUND_CLOSER_CHAT_ID,
      sender: "assistant",
      content: roundCloserWelcome,
      status: "done",
      modelUsed: activeModelId,
      botId: ROUND_CLOSER_CONTACT_ID,
      createdAt,
      updatedAt: createdAt,
    }).changes;
    updateChatMeta.run({
      id: ROUND_CLOSER_CHAT_ID,
      updatedAt: base,
    });

    return {
      contactInserted,
      chatInserted,
      messageInserted,
      roundContactInserted,
      roundChatInserted,
      roundMessageInserted,
    };
  });
  const result = tx();

  return {
    seeded: Boolean(
      result.chatInserted ||
      result.messageInserted ||
      result.roundContactInserted ||
      result.roundChatInserted ||
      result.roundMessageInserted
    ),
    botContactId: BOT_CONTACT_ID,
    botChatId: BOT_CHAT_ID,
    botMessageId: BOT_WELCOME_MESSAGE_ID,
    roundCloserContactId: ROUND_CLOSER_CONTACT_ID,
    roundCloserChatId: ROUND_CLOSER_CHAT_ID,
    roundCloserMessageId: ROUND_CLOSER_WELCOME_MESSAGE_ID,
  };
}

module.exports = {
  seedIfEmpty,
};
