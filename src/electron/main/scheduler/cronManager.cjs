/**
 * Wraps node-cron: maintains a Map of taskId -> ScheduledTask.
 * On app start loads all active tasks from DB and schedules them.
 * When cron fires, runs headlessRunner.executeTask(task).
 */

const cron = require("node-cron");
const { executeTask } = require("./headlessRunner.cjs");

const jobMap = new Map();
let deps = null;

/**
 * Set dependencies once (called from main index after repos are ready).
 * @param {object} d - { taskRepository, chatRepository, contactRepository, assistantConfigRepository, appStateStore, memoryStore, creezHome, sendToRenderer }
 */
function setDeps(d) {
  deps = d;
}

/**
 * Schedule one task in memory. Idempotent: if taskId already scheduled, unschedule first then reschedule.
 * @param {object} taskRecord - { id, contact_id, chat_id, cron_expression, task_prompt, status }
 */
function schedule(taskRecord) {
  if (!deps) {
    console.warn("[creez:scheduler] schedule called before setDeps");
    return;
  }
  const id = taskRecord?.id;
  const expr = taskRecord?.cron_expression?.trim();
  const status = taskRecord?.status;
  if (!id || !expr) {
    console.warn("[creez:scheduler] schedule: id and cron_expression required", { id: !!id, expr: !!expr });
    return;
  }
  if (status !== "active") {
    unschedule(id);
    return;
  }

  let valid = true;
  try {
    cron.validate(expr);
  } catch (e) {
    console.warn("[creez:scheduler] invalid cron_expression", { id, expr, message: e?.message });
    valid = false;
  }
  if (!valid) return;

  unschedule(id);
  let task;
  try {
    task = cron.schedule(expr, () => {
      console.log("[creez:task] cron fired", { id: taskRecord.id, chatId: taskRecord.chat_id, cron_expression: expr });
      executeTask(taskRecord, deps);
    });
  } catch (e) {
    console.warn("[creez:scheduler] cron.schedule failed", { id, expr, message: e?.message });
    return;
  }
  jobMap.set(id, task);
  console.log("[creez:scheduler] scheduled", { id, cron_expression: expr });
}

/**
 * Remove one task from the in-memory cron map.
 * @param {string} taskId
 */
function unschedule(taskId) {
  if (!taskId) return;
  const existing = jobMap.get(taskId);
  if (existing && existing.stop) {
    existing.stop();
    jobMap.delete(taskId);
    console.log("[creez:scheduler] unscheduled", { taskId });
  }
}

/**
 * Load all active tasks from DB and schedule them. Call after DB init and setDeps.
 */
async function initAll() {
  if (!deps?.taskRepository) {
    console.warn("[creez:scheduler] initAll: taskRepository not set");
    return;
  }
  const active = deps.taskRepository.listActive();
  console.log("[creez:task] cronManager.initAll start", { activeCount: active.length });
  for (const task of active) {
    schedule(task);
  }
  console.log("[creez:task] cronManager.initAll done", { scheduledCount: active.length });
}

/** Returns scheduled task ids (for unit tests). */
function getScheduledTaskIds() {
  return Array.from(jobMap.keys());
}

module.exports = {
  setDeps,
  schedule,
  unschedule,
  initAll,
  getScheduledTaskIds,
};
