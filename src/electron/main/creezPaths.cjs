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
const os = require("node:os");
const path = require("node:path");

/** Subdirs under ~/.creez that are created on startup (system config only). */
const CREEZ_SUBDIRS = ["avatars", "logs", "memory", "skills", "sessions"];

/**
 * @param {string} homeOrCreezDir - User home (e.g. app.getPath("home")) OR creez dir itself.
 * @returns {string} Absolute path to the Creez config root (~/.creez).
 */
function getCreezDir(homeOrCreezDir) {
  const raw = String(homeOrCreezDir || "").trim();
  if (!raw) return path.join(os.homedir(), ".creez");
  const abs = path.resolve(raw);
  if (abs === path.resolve(os.homedir())) return path.join(abs, ".creez");
  return path.basename(abs).toLowerCase() === ".creez" ? abs : path.join(abs, ".creez");
}

/**
 * Resolve Creez root directory with env override.
 * - If CREEZ_HOME is set, use it directly.
 * - Otherwise default to ~/.creez (based on provided home dir or os.homedir()).
 *
 * @param {string} [defaultHomeDir]
 * @returns {string}
 */
function resolveCreezHome(defaultHomeDir) {
  const envHome = String(process.env.CREEZ_HOME || "").trim();
  if (envHome) return path.resolve(envHome);
  return getCreezDir(defaultHomeDir || os.homedir());
}

/**
 * Ensures ~/.creez and system subdirs exist. Call once at app startup before using DB or agent.
 * @param {string} homeOrCreezDir - User home (e.g. app.getPath("home")) OR creez dir itself.
 */
function ensureCreezDirs(homeOrCreezDir) {
  const raw = String(homeOrCreezDir || "").trim();
  const envHome = String(process.env.CREEZ_HOME || "").trim();
  const isExplicitEnvHome =
    raw &&
    envHome &&
    path.resolve(raw) === path.resolve(envHome);
  const creezDir = isExplicitEnvHome ? path.resolve(raw) : getCreezDir(raw);
  fs.mkdirSync(creezDir, { recursive: true });
  for (const sub of CREEZ_SUBDIRS) {
    fs.mkdirSync(path.join(creezDir, sub), { recursive: true });
  }
}

/**
 * Per-bot directory: ~/.creez/bots/<botId>/
 * Contains skills/, sessions/, knowledge/, data/ for the bot's runtime.
 * @param {string} creezHome - Resolved ~/.creez path
 * @param {string} botId
 * @returns {string}
 */
function getBotDir(creezHome, botId) {
  return path.join(creezHome, "bots", botId);
}

const BOT_SUBDIRS = ["skills", "sessions", "knowledge", "data"];

/**
 * Create the bot directory and its subdirs. Idempotent.
 * @param {string} creezHome
 * @param {string} botId
 * @returns {string} The bot dir root path
 */
function ensureBotDir(creezHome, botId) {
  const bd = getBotDir(creezHome, botId);
  for (const sub of BOT_SUBDIRS) {
    fs.mkdirSync(path.join(bd, sub), { recursive: true });
  }
  return bd;
}

module.exports = {
  getCreezDir,
  resolveCreezHome,
  ensureCreezDirs,
  getBotDir,
  ensureBotDir,
  BOT_SUBDIRS,
  CREEZ_SUBDIRS,
};
