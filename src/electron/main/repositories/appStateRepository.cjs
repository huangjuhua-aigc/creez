const DEFAULT_APP_STATE = Object.freeze({
  lastTab: "chat",
  lastChatId: null,
  workspaceRoot: null,
  isLoggedIn: false,
  creezApiKey: null,
  deviceId: null,
});

function toDto(row) {
  if (!row) return { ...DEFAULT_APP_STATE };
  return {
    lastTab: row.last_tab || DEFAULT_APP_STATE.lastTab,
    lastChatId: row.last_chat_id || null,
    workspaceRoot: row.workspace_root || null,
    isLoggedIn: Boolean(row.is_logged_in),
    creezApiKey: row.creez_api_key != null ? String(row.creez_api_key) : null,
    deviceId: row.device_id != null ? String(row.device_id) : null,
  };
}

function sanitize(raw) {
  const safe = {
    ...DEFAULT_APP_STATE,
    ...(raw && typeof raw === "object" ? raw : {}),
  };

  if (typeof safe.lastTab !== "string" || safe.lastTab.trim() === "") {
    safe.lastTab = DEFAULT_APP_STATE.lastTab;
  } else {
    safe.lastTab = safe.lastTab.trim();
  }

  safe.lastChatId = safe.lastChatId == null ? null : String(safe.lastChatId);
  safe.workspaceRoot = safe.workspaceRoot == null ? null : String(safe.workspaceRoot);
  safe.isLoggedIn = Boolean(safe.isLoggedIn);
  safe.creezApiKey = safe.creezApiKey != null && String(safe.creezApiKey).trim() !== "" ? String(safe.creezApiKey).trim() : null;
  safe.deviceId = safe.deviceId != null && String(safe.deviceId).trim() !== "" ? String(safe.deviceId).trim() : null;
  return safe;
}

class AppStateRepository {
  constructor(db) {
    this.db = db;
    this.getStmt = db.prepare("SELECT * FROM app_state WHERE id = 1");
    this.updateStmt = db.prepare(`
      UPDATE app_state
      SET last_tab = @last_tab,
          last_chat_id = @last_chat_id,
          workspace_root = @workspace_root,
          is_logged_in = @is_logged_in,
          creez_api_key = @creez_api_key,
          device_id = @device_id,
          updated_at = @updated_at
      WHERE id = 1
    `);
  }

  getState() {
    return toDto(this.getStmt.get());
  }

  setState(partialState) {
    const merged = sanitize({
      ...this.getState(),
      ...(partialState && typeof partialState === "object" ? partialState : {}),
    });

    this.updateStmt.run({
      last_tab: merged.lastTab,
      last_chat_id: merged.lastChatId,
      workspace_root: merged.workspaceRoot,
      is_logged_in: merged.isLoggedIn ? 1 : 0,
      creez_api_key: merged.creezApiKey,
      device_id: merged.deviceId,
      updated_at: Math.floor(Date.now() / 1000),
    });

    return this.getState();
  }
}

module.exports = {
  AppStateRepository,
  DEFAULT_APP_STATE,
};
