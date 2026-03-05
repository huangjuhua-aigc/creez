/**
 * CRUD for scheduled_tasks and task_logs tables.
 */

const { randomUUID } = require("node:crypto");

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

class TaskRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {{ contact_id: string, chat_id: string, cron_expression: string, task_prompt: string }}
   * @returns {{ id: string, contact_id: string, chat_id: string, cron_expression: string, task_prompt: string, status: string, created_at: number, updated_at: number }}
   */
  insert(raw) {
    const id = raw.id && String(raw.id).trim() ? String(raw.id).trim() : randomUUID();
    const contactId = String(raw.contact_id || "").trim();
    const chatId = String(raw.chat_id || "").trim();
    const cronExpression = String(raw.cron_expression || "").trim();
    const taskPrompt = String(raw.task_prompt || "").trim();
    const status = ["active", "paused", "deleted"].includes(String(raw.status || "active").trim())
      ? String(raw.status).trim()
      : "active";
    const ts = nowTs();

    if (!contactId || !chatId || !cronExpression || !taskPrompt) {
      throw new Error("taskRepository.insert: contact_id, chat_id, cron_expression, task_prompt are required.");
    }

    this.db
      .prepare(
        `
      INSERT INTO scheduled_tasks (id, contact_id, chat_id, cron_expression, task_prompt, status, created_at, updated_at)
      VALUES (@id, @contact_id, @chat_id, @cron_expression, @task_prompt, @status, @created_at, @updated_at)
    `
      )
      .run({
        id,
        contact_id: contactId,
        chat_id: chatId,
        cron_expression: cronExpression,
        task_prompt: taskPrompt,
        status,
        created_at: ts,
        updated_at: ts,
      });

    const record = this.getById(id);
    console.log("[creez:task] taskRepository.insert", { id: record.id, chatId: record.chat_id, cron_expression: record.cron_expression });
    return record;
  }

  getById(id) {
    if (!id || typeof id !== "string") return null;
    const row = this.db.prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id.trim());
    if (!row) return null;
    return {
      id: row.id,
      contact_id: row.contact_id,
      chat_id: row.chat_id,
      cron_expression: row.cron_expression,
      task_prompt: row.task_prompt,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  listActive() {
    const rows = this.db
      .prepare("SELECT * FROM scheduled_tasks WHERE status = 'active' ORDER BY created_at ASC")
      .all();
    return rows.map((row) => ({
      id: row.id,
      contact_id: row.contact_id,
      chat_id: row.chat_id,
      cron_expression: row.cron_expression,
      task_prompt: row.task_prompt,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  /**
   * List all non-deleted tasks (for settings UI). Order: created_at desc.
   */
  listNonDeleted() {
    const rows = this.db
      .prepare(
        "SELECT * FROM scheduled_tasks WHERE status != 'deleted' ORDER BY created_at DESC"
      )
      .all();
    return rows.map((row) => ({
      id: row.id,
      contact_id: row.contact_id,
      chat_id: row.chat_id,
      cron_expression: row.cron_expression,
      task_prompt: row.task_prompt,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  /**
   * List tasks for a given contact and chat (for current conversation). Returns active first, then paused.
   */
  listByContactAndChat(contactId, chatId) {
    if (!contactId || !chatId) return [];
    const rows = this.db
      .prepare(
        "SELECT * FROM scheduled_tasks WHERE contact_id = ? AND chat_id = ? AND status != 'deleted' ORDER BY status = 'active' DESC, created_at ASC"
      )
      .all(String(contactId).trim(), String(chatId).trim());
    return rows.map((row) => ({
      id: row.id,
      contact_id: row.contact_id,
      chat_id: row.chat_id,
      cron_expression: row.cron_expression,
      task_prompt: row.task_prompt,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  updateStatus(id, status) {
    if (!id || typeof id !== "string") return false;
    const s = ["active", "paused", "deleted"].includes(String(status).trim()) ? String(status).trim() : null;
    if (!s) return false;
    const info = this.db
      .prepare("UPDATE scheduled_tasks SET status = @status, updated_at = @updated_at WHERE id = @id")
      .run({ id: id.trim(), status: s, updated_at: nowTs() });
    return info.changes > 0;
  }

  /**
   * Update task fields: cron_expression, task_prompt, status. Only provided fields are updated.
   * @param {string} id
   * @param {{ cron_expression?: string, task_prompt?: string, status?: string }} patch
   * @returns {boolean}
   */
  update(id, patch) {
    if (!id || typeof id !== "string" || !patch || typeof patch !== "object") return false;
    const task = this.getById(id.trim());
    if (!task) return false;
    const updates = [];
    const params = { id: id.trim(), updated_at: nowTs() };
    if (patch.cron_expression != null) {
      const v = String(patch.cron_expression).trim();
      if (v) {
        updates.push("cron_expression = @cron_expression");
        params.cron_expression = v;
      }
    }
    if (patch.task_prompt != null) {
      updates.push("task_prompt = @task_prompt");
      params.task_prompt = String(patch.task_prompt).trim();
    }
    if (patch.status != null && ["active", "paused", "deleted"].includes(String(patch.status).trim())) {
      updates.push("status = @status");
      params.status = String(patch.status).trim();
    }
    if (updates.length === 0) return true;
    const sql = `UPDATE scheduled_tasks SET ${updates.join(", ")}, updated_at = @updated_at WHERE id = @id`;
    const info = this.db.prepare(sql).run(params);
    return info.changes > 0;
  }

  insertLog(raw) {
    const id = raw.id && String(raw.id).trim() ? String(raw.id).trim() : randomUUID();
    const taskId = String(raw.task_id || "").trim();
    const status = ["running", "success", "failed"].includes(String(raw.status || "").trim())
      ? String(raw.status).trim()
      : "running";
    const errorMessage = raw.error_message != null ? String(raw.error_message) : null;
    const executedAt = Number.isFinite(Number(raw.executed_at)) ? Number(raw.executed_at) : nowTs();

    if (!taskId) throw new Error("taskRepository.insertLog: task_id is required.");

    this.db
      .prepare(
        `
      INSERT INTO task_logs (id, task_id, status, error_message, executed_at)
      VALUES (@id, @task_id, @status, @error_message, @executed_at)
    `
      )
      .run({
        id,
        task_id: taskId,
        status,
        error_message: errorMessage,
        executed_at: executedAt,
      });
    return { id, task_id: taskId, status, error_message: errorMessage, executed_at: executedAt };
  }
}

module.exports = {
  TaskRepository,
};
