/**
 * Unit tests for WeCom channel: config repository, channel IPC, ChannelManager.sendMessage, channel_send tool.
 * Run: npm run test:unit (or electron --test tests/wecomChannel.test.cjs)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CreezDatabase } = require("../electron/main/db/database.cjs");
const {
  ChannelConfigRepository,
  valuesToCredentials,
  credentialsToValues,
} = require("../electron/main/repositories/channelConfigRepository.cjs");
const { registerChannelIpc } = require("../electron/main/channelIpc.cjs");
const { ChannelManager } = require("../electron/main/channel/ChannelManager.cjs");
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

// ---- valuesToCredentials / credentialsToValues (wecom) ----
test("wecom valuesToCredentials maps WECOM_BOT_ID and WECOM_SECRET to storage keys", () => {
  const creds = valuesToCredentials("wecom", {
    WECOM_BOT_ID: "  bot-123  ",
    WECOM_SECRET: "secret-abc",
  });
  assert.equal(creds.botId, "bot-123");
  assert.equal(creds.secret, "secret-abc");
});

test("wecom credentialsToValues maps storage keys back to UI keys", () => {
  const values = credentialsToValues("wecom", { botId: "bot-1", secret: "sec-1" });
  assert.equal(values.WECOM_BOT_ID, "bot-1");
  assert.equal(values.WECOM_SECRET, "sec-1");
});

test("wecom valuesToCredentials ignores empty or missing values", () => {
  const creds = valuesToCredentials("wecom", { WECOM_BOT_ID: "", WECOM_SECRET: "  " });
  assert.equal(Object.keys(creds).length, 0);
});

// ---- ChannelConfigRepository (wecom) ----
test("channel config repository upserts and lists wecom config with masked secret", async () => {
  const homeDir = await createTempHome("creez-wecom-repo-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new ChannelConfigRepository(dbWrapper.db);
  const botId = "11111111-1111-1111-1111-111111111111";

  const result = repo.upsert({
    botId,
    channelType: "wecom",
    enabled: true,
    values: { WECOM_BOT_ID: "my-bot-id", WECOM_SECRET: "my-secret-xyz" },
  });
  assert.equal(result.id != null, true);
  assert.equal(result.updated, false);

  const list = repo.listByBotId(botId);
  assert.equal(list.length, 1);
  assert.equal(list[0].channelType, "wecom");
  assert.equal(list[0].enabled, true);
  assert.equal(list[0].values.WECOM_BOT_ID, "my-bot-id");
  assert.ok(list[0].values.WECOM_SECRET.startsWith("****"));
  assert.notEqual(list[0].values.WECOM_SECRET, "my-secret-xyz");

  const full = repo.getByBotAndType(botId, "wecom");
  assert.equal(full.credentials.botId, "my-bot-id");
  assert.equal(full.credentials.secret, "my-secret-xyz");

  repo.delete(botId, "wecom");
  const afterDelete = repo.listByBotId(botId);
  assert.equal(afterDelete.length, 0);

  dbWrapper.close();
});

test("channel config repository wecom upsert merge keeps existing secret when not provided", async () => {
  const homeDir = await createTempHome("creez-wecom-merge-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new ChannelConfigRepository(dbWrapper.db);
  const botId = "11111111-1111-1111-1111-111111111111";

  repo.upsert({
    botId,
    channelType: "wecom",
    enabled: true,
    values: { WECOM_BOT_ID: "bot-a", WECOM_SECRET: "secret-original" },
  });

  repo.upsert({
    botId,
    channelType: "wecom",
    enabled: true,
    values: { WECOM_BOT_ID: "bot-b" },
  });

  const full = repo.getByBotAndType(botId, "wecom");
  assert.equal(full.credentials.botId, "bot-b");
  assert.equal(full.credentials.secret, "secret-original");

  dbWrapper.close();
});

// ---- Channel IPC (wecom) ----
test("channel IPC list/save/delete wecom config", async () => {
  const homeDir = await createTempHome("creez-wecom-ipc-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new ChannelConfigRepository(dbWrapper.db);
  const contactRepo = {
    getDefaultAssistantConfigId: () => "11111111-1111-1111-1111-111111111111",
  };
  const ipcMain = createIpcMainMock();
  registerChannelIpc(ipcMain, {
    channelConfigRepository: repo,
    contactRepository: contactRepo,
    channelManager: null,
  });

  const listRes = await ipcMain.handlers.get(CHANNELS.CHANNEL_LIST_CONFIGS)(null, {});
  assert.equal(listRes.ok, true);
  assert.equal(Array.isArray(listRes.data.items), true);
  assert.equal(listRes.data.items.length, 0);

  const saveRes = await ipcMain.handlers.get(CHANNELS.CHANNEL_SAVE_CONFIG)(null, {
    channelType: "wecom",
    enabled: true,
    values: { WECOM_BOT_ID: "ipc-bot", WECOM_SECRET: "ipc-secret-1234" },
  });
  assert.equal(saveRes.ok, true);

  const listAfter = await ipcMain.handlers.get(CHANNELS.CHANNEL_LIST_CONFIGS)(null, {});
  assert.equal(listAfter.data.items.length, 1);
  assert.equal(listAfter.data.items[0].channelType, "wecom");
  assert.equal(listAfter.data.items[0].values.WECOM_BOT_ID, "ipc-bot");
  assert.equal(listAfter.data.items[0].values.WECOM_SECRET, "****1234");

  const deleteRes = await ipcMain.handlers.get(CHANNELS.CHANNEL_DELETE_CONFIG)(null, {
    channelType: "wecom",
  });
  assert.equal(deleteRes.ok, true);
  const listFinal = await ipcMain.handlers.get(CHANNELS.CHANNEL_LIST_CONFIGS)(null, {});
  assert.equal(listFinal.data.items.length, 0);

  dbWrapper.close();
});

// ---- ChannelManager.sendMessage(wecom) ----
test("ChannelManager.sendMessage wecom returns error when adapter not running", async () => {
  const homeDir = await createTempHome("creez-wecom-mgr-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const { seedIfEmpty } = require("../electron/main/db/seed.cjs");
  seedIfEmpty(dbWrapper.db);
  const contactRepo = {
    getDefaultAssistantConfigId: () => "11111111-1111-1111-1111-111111111111",
  };
  const chatRepo = require("../electron/main/repositories/chatRepository.cjs").ChatRepository;
  const chatRepository = new chatRepo(dbWrapper.db);

  const manager = new ChannelManager({
    channelConfigRepository: new ChannelConfigRepository(dbWrapper.db),
    contactRepository: contactRepo,
    chatRepository,
  });

  const result = await manager.sendMessage("wecom", { content: "hello" });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.ok(result.error.toLowerCase().includes("not running") || result.error.toLowerCase().includes("wecom"));

  dbWrapper.close();
});

test("ChannelManager.sendMessage wecom returns ok when mock adapter sendOutbound succeeds", async () => {
  const homeDir = await createTempHome("creez-wecom-mgr-mock-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const { seedIfEmpty } = require("../electron/main/db/seed.cjs");
  seedIfEmpty(dbWrapper.db);
  const contactRepo = {
    getDefaultAssistantConfigId: () => "11111111-1111-1111-1111-111111111111",
  };
  const defaultBotId = contactRepo.getDefaultAssistantConfigId();
  const chatRepo = require("../electron/main/repositories/chatRepository.cjs").ChatRepository;
  const chatRepository = new chatRepo(dbWrapper.db);

  const manager = new ChannelManager({
    channelConfigRepository: new ChannelConfigRepository(dbWrapper.db),
    contactRepository: contactRepo,
    chatRepository,
  });

  const mockAdapter = {
    channelType: "wecom",
    running: true,
    sendOutbound(content) {
      return Promise.resolve({ ok: true, message_id: "wecom-msg-123" });
    },
  };
  manager._adapters.set(`${defaultBotId}:wecom`, mockAdapter);

  const result = await manager.sendMessage("wecom", { content: "hello from test" });
  assert.equal(result.ok, true);
  assert.equal(result.message_id, "wecom-msg-123");

  const { chatId } = chatRepository.getOrCreateMainChatForContact({ contactId: defaultBotId });
  const messages = chatRepository.getMessages({ chatId, limit: 20 });
  const viaWecom = messages?.items?.find(
    (m) => m.channelType === "wecom" && m.content && m.content.includes("hello from test")
  );
  assert.ok(viaWecom, "expected a wecom message with 'hello from test'");
  assert.ok(viaWecom.content.includes("[via wecom]"));

  dbWrapper.close();
});

// ---- channel_send tool (wecom) ----
test("channel_send tool execute with channel wecom calls channelSend and returns success", async () => {
  const { createChannelSendHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/channelSendHandler.mjs"
  );

  let sentChannel = null;
  let sentContent = null;
  const channelSend = async (channel, opts) => {
    sentChannel = channel;
    sentContent = opts?.content;
    return { ok: true, message_id: "wecom-test-msg-id" };
  };

  const handler = createChannelSendHandler({ channelSend });
  const result = await handler.execute({ channel: "wecom", content: "测试消息" });

  assert.equal(sentChannel, "wecom");
  assert.equal(sentContent, "测试消息");
  assert.ok(!result.isError);
  assert.equal(Array.isArray(result.content), true);
  assert.equal(result.details?.data?.channel, "wecom");
  assert.equal(result.details?.data?.message_id, "wecom-test-msg-id");
});

test("channel_send tool execute with channel wecom returns error when channelSend returns ok: false", async () => {
  const { createChannelSendHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/channelSendHandler.mjs"
  );

  const channelSend = async () => ({ ok: false, error: "No WeCom chat available." });
  const handler = createChannelSendHandler({ channelSend });
  const result = await handler.execute({ channel: "wecom", content: "hi" });

  assert.equal(result.isError, true);
  const msg = result.details?.error?.message || result.details?.message || "";
  assert.ok(msg.includes("No WeCom chat") || msg.includes("Send failed"), "expected error message to mention send failure");
});

test("channel_send tool execute rejects empty channel and empty content", async () => {
  const { createChannelSendHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/channelSendHandler.mjs"
  );

  const channelSend = async () => ({ ok: true });
  const handler = createChannelSendHandler({ channelSend });

  const noChannel = await handler.execute({ channel: "", content: "hi" });
  assert.equal(noChannel.isError, true);
  assert.equal(noChannel.details?.error?.code, "MISSING_CHANNEL");

  const noContent = await handler.execute({ channel: "wecom", content: "" });
  assert.equal(noContent.isError, true);
  assert.equal(noContent.details?.error?.code, "MISSING_CONTENT");
});
