const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CreezDatabase } = require("../electron/main/db/database.cjs");
const { seedIfEmpty } = require("../electron/main/db/seed.cjs");
const { AppStateRepository } = require("../electron/main/repositories/appStateRepository.cjs");
const { ChatRepository } = require("../electron/main/repositories/chatRepository.cjs");
const { registerChatIpc } = require("../electron/main/chatIpc.cjs");
const { CHANNELS } = require("../electron/main/channels.cjs");

async function createTempHome(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

function createIpcMainMock() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  };
}

test("database init creates tables and app_state row", async () => {
  const homeDir = await createTempHome("creezv2-db-init-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const dbPath = path.join(homeDir, ".creez", "app.db");

  assert.equal(fs.existsSync(dbPath), true);
  const row = dbWrapper.db.prepare("SELECT id, last_tab FROM app_state WHERE id = 1").get();
  assert.equal(row.id, 1);
  assert.equal(row.last_tab, "chat");

  dbWrapper.close();
});

test("seed ensures default bot contact/chat/message exist", async () => {
  const homeDir = await createTempHome("creezv2-db-seed-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();

  const first = seedIfEmpty(dbWrapper.db);
  assert.equal(first.seeded, true);
  assert.equal(first.botContactId, "11111111-1111-1111-1111-111111111111");
  assert.equal(first.botChatId, "1f2e3d4c-5b6a-47d8-9c01-23456789abcd");

  const chatCount = dbWrapper.db.prepare("SELECT COUNT(*) AS count FROM chats").get();
  const messageCount = dbWrapper.db.prepare("SELECT COUNT(*) AS count FROM messages").get();
  const contactCount = dbWrapper.db.prepare("SELECT COUNT(*) AS count FROM contacts").get();
  assert.equal(Number(chatCount.count) >= 1, true);
  assert.equal(Number(messageCount.count) >= 1, true);
  assert.equal(Number(contactCount.count) >= 1, true);

  const botMessage = dbWrapper.db.prepare("SELECT bot_id FROM messages WHERE id = ?").get("2a3b4c5d-6e7f-48a9-b012-3456789abcde");
  assert.equal(botMessage.bot_id, "11111111-1111-1111-1111-111111111111");

  const second = seedIfEmpty(dbWrapper.db);
  assert.equal(second.seeded, false);

  dbWrapper.close();
});

test("seed reuses an existing default assistant chat when fixed chat id was deleted", async () => {
  const homeDir = await createTempHome("creezv2-db-seed-reuse-chat-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const db = dbWrapper.db;

  seedIfEmpty(db);
  db.prepare("DELETE FROM chats WHERE id = ?").run("1f2e3d4c-5b6a-47d8-9c01-23456789abcd");
  db.prepare(
    "INSERT INTO chats (id, contact_id, created_at, updated_at, last_message_at, channel_type, channel_chat_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("chat_rebased_default", "11111111-1111-1111-1111-111111111111", 100, 100, 100, "creez_app", null);
  db.prepare(
    "INSERT INTO messages (id, chat_id, sender, content, status, bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("m_rebased_default", "chat_rebased_default", "assistant", "kept", "done", "11111111-1111-1111-1111-111111111111", 100, 100);

  const result = seedIfEmpty(db);
  assert.equal(result.botChatId, "chat_rebased_default");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_id = ?").get("chat_rebased_default").count, 1);

  dbWrapper.close();
});

test("appState repository reads and updates app_state table", async () => {
  const homeDir = await createTempHome("creezv2-db-appstate-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new AppStateRepository(dbWrapper.db);

  const initial = repo.getState();
  assert.equal(initial.lastTab, "chat");

  const updated = repo.setState({ lastTab: "settings", lastChatId: "chat_1", isLoggedIn: true });
  assert.equal(updated.lastTab, "settings");
  assert.equal(updated.lastChatId, "chat_1");
  assert.equal(updated.isLoggedIn, true);

  dbWrapper.close();
});

test("chat repository lists chats and paginates messages", async () => {
  const homeDir = await createTempHome("creezv2-db-chat-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const db = dbWrapper.db;
  const repo = new ChatRepository(db);

  db.prepare(
    "INSERT INTO contacts (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run("contact_a", "bot", "Alpha Bot", 50, 50);
  db.prepare(
    "INSERT INTO chats (id, contact_id, created_at, updated_at, last_message_at) VALUES (?, ?, ?, ?, ?)"
  ).run("chat_a", "contact_a", 100, 300, 300);
  db.prepare(
    "INSERT INTO contacts (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run("contact_b", "bot", "Beta Bot", 50, 50);
  db.prepare(
    "INSERT INTO chats (id, contact_id, created_at, updated_at, last_message_at) VALUES (?, ?, ?, ?, ?)"
  ).run("chat_b", "contact_b", 100, 200, 200);

  db.prepare(
    "INSERT INTO messages (id, chat_id, sender, content, status, bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("m1", "chat_a", "user", "hello", "done", null, 150, 150);
  db.prepare(
    "INSERT INTO messages (id, chat_id, sender, content, status, bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("m2", "chat_a", "assistant", "world", "done", "contact_a", 300, 300);
  db.prepare(
    "INSERT INTO messages (id, chat_id, sender, content, status, bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("m2b", "chat_a", "assistant", "world-2", "done", "contact_a", 300, 300);
  db.prepare(
    "INSERT INTO messages (id, chat_id, sender, content, status, bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("m3", "chat_b", "assistant", "beta", "done", "contact_b", 200, 200);

  const list = repo.list({ limit: 10, offset: 0 });
  assert.equal(list.total, 2);
  assert.equal(list.items[0].id, "chat_a");
  assert.equal(list.items[0].lastMessage, "world-2");
  assert.equal(list.items[0].contactId, "contact_a");

  const page1 = repo.getMessages({ chatId: "chat_a", limit: 1 });
  assert.equal(page1.items.length, 1);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.items[0].id, "m2b");
  assert.equal(page1.items[0].botId, "contact_a");

  const page2 = repo.getMessages({ chatId: "chat_a", limit: 5, before: page1.nextBefore });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0].id, "m1");

  dbWrapper.close();
});

test("chat repository deletes chat history without deleting scheduled tasks", async () => {
  const homeDir = await createTempHome("creezv2-db-chat-delete-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const db = dbWrapper.db;
  const repo = new ChatRepository(db);

  db.prepare(
    "INSERT INTO contacts (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run("contact_del", "bot", "Delete Bot", 50, 50);
  db.prepare(
    "INSERT INTO chats (id, contact_id, created_at, updated_at, last_message_at) VALUES (?, ?, ?, ?, ?)"
  ).run("chat_del", "contact_del", 100, 300, 300);
  db.prepare(
    "INSERT INTO messages (id, chat_id, sender, content, status, bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("m_del_1", "chat_del", "user", "remove me", "done", null, 150, 150);
  db.prepare(
    "INSERT INTO scheduled_tasks (id, contact_id, chat_id, cron_expression, task_prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("task_del_1", "contact_del", "chat_del", "* * * * *", "ping", "active", 200, 200);

  const result = repo.deleteChat({ chatId: "chat_del" });
  assert.equal(result.deleted, true);
  assert.equal(result.contactId, "contact_del");
  assert.equal(result.messagesDeleted, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM chats WHERE id = ?").get("chat_del").count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_id = ?").get("chat_del").count, 0);
  const task = db.prepare("SELECT status, chat_id FROM scheduled_tasks WHERE id = ?").get("task_del_1");
  assert.equal(task.status, "active");
  assert.equal(task.chat_id, "chat_del");

  dbWrapper.close();
});

test("chat IPC validates payload and returns data", async () => {
  const ipcMain = createIpcMainMock();
  const repo = {
    list() {
      return { items: [], total: 0 };
    },
    getMessages(payload) {
      return { items: [{ id: "1", chatId: payload.chatId }], hasMore: false, nextBefore: null };
    },
    deleteChat(payload) {
      return { deleted: true, chatId: payload.chatId, contactId: "contact_x", messagesDeleted: 1 };
    },
  };

  registerChatIpc(ipcMain, repo);

  const listRes = await ipcMain.handlers.get(CHANNELS.CHAT_LIST)(null, {});
  assert.equal(listRes.ok, true);
  assert.equal(listRes.data.total, 0);

  const invalid = await ipcMain.handlers.get(CHANNELS.CHAT_GET_MESSAGES)(null, {});
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "VALIDATION_ERROR");

  const valid = await ipcMain.handlers.get(CHANNELS.CHAT_GET_MESSAGES)(null, { chatId: "chat_x" });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.items[0].chatId, "chat_x");

  const invalidDelete = await ipcMain.handlers.get(CHANNELS.CHAT_DELETE)(null, {});
  assert.equal(invalidDelete.ok, false);
  assert.equal(invalidDelete.error.code, "VALIDATION_ERROR");

  const deleted = await ipcMain.handlers.get(CHANNELS.CHAT_DELETE)(null, { chatId: "chat_x" });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.data.deleted, true);
});
