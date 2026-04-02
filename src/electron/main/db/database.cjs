/**
 * Local SQLite DB for Creez (contacts, chats, messages, assistant config, app state).
 * - Path: ~/.creez/app.db (or path from options.homeDir). Parent dir is created in init().
 * - Tables: created by migrations (schema_migrations + app tables). No manual setup.
 * - Runtime: only "better-sqlite3" is required; npm install compiles the native addon. No separate SQLite binary.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { MIGRATIONS } = require("./migrations.cjs");
const { getCreezDir } = require("../creezPaths.cjs");

class CreezDatabase {
  constructor(options = {}) {
    this.homeDir = options.homeDir || os.homedir();
    this.creezHome = options.creezHome || getCreezDir(this.homeDir);
    this.dbPath = options.dbPath || path.join(this.creezHome, "app.db");
    this.db = null;
  }

  init() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 3000");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const getMigration = this.db.prepare("SELECT version FROM schema_migrations WHERE version = ?");
    const insertMigration = this.db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
    );

    for (const migration of MIGRATIONS) {
      const exists = getMigration.get(migration.version);
      if (exists) continue;

      const tx = this.db.transaction(() => {
        this.db.exec(migration.sql);
        insertMigration.run(migration.version, migration.name, Math.floor(Date.now() / 1000));
      });
      tx();
    }

    return this;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = {
  CreezDatabase,
};
