const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");

const { CreezDatabase } = require("../electron/main/db/database.cjs");
const { ContactRepository } = require("../electron/main/repositories/contactRepository.cjs");
const { registerContactIpc } = require("../electron/main/contactIpc.cjs");
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

test("contact IPC can create bot from vc template", async () => {
  const homeDir = await createTempHome("creezv2-contact-ipc-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new ContactRepository(dbWrapper.db);
  const ipcMain = createIpcMainMock();
  registerContactIpc(ipcMain, repo);

  const created = await ipcMain.handlers.get(CHANNELS.CONTACT_CREATE_BOT_FROM_TEMPLATE)(null, {
    templateId: "vc_fundraising",
  });
  assert.equal(created.ok, true);
  assert.equal(Boolean(created.data.contactId), true);
  assert.equal(Boolean(created.data.chatId), true);
  assert.equal(typeof created.data.assistantConfigId, "string");
  assert.equal(created.data.assistantConfigId.length > 0, true);

  const contact = dbWrapper.db.prepare("SELECT id, name FROM contacts WHERE id = ?").get(created.data.contactId);
  assert.equal(contact.name, "VC Fundraising Bot");
  assert.equal(contact.id, created.data.contactId);
  assert.equal(created.data.assistantConfigId, created.data.contactId);

  const chat = dbWrapper.db.prepare("SELECT contact_id FROM chats WHERE id = ?").get(created.data.chatId);
  assert.equal(chat.contact_id, created.data.contactId);

  dbWrapper.close();
});

test("contact IPC validates unknown bot template", async () => {
  const homeDir = await createTempHome("creezv2-contact-ipc-invalid-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new ContactRepository(dbWrapper.db);
  const ipcMain = createIpcMainMock();
  registerContactIpc(ipcMain, repo);

  const created = await ipcMain.handlers.get(CHANNELS.CONTACT_CREATE_BOT_FROM_TEMPLATE)(null, {
    templateId: "unknown_template",
  });
  assert.equal(created.ok, false);
  assert.equal(created.error.code, "VALIDATION_ERROR");

  dbWrapper.close();
});
