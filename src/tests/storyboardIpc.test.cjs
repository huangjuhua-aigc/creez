const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");

const { CHANNELS } = require("../electron/main/channels.cjs");
const { registerStoryboardIpc } = require("../electron/main/storyboardIpc.cjs");

function createIpcMainMock() {
  const handlers = new Map();
  return {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    handlers,
  };
}

async function createTempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("storyboard IPC list returns items from storage", async () => {
  const workspaceRoot = await createTempDir("creez-storyboard-ipc-");
  const ipcMain = createIpcMainMock();
  const appStateStore = {
    async getState() {
      return { workspaceRoot };
    },
  };
  registerStoryboardIpc(ipcMain, { appStateStore });

  const listHandler = ipcMain.handlers.get(CHANNELS.STORYBOARD_LIST);
  assert.ok(listHandler);
  const result = await listHandler(null);
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.data.items));
  assert.equal(result.data.items.length, 0);
});

test("storyboard IPC create and get", async () => {
  const workspaceRoot = await createTempDir("creez-storyboard-ipc-crud-");
  const ipcMain = createIpcMainMock();
  const appStateStore = {
    async getState() {
      return { workspaceRoot };
    },
  };
  registerStoryboardIpc(ipcMain, { appStateStore });

  const createRes = await ipcMain.handlers.get(CHANNELS.STORYBOARD_CREATE)(
    null,
    { title: "IPC Test", prompt: "hello" }
  );
  assert.equal(createRes.ok, true);
  assert.ok(createRes.data.projectId);

  const getRes = await ipcMain.handlers.get(CHANNELS.STORYBOARD_GET)(null, {
    projectId: createRes.data.projectId,
  });
  assert.equal(getRes.ok, true);
  assert.equal(getRes.data.title, "IPC Test");
  assert.equal(getRes.data.prompt, "hello");
  assert.ok(getRes.data.content);
  assert.equal(getRes.data.content.script, "");
});

test("storyboard IPC get without projectId returns error", async () => {
  const workspaceRoot = await createTempDir("creez-storyboard-ipc-err-");
  const ipcMain = createIpcMainMock();
  const appStateStore = { async getState() { return { workspaceRoot }; } };
  registerStoryboardIpc(ipcMain, { appStateStore });

  const res = await ipcMain.handlers.get(CHANNELS.STORYBOARD_GET)(null, {});
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "VALIDATION_ERROR");
});

test("storyboard IPC update", async () => {
  const workspaceRoot = await createTempDir("creez-storyboard-ipc-update-");
  const ipcMain = createIpcMainMock();
  const appStateStore = {
    async getState() {
      return { workspaceRoot };
    },
  };
  registerStoryboardIpc(ipcMain, { appStateStore });

  const createRes = await ipcMain.handlers.get(CHANNELS.STORYBOARD_CREATE)(
    null,
    { prompt: "p" }
  );
  const projectId = createRes.data.projectId;

  const updateRes = await ipcMain.handlers.get(CHANNELS.STORYBOARD_UPDATE)(
    null,
    {
      projectId,
      meta: { title: "Updated" },
    }
  );
  assert.equal(updateRes.ok, true);

  const getRes = await ipcMain.handlers.get(CHANNELS.STORYBOARD_GET)(null, {
    projectId,
  });
  assert.equal(getRes.data.title, "Updated");
});
