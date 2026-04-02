const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isBuiltinSkillId } = require("./builtinSkillIds.cjs");
const { getCreezDir } = require("./creezPaths.cjs");

class SkillManager {
  constructor(options = {}) {
    this.homeDir = options.homeDir || os.homedir();
    this.creezHome = options.creezHome || getCreezDir(this.homeDir);
    this.baseDir = options.baseDir || path.join(__dirname, "..", "..");
    this.fs = options.fs || fs;
    this.fsSync = options.fsSync || fsSync;
    this.path = options.path || path;
  }

  getBundledSkillsDir() {
    return this.path.join(this.baseDir, "skills");
  }

  getUserSkillsDir() {
    return this.path.join(this.creezHome, "skills");
  }

  async listAvailableSkills() {
    const bundledDir = this.getBundledSkillsDir();
    const userDir = this.getUserSkillsDir();
    let entries = [];
    try {
      entries = await this.fs.readdir(bundledDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      if (skillName === "builtin" || isBuiltinSkillId(skillName)) continue;
      const skillMd = this.path.join(bundledDir, skillName, "SKILL.md");
      if (!this.fsSync.existsSync(skillMd)) continue;

      let description = "";
      try {
        const raw = await this.fs.readFile(skillMd, "utf8");
        const desc = raw.match(/description:\s*(.+)/i);
        description = desc ? desc[1].trim() : "";
      } catch {
        description = "";
      }

      const enabled = this.fsSync.existsSync(this.path.join(userDir, skillName));
      skills.push({
        id: skillName,
        name: skillName,
        description,
        enabled,
      });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  async syncEnabledSkills(enabledMap = {}) {
    const bundledDir = this.getBundledSkillsDir();
    const userDir = this.getUserSkillsDir();
    await this.fs.mkdir(userDir, { recursive: true });

    const skills = await this.listAvailableSkills();
    for (const skill of skills) {
      const src = this.path.join(bundledDir, skill.name);
      const dst = this.path.join(userDir, skill.name);
      const shouldEnable = Boolean(enabledMap[skill.name]);

      if (shouldEnable) {
        if (!this.fsSync.existsSync(dst)) {
          await this.fs.cp(src, dst, { recursive: true });
        }
      } else {
        if (this.fsSync.existsSync(dst)) {
          await this.fs.rm(dst, { recursive: true, force: true });
        }
      }
    }
  }

  /** Single .env path for all skill env (app-defined location). */
  getCreezEnvFilePath() {
    return this.path.join(this.creezHome, ".env");
  }

  /** Which env keys each skill uses (for reading subset only). "creez" = app-level env in ~/.creez/.env (Creez API / 后端调用). */
  static getSkillEnvKeys() {
    return {
      xiaohongshu: ["XHS_COOKIE"],
      "tavily-search": ["TAVILY_API_KEY"],
      creez: ["CREEZ_API_KEY", "CREEZ_BACKEND_URL"],
    };
  }

  /** Read full .env at ~/.creez/.env into key-value map. */
  async _readCreezEnvFile() {
    const envPath = this.getCreezEnvFilePath();
    try {
      const raw = await this.fs.readFile(envPath, "utf8");
      const env = {};
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key) env[key] = value;
      }
      return env;
    } catch {
      return {};
    }
  }

  /** Write full key-value map to ~/.creez/.env. */
  async _writeCreezEnvFile(env) {
    await this.fs.mkdir(this.creezHome, { recursive: true });
    const envPath = this.getCreezEnvFilePath();
    const lines = Object.entries(env)
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]) => `${k}=${String(v).trim()}`);
    await this.fs.writeFile(envPath, lines.length ? lines.join("\n") + "\n" : "", "utf8");
  }

  /**
   * Read skill env from ~/.creez/.env (only keys for this skill).
   * Returns { XHS_COOKIE?: string, ... } for that skill.
   */
  async getSkillEnv(skillId) {
    if (!skillId || typeof skillId !== "string") return {};
    const all = await this._readCreezEnvFile();
    const keys = SkillManager.getSkillEnvKeys()[skillId.trim()];
    if (!Array.isArray(keys)) return {};
    const out = {};
    for (const k of keys) {
      if (all[k] !== undefined) out[k] = all[k];
    }
    return out;
  }

  /**
   * Write skill env into ~/.creez/.env. Merges with existing file; only updates keys in `updates`.
   */
  async setSkillEnv(skillId, updates) {
    if (!skillId || typeof skillId !== "string" || !updates || typeof updates !== "object") return;
    const all = await this._readCreezEnvFile();
    for (const [k, v] of Object.entries(updates)) {
      if (v != null && String(v).trim() !== "") {
        all[k] = String(v).trim();
      } else if (all[k] !== undefined) {
        delete all[k];
      }
    }
    await this._writeCreezEnvFile(all);
  }
}

module.exports = {
  SkillManager,
};
