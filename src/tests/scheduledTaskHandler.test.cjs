const test = require("node:test");
const assert = require("node:assert/strict");

const { setSchedulerDeps } = require("../electron/main/scheduler/deps.cjs");

test("create_scheduled_task handler returns error when contactId/chatId missing", async () => {
  setSchedulerDeps({ taskRepository: {}, cronManager: {} });

  const { createScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = createScheduledTaskHandler({});
  const result = await handler.execute({ cron_expression: "0 8 * * *", task_prompt: "Hi" });

  assert.equal(result.isError, true);
  assert.equal(Array.isArray(result.content), true);
  assert.equal(result.content.length >= 1, true);
  const text = result.content[0]?.text || "";
  assert.equal(text.includes("contactId") || text.includes("chatId") || text.includes("MISSING"), true);
});

test("create_scheduled_task handler returns error when cron_expression missing", async () => {
  setSchedulerDeps({ taskRepository: {}, cronManager: {} });

  const { createScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = createScheduledTaskHandler({
    contactId: "11111111-1111-1111-1111-111111111111",
    chatId: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
  });
  const result = await handler.execute({ task_prompt: "Do something" });

  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("cron") || text.includes("INVALID"), true);
});

test("create_scheduled_task handler returns error when task_prompt missing", async () => {
  setSchedulerDeps({ taskRepository: {}, cronManager: {} });

  const { createScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = createScheduledTaskHandler({
    contactId: "11111111-1111-1111-1111-111111111111",
    chatId: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
  });
  const result = await handler.execute({ cron_expression: "0 8 * * *" });

  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("task_prompt") || text.includes("INVALID"), true);
});

test("create_scheduled_task handler returns error for invalid cron expression", async () => {
  setSchedulerDeps({ taskRepository: {}, cronManager: {} });

  const { createScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = createScheduledTaskHandler({
    contactId: "11111111-1111-1111-1111-111111111111",
    chatId: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
  });
  const result = await handler.execute({
    cron_expression: "99 99 * * *",
    task_prompt: "Hello",
  });

  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("cron") || text.includes("INVALID"), true);
});

test("create_scheduled_task handler returns error when scheduler deps not set", async () => {
  setSchedulerDeps(null);

  const { createScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = createScheduledTaskHandler({
    contactId: "11111111-1111-1111-1111-111111111111",
    chatId: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
  });
  const result = await handler.execute({
    cron_expression: "0 8 * * *",
    task_prompt: "Daily summary",
  });

  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("SCHEDULER") || text.includes("initialized") || text.includes("UNAVAILABLE"), true);
});

test("create_scheduled_task handler success inserts task and returns success message", async () => {
  const inserted = [];
  const scheduledIds = [];
  const mockTaskRepository = {
    insert(raw) {
      const record = {
        id: raw.id || `mock-${Date.now()}`,
        contact_id: raw.contact_id,
        chat_id: raw.chat_id,
        cron_expression: raw.cron_expression,
        task_prompt: raw.task_prompt,
        status: raw.status || "active",
      };
      inserted.push(record);
      return record;
    },
    listActive() {
      return inserted.filter((r) => r.status === "active");
    },
  };
  const mockCronManager = {
    schedule(record) {
      scheduledIds.push(record.id);
    },
  };

  setSchedulerDeps({ taskRepository: mockTaskRepository, cronManager: mockCronManager });

  const { createScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = createScheduledTaskHandler({
    contactId: "11111111-1111-1111-1111-111111111111",
    chatId: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
  });
  const result = await handler.execute({
    cron_expression: "0 8 * * *",
    task_prompt: "Summarize today",
  });

  assert.equal(Boolean(result.isError), false);
  assert.equal(Array.isArray(result.content), true);
  assert.equal(result.content.length >= 1, true);
  const text = result.content[0].text || "";
  assert.equal(text.includes("success") && text.includes("定时任务已创建"), true);

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].task_prompt, "Summarize today");
  assert.equal(inserted[0].cron_expression, "0 8 * * *");
  assert.equal(scheduledIds.length, 1);
  assert.equal(scheduledIds[0], inserted[0].id);
});

// --- delete_scheduled_task ---
test("delete_scheduled_task handler returns error when contactId/chatId missing", async () => {
  setSchedulerDeps({ taskRepository: {}, cronManager: {} });
  const { deleteScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = deleteScheduledTaskHandler({});
  const result = await handler.execute({ task_id: "some-id" });
  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("contactId") || text.includes("chatId") || text.includes("MISSING"), true);
});

test("delete_scheduled_task handler returns error when task_id missing", async () => {
  setSchedulerDeps({ taskRepository: {}, cronManager: {} });
  const { deleteScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = deleteScheduledTaskHandler({
    contactId: "11111111-1111-1111-1111-111111111111",
    chatId: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
  });
  const result = await handler.execute({});
  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("task_id") || text.includes("INVALID"), true);
});

test("delete_scheduled_task handler returns NOT_FOUND when task does not exist", async () => {
  const mockTaskRepository = {
    getById(id) {
      return null;
    },
  };
  setSchedulerDeps({ taskRepository: mockTaskRepository, cronManager: {} });
  const { deleteScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = deleteScheduledTaskHandler({
    contactId: "11111111-1111-1111-1111-111111111111",
    chatId: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
  });
  const result = await handler.execute({ task_id: "non-existent" });
  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("NOT_FOUND") || text.includes("No scheduled task"), true);
});

test("delete_scheduled_task handler returns FORBIDDEN when task belongs to another chat", async () => {
  const mockTaskRepository = {
    getById(id) {
      return {
        id,
        contact_id: "other-contact",
        chat_id: "other-chat",
        cron_expression: "0 8 * * *",
        task_prompt: "X",
        status: "active",
      };
    },
  };
  setSchedulerDeps({ taskRepository: mockTaskRepository, cronManager: {} });
  const { deleteScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = deleteScheduledTaskHandler({
    contactId: "11111111-1111-1111-1111-111111111111",
    chatId: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
  });
  const result = await handler.execute({ task_id: "task-other" });
  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("FORBIDDEN") || text.includes("another"), true);
});

test("delete_scheduled_task handler success unschedules and marks deleted", async () => {
  const unscheduledIds = [];
  const mockTaskRepository = {
    getById(id) {
      return {
        id,
        contact_id: "11111111-1111-1111-1111-111111111111",
        chat_id: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
        cron_expression: "0 8 * * *",
        task_prompt: "Daily",
        status: "active",
      };
    },
    updateStatus(id, status) {
      if (status === "deleted") return true;
      return false;
    },
  };
  const mockCronManager = {
    unschedule(id) {
      unscheduledIds.push(id);
    },
  };
  setSchedulerDeps({ taskRepository: mockTaskRepository, cronManager: mockCronManager });
  const { deleteScheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = deleteScheduledTaskHandler({
    contactId: "11111111-1111-1111-1111-111111111111",
    chatId: "1f2e3d4c-5b6a-47d8-9c01-23456789abcd",
  });
  const result = await handler.execute({ task_id: "task-to-delete" });
  assert.equal(Boolean(result.isError), false);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("成功") || text.includes("删除"), true);
  assert.equal(unscheduledIds.length, 1);
  assert.equal(unscheduledIds[0], "task-to-delete");
});

// --- list_scheduled_tasks ---
test("list_scheduled_tasks handler returns error when contactId/chatId missing", async () => {
  setSchedulerDeps({ taskRepository: {} });
  const { listScheduledTasksHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = listScheduledTasksHandler({});
  const result = await handler.execute({});
  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("contactId") || text.includes("chatId") || text.includes("MISSING"), true);
});

test("list_scheduled_tasks handler success returns tasks summary", async () => {
  const tasks = [
    {
      id: "t1",
      contact_id: "c1",
      chat_id: "ch1",
      cron_expression: "0 8 * * *",
      task_prompt: "Summarize today",
      status: "active",
    },
  ];
  const mockTaskRepository = {
    listByContactAndChat(contactId, chatId) {
      return tasks;
    },
  };
  setSchedulerDeps({ taskRepository: mockTaskRepository });
  const { listScheduledTasksHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = listScheduledTasksHandler({
    contactId: "c1",
    chatId: "ch1",
  });
  const result = await handler.execute({});
  assert.equal(Boolean(result.isError), false);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  const data = JSON.parse(text);
  assert.equal(data.status, "success");
  assert.equal(data.count, 1);
  assert.equal(Array.isArray(data.tasks), true);
  assert.equal(data.tasks[0].id, "t1");
  assert.equal(data.tasks[0].cron_expression, "0 8 * * *");
});

// --- unified scheduled_task skill ---
test("scheduled_task handler with action list delegates to list handler", async () => {
  const tasks = [{ id: "t1", contact_id: "c1", chat_id: "ch1", cron_expression: "0 8 * * *", task_prompt: "Hi", status: "active" }];
  setSchedulerDeps({ taskRepository: { listByContactAndChat: () => tasks } });
  const { scheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = scheduledTaskHandler({ contactId: "c1", chatId: "ch1" });
  const result = await handler.execute({ action: "list" });
  assert.equal(Boolean(result.isError), false);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  const data = JSON.parse(text);
  assert.equal(data.status, "success");
  assert.equal(data.count, 1);
});

test("scheduled_task handler with invalid action returns error", async () => {
  setSchedulerDeps({ taskRepository: {}, cronManager: {} });
  const { scheduledTaskHandler } = await import(
    "../electron/main/agent-tools/builtin/handlers/scheduledTaskHandler.mjs"
  );
  const handler = scheduledTaskHandler({ contactId: "c1", chatId: "ch1" });
  const result = await handler.execute({ action: "invalid" });
  assert.equal(result.isError, true);
  const text = (result.content && result.content[0] && result.content[0].text) || "";
  assert.equal(text.includes("INVALID_ACTION") || text.includes("list, create, delete"), true);
});
