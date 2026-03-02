const test = require("node:test");
const assert = require("node:assert/strict");

const { registerAppStateIpc } = require("../electron/main/appStateIpc.cjs");
const { CHANNELS } = require("../electron/main/channels.cjs");

function createMockIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
}

test("registerAppStateIpc registers handlers and returns app state", async () => {
  const ipcMain = createMockIpcMain();
  const store = {
    async getState() {
      return { lastTab: "chat", lastChatId: null, workspaceRoot: null, isLoggedIn: false };
    },
    async setState() {
      throw new Error("unused");
    },
  };

  registerAppStateIpc(ipcMain, store);

  assert.equal(typeof ipcMain.handlers.get(CHANNELS.APP_GET_STATE), "function");
  assert.equal(typeof ipcMain.handlers.get(CHANNELS.APP_SET_STATE), "function");

  const response = await ipcMain.handlers.get(CHANNELS.APP_GET_STATE)();
  assert.equal(response.ok, true);
  assert.equal(response.data.lastTab, "chat");
});

test("registerAppStateIpc validates setState payload", async () => {
  const ipcMain = createMockIpcMain();
  const store = {
    async getState() {
      return { lastTab: "chat", lastChatId: null, workspaceRoot: null, isLoggedIn: false };
    },
    async setState(payload) {
      return {
        lastTab: payload.lastTab || "chat",
        lastChatId: null,
        workspaceRoot: null,
        isLoggedIn: false,
      };
    },
  };

  registerAppStateIpc(ipcMain, store);

  const invalid = await ipcMain.handlers.get(CHANNELS.APP_SET_STATE)(null, "bad");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "VALIDATION_ERROR");

  const valid = await ipcMain.handlers.get(CHANNELS.APP_SET_STATE)(null, { lastTab: "settings" });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.updated, true);
  assert.equal(valid.data.state.lastTab, "settings");
});
