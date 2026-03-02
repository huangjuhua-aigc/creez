const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { CHANNELS } = require("./channels.cjs");

function ok(data) {
  return { ok: true, data };
}

function err(code, message, details) {
  return { ok: false, error: { code, message, details } };
}

function safeBasename(fileName) {
  const name = String(fileName || "file").replace(/[/\\]/g, "");
  return name.length > 0 ? name : "file";
}

function registerAttachmentIpc(ipcMain) {
  ipcMain.handle(CHANNELS.ATTACHMENT_SAVE, async (_event, payload) => {
    try {
      const buffer = payload?.buffer;
      const fileName = payload?.fileName;
      if (!buffer || !fileName || typeof fileName !== "string") {
        return err("VALIDATION_ERROR", "buffer and fileName are required.");
      }
      const userData = app.getPath("userData");
      const uploadsDir = path.join(userData, "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const base = safeBasename(fileName);
      const ext = path.extname(base) || "";
      const stem = path.basename(base, ext) || "file";
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${stem}${ext}`;
      const fullPath = path.join(uploadsDir, unique);
      const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      fs.writeFileSync(fullPath, nodeBuffer);
      return ok({ path: fullPath });
    } catch (e) {
      const message = e?.message || String(e);
      return err("FS_ERROR", "Failed to save attachment", message);
    }
  });
}

module.exports = {
  registerAttachmentIpc,
};
