/**
 * Sync pull task: every 5 minutes, if the app has non-default bots,
 * call backend GET /sync/pull?device_id=xxx and forward items to renderer via IPC.
 */

const { BrowserWindow } = require("electron");
const { CHANNELS } = require("./channels.cjs");
const { resolveCreezBackendBase } = require("./creezBackendBase.cjs");
const { ensureDeviceId } = require("./creezDeviceId.cjs");

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 15000;

let intervalId = null;
/** @type {{ appStateStore: object } | null} */
let syncPullDeviceDeps = null;

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
  const baseUrl = resolveCreezBackendBase().replace(/\/+$/, "");
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
  const { appStateStore } = syncPullDeviceDeps || {};
  const deviceId = appStateStore ? await ensureDeviceId("", appStateStore) : "";
  if (!deviceId) return;
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
function startSyncPullTask(contactRepository, deps = {}) {
  if (intervalId != null) return;
  syncPullDeviceDeps = deps.appStateStore ? { appStateStore: deps.appStateStore } : null;
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
  syncPullDeviceDeps = null;
}

module.exports = {
  hasNonDefaultBots,
  startSyncPullTask,
  stopSyncPullTask,
};
