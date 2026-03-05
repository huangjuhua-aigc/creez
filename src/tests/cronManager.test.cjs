const test = require("node:test");
const assert = require("node:assert/strict");

const cronManager = require("../electron/main/scheduler/cronManager.cjs");

test("cronManager setDeps and initAll with empty list schedules nothing", async () => {
  const taskRepository = { listActive: () => [] };
  cronManager.setDeps({ taskRepository });
  await cronManager.initAll();

  assert.deepEqual(cronManager.getScheduledTaskIds(), []);
});

test("cronManager schedule adds job and unschedule removes it", async () => {
  const taskRepository = { listActive: () => [] };
  const task = {
    id: "task-schedule-unschedule",
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 8 * * *",
    task_prompt: "Daily summary",
    status: "active",
  };

  cronManager.setDeps({ taskRepository });
  cronManager.schedule(task);

  assert.equal(cronManager.getScheduledTaskIds().includes(task.id), true);

  cronManager.unschedule(task.id);
  assert.equal(cronManager.getScheduledTaskIds().includes(task.id), false);

  cronManager.unschedule("non-existent");
  assert.deepEqual(cronManager.getScheduledTaskIds(), []);
});

test("cronManager initAll loads active tasks and schedules them", async () => {
  const t1 = {
    id: "initall-t1",
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 8 * * *",
    task_prompt: "A",
    status: "active",
  };
  const t2 = {
    id: "initall-t2",
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 9 * * *",
    task_prompt: "B",
    status: "paused",
  };
  const taskRepository = { listActive: () => [t1, t2] };

  cronManager.setDeps({ taskRepository });
  await cronManager.initAll();

  const ids = cronManager.getScheduledTaskIds();
  assert.equal(ids.includes(t1.id), true);
  assert.equal(ids.includes(t2.id), false);
  assert.equal(ids.length, 1);

  cronManager.unschedule(t1.id);
});

test("cronManager schedule with invalid cron does not add job", async () => {
  cronManager.setDeps({ taskRepository: {} });

  cronManager.schedule({
    id: "bad-cron-task",
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "99 99 * * *",
    task_prompt: "X",
    status: "active",
  });

  assert.equal(cronManager.getScheduledTaskIds().includes("bad-cron-task"), false);
});

test("cronManager schedule with status paused does not add job", async () => {
  cronManager.setDeps({ taskRepository: {} });
  cronManager.schedule({
    id: "paused-task",
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 8 * * *",
    task_prompt: "X",
    status: "paused",
  });

  assert.equal(cronManager.getScheduledTaskIds().includes("paused-task"), false);
});
