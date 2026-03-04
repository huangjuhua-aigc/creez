/**
 * Starts and stops channel adapters for the default bot. Only Feishu is implemented.
 * Reads channel_configs (enabled=1, default bot_id) and starts the corresponding adapter.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { FeishuChannelAdapter } = require("./feishuAdapter.cjs");

const ADAPTERS = {
  feishu: FeishuChannelAdapter,
};

function channelLog(message) {
  const line = `[${new Date().toISOString()}] [ChannelManager] ${message}`;
  console.log(line);
  try {
    const logPath = path.join(os.homedir(), ".creez", "logs", "startup.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line + "\n", "utf8");
  } catch (_) {}
}

class ChannelManager {
  constructor(deps) {
    this._deps = deps;
    this._adapters = new Map();
  }

  async startAll() {
    channelLog("startAll() called");
    try {
      const { channelConfigRepository, contactRepository } = this._deps;
      const defaultBotId = contactRepository?.getDefaultAssistantConfigId?.() ?? "11111111-1111-1111-1111-111111111111";
      const list = channelConfigRepository.listByBotId(defaultBotId);
      const enabled = list.filter((c) => c.enabled);
      channelLog("defaultBotId=" + defaultBotId + " | configs=" + list.length + " | enabled=" + enabled.length);
      for (const item of enabled) {
        const full = channelConfigRepository.getByBotAndType(defaultBotId, item.channelType);
        const hasCreds = full?.credentials && typeof full.credentials === "object";
        const feishuReady = item.channelType === "feishu" && hasCreds && full.credentials.appId && full.credentials.appSecret;
        const otherReady = item.channelType !== "feishu" && hasCreds;
        if (!full || !hasCreds) {
          channelLog("skip " + item.channelType + ": no config or credentials");
          continue;
        }
        if (item.channelType === "feishu" && !feishuReady) {
          channelLog("skip feishu: missing appId or appSecret (check Advanced Settings → Channel)");
          continue;
        }
        if (item.channelType !== "feishu" && !otherReady) continue;
        channelLog("starting " + item.channelType + " ...");
        await this.startOne({
          botId: defaultBotId,
          channelType: item.channelType,
          credentials: full.credentials,
          extra: full.extra || {},
        });
      }
      channelLog("started " + this._adapters.size + " channel(s)");
    } catch (err) {
      channelLog("startAll error: " + (err?.message || String(err)));
      throw err;
    }
  }

  async startOne({ botId, channelType, credentials, extra }) {
    const key = `${botId}:${channelType}`;
    if (this._adapters.has(key)) {
      await this._adapters.get(key).stop();
      this._adapters.delete(key);
    }
    const AdapterClass = ADAPTERS[channelType];
    if (!AdapterClass) return;
    const adapter = new AdapterClass();
    const config = { ...credentials, ...extra };
    try {
      await adapter.start({
        config,
        botId,
        deps: this._deps,
      });
      this._adapters.set(key, adapter);
    } catch (err) {
      const msg = err?.message || String(err);
      console.error("[ChannelManager] failed to start " + channelType + ":", msg);
      channelLog("failed to start " + channelType + ": " + msg);
    }
  }

  async stopOne(botId, channelType) {
    const key = `${botId}:${channelType}`;
    const adapter = this._adapters.get(key);
    if (!adapter) return;
    await adapter.stop();
    this._adapters.delete(key);
  }

  async stopAll() {
    for (const [, adapter] of this._adapters) {
      await adapter.stop();
    }
    this._adapters.clear();
  }

  async restartChannel(botId, channelType) {
    const { channelConfigRepository } = this._deps;
    const full = channelConfigRepository.getByBotAndType(botId, channelType);
    if (!full || !full.enabled) {
      await this.stopOne(botId, channelType);
      return;
    }
    await this.startOne({
      botId,
      channelType,
      credentials: full.credentials,
      extra: full.extra || {},
    });
  }
}

module.exports = { ChannelManager };
