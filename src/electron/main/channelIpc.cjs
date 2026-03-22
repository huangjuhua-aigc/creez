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

let _weixinAdapter = null;

function getOrCreateWeixinAdapter(channelManager) {
  if (_weixinAdapter) return _weixinAdapter;
  if (channelManager) {
    for (const [, adapter] of channelManager._adapters) {
      if (adapter.channelType === "weixin_personal") {
        _weixinAdapter = adapter;
        return _weixinAdapter;
      }
    }
  }
  const { WeixinPersonalAdapter } = require("./channel/weixinPersonalAdapter.cjs");
  _weixinAdapter = new WeixinPersonalAdapter();
  return _weixinAdapter;
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

  // -- WeChat Personal QR login flow ----------------------------------------

  ipcMain.handle(CHANNELS.WEIXIN_QR_START, async () => {
    try {
      const adapter = getOrCreateWeixinAdapter(channelManager);
      const result = await adapter.startQrLogin();
      return ok(result);
    } catch (e) {
      console.error("[channelIpc] weixin qrStart error:", e?.message || e);
      return err("WEIXIN_ERROR", e?.message ?? "Failed to start QR login");
    }
  });

  ipcMain.handle(CHANNELS.WEIXIN_QR_WAIT, async (_event, payload) => {
    try {
      const adapter = getOrCreateWeixinAdapter(channelManager);
      const result = await adapter.waitForQrLogin({ timeoutMs: payload?.timeoutMs });
      if (result.ok && result.connected && channelManager) {
        const botId = getDefaultBotId();
        channelConfigRepository.upsert({ botId, channelType: "weixin_personal", enabled: true, values: {} });
        channelManager.restartChannel(botId, "weixin_personal").catch((e) =>
          console.warn("[channelIpc] weixin restartChannel after login:", e?.message || e)
        );
      }
      return ok(result);
    } catch (e) {
      console.error("[channelIpc] weixin qrWait error:", e?.message || e);
      return err("WEIXIN_ERROR", e?.message ?? "Failed to wait for QR login");
    }
  });

  ipcMain.handle(CHANNELS.WEIXIN_STATUS, async () => {
    try {
      const adapter = getOrCreateWeixinAdapter(channelManager);
      return ok(adapter.getStatus());
    } catch (e) {
      return err("WEIXIN_ERROR", e?.message ?? "Failed to get status");
    }
  });
}

module.exports = {
  registerChannelIpc,
};
