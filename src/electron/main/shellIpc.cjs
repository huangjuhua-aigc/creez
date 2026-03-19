const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { shell } = require("electron");
const { CHANNELS } = require("./channels.cjs");

/**
 * Open a URL in the system browser (http/https/mailto) or a file/folder in the default app (absolute path / file://).
 * @param {import("electron").IpcMain} ipcMain
 */
function registerShellIpc(ipcMain) {
  ipcMain.handle(CHANNELS.SHELL_OPEN, async (_event, payload) => {
    const raw = String(payload?.target ?? "").trim();
    if (!raw) {
      return { ok: false, error: { code: "BAD_REQUEST", message: "target is required" } };
    }
    try {
      if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) {
        await shell.openExternal(raw);
        return { ok: true, data: { kind: "external" } };
      }

      let filePath = raw;
      if (raw.startsWith("file://")) {
        try {
          filePath = fileURLToPath(raw);
        } catch {
          return { ok: false, error: { code: "BAD_REQUEST", message: "invalid file:// URL" } };
        }
      }

      const normalized = path.normalize(filePath);
      if (!path.isAbsolute(normalized)) {
        return {
          ok: false,
          error: {
            code: "BAD_REQUEST",
            message: "Only absolute file paths or file:// URLs can be opened from chat",
          },
        };
      }

      const errMsg = await shell.openPath(normalized);
      if (errMsg) {
        return { ok: false, error: { code: "OPEN_FAILED", message: errMsg } };
      }
      return { ok: true, data: { kind: "path" } };
    } catch (e) {
      return {
        ok: false,
        error: { code: "OPEN_FAILED", message: e?.message || String(e) },
      };
    }
  });
}

module.exports = {
  registerShellIpc,
};
