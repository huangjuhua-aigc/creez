import { createRequire } from "node:module";
import { asTextEnvelope, buildErrorEnvelope } from "../errorProtocol.mjs";

const require = createRequire(import.meta.url);

function isValidCronExpression(str) {
  if (typeof str !== "string" || str.trim().length === 0) return false;
  try {
    const cron = require("node-cron");
    return cron.validate(str.trim());
  } catch {
    return false;
  }
}

export function createScheduledTaskHandler(runtimeContext = {}) {
  return {
    id: "create_scheduled_task",
    async execute(args = {}) {
      const contactId = runtimeContext?.contactId ? String(runtimeContext.contactId).trim() : "";
      const chatId = runtimeContext?.chatId ? String(runtimeContext.chatId).trim() : "";
      console.log("[creez:task] create_scheduled_task execute called", { contactId: contactId || "(empty)", chatId: chatId || "(empty)" });

      if (!contactId || !chatId) {
        const envelope = buildErrorEnvelope({
          toolName: "create_scheduled_task",
          code: "MISSING_CONTEXT",
          message: "create_scheduled_task requires contactId and chatId from current conversation.",
          retryable: false,
          nextAction: "Use this tool only from a conversation where the user is asking to create a scheduled task.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "create_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }

      const cronExpression = args?.cron_expression != null ? String(args.cron_expression).trim() : "";
      const taskPrompt = args?.task_prompt != null ? String(args.task_prompt).trim() : "";

      if (!cronExpression) {
        const envelope = buildErrorEnvelope({
          toolName: "create_scheduled_task",
          code: "INVALID_ARGUMENT",
          message: "cron_expression is required (e.g. '0 8 * * *' for 8:00 daily).",
          retryable: false,
          nextAction: "Call with a valid cron expression (5 fields: minute hour day month weekday).",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "create_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }
      if (!taskPrompt) {
        const envelope = buildErrorEnvelope({
          toolName: "create_scheduled_task",
          code: "INVALID_ARGUMENT",
          message: "task_prompt is required (the instruction to run at each scheduled time).",
          retryable: false,
          nextAction: "Call with a non-empty task_prompt describing what the agent should do.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "create_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }
      if (!isValidCronExpression(cronExpression)) {
        const envelope = buildErrorEnvelope({
          toolName: "create_scheduled_task",
          code: "INVALID_CRON",
          message: `Invalid cron expression: ${cronExpression}`,
          retryable: false,
          nextAction: "Use a standard 5-field cron (e.g. '0 8 * * *' for 8:00 every day).",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "create_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }

      const { getSchedulerDeps } = require("../../../scheduler/deps.cjs");
      const deps = getSchedulerDeps();
      console.log("[creez:task] create_scheduled_task deps", { hasTaskRepo: Boolean(deps?.taskRepository), hasCronManager: Boolean(deps?.cronManager) });
      if (!deps?.taskRepository || !deps?.cronManager) {
        const envelope = buildErrorEnvelope({
          toolName: "create_scheduled_task",
          code: "SCHEDULER_UNAVAILABLE",
          message: "Scheduler not initialized.",
          retryable: false,
          nextAction: "Try again later or restart the app.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "create_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }

      try {
        const taskRecord = deps.taskRepository.insert({
          contact_id: contactId,
          chat_id: chatId,
          cron_expression: cronExpression,
          task_prompt: taskPrompt,
          status: "active",
        });
        console.log("[creez:task] create_scheduled_task insert done", { taskId: taskRecord.id });
        deps.cronManager.schedule(taskRecord);
        console.log("[creez:task] create_scheduled_task schedule called, returning success");
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "success", message: "定时任务已创建" }) }],
          details: { status: "success", message: "定时任务已创建" },
        };
      } catch (err) {
        const message = err?.message || String(err);
        const envelope = buildErrorEnvelope({
          toolName: "create_scheduled_task",
          code: "CREATE_FAILED",
          message,
          retryable: true,
          nextAction: "Retry or ask the user to check settings.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "create_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }
    },
  };
}

export function deleteScheduledTaskHandler(runtimeContext = {}) {
  return {
    id: "delete_scheduled_task",
    async execute(args = {}) {
      const contactId = runtimeContext?.contactId ? String(runtimeContext.contactId).trim() : "";
      const chatId = runtimeContext?.chatId ? String(runtimeContext.chatId).trim() : "";
      const taskId = args?.task_id != null ? String(args.task_id).trim() : "";

      if (!contactId || !chatId) {
        const envelope = buildErrorEnvelope({
          toolName: "delete_scheduled_task",
          code: "MISSING_CONTEXT",
          message: "delete_scheduled_task requires contactId and chatId from current conversation.",
          retryable: false,
          nextAction: "Use this tool only from a conversation where the user is asking to delete a scheduled task.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "delete_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }
      if (!taskId) {
        const envelope = buildErrorEnvelope({
          toolName: "delete_scheduled_task",
          code: "INVALID_ARGUMENT",
          message: "task_id is required. Use list_scheduled_tasks first to get task ids for this chat.",
          retryable: false,
          nextAction: "Call list_scheduled_tasks to see tasks, then call delete_scheduled_task with the id of the task to remove.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "delete_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }

      const { getSchedulerDeps } = require("../../../scheduler/deps.cjs");
      const deps = getSchedulerDeps();
      if (!deps?.taskRepository || !deps?.cronManager) {
        const envelope = buildErrorEnvelope({
          toolName: "delete_scheduled_task",
          code: "SCHEDULER_UNAVAILABLE",
          message: "Scheduler not initialized.",
          retryable: false,
          nextAction: "Try again later or restart the app.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "delete_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }

      const task = deps.taskRepository.getById(taskId);
      if (!task) {
        const envelope = buildErrorEnvelope({
          toolName: "delete_scheduled_task",
          code: "NOT_FOUND",
          message: `No scheduled task found with id: ${taskId}`,
          retryable: false,
          nextAction: "Call list_scheduled_tasks to see valid task ids for this chat.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "delete_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }
      if (task.contact_id !== contactId || task.chat_id !== chatId) {
        const envelope = buildErrorEnvelope({
          toolName: "delete_scheduled_task",
          code: "FORBIDDEN",
          message: "This task belongs to another chat or bot.",
          retryable: false,
          nextAction: "Only tasks in the current chat can be deleted.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "delete_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }

      try {
        deps.cronManager.unschedule(taskId);
        deps.taskRepository.updateStatus(taskId, "deleted");
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "success", message: "定时任务已删除" }) }],
          details: { status: "success", message: "定时任务已删除" },
        };
      } catch (err) {
        const message = err?.message || String(err);
        const envelope = buildErrorEnvelope({
          toolName: "delete_scheduled_task",
          code: "DELETE_FAILED",
          message,
          retryable: true,
          nextAction: "Retry or ask the user to try again.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "delete_scheduled_task") }],
          details: envelope,
          isError: true,
        };
      }
    },
  };
}

export function listScheduledTasksHandler(runtimeContext = {}) {
  return {
    id: "list_scheduled_tasks",
    async execute(args = {}) {
      const contactId = runtimeContext?.contactId ? String(runtimeContext.contactId).trim() : "";
      const chatId = runtimeContext?.chatId ? String(runtimeContext.chatId).trim() : "";

      if (!contactId || !chatId) {
        const envelope = buildErrorEnvelope({
          toolName: "list_scheduled_tasks",
          code: "MISSING_CONTEXT",
          message: "list_scheduled_tasks requires contactId and chatId from current conversation.",
          retryable: false,
          nextAction: "Use this tool only from a conversation where the user is asking to list scheduled tasks.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "list_scheduled_tasks") }],
          details: envelope,
          isError: true,
        };
      }

      const { getSchedulerDeps } = require("../../../scheduler/deps.cjs");
      const deps = getSchedulerDeps();
      if (!deps?.taskRepository) {
        const envelope = buildErrorEnvelope({
          toolName: "list_scheduled_tasks",
          code: "SCHEDULER_UNAVAILABLE",
          message: "Scheduler not initialized.",
          retryable: false,
          nextAction: "Try again later or restart the app.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "list_scheduled_tasks") }],
          details: envelope,
          isError: true,
        };
      }

      try {
        const tasks = deps.taskRepository.listByContactAndChat(contactId, chatId);
        const summary = tasks.map((t) => ({
          id: t.id,
          cron_expression: t.cron_expression,
          task_prompt: t.task_prompt?.slice(0, 80) + (t.task_prompt?.length > 80 ? "…" : ""),
          status: t.status,
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "success", count: tasks.length, tasks: summary }),
            },
          ],
          details: { status: "success", count: tasks.length, tasks: summary },
        };
      } catch (err) {
        const message = err?.message || String(err);
        const envelope = buildErrorEnvelope({
          toolName: "list_scheduled_tasks",
          code: "LIST_FAILED",
          message,
          retryable: true,
          nextAction: "Retry or ask the user to try again.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "list_scheduled_tasks") }],
          details: envelope,
          isError: true,
        };
      }
    },
  };
}

/**
 * Unified scheduled-task skill: model chooses action by user intent (list / create / delete) and supplies the right parameters.
 */
export function scheduledTaskHandler(runtimeContext = {}) {
  return {
    id: "scheduled_task",
    async execute(args = {}) {
      const action = args?.action != null ? String(args.action).trim().toLowerCase() : "";
      if (action === "list") {
        return listScheduledTasksHandler(runtimeContext).execute({});
      }
      if (action === "create") {
        return createScheduledTaskHandler(runtimeContext).execute({
          cron_expression: args.cron_expression,
          task_prompt: args.task_prompt,
        });
      }
      if (action === "delete") {
        return deleteScheduledTaskHandler(runtimeContext).execute({
          task_id: args.task_id,
        });
      }
      const envelope = buildErrorEnvelope({
        toolName: "scheduled_task",
        code: "INVALID_ACTION",
        message: `action must be one of: list, create, delete. Got: ${action || "(empty)"}`,
        retryable: false,
        nextAction: "Use action 'list' to list tasks, 'create' with cron_expression and task_prompt to add one, 'delete' with task_id to remove one.",
      });
      return {
        content: [{ type: "text", text: asTextEnvelope(envelope, "scheduled_task") }],
        details: envelope,
        isError: true,
      };
    },
  };
}
