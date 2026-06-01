const MIGRATIONS = [
  {
    version: 1,
    name: "init_core_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        title TEXT,
        avatar TEXT,
        model_id TEXT,
        unread_count INTEGER NOT NULL DEFAULT 0,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_message_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sender TEXT NOT NULL CHECK(sender IN ('user','assistant','system')),
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'done' CHECK(status IN ('pending','streaming','done','error')),
        model_used TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        token_prompt INTEGER,
        token_completion INTEGER,
        token_total INTEGER,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at
        ON messages(chat_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        last_tab TEXT DEFAULT 'chat',
        last_chat_id TEXT,
        workspace_root TEXT,
        is_logged_in INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO app_state (id, updated_at)
      VALUES (1, CAST(strftime('%s', 'now') AS INTEGER));

      CREATE TABLE IF NOT EXISTS assistant_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        name TEXT NOT NULL DEFAULT 'Assistant',
        avatar_path TEXT,
        system_prompt TEXT,
        skills_json TEXT NOT NULL DEFAULT '{}',
        models_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO assistant_config (id, updated_at)
      VALUES (1, CAST(strftime('%s', 'now') AS INTEGER));
    `,
  },
  {
    version: 2,
    name: "add_contacts_and_bot_relation",
    sql: `
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'bot' CHECK(type IN ('bot','human','group')),
        name TEXT NOT NULL,
        avatar_path TEXT,
        assistant_config_id INTEGER,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);
      CREATE INDEX IF NOT EXISTS idx_contacts_default ON contacts(is_default DESC, updated_at DESC);

      ALTER TABLE chats ADD COLUMN contact_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_chats_contact_id ON chats(contact_id);

      ALTER TABLE messages ADD COLUMN bot_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_messages_bot_id_created_at ON messages(bot_id, created_at DESC);
    `,
  },
  {
    version: 3,
    name: "normalize_chat_contact_message_schema",
    sql: `
      INSERT OR IGNORE INTO contacts (id, type, name, avatar_path, assistant_config_id, is_default, created_at, updated_at)
      SELECT
        'contact_legacy_' || c.id,
        'bot',
        COALESCE(NULLIF(c.title, ''), 'Legacy Bot'),
        c.avatar,
        1,
        0,
        c.created_at,
        c.updated_at
      FROM chats c
      WHERE c.contact_id IS NULL;

      UPDATE chats
      SET contact_id = 'contact_legacy_' || id
      WHERE contact_id IS NULL;

      CREATE TEMP TABLE chat_keep AS
      SELECT
        c.contact_id,
        c.id AS keep_chat_id
      FROM chats c
      WHERE c.rowid = (
        SELECT c2.rowid
        FROM chats c2
        WHERE c2.contact_id = c.contact_id
        ORDER BY COALESCE(c2.last_message_at, c2.updated_at, c2.created_at) DESC, c2.rowid DESC
        LIMIT 1
      );

      UPDATE messages
      SET chat_id = (
        SELECT ck.keep_chat_id
        FROM chats c
        JOIN chat_keep ck ON ck.contact_id = c.contact_id
        WHERE c.id = messages.chat_id
        LIMIT 1
      )
      WHERE chat_id IN (SELECT id FROM chats);

      CREATE TABLE chats_v3 (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_message_at INTEGER,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );

      INSERT INTO chats_v3 (id, contact_id, created_at, updated_at, last_message_at)
      SELECT
        c.id,
        c.contact_id,
        c.created_at,
        c.updated_at,
        c.last_message_at
      FROM chats c
      JOIN chat_keep ck ON ck.keep_chat_id = c.id;

      CREATE TABLE messages_v3 (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sender TEXT NOT NULL CHECK(sender IN ('user','assistant','system')),
        bot_id TEXT,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'done' CHECK(status IN ('pending','streaming','done','error')),
        model_used TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        token_prompt INTEGER,
        token_completion INTEGER,
        token_total INTEGER,
        FOREIGN KEY(chat_id) REFERENCES chats_v3(id) ON DELETE CASCADE,
        FOREIGN KEY(bot_id) REFERENCES contacts(id) ON DELETE SET NULL,
        CHECK((sender <> 'assistant') OR (bot_id IS NOT NULL))
      );

      INSERT INTO messages_v3 (
        id, chat_id, sender, bot_id, content, status, model_used, error_code, error_message,
        created_at, updated_at, token_prompt, token_completion, token_total
      )
      SELECT
        m.id,
        m.chat_id,
        m.sender,
        CASE
          WHEN m.sender <> 'assistant' THEN NULL
          WHEN m.bot_id IS NOT NULL AND EXISTS (SELECT 1 FROM contacts WHERE id = m.bot_id) THEN m.bot_id
          ELSE c.contact_id
        END AS bot_id,
        m.content,
        m.status,
        m.model_used,
        m.error_code,
        m.error_message,
        m.created_at,
        m.updated_at,
        m.token_prompt,
        m.token_completion,
        m.token_total
      FROM messages m
      LEFT JOIN chats c ON c.id = m.chat_id
      WHERE m.chat_id IN (SELECT id FROM chats_v3);

      DROP TABLE messages;
      DROP TABLE chats;

      ALTER TABLE chats_v3 RENAME TO chats;
      ALTER TABLE messages_v3 RENAME TO messages;

      CREATE INDEX IF NOT EXISTS idx_chats_contact_id ON chats(contact_id);
      CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at ON messages(chat_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_bot_id_created_at ON messages(bot_id, created_at DESC);

      DROP TABLE chat_keep;
    `,
  },
  {
    version: 4,
    name: "migrate_default_bot_ids_to_guid",
    sql: `
      INSERT OR IGNORE INTO contacts (id, type, name, avatar_path, assistant_config_id, is_default, created_at, updated_at)
      SELECT
        '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11',
        type,
        name,
        avatar_path,
        assistant_config_id,
        is_default,
        created_at,
        updated_at
      FROM contacts
      WHERE id = 'contact_bot_default';

      INSERT OR IGNORE INTO contacts (id, type, name, avatar_path, assistant_config_id, is_default, created_at, updated_at)
      SELECT '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11', 'bot', 'Assistant', NULL, 1, 1, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER)
      WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE id = '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11');

      INSERT OR IGNORE INTO chats (id, contact_id, created_at, updated_at, last_message_at)
      SELECT
        '1f2e3d4c-5b6a-47d8-9c01-23456789abcd',
        '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11',
        created_at,
        updated_at,
        last_message_at
      FROM chats
      WHERE id = 'chat_bot_default';

      INSERT OR IGNORE INTO chats (id, contact_id, created_at, updated_at, last_message_at)
      SELECT '1f2e3d4c-5b6a-47d8-9c01-23456789abcd', '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11', CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER), NULL
      WHERE NOT EXISTS (SELECT 1 FROM chats WHERE id = '1f2e3d4c-5b6a-47d8-9c01-23456789abcd');

      UPDATE messages
      SET bot_id = '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11'
      WHERE bot_id = 'contact_bot_default';

      UPDATE messages
      SET chat_id = '1f2e3d4c-5b6a-47d8-9c01-23456789abcd'
      WHERE chat_id = 'chat_bot_default';

      DELETE FROM chats
      WHERE id = 'chat_bot_default';

      DELETE FROM contacts
      WHERE id = 'contact_bot_default';

      INSERT OR IGNORE INTO messages (
        id, chat_id, sender, bot_id, content, status, model_used, error_code, error_message,
        created_at, updated_at, token_prompt, token_completion, token_total
      )
      SELECT
        '2a3b4c5d-6e7f-48a9-b012-3456789abcde',
        '1f2e3d4c-5b6a-47d8-9c01-23456789abcd',
        sender,
        '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11',
        content,
        status,
        model_used,
        error_code,
        error_message,
        created_at,
        updated_at,
        token_prompt,
        token_completion,
        token_total
      FROM messages
      WHERE id = 'msg_bot_default_welcome';

      DELETE FROM messages
      WHERE id = 'msg_bot_default_welcome';
    `,
  },
  {
    version: 5,
    name: "add_messages_tool_calls",
    sql: `
      ALTER TABLE messages ADD COLUMN tool_calls TEXT;
    `,
  },
  {
    version: 6,
    name: "add_assistant_config_engine_type",
    sql: `
      ALTER TABLE assistant_config ADD COLUMN engine_type TEXT NOT NULL DEFAULT 'pi';
    `,
  },
  {
    version: 7,
    name: "assistant_config_allow_multi_row",
    sql: `
      CREATE TABLE assistant_config_v7 (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Assistant',
        avatar_path TEXT,
        system_prompt TEXT,
        skills_json TEXT NOT NULL DEFAULT '{}',
        models_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        engine_type TEXT NOT NULL DEFAULT 'pi'
      );

      INSERT INTO assistant_config_v7 (
        id, name, avatar_path, system_prompt, skills_json, models_json, updated_at, engine_type
      )
      SELECT
        id,
        name,
        avatar_path,
        system_prompt,
        skills_json,
        models_json,
        updated_at,
        CASE
          WHEN engine_type IS NULL OR TRIM(engine_type) = '' THEN 'pi'
          ELSE engine_type
        END
      FROM assistant_config;

      DROP TABLE assistant_config;
      ALTER TABLE assistant_config_v7 RENAME TO assistant_config;

      INSERT OR IGNORE INTO assistant_config (id, updated_at, engine_type)
      VALUES (1, CAST(strftime('%s', 'now') AS INTEGER), 'pi');
    `,
  },
  {
    version: 8,
    name: "assistant_config_id_equals_contact_id",
    sql: `
      CREATE TABLE assistant_config_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Assistant',
        avatar_path TEXT,
        system_prompt TEXT,
        skills_json TEXT NOT NULL DEFAULT '{}',
        models_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        engine_type TEXT NOT NULL DEFAULT 'pi'
      );

      INSERT INTO assistant_config_new (id, name, avatar_path, system_prompt, skills_json, models_json, updated_at, engine_type)
      SELECT
        c.id,
        ac.name,
        ac.avatar_path,
        ac.system_prompt,
        ac.skills_json,
        ac.models_json,
        ac.updated_at,
        COALESCE(NULLIF(TRIM(ac.engine_type), ''), 'pi')
      FROM contacts c
      JOIN assistant_config ac ON ac.id = c.assistant_config_id
      WHERE c.type = 'bot' AND c.assistant_config_id IS NOT NULL;

      DROP TABLE assistant_config;
      ALTER TABLE assistant_config_new RENAME TO assistant_config;

      CREATE TABLE contacts_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'bot' CHECK(type IN ('bot','human','group')),
        name TEXT NOT NULL,
        avatar_path TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO contacts_new (id, type, name, avatar_path, is_default, created_at, updated_at)
      SELECT id, type, name, avatar_path, is_default, created_at, updated_at FROM contacts;
      DROP TABLE contacts;
      ALTER TABLE contacts_new RENAME TO contacts;
      CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);
      CREATE INDEX IF NOT EXISTS idx_contacts_default ON contacts(is_default DESC, updated_at DESC);
    `,
  },
  {
    version: 9,
    name: "default_bot_id_to_fixed_uuid",
    sql: `
      UPDATE contacts SET id = '11111111-1111-1111-1111-111111111111' WHERE id = '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11';
      UPDATE assistant_config SET id = '11111111-1111-1111-1111-111111111111' WHERE id = '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11';
      UPDATE chats SET contact_id = '11111111-1111-1111-1111-111111111111' WHERE contact_id = '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11';
      UPDATE messages SET bot_id = '11111111-1111-1111-1111-111111111111' WHERE bot_id = '0d9f5d8a-4c7e-4f2a-9d6a-2b3a1a5e7c11';
    `,
  },
  {
    version: 10,
    name: "add_channel_configs",
    sql: `
      CREATE TABLE IF NOT EXISTS channel_configs (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        credentials TEXT,
        extra TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(bot_id, channel_type)
      );
      CREATE INDEX IF NOT EXISTS idx_channel_configs_bot ON channel_configs(bot_id);
    `,
  },
  {
    version: 11,
    name: "add_channel_to_chats_and_messages",
    sql: `
      ALTER TABLE chats ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'creez_app';
      ALTER TABLE chats ADD COLUMN channel_chat_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_chats_channel ON chats(channel_type);
      CREATE INDEX IF NOT EXISTS idx_chats_channel_chat_id ON chats(contact_id, channel_type, channel_chat_id);

      ALTER TABLE messages ADD COLUMN channel_type TEXT;
      ALTER TABLE messages ADD COLUMN channel_message_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_messages_channel_message_id ON messages(channel_message_id);
    `,
  },
  {
    version: 12,
    name: "chats_unique_per_channel",
    sql: `
      CREATE TABLE chats_new (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_message_at INTEGER,
        channel_type TEXT NOT NULL DEFAULT 'creez_app',
        channel_chat_id TEXT,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_chats_contact_channel_unique ON chats_new(contact_id, channel_type, COALESCE(channel_chat_id, ''));

      INSERT INTO chats_new (id, contact_id, created_at, updated_at, last_message_at, channel_type, channel_chat_id)
      SELECT id, contact_id, created_at, updated_at, last_message_at, channel_type, channel_chat_id FROM chats;

      DROP TABLE chats;
      ALTER TABLE chats_new RENAME TO chats;

      CREATE INDEX IF NOT EXISTS idx_chats_contact_id ON chats(contact_id);
      CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chats_channel ON chats(channel_type);
      CREATE INDEX IF NOT EXISTS idx_chats_channel_chat_id ON chats(contact_id, channel_type, channel_chat_id);
    `,
  },
  {
    version: 13,
    name: "add_scheduled_tasks_and_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        task_prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','deleted')),
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
        updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_contact_id ON scheduled_tasks(contact_id);

      CREATE TABLE IF NOT EXISTS task_logs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running','success','failed')),
        error_message TEXT,
        executed_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
      );
      CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
    `,
  },
  {
    version: 14,
    name: "add_app_state_creez_api_key",
    sql: `
      ALTER TABLE app_state ADD COLUMN creez_api_key TEXT;
    `,
  },
  {
    version: 15,
    name: "add_contacts_remote_agent_id_and_device_id",
    sql: `
      ALTER TABLE contacts ADD COLUMN remote_agent_id TEXT;
      ALTER TABLE app_state ADD COLUMN device_id TEXT;
    `,
  },
  {
    version: 16,
    name: "add_app_state_last_selected_model_id",
    sql: `
      ALTER TABLE app_state ADD COLUMN last_selected_model_id TEXT;
    `,
  },
  {
    version: 17,
    name: "a2a_support",
    sql: `
      ALTER TABLE contacts ADD COLUMN a2a_agent_id TEXT;

      CREATE TABLE IF NOT EXISTS a2a_contact_history (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        last_session_id TEXT,
        last_contacted_at TEXT DEFAULT (datetime('now')),
        total_sessions INTEGER DEFAULT 1,
        next_allowed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(from_agent_id, to_agent_id)
      );
    `,
  },
  {
    version: 18,
    name: "contacts_bot_origin",
    sql: `
      ALTER TABLE contacts ADD COLUMN bot_origin TEXT;
      UPDATE contacts SET bot_origin = 'assistant' WHERE type = 'bot' AND is_default = 1;
      UPDATE contacts SET bot_origin = 'template'
        WHERE type = 'bot' AND is_default = 0
          AND (remote_agent_id IS NULL OR TRIM(remote_agent_id) = '');
    `,
  },
  {
    version: 19,
    name: "add_assistant_config_a2a_strategy",
    sql: `
      ALTER TABLE assistant_config ADD COLUMN a2a_strategy_json TEXT;
    `,
  },
  {
    version: 20,
    name: "assistant_config_local_first_fields",
    sql: `
      ALTER TABLE assistant_config ADD COLUMN greeting_message TEXT DEFAULT '';
      ALTER TABLE assistant_config ADD COLUMN knowledge TEXT DEFAULT '';
      ALTER TABLE assistant_config ADD COLUMN agent_card_json TEXT;
      ALTER TABLE assistant_config ADD COLUMN visibility TEXT DEFAULT 'public';
      ALTER TABLE assistant_config ADD COLUMN status TEXT DEFAULT 'draft';
    `,
  },
  {
    version: 21,
    name: "add_assistant_config_qrcode",
    sql: `
      ALTER TABLE assistant_config ADD COLUMN qrcode_data_uri TEXT;
    `,
  },
  {
    version: 22,
    name: "add_gmail_accounts",
    sql: `
      CREATE TABLE IF NOT EXISTS gmail_accounts (
        id TEXT PRIMARY KEY,
        google_email TEXT,
        access_token TEXT,
        refresh_token TEXT,
        scope TEXT NOT NULL DEFAULT '',
        expiry_date INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 23,
    name: "add_gmail_gog_provider_fields",
    sql: `
      ALTER TABLE gmail_accounts ADD COLUMN provider TEXT NOT NULL DEFAULT 'native';
      ALTER TABLE gmail_accounts ADD COLUMN gog_account TEXT;
    `,
  },
  {
    version: 24,
    name: "add_gmail_gog_executable_path",
    sql: `
      ALTER TABLE gmail_accounts ADD COLUMN gog_path TEXT;
    `,
  },
  {
    version: 25,
    name: "add_gmail_gog_credentials_path",
    sql: `
      ALTER TABLE gmail_accounts ADD COLUMN gog_credentials_path TEXT;
    `,
  },
];

module.exports = {
  MIGRATIONS,
};
