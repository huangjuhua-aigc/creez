const { CHANNELS } = require("./channels.cjs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function ok(data) {
  return { ok: true, data };
}

function err(code, message, details) {
  return {
    ok: false,
    error: { code, message, details },
  };
}

let _fetchRemoteAgentConfig = null;
async function getFetchRemote() {
  if (!_fetchRemoteAgentConfig) {
    const { pathToFileURL } = require("node:url");
    const mod = await import(pathToFileURL(path.join(__dirname, "remoteAgentConfig.mjs")).href);
    _fetchRemoteAgentConfig = mod.fetchRemoteAgentConfig;
  }
  return _fetchRemoteAgentConfig;
}

function registerChatIpc(ipcMain, chatRepository, deps = {}) {
  const { contactRepository } = deps;
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

  ipcMain.handle(CHANNELS.CHAT_GET_OR_CREATE_BY_CONTACT, async (_event, payload) => {
    if (!payload || typeof payload !== "object" || !payload.contactId || String(payload.contactId).trim() === "") {
      return err("VALIDATION_ERROR", "contactId is required.");
    }
    try {
      const result = chatRepository.getOrCreateByContactId(payload);
      if (contactRepository) {
        const contact = contactRepository.getById(String(payload.contactId || ""));
        const remoteAgentId = contact?.remoteAgentId || null;
        if (remoteAgentId) {
          try {
            const existingMessages = chatRepository.getMessages({ chatId: result.chatId, limit: 1 });
            const isEmptyChat = !Array.isArray(existingMessages?.items) || existingMessages.items.length === 0;
            if (isEmptyChat) {
              const fetchRemote = await getFetchRemote();
              const remote = await fetchRemote(remoteAgentId);
              const greeting = String(remote?.greetingMessage || "").trim();
              if (greeting) {
                chatRepository.appendMessage({
                  id: randomUUID(),
                  chatId: result.chatId,
                  sender: "assistant",
                  botId: remoteAgentId,
                  content: greeting,
                  status: "done",
                });
              }
            }
          } catch (e) {
            console.warn("[chatIpc] greeting fetch failed:", e?.message || String(e));
          }
        }
      }
      return ok(result);
    } catch (error) {
      return err("DB_ERROR", "Failed to get or create chat by contact", error?.message || String(error));
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
