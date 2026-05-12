const { CHANNELS } = require("../channels.cjs");
const { resolveGmailAuth } = require("./gmailAuthRequest.cjs");
const { BrowserWindow, dialog } = require("electron");

function ok(data) {
  return { ok: true, data };
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

function registerGmailIpc(ipcMain, { gmailOAuthService, gmailGogClient, gmailRepository } = {}) {
  ipcMain.handle(CHANNELS.GMAIL_STATUS, async () => {
    try {
      return ok(gmailOAuthService?.getStatus?.() || { connected: false });
    } catch (error) {
      return fail("GMAIL_STATUS_ERROR", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.GMAIL_CONNECT, async () => {
    try {
      if (!gmailOAuthService?.connect) return fail("GMAIL_UNAVAILABLE", "Gmail OAuth service is unavailable.");
      return await gmailOAuthService.connect();
    } catch (error) {
      return fail("GMAIL_CONNECT_ERROR", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.GMAIL_DISCONNECT, async () => {
    try {
      return ok(gmailOAuthService?.disconnect?.() || { connected: false });
    } catch (error) {
      return fail("GMAIL_DISCONNECT_ERROR", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.GMAIL_GOG_CHOOSE_CREDENTIALS, async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(window, {
        title: "Select Google OAuth client_secret.json",
        properties: ["openFile"],
        filters: [{ name: "Google OAuth JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePaths?.[0]) return ok({ canceled: true, path: "" });
      return ok({ canceled: false, path: result.filePaths[0] });
    } catch (error) {
      return fail("GMAIL_GOG_CHOOSE_ERROR", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.GMAIL_GOG_CHOOSE_EXECUTABLE, async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(window, {
        title: "Select gog executable",
        properties: ["openFile"],
        filters: process.platform === "win32"
          ? [{ name: "gog.exe", extensions: ["exe"] }]
          : [{ name: "gog", extensions: ["*"] }],
      });
      if (result.canceled || !result.filePaths?.[0]) return ok({ canceled: true, path: "" });
      const selected = result.filePaths[0];
      gmailRepository?.saveGogPath?.(selected);
      return ok({ canceled: false, path: selected });
    } catch (error) {
      return fail("GMAIL_GOG_CHOOSE_EXECUTABLE_ERROR", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.GMAIL_GOG_SETUP, async (_event, payload = {}) => {
    try {
      if (!gmailGogClient?.setup) return fail("GMAIL_GOG_UNAVAILABLE", "gog Gmail provider is unavailable.");
      const status = await gmailGogClient.setup({
        credentialsPath: payload?.credentialsPath,
        googleEmail: payload?.googleEmail,
      });
      return ok(status);
    } catch (error) {
      return fail("GMAIL_GOG_SETUP_ERROR", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.GMAIL_AUTH_DECIDE, async (_event, payload = {}) => {
    return resolveGmailAuth(payload?.id, {
      allowed: Boolean(payload?.allowed),
      reason: payload?.reason,
    });
  });
}

module.exports = {
  registerGmailIpc,
};
