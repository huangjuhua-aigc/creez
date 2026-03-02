const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

class MemoryStore {
  constructor(options = {}) {
    this.homeDir = options.homeDir || os.homedir();
    this.fs = options.fs || fs;
    this.path = options.path || path;
    this.defaultPath = options.defaultPath || this.path.join(this.homeDir, ".creez", "memory", "memory.md");
  }

  resolvePath(customPath) {
    return customPath ? String(customPath) : this.defaultPath;
  }

  async read(customPath) {
    const filePath = this.resolvePath(customPath);
    try {
      const content = await this.fs.readFile(filePath, "utf8");
      return { content, path: filePath };
    } catch (_error) {
      return { content: "", path: filePath };
    }
  }

  async write(content, customPath) {
    const filePath = this.resolvePath(customPath);
    await this.fs.mkdir(this.path.dirname(filePath), { recursive: true });
    await this.fs.writeFile(filePath, typeof content === "string" ? content : String(content ?? ""), "utf8");
    return {
      updated: true,
      path: filePath,
      updatedAt: Math.floor(Date.now() / 1000),
    };
  }
}

module.exports = {
  MemoryStore,
};
