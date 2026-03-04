/**
 * IPC for channel config (list / save / delete). Uses default bot when botId not provided.
 * ChannelManager (adapter lifecycle) can be wired later; for now we only persist config.
 */

const { CHANNELS } = require("./channels.cjs");

function ok(data) {
  return { ok: true, data };
}

function err(code, message) {
  return { ok: false, error: { code, message } };
}

function registerChannelIpc(ipcMain, deps) {
  const { channelConfigRepository, contactRepository, channelManager } = deps;

  function getDefaultBotId() {
    return contactRepository?.getDefaultAssistantConfigId?.() ?? "11111111-1111-1111-1111-111111111111";
  }

  ipcMain.handle(CHANNELS.CHANNEL_LIST_CONFIGS, async (_event, payload) => {
    try {
      const botId = payload?.botId && String(payload.botId).trim() ? String(payload.botId).trim() : getDefaultBotId();
      const items = channelConfigRepository.listByBotId(botId);
      return ok({ items, botId });
    } catch (e) {
      console.error("[channelIpc] listConfigs error:", e?.message || e);
      return err("DB_ERROR", e?.message ?? "Failed to list channel configs");
    }
  });

  ipcMain.handle(CHANNELS.CHANNEL_SAVE_CONFIG, async (_event, payload) => {
    try {
      const botId = payload?.botId && String(payload.botId).trim() ? String(payload.botId).trim() : getDefaultBotId();
      const channelType = payload?.channelType && String(payload.channelType).trim() ? String(payload.channelType).trim() : null;
      if (!channelType) return err("VALIDATION_ERROR", "channelType is required");

      const enabled = payload?.enabled !== false;
      const values = payload?.values && typeof payload.values === "object" ? payload.values : {};

      const result = channelConfigRepository.upsert({ botId, channelType, enabled, values });
      if (channelManager) {
        channelManager.restartChannel(botId, channelType).catch((e) =>
          console.warn("[channelIpc] restartChannel after save:", e?.message || e)
        );
      }
      return ok(result);
    } catch (e) {
      console.error("[channelIpc] saveConfig error:", e?.message || e);
      return err("DB_ERROR", e?.message ?? "Failed to save channel config");
    }
  });

  ipcMain.handle(CHANNELS.CHANNEL_DELETE_CONFIG, async (_event, payload) => {
    try {
      const botId = payload?.botId && String(payload.botId).trim() ? String(payload.botId).trim() : getDefaultBotId();
      const channelType = payload?.channelType && String(payload.channelType).trim() ? String(payload.channelType).trim() : null;
      if (!channelType) return err("VALIDATION_ERROR", "channelType is required");

      channelConfigRepository.delete(botId, channelType);
      return ok({ deleted: true });
    } catch (e) {
      console.error("[channelIpc] deleteConfig error:", e?.message || e);
      return err("DB_ERROR", e?.message ?? "Failed to delete channel config");
    }
  });
}

module.exports = {
  registerChannelIpc,
};
