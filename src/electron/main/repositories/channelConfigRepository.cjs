/**
 * Channel config persistence. Maps UI field keys (e.g. FEISHU_APP_ID) to stored credentials.
 * Storage: SQLite table `channel_configs` (bot_id, channel_type, enabled, credentials JSON).
 * DB file: ~/.creez/ 下与 Creez 主库同库（见 index.cjs 中 creezDb）。
 * UI: 设置 → 高级设置 → Channel 里编辑；credentials 存为 { appId, appSecret, openId }（feishu）等。
 */

const { randomUUID } = require("node:crypto");

/** UI field key -> storage key for each channel type */
const FEISHU_KEYS = {
  FEISHU_APP_ID: "appId",
  FEISHU_APP_SECRET: "appSecret",
  FEISHU_OPEN_ID: "openId",
};
const SLACK_KEYS = {
  SLACK_BOT_TOKEN: "botToken",
  SLACK_SIGNING_SECRET: "signingSecret",
  SLACK_CHANNEL_ID: "channelId",
};
const TELEGRAM_KEYS = {
  TELEGRAM_BOT_TOKEN: "botToken",
  TELEGRAM_CHAT_ID: "chatId",
};
const DINGTALK_KEYS = {
  DINGTALK_APP_KEY: "appKey",
  DINGTALK_APP_SECRET: "appSecret",
  DINGTALK_ROBOT_CODE: "robotCode",
};
const WECOM_KEYS = {
  WECOM_BOT_ID: "botId",
  WECOM_SECRET: "secret",
};
const WEIXIN_PERSONAL_KEYS = {};

const VALUE_TO_CREDENTIALS = {
  feishu: FEISHU_KEYS,
  slack: SLACK_KEYS,
  telegram: TELEGRAM_KEYS,
  dingtalk: DINGTALK_KEYS,
  wecom: WECOM_KEYS,
  weixin_personal: WEIXIN_PERSONAL_KEYS,
};

function valuesToCredentials(channelType, values) {
  const keyMap = VALUE_TO_CREDENTIALS[channelType];
  if (!keyMap || !values || typeof values !== "object") return {};
  const creds = {};
  for (const [uiKey, storageKey] of Object.entries(keyMap)) {
    const v = values[uiKey];
    if (v != null && String(v).trim() !== "") creds[storageKey] = String(v).trim();
  }
  return creds;
}

function credentialsToValues(channelType, credentials) {
  const keyMap = VALUE_TO_CREDENTIALS[channelType];
  if (!keyMap || !credentials || typeof credentials !== "object") return {};
  const values = {};
  for (const [uiKey, storageKey] of Object.entries(keyMap)) {
    const v = credentials[storageKey];
    if (v != null) values[uiKey] = String(v);
  }
  return values;
}

/** Mask secret for display (e.g. show last 4 chars or ***) */
function maskSecret(s) {
  if (s == null || typeof s !== "string") return "";
  if (s.length <= 4) return "****";
  return "****" + s.slice(-4);
}

class ChannelConfigRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * List configs for a bot. Returns items with channelType, enabled, and values (for UI).
   * Secrets are masked in values (FEISHU_APP_SECRET -> ****xxxx).
   */
  listByBotId(botId) {
    const rows = this.db
      .prepare(
        "SELECT id, bot_id, channel_type, enabled, credentials, extra, created_at, updated_at FROM channel_configs WHERE bot_id = ? ORDER BY channel_type"
      )
      .all(botId);

    return rows.map((row) => {
      let credentials = {};
      try {
        if (row.credentials) credentials = JSON.parse(row.credentials);
      } catch {
        credentials = {};
      }
      const values = credentialsToValues(row.channel_type, credentials);
      // Mask secrets in values for list (so UI can show "configured" without exposing secret)
      const masked = { ...values };
      if (row.channel_type === "feishu" && masked.FEISHU_APP_SECRET)
        masked.FEISHU_APP_SECRET = maskSecret(masked.FEISHU_APP_SECRET);
      if (row.channel_type === "slack") {
        if (masked.SLACK_BOT_TOKEN) masked.SLACK_BOT_TOKEN = maskSecret(masked.SLACK_BOT_TOKEN);
        if (masked.SLACK_SIGNING_SECRET) masked.SLACK_SIGNING_SECRET = maskSecret(masked.SLACK_SIGNING_SECRET);
      }
      if (row.channel_type === "telegram" && masked.TELEGRAM_BOT_TOKEN)
        masked.TELEGRAM_BOT_TOKEN = maskSecret(masked.TELEGRAM_BOT_TOKEN);
      if (row.channel_type === "dingtalk" && masked.DINGTALK_APP_SECRET)
        masked.DINGTALK_APP_SECRET = maskSecret(masked.DINGTALK_APP_SECRET);
      if (row.channel_type === "wecom" && masked.WECOM_SECRET)
        masked.WECOM_SECRET = maskSecret(masked.WECOM_SECRET);

      return {
        id: row.id,
        botId: row.bot_id,
        channelType: row.channel_type,
        enabled: Boolean(row.enabled),
        values: masked,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  /** Get one config with full credentials (for editing). Caller must not expose to UI as-is; use for save only or pre-fill and mask. */
  getByBotAndType(botId, channelType) {
    const row = this.db
      .prepare("SELECT * FROM channel_configs WHERE bot_id = ? AND channel_type = ?")
      .get(botId, channelType);
    if (!row) return null;
    let credentials = {};
    let extra = {};
    try {
      if (row.credentials) credentials = JSON.parse(row.credentials);
      if (row.extra) extra = JSON.parse(row.extra);
    } catch {
      // ignore
    }
    return {
      id: row.id,
      botId: row.bot_id,
      channelType: row.channel_type,
      enabled: Boolean(row.enabled),
      credentials,
      extra,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Upsert channel config. values = UI shape (FEISHU_APP_ID, FEISHU_APP_SECRET, ...).
   * If an existing row has credentials, we merge: only overwrite keys present in values (so user can leave secret blank to keep existing).
   */
  upsert({ botId, channelType, enabled, values }) {
    const nowTs = Math.floor(Date.now() / 1000);
    const existing = this.getByBotAndType(botId, channelType);
    const newCredentials = valuesToCredentials(channelType, values || {});

    if (existing) {
      const merged = { ...existing.credentials };
      for (const [k, v] of Object.entries(newCredentials)) {
        if (v != null && v !== "") merged[k] = v;
      }
      this.db
        .prepare(
          "UPDATE channel_configs SET enabled = ?, credentials = ?, updated_at = ? WHERE id = ?"
        )
        .run(enabled ? 1 : 0, JSON.stringify(merged), nowTs, existing.id);
      return { id: existing.id, updated: true };
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO channel_configs (id, bot_id, channel_type, enabled, credentials, extra, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        botId,
        channelType,
        enabled ? 1 : 0,
        JSON.stringify(newCredentials),
        "{}",
        nowTs,
        nowTs
      );
    return { id, updated: false };
  }

  /** Return all enabled channel config rows (across all bots) with full credentials. */
  listAllEnabled() {
    const rows = this.db
      .prepare(
        "SELECT id, bot_id, channel_type, enabled, credentials, extra, created_at, updated_at FROM channel_configs WHERE enabled = 1 ORDER BY bot_id, channel_type"
      )
      .all();

    return rows.map((row) => {
      let credentials = {};
      let extra = {};
      try { if (row.credentials) credentials = JSON.parse(row.credentials); } catch {}
      try { if (row.extra) extra = JSON.parse(row.extra); } catch {}
      return {
        id: row.id,
        botId: row.bot_id,
        channelType: row.channel_type,
        enabled: true,
        credentials,
        extra,
      };
    });
  }

  delete(botId, channelType) {
    this.db.prepare("DELETE FROM channel_configs WHERE bot_id = ? AND channel_type = ?").run(botId, channelType);
  }
}

module.exports = {
  ChannelConfigRepository,
  valuesToCredentials,
  credentialsToValues,
};
