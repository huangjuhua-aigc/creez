const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isBuiltinSkillId } = require("./builtinSkillIds.cjs");

class SkillManager {
  constructor(options = {}) {
    this.homeDir = options.homeDir || os.homedir();
    this.baseDir = options.baseDir || path.join(__dirname, "..", "..");
    this.fs = options.fs || fs;
    this.fsSync = options.fsSync || fsSync;
    this.path = options.path || path;
  }

  getBundledSkillsDir() {
    return this.path.join(this.baseDir, "skills");
  }

  getUserSkillsDir() {
    return this.path.join(this.homeDir, ".creez", "skills");
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
}

module.exports = {
  SkillManager,
};
