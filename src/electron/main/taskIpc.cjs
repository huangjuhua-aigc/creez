/**
 * IPC for scheduled tasks (settings UI: list, add, edit, delete).
 * Uses getSchedulerDeps() for taskRepository and cronManager.
 */

const cron = require("node-cron");
const { CHANNELS } = require("./channels.cjs");
const { getSchedulerDeps } = require("./scheduler/deps.cjs");

function ok(data) {
  return { ok: true, data };
}

function err(code, message, details) {
  return { ok: false, error: { code, message, details } };
}

function validateCron(expr) {
  if (!expr || typeof expr !== "string") return false;
  try {
    return cron.validate(expr.trim());
  } catch {
    return false;
  }
}

function registerTaskIpc(ipcMain) {
  ipcMain.handle(CHANNELS.SCHEDULED_TASKS_LIST, async () => {
    try {
      const deps = getSchedulerDeps();
      if (!deps?.taskRepository) return err("UNAVAILABLE", "Scheduler not initialized.");
      const tasks = deps.taskRepository.listNonDeleted();
      return ok({ tasks });
    } catch (e) {
      return err("DB_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.SCHEDULED_TASKS_CREATE, async (_event, payload) => {
    const contactId = payload?.contact_id != null ? String(payload.contact_id).trim() : "";
    const chatId = payload?.chat_id != null ? String(payload.chat_id).trim() : "";
    const cronExpression = payload?.cron_expression != null ? String(payload.cron_expression).trim() : "";
    const taskPrompt = payload?.task_prompt != null ? String(payload.task_prompt).trim() : "";
    if (!contactId || !chatId) return err("VALIDATION_ERROR", "contact_id and chat_id are required.");
    if (!cronExpression) return err("VALIDATION_ERROR", "cron_expression is required (e.g. 0 8 * * *).");
    if (!taskPrompt) return err("VALIDATION_ERROR", "task_prompt is required.");
    if (!validateCron(cronExpression)) return err("VALIDATION_ERROR", "Invalid cron expression.");
    try {
      const deps = getSchedulerDeps();
      if (!deps?.taskRepository || !deps?.cronManager) return err("UNAVAILABLE", "Scheduler not initialized.");
      const record = deps.taskRepository.insert({
        contact_id: contactId,
        chat_id: chatId,
        cron_expression: cronExpression,
        task_prompt: taskPrompt,
        status: "active",
      });
      deps.cronManager.schedule(record);
      return ok({ task: record });
    } catch (e) {
      return err("DB_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.SCHEDULED_TASKS_UPDATE, async (_event, payload) => {
    const taskId = payload?.task_id != null ? String(payload.task_id).trim() : "";
    if (!taskId) return err("VALIDATION_ERROR", "task_id is required.");
    const patch = {};
    if (payload?.cron_expression != null) patch.cron_expression = String(payload.cron_expression).trim();
    if (payload?.task_prompt != null) patch.task_prompt = String(payload.task_prompt).trim();
    if (payload?.status != null && ["active", "paused"].includes(String(payload.status).trim())) {
      patch.status = String(payload.status).trim();
    }
    if (Object.keys(patch).length === 0) return err("VALIDATION_ERROR", "Provide at least one of cron_expression, task_prompt, status.");
    if (patch.cron_expression && !validateCron(patch.cron_expression)) {
      return err("VALIDATION_ERROR", "Invalid cron expression.");
    }
    try {
      const deps = getSchedulerDeps();
      if (!deps?.taskRepository || !deps?.cronManager) return err("UNAVAILABLE", "Scheduler not initialized.");
      const existing = deps.taskRepository.getById(taskId);
      if (!existing) return err("NOT_FOUND", "Task not found.");
      deps.cronManager.unschedule(taskId);
      deps.taskRepository.update(taskId, patch);
      const updated = deps.taskRepository.getById(taskId);
      if (updated.status === "active") deps.cronManager.schedule(updated);
      return ok({ task: updated });
    } catch (e) {
      return err("DB_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.SCHEDULED_TASKS_DELETE, async (_event, payload) => {
    const taskId = payload?.task_id != null ? String(payload.task_id).trim() : "";
    if (!taskId) return err("VALIDATION_ERROR", "task_id is required.");
    try {
      const deps = getSchedulerDeps();
      if (!deps?.taskRepository || !deps?.cronManager) return err("UNAVAILABLE", "Scheduler not initialized.");
      const existing = deps.taskRepository.getById(taskId);
      if (!existing) return err("NOT_FOUND", "Task not found.");
      deps.cronManager.unschedule(taskId);
      deps.taskRepository.updateStatus(taskId, "deleted");
      return ok({ deleted: true });
    } catch (e) {
      return err("DB_ERROR", e?.message || String(e));
    }
  });
}

module.exports = {
  registerTaskIpc,
};
