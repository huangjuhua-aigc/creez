const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_APP_STATE = Object.freeze({
  lastTab: "chat",
  lastChatId: null,
  workspaceRoot: null,
  isLoggedIn: false,
  creezApiKey: null,
  deviceId: null,
});

function sanitizeState(raw) {
  const safe = {
    ...DEFAULT_APP_STATE,
    ...(raw && typeof raw === "object" ? raw : {}),
  };

  if (typeof safe.lastTab !== "string" || safe.lastTab.trim() === "") {
    safe.lastTab = DEFAULT_APP_STATE.lastTab;
  }
  safe.lastTab = safe.lastTab.trim();

  if (safe.lastChatId !== null && safe.lastChatId !== undefined) {
    safe.lastChatId = String(safe.lastChatId);
  } else {
    safe.lastChatId = null;
  }

  if (safe.workspaceRoot !== null && safe.workspaceRoot !== undefined) {
    safe.workspaceRoot = String(safe.workspaceRoot);
  } else {
    safe.workspaceRoot = null;
  }

  if (safe.creezApiKey !== null && safe.creezApiKey !== undefined) {
    const trimmed = String(safe.creezApiKey).trim();
    safe.creezApiKey = trimmed !== "" ? trimmed : null;
  } else {
    safe.creezApiKey = null;
  }

  safe.isLoggedIn = Boolean(safe.isLoggedIn);

  if (safe.deviceId !== null && safe.deviceId !== undefined) {
    const trimmed = String(safe.deviceId).trim();
    safe.deviceId = trimmed !== "" ? trimmed : null;
  } else {
    safe.deviceId = null;
  }

  return safe;
}

class AppStateStore {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.homeDir = options.homeDir || os.homedir();
    this.fs = options.fs || fs;
    this.path = options.path || path;
    this.filePath = options.filePath || this.path.join(this.homeDir, ".creez", "app-state.json");
  }

  async getState() {
    if (this.repository) {
      return sanitizeState(this.repository.getState());
    }

    try {
      const raw = await this.fs.readFile(this.filePath, "utf8");
      return sanitizeState(JSON.parse(raw));
    } catch (_err) {
      return { ...DEFAULT_APP_STATE };
    }
  }

  async setState(partialState) {
    if (this.repository) {
      return sanitizeState(this.repository.setState(partialState));
    }

    const current = await this.getState();
    const merged = sanitizeState({
      ...current,
      ...(partialState && typeof partialState === "object" ? partialState : {}),
    });

    await this.fs.mkdir(this.path.dirname(this.filePath), { recursive: true });
    await this.fs.writeFile(this.filePath, JSON.stringify(merged, null, 2), "utf8");
    return merged;
  }
}

module.exports = {
  AppStateStore,
  DEFAULT_APP_STATE,
  sanitizeState,
};
