/**
 * Sync pull task: every 5 minutes, if the app has non-default bots,
 * call backend GET /sync/pull?device_id=xxx and forward items to renderer via IPC.
 */

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow } = require("electron");
const { randomUUID } = require("node:crypto");
const { CHANNELS } = require("./channels.cjs");

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 15000;

let intervalId = null;

function getDeviceIdPath() {
  const homeDir = app.getPath("home");
  return path.join(homeDir, ".creez", "device_id");
}

/**
 * Read or create and persist device_id. Returns a non-empty string.
 */
function getOrCreateDeviceId() {
  const filePath = getDeviceIdPath();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (content) return content;
    }
  } catch (err) {
    console.warn("[creezv2 syncPull] read device_id failed", err?.message);
  }
  const deviceId = randomUUID();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, deviceId, "utf8");
  } catch (err) {
    console.warn("[creezv2 syncPull] write device_id failed", err?.message);
  }
  return deviceId;
}

function resolveSyncApiBase() {
  const fromEnv = String(process.env.CREEZ_KNOWLEDGE_API_BASE || "").trim();
  return fromEnv || "https://creez.lighton.video";
}

/**
 * Returns true if there is at least one non-default bot contact.
 */
function hasNonDefaultBots(contactRepository) {
  if (!contactRepository || typeof contactRepository.list !== "function") return false;
  const { items = [] } = contactRepository.list({ type: "bot" }) || {};
  return items.some((c) => c && c.type === "bot" && !c.isDefault);
}

/**
 * Fetch pending messages from backend. Returns { ok, items } or { ok: false, error }.
 */
async function pullPendingMessages(deviceId) {
  const baseUrl = resolveSyncApiBase().replace(/\/+$/, "");
  const url = `${baseUrl}/sync/pull?device_id=${encodeURIComponent(deviceId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json().catch(() => null);
    clearTimeout(timeout);
    if (!response.ok) {
      return {
        ok: false,
        error: payload?.error?.message || `HTTP ${response.status}`,
      };
    }
    if (!payload || !payload.ok) {
      return {
        ok: false,
        error: payload?.error?.message || "Invalid response",
      };
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    return { ok: true, items };
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Send payload to all open browser windows.
 */
function sendToAllWindows(channel, payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, payload);
    }
  }
}

/**
 * Single tick: check non-default bots, pull, and forward to renderer.
 */
async function runSyncTick(contactRepository) {
  if (!hasNonDefaultBots(contactRepository)) return;
  const deviceId = getOrCreateDeviceId();
  const result = await pullPendingMessages(deviceId);
  if (!result.ok) {
    console.log("[creezv2 syncPull] pull failed", result.error);
    return;
  }
  if (result.items && result.items.length > 0) {
    console.log("[creezv2 syncPull] forwarding", result.items.length, "items to renderer");
    sendToAllWindows(CHANNELS.SYNC_PENDING_MESSAGES, { items: result.items });
  }
}

/**
 * Start the 5-minute sync pull task. Call once after app is ready.
 * Only runs the request when there are non-default bots.
 */
function startSyncPullTask(contactRepository) {
  if (intervalId != null) return;
  intervalId = setInterval(() => {
    runSyncTick(contactRepository).catch((err) => {
      console.warn("[creezv2 syncPull] tick error", err?.message);
    });
  }, INTERVAL_MS);
  // First run after 30s so app is settled; then every 5 min
  setTimeout(() => {
    runSyncTick(contactRepository).catch((err) => {
      console.warn("[creezv2 syncPull] initial tick error", err?.message);
    });
  }, 30 * 1000);
}

/**
 * Stop the sync pull task. Call on app before-quit.
 */
function stopSyncPullTask() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  getOrCreateDeviceId,
  hasNonDefaultBots,
  startSyncPullTask,
  stopSyncPullTask,
};
