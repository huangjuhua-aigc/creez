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

function registerChatIpc(ipcMain, chatRepository) {
  ipcMain.handle(CHANNELS.CHAT_LIST, async (_event, payload) => {
    try {
      const result = chatRepository.list(payload || {});
      return ok(result);
    } catch (error) {
      return err("DB_ERROR", "Failed to list chats", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.CHAT_GET_MESSAGES, async (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return err("VALIDATION_ERROR", "Payload must be an object.");
    }
    if (payload.chatId == null || String(payload.chatId).trim() === "") {
      return err("VALIDATION_ERROR", "chatId is required.");
    }

    try {
      const result = chatRepository.getMessages(payload);
      return ok(result);
    } catch (error) {
      return err("DB_ERROR", "Failed to fetch chat messages", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.CHAT_APPEND_MESSAGE, async (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return err("VALIDATION_ERROR", "Payload must be an object.");
    }
    if (!payload.chatId || !payload.sender) {
      return err("VALIDATION_ERROR", "chatId and sender are required.");
    }
    try {
      const result = chatRepository.appendMessage(payload);
      return ok(result);
    } catch (error) {
      return err("DB_ERROR", "Failed to append message", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.CHAT_UPDATE_MESSAGE, async (_event, payload) => {
    if (!payload || typeof payload !== "object" || !payload.id) {
      return err("VALIDATION_ERROR", "message id is required.");
    }
    try {
      const result = chatRepository.updateMessage(payload);
      return ok(result);
    } catch (error) {
      return err("DB_ERROR", "Failed to update message", error?.message || String(error));
    }
  });
}

module.exports = {
  registerChatIpc,
};
