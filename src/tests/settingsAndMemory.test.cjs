const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");

const { CreezDatabase } = require("../electron/main/db/database.cjs");
const { AssistantConfigRepository } = require("../electron/main/repositories/assistantConfigRepository.cjs");
const { ContactRepository } = require("../electron/main/repositories/contactRepository.cjs");
const { MemoryStore } = require("../electron/main/memoryStore.cjs");
const { registerSettingsIpc } = require("../electron/main/settingsIpc.cjs");
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

test("assistant config repository read/save works with masking", async () => {
  const homeDir = await createTempHome("creezv2-settings-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new AssistantConfigRepository(dbWrapper.db);

  const initial = repo.getConfig();
  assert.equal(initial.name.length > 0, true);

  const saved = repo.saveConfigById(1, {
    name: "My Assistant",
    systemPrompt: "You are concise.",
    skills: { webSearch: true },
    models: [{ id: "m1", provider: "OpenRouter", model: "gpt-4o", apiKey: "sk-123456789", active: true }],
  });

  assert.equal(saved.name, "My Assistant");
  assert.equal(saved.models[0].apiKey, "");
  assert.equal(saved.models[0].apiKeyMasked.length > 0, true);
  assert.equal(repo.getModelApiKey("m1"), "sk-123456789");

  dbWrapper.close();
});

test("assistant config repository supports by-id save isolation", async () => {
  const homeDir = await createTempHome("creezv2-settings-multi-config-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new AssistantConfigRepository(dbWrapper.db);

  const defaultBefore = repo.getConfigById(1);
  assert.equal(Boolean(defaultBefore), true);

  const savedTwo = repo.saveConfigById(2, {
    name: "VC Bot",
    systemPrompt: "You are a fundraising assistant.",
    skills: { knowledge_search: true },
    models: [{ id: "m2", provider: "OpenRouter", model: "minimax/minimax-m2.5", apiKey: "sk-vc-002", active: true }],
  });
  assert.equal(savedTwo?.id, 2);
  assert.equal(savedTwo?.name, "VC Bot");
  assert.equal(savedTwo?.models?.[0]?.apiKey, "");

  const defaultAfter = repo.getConfigById(1);
  assert.equal(defaultAfter?.name, defaultBefore?.name);
  assert.equal(repo.getModelApiKeyFromConfig(2, "m2"), "sk-vc-002");

  dbWrapper.close();
});

test("memory store read/write roundtrip", async () => {
  const homeDir = await createTempHome("creezv2-memory-");
  const store = new MemoryStore({ homeDir });

  const readBefore = await store.read();
  assert.equal(readBefore.content, "");

  const write = await store.write("# hello memory");
  assert.equal(write.updated, true);

  const readAfter = await store.read();
  assert.equal(readAfter.content, "# hello memory");
});

test("settings IPC handles get/save/memory channels", async () => {
  const homeDir = await createTempHome("creezv2-settings-ipc-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const assistantConfigRepository = new AssistantConfigRepository(dbWrapper.db);
  const memoryStore = new MemoryStore({ homeDir });
  const ipcMain = createIpcMainMock();

  registerSettingsIpc(ipcMain, assistantConfigRepository, memoryStore);

  const getResult = await ipcMain.handlers.get(CHANNELS.SETTINGS_GET_ASSISTANT_CONFIG)();
  assert.equal(getResult.ok, true);

  const saveResult = await ipcMain.handlers.get(CHANNELS.SETTINGS_SAVE_ASSISTANT_CONFIG)(null, {
    name: "Config A",
    systemPrompt: "Prompt",
    skills: {},
    models: [{ id: "m-1", provider: "OpenRouter", model: "gpt-4o", apiKey: "sk-secret-001" }],
  });
  assert.equal(saveResult.ok, true);

  const getKeyResult = await ipcMain.handlers.get(CHANNELS.SETTINGS_GET_MODEL_API_KEY)(null, { modelId: "m-1" });
  assert.equal(getKeyResult.ok, true);
  assert.equal(getKeyResult.data.apiKey, "sk-secret-001");

  const memWrite = await ipcMain.handlers.get(CHANNELS.MEMORY_WRITE)(null, { content: "abc" });
  assert.equal(memWrite.ok, true);
  const memRead = await ipcMain.handlers.get(CHANNELS.MEMORY_READ)(null, {});
  assert.equal(memRead.ok, true);
  assert.equal(memRead.data.content, "abc");

  dbWrapper.close();
});

test("settings IPC syncs enabled skills and lists available skills", async () => {
  const homeDir = await createTempHome("creezv2-settings-skills-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const assistantConfigRepository = new AssistantConfigRepository(dbWrapper.db);
  const memoryStore = new MemoryStore({ homeDir });
  const ipcMain = createIpcMainMock();
  let syncedPayload = null;

  const skillManager = {
    async syncEnabledSkills(payload) {
      syncedPayload = payload;
    },
    async listAvailableSkills() {
      return [{ id: "storyboard-editor", name: "storyboard-editor", description: "Storyboards", enabled: false }];
    },
  };

  registerSettingsIpc(ipcMain, assistantConfigRepository, memoryStore, skillManager);

  const saveResult = await ipcMain.handlers.get(CHANNELS.SETTINGS_SAVE_ASSISTANT_CONFIG)(null, {
    skills: { "storyboard-editor": true },
  });
  assert.equal(saveResult.ok, true);
  assert.equal(Boolean(syncedPayload && syncedPayload["storyboard-editor"]), true);

  const listResult = await ipcMain.handlers.get(CHANNELS.SETTINGS_LIST_AVAILABLE_SKILLS)();
  assert.equal(listResult.ok, true);
  assert.equal(Array.isArray(listResult.data.items), true);
  assert.equal(listResult.data.items[0].id, "storyboard-editor");

  dbWrapper.close();
});

test("settings IPC resolves assistant config by contactId", async () => {
  const homeDir = await createTempHome("creezv2-settings-contact-scope-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const assistantConfigRepository = new AssistantConfigRepository(dbWrapper.db);
  const contactRepository = new ContactRepository(dbWrapper.db);
  const memoryStore = new MemoryStore({ homeDir });
  const ipcMain = createIpcMainMock();

  assistantConfigRepository.saveConfigById(2, {
    name: "VC Bot",
    models: [{ id: "vc-m1", provider: "OpenRouter", model: "minimax/minimax-m2.5", apiKey: "sk-vc-999", active: true }],
  });
  dbWrapper.db.prepare(`
    INSERT OR REPLACE INTO contacts (id, type, name, avatar_path, assistant_config_id, is_default, created_at, updated_at)
    VALUES (?, 'bot', 'VC Bot', NULL, 2, 0, ?, ?)
  `).run("contact_vc", 123, 123);

  registerSettingsIpc(ipcMain, assistantConfigRepository, memoryStore, null, contactRepository);

  const getConfig = await ipcMain.handlers.get(CHANNELS.SETTINGS_GET_ASSISTANT_CONFIG)(null, { contactId: "contact_vc" });
  assert.equal(getConfig.ok, true);
  assert.equal(getConfig.data.name, "VC Bot");

  const getKey = await ipcMain.handlers.get(CHANNELS.SETTINGS_GET_MODEL_API_KEY)(null, {
    contactId: "contact_vc",
    modelId: "vc-m1",
  });
  assert.equal(getKey.ok, true);
  assert.equal(getKey.data.apiKey, "sk-vc-999");

  const saveConfig = await ipcMain.handlers.get(CHANNELS.SETTINGS_SAVE_ASSISTANT_CONFIG)(null, {
    contactId: "contact_vc",
    name: "VC Bot Updated",
  });
  assert.equal(saveConfig.ok, false);
  assert.equal(saveConfig.error?.code, "FORBIDDEN");
  const updated = assistantConfigRepository.getConfigById(2);
  assert.equal(updated?.name, "VC Bot");

  dbWrapper.close();
});
