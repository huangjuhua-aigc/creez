const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CreezDatabase } = require("../electron/main/db/database.cjs");
const { TaskRepository } = require("../electron/main/repositories/taskRepository.cjs");

async function createTempHome(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("TaskRepository insert returns record with required fields", async () => {
  const homeDir = await createTempHome("creez-task-repo-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new TaskRepository(dbWrapper.db);

  const contactId = "11111111-1111-1111-1111-111111111111";
  const chatId = "1f2e3d4c-5b6a-47d8-9c01-23456789abcd";
  const record = repo.insert({
    contact_id: contactId,
    chat_id: chatId,
    cron_expression: "0 8 * * *",
    task_prompt: "Summarize today",
  });

  assert.equal(typeof record.id, "string");
  assert.equal(record.id.length > 0, true);
  assert.equal(record.contact_id, contactId);
  assert.equal(record.chat_id, chatId);
  assert.equal(record.cron_expression, "0 8 * * *");
  assert.equal(record.task_prompt, "Summarize today");
  assert.equal(record.status, "active");
  assert.equal(Number.isFinite(record.created_at), true);
  assert.equal(Number.isFinite(record.updated_at), true);

  dbWrapper.close();
});

test("TaskRepository insert with custom id uses it", async () => {
  const homeDir = await createTempHome("creez-task-repo-id-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new TaskRepository(dbWrapper.db);

  const customId = "task-custom-001";
  const record = repo.insert({
    id: customId,
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 9 * * *",
    task_prompt: "Hello",
  });

  assert.equal(record.id, customId);
  assert.equal(repo.getById(customId)?.id, customId);

  dbWrapper.close();
});

test("TaskRepository insert throws when required fields missing", async () => {
  const homeDir = await createTempHome("creez-task-repo-err-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new TaskRepository(dbWrapper.db);

  assert.throws(
    () => repo.insert({ contact_id: "c1", chat_id: "ch1" }),
    /cron_expression|task_prompt|required/
  );
  assert.throws(
    () => repo.insert({ cron_expression: "0 8 * * *", task_prompt: "x" }),
    /contact_id|chat_id|required/
  );

  dbWrapper.close();
});

test("TaskRepository getById returns null for missing id", async () => {
  const homeDir = await createTempHome("creez-task-repo-get-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new TaskRepository(dbWrapper.db);

  assert.equal(repo.getById("non-existent"), null);
  assert.equal(repo.getById(""), null);
  assert.equal(repo.getById(null), null);

  dbWrapper.close();
});

test("TaskRepository listActive returns only active tasks", async () => {
  const homeDir = await createTempHome("creez-task-repo-list-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new TaskRepository(dbWrapper.db);

  const t1 = repo.insert({
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 8 * * *",
    task_prompt: "A",
  });
  const t2 = repo.insert({
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 9 * * *",
    task_prompt: "B",
    status: "paused",
  });

  const active = repo.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].id, t1.id);
  assert.equal(active[0].status, "active");

  dbWrapper.close();
});

test("TaskRepository listByContactAndChat returns tasks for that contact and chat only", async () => {
  const homeDir = await createTempHome("creez-task-repo-listBy-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new TaskRepository(dbWrapper.db);

  const t1 = repo.insert({
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 8 * * *",
    task_prompt: "A",
  });
  repo.insert({
    contact_id: "c1",
    chat_id: "ch2",
    cron_expression: "0 9 * * *",
    task_prompt: "B",
  });
  repo.insert({
    contact_id: "c2",
    chat_id: "ch1",
    cron_expression: "0 10 * * *",
    task_prompt: "C",
  });
  const t4 = repo.insert({
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 11 * * *",
    task_prompt: "D",
    status: "paused",
  });

  const list = repo.listByContactAndChat("c1", "ch1");
  assert.equal(list.length, 2);
  assert.equal(list[0].id, t1.id);
  assert.equal(list[0].status, "active");
  assert.equal(list[1].id, t4.id);
  assert.equal(list[1].status, "paused");

  assert.equal(repo.listByContactAndChat("c1", "ch2").length, 1);
  assert.equal(repo.listByContactAndChat("", "ch1").length, 0);
  assert.equal(repo.listByContactAndChat("c1", "").length, 0);

  repo.updateStatus(t1.id, "deleted");
  const afterDelete = repo.listByContactAndChat("c1", "ch1");
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].id, t4.id);

  dbWrapper.close();
});

test("TaskRepository updateStatus changes status", async () => {
  const homeDir = await createTempHome("creez-task-repo-update-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new TaskRepository(dbWrapper.db);

  const t = repo.insert({
    contact_id: "c1",
    chat_id: "ch1",
    cron_expression: "0 8 * * *",
    task_prompt: "A",
  });
  assert.equal(repo.getById(t.id).status, "active");

  const updated = repo.updateStatus(t.id, "paused");
  assert.equal(updated, true);
  assert.equal(repo.getById(t.id).status, "paused");

  assert.equal(repo.updateStatus("no-such-id", "active"), false);
  assert.equal(repo.updateStatus(t.id, "invalid"), false);

  dbWrapper.close();
});

test("TaskRepository insertLog writes and returns log row", async () => {
  const homeDir = await createTempHome("creez-task-repo-log-");
  const dbWrapper = new CreezDatabase({ homeDir }).init();
  const repo = new TaskRepository(dbWrapper.db);

  const taskId = "task-001";
  const log = repo.insertLog({ task_id: taskId, status: "running" });
  assert.equal(typeof log.id, "string");
  assert.equal(log.task_id, taskId);
  assert.equal(log.status, "running");
  assert.equal(log.error_message, null);
  assert.equal(Number.isFinite(log.executed_at), true);

  const log2 = repo.insertLog({
    task_id: taskId,
    status: "failed",
    error_message: "Something broke",
  });
  assert.equal(log2.status, "failed");
  assert.equal(log2.error_message, "Something broke");

  assert.throws(() => repo.insertLog({ status: "running" }), /task_id/);

  dbWrapper.close();
});
