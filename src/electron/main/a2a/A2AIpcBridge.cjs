/**
 * Registers A2A IPC handlers so the renderer can interact with the A2A subsystem.
 */

const { CHANNELS } = require("../channels.cjs");

const TAG = "[A2A:ipc]";

function ok(data) {
  return { ok: true, data };
}

function err(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {import('./A2ASessionOrchestrator.cjs').A2ASessionOrchestrator} orchestrator
 */
function registerA2AIpc(ipcMain, orchestrator) {
  ipcMain.handle(CHANNELS.A2A_GET_STATUS, async () => {
    try {
      return ok(orchestrator.getStatus());
    } catch (e) {
      return err("INTERNAL_ERROR", e.message);
    }
  });

  ipcMain.handle(CHANNELS.A2A_DISCOVER, async (_event, payload) => {
    try {
      const result = await orchestrator.discoverAgents(payload || {});
      return ok(result);
    } catch (e) {
      return err(e.code || "DISCOVER_ERROR", e.message);
    }
  });

  ipcMain.handle(CHANNELS.A2A_OPEN_SESSION, async (_event, payload) => {
    try {
      if (!payload?.fromAgentId || !payload?.toAgentId) {
        return err("VALIDATION_ERROR", "fromAgentId and toAgentId are required");
      }
      const result = await orchestrator.openUserSession(payload.fromAgentId, payload.toAgentId);
      return ok(result);
    } catch (e) {
      return err(e.code || "SESSION_ERROR", e.message);
    }
  });

  ipcMain.handle(CHANNELS.A2A_SEND_MESSAGE, async (_event, payload) => {
    try {
      if (!payload?.sessionId || !payload?.content) {
        return err("VALIDATION_ERROR", "sessionId and content are required");
      }
      const result = await orchestrator.sendUserMessage(payload.sessionId, payload.content);
      return ok(result);
    } catch (e) {
      return err(e.code || "MESSAGE_ERROR", e.message);
    }
  });

  ipcMain.handle(CHANNELS.A2A_CLOSE_SESSION, async (_event, payload) => {
    try {
      if (!payload?.sessionId) {
        return err("VALIDATION_ERROR", "sessionId is required");
      }
      const result = await orchestrator.closeSessionFromLocal(
        payload.sessionId,
        payload.reason || "user_closed",
      );
      return ok(result);
    } catch (e) {
      return err(e.code || "SESSION_ERROR", e.message);
    }
  });

  ipcMain.handle(CHANNELS.A2A_FETCH_MESSAGES, async (_event, payload) => {
    try {
      if (!payload?.sessionId) {
        return err("VALIDATION_ERROR", "sessionId is required");
      }
      const result = await orchestrator.fetchSessionMessages(payload.sessionId, payload.afterSeq);
      return ok(result);
    } catch (e) {
      return err(e.code || "FETCH_ERROR", e.message);
    }
  });

  ipcMain.handle(CHANNELS.A2A_SEND_TO_REMOTE_BOT, async (_event, payload) => {
    try {
      if (!payload?.chatId || !payload?.toAgentId || !payload?.content) {
        return err("VALIDATION_ERROR", "chatId, toAgentId, and content are required");
      }
      const result = await orchestrator.sendToRemoteBot(payload);
      return ok(result);
    } catch (e) {
      return err(e.code || "SEND_ERROR", e.message);
    }
  });

  ipcMain.handle(CHANNELS.A2A_REFRESH_REGISTRATION, async () => {
    try {
      const result = await orchestrator.refreshRegistration();
      return ok(result);
    } catch (e) {
      return err("REFRESH_ERROR", e.message);
    }
  });

  ipcMain.handle(CHANNELS.A2A_TRIGGER_AUTO_DISCOVERY, async (_event, payload) => {
    try {
      const agentId = String(payload?.agentId || "").trim();
      const result = await orchestrator.triggerManualAutoDiscovery(agentId);
      if (result.ok) return ok({});
      return err("MANUAL_DISCOVERY_ERROR", result.error || "failed");
    } catch (e) {
      return err("MANUAL_DISCOVERY_ERROR", e.message);
    }
  });

  console.log(TAG, "A2A IPC handlers registered");
}

module.exports = { registerA2AIpc };
