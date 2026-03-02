const { CHANNELS } = require("./channels.cjs");

function ok(data) {
  return { ok: true, data };
}

function err(code, message, details) {
  return {
    ok: false,
    error: { code, message, details },
  };
}

function registerAppStateIpc(ipcMain, store) {
  ipcMain.handle(CHANNELS.APP_GET_STATE, async () => {
    try {
      const state = await store.getState();
      return ok(state);
    } catch (error) {
      return err("UNKNOWN_ERROR", "Failed to load app state", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.APP_SET_STATE, async (_event, payload) => {
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
      return err("VALIDATION_ERROR", "Payload must be an object.");
    }

    try {
      const state = await store.setState(payload);
      return ok({ updated: true, state });
    } catch (error) {
      return err("UNKNOWN_ERROR", "Failed to persist app state", error?.message || String(error));
    }
  });
}

module.exports = {
  registerAppStateIpc,
};
