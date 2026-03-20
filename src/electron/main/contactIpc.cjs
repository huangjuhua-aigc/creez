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

function registerContactIpc(ipcMain, contactRepository) {
  ipcMain.handle(CHANNELS.CONTACT_LIST, async (_event, payload) => {
    try {
      const result = contactRepository.list(payload || {});
      return ok(result);
    } catch (error) {
      return err("DB_ERROR", "Failed to list contacts", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.CONTACT_CREATE_BOT_FROM_TEMPLATE, async (_event, payload) => {
    const templateId = payload?.templateId;
    if (!templateId || typeof templateId !== "string") {
      return err("VALIDATION_ERROR", "templateId is required.");
    }
    try {
      const result = contactRepository.createBotFromTemplate(templateId);
      return ok(result);
    } catch (error) {
      const message = error?.message || String(error);
      if (message.startsWith("Unsupported bot template:")) {
        return err("VALIDATION_ERROR", message);
      }
      return err("DB_ERROR", "Failed to create bot from template", message);
    }
  });

  ipcMain.handle(CHANNELS.CONTACT_GET_DEFAULT_BOT_ID, async () => {
    try {
      const id = contactRepository.getDefaultAssistantConfigId?.() ?? "11111111-1111-1111-1111-111111111111";
      return ok({ botId: id });
    } catch (error) {
      return err("DB_ERROR", "Failed to get default bot id", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.CONTACT_ADD_REMOTE_AGENT, async (_event, payload) => {
    const agentId = String(payload?.agentId || "").trim();
    const name = String(payload?.name || "").trim();
    if (!agentId) return err("VALIDATION_ERROR", "agentId is required.");
    if (!name) return err("VALIDATION_ERROR", "name is required.");
    try {
      const result = contactRepository.addRemoteAgent({
        agentId,
        name,
        avatarUrl: payload?.avatarUrl || null,
        greetingMessage: payload?.greetingMessage || "",
      });
      return ok(result);
    } catch (error) {
      return err("DB_ERROR", "Failed to add remote agent", error?.message || String(error));
    }
  });
}

module.exports = {
  registerContactIpc,
};
