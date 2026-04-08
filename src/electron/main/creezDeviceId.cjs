/**
 * Canonical device id lives only in SQLite: `app_state.device_id`.
 * Legacy `$CREEZ_HOME/device_id` is read once when DB is empty (migration), then removed.
 */

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function legacyDeviceIdFilePath(creezHome) {
  return path.join(String(creezHome || "").trim(), "device_id");
}

/** @returns {{ filePath: string, id: string }} */
function readLegacyDeviceIdFile(creezHome) {
  const filePath = legacyDeviceIdFilePath(creezHome);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (content) return { filePath, id: content };
    }
  } catch (e) {
    console.warn("[creez:deviceId] read legacy file failed", e?.message);
  }
  return { filePath, id: "" };
}

function unlinkLegacyDeviceIdFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn("[creez:deviceId] remove legacy file failed", e?.message);
  }
}

/**
 * Ensure a non-empty device id in app_state. When `creezHome` is set, migrates legacy file into DB then deletes the file.
 * @param {string} creezHome
 * @param {{ getState: () => Promise<object>, setState?: (p: object) => Promise<object> } | null | undefined} appStateStore
 * @returns {Promise<string>}
 */
async function ensureDeviceId(creezHome, appStateStore) {
  const home = String(creezHome || "").trim();

  if (!appStateStore || typeof appStateStore.getState !== "function") {
    if (home) {
      const { id } = readLegacyDeviceIdFile(home);
      if (id) return id;
    }
    console.warn("[creez:deviceId] no appStateStore, ephemeral uuid");
    return randomUUID();
  }

  let fromDb = "";
  try {
    const state = await appStateStore.getState();
    fromDb = String(state?.deviceId || "").trim();
  } catch {
    /* ignore */
  }

  if (fromDb) {
    if (home) {
      const { filePath, id: legacy } = readLegacyDeviceIdFile(home);
      if (legacy && legacy !== fromDb) {
        console.warn("[creez:deviceId] ignoring legacy device_id file (differs from app.db)");
      }
      unlinkLegacyDeviceIdFile(filePath);
    }
    return fromDb;
  }

  let id = "";
  if (home) {
    const { filePath, id: fromFile } = readLegacyDeviceIdFile(home);
    if (fromFile) {
      id = fromFile;
      unlinkLegacyDeviceIdFile(filePath);
    }
  }
  if (!id) id = randomUUID();

  if (typeof appStateStore.setState === "function") {
    await appStateStore.setState({ deviceId: id });
  }
  return id;
}

module.exports = {
  ensureDeviceId,
};
