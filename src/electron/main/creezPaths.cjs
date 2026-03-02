/**
 * Creez path conventions:
 * - System config (app config, agent state, skills, avatars, logs, memory, device_id, DB):
 *   always under ~/.creez (passed as homeDir → path.join(homeDir, ".creez")).
 * - User work data (workspace files): user-defined directory from app state (workspaceRoot),
 *   not under ~/.creez.
 *
 * agentDir = path.join(homeDir, ".creez") — root for agent system files (sessions, auth, etc.).
 */

const fs = require("node:fs");
const path = require("node:path");

/** Subdirs under ~/.creez that are created on startup (system config only). */
const CREEZ_SUBDIRS = ["avatars", "logs", "memory", "skills", "sessions"];

/**
 * @param {string} homeDir - User home (e.g. app.getPath("home")).
 * @returns {string} Absolute path to the Creez config root (~/.creez).
 */
function getCreezDir(homeDir) {
  return path.join(homeDir, ".creez");
}

/**
 * Ensures ~/.creez and system subdirs exist. Call once at app startup before using DB or agent.
 * @param {string} homeDir - User home (e.g. app.getPath("home")).
 */
function ensureCreezDirs(homeDir) {
  const creezDir = getCreezDir(homeDir);
  fs.mkdirSync(creezDir, { recursive: true });
  for (const sub of CREEZ_SUBDIRS) {
    fs.mkdirSync(path.join(creezDir, sub), { recursive: true });
  }
}

module.exports = {
  getCreezDir,
  ensureCreezDirs,
  CREEZ_SUBDIRS,
};
