/**
 * Headless executor: when a cron fires, runs the default bot with no conversation context.
 * Uses a dedicated session key (headless:taskId) so no prior chat history is loaded;
 * only the task_prompt is sent and the reply is persisted to the chat.
 */

const os = require("node:os");
const path = require("node:path");
const { resolveCreezHome } = require("../creezPaths.cjs");
const { CHANNELS } = require("../channels.cjs");
const { removeListener, releaseChatRoutingFromHeadless } = require("../agent-runner.mjs");
const { AgentConfigBuilder } = require("../AgentConfigBuilder.cjs");

/**
 * Execute a scheduled task: append user message, ensure session, prompt, persist assistant message, notify UI.
 * @param {object} task - { id, contact_id, chat_id, cron_expression, task_prompt }
 * @param {object} deps - { contactRepository, assistantConfigRepository, appStateStore, memoryStore, chatRepository, taskRepository, creezHome, sendToRenderer }
 */
async function executeTask(task, deps) {
  const {
    contactRepository,
    assistantConfigRepository,
    appStateStore,
    memoryStore,
    chatRepository,
    taskRepository,
    creezHome,
    sendToRenderer,
  } = deps;

  const taskId = task.id;
  const contactId = task.contact_id;
  const chatId = task.chat_id;
  const taskPrompt = String(task.task_prompt || "").trim();
  const headlessSessionKey = `headless:${taskId}`;

  console.log("[creez:task] headlessRunner.executeTask start", { taskId, chatId, promptLen: taskPrompt.length });

  if (!taskPrompt) {
    console.warn("[creez:scheduler] executeTask: empty task_prompt", { taskId, chatId });
    return;
  }

  const agentDir = creezHome || resolveCreezHome(os.homedir());

  try {
    taskRepository.insertLog({ task_id: taskId, status: "running" });
  } catch (e) {
    console.warn("[creez:scheduler] task_log insert failed", e?.message || e);
  }

  let assistantMessageId = null;

  try {
    const config = await new AgentConfigBuilder()
      .setContactId(contactId)
      .setScenario("headless")
      .setDeps({ contactRepository, assistantConfigRepository, appStateStore, memoryStore })
      .setChatId(chatId)
      .setSessionKey(headlessSessionKey)
      .setCreezHome(agentDir)
      .build();

    console.log("[creez:task] headlessRunner AgentConfigBuilder ok", { contactId, assistantConfigId: config.assistantConfigId });

    if (!config.provider || !config.modelId || !config.apiKey) {
      const errMsg =
        "Scheduled task skipped: no model/apiKey configured for this task's bot (contact_id).";
      console.warn("[creez:scheduler]", errMsg, { taskId, chatId, contactId });
      taskRepository.insertLog({ task_id: taskId, status: "failed", error_message: errMsg });
      if (sendToRenderer) {
        sendToRenderer({ type: "scheduled_task_skipped", chatId, taskId, message: errMsg });
      }
      return;
    }

    const userMsgId = `sched-user-${taskId}-${Date.now()}`;
    const assistantMsgId = `sched-ast-${taskId}-${Date.now()}`;
    const nowTs = Math.floor(Date.now() / 1000);

    chatRepository.appendMessage({
      id: userMsgId,
      chatId,
      sender: "user",
      content: taskPrompt,
      status: "done",
      botId: null,
      createdAt: nowTs,
      updatedAt: nowTs,
    });
    console.log("[creez:task] headlessRunner appended user message", { chatId, userMsgId });

    chatRepository.appendMessage({
      id: assistantMsgId,
      chatId,
      sender: "assistant",
      content: "",
      status: "streaming",
      botId: contactId,
      createdAt: nowTs,
      updatedAt: nowTs,
    });
    assistantMessageId = assistantMsgId;
    console.log("[creez:task] headlessRunner appended placeholder assistant message", { chatId, assistantMsgId });

    // Dedicated session key so this run has no prior conversation context (only task_prompt).
    let lastPersistedContent = "";
    const headlessSender = {
      send(channel, data) {
        if (channel !== "agent:event" && channel !== CHANNELS.AGENT_EVENT) return;
        const ev = data && typeof data === "object" ? data : {};
        const eventChatId = ev.chatId;
        if (eventChatId != null && String(eventChatId).trim() !== String(chatId).trim()) return;

        if (ev.type === "message_end" && ev.message?.role === "assistant") {
          const contentStr =
            typeof ev.message?.content === "string"
              ? ev.message.content
              : Array.isArray(ev.message?.content)
                ? String(ev.message.content.find((c) => c?.type === "text")?.text || "")
                : "";
          lastPersistedContent = contentStr;
          try {
            chatRepository.updateMessage({
              id: assistantMessageId,
              content: contentStr,
              status: "done",
              updatedAt: Math.floor(Date.now() / 1000),
            });
            console.log("[creez:task] headlessRunner message_end persisted", { chatId, contentLen: contentStr.length });
            if (sendToRenderer) {
              console.log("[creez:stream-debug][main] scheduled task → renderer (message_end)", {
                chatId,
                messageId: assistantMessageId,
                contentLen: contentStr.length,
              });
              sendToRenderer({
                type: "chat:message_appended",
                chatId,
                message: { id: assistantMessageId, sender: "assistant", content: contentStr, status: "done" },
              });
            }
          } catch (e) {
            console.warn("[creez:scheduler] updateMessage failed", e?.message || e);
          }
        } else if (ev.type === "agent_end") {
          const contentStr =
            typeof ev.message?.content === "string"
              ? ev.message.content
              : Array.isArray(ev.message?.content)
                ? String(ev.message.content.find((c) => c?.type === "text")?.text || "")
                : "";
          const errMsg = ev.isError ?? ev.message?.errorMessage ?? null;
          const finalContent = contentStr || lastPersistedContent || (errMsg ? `[Error] ${errMsg}` : "");
          const finalStatus = errMsg ? "error" : "done";
          try {
            chatRepository.updateMessage({
              id: assistantMessageId,
              content: finalContent,
              status: finalStatus,
              errorMessage: errMsg || undefined,
              updatedAt: Math.floor(Date.now() / 1000),
            });
            console.log("[creez:task] headlessRunner agent_end persisted", { chatId, hasError: Boolean(errMsg), contentLen: finalContent.length });
            if (sendToRenderer) {
              console.log("[creez:stream-debug][main] scheduled task → renderer (agent_end)", {
                chatId,
                messageId: assistantMessageId,
                finalStatus,
                contentLen: finalContent.length,
              });
              sendToRenderer({
                type: "chat:message_appended",
                chatId,
                message: {
                  id: assistantMessageId,
                  sender: "assistant",
                  content: finalContent,
                  status: finalStatus,
                },
              });
            }
            taskRepository.insertLog({ task_id: taskId, status: errMsg ? "failed" : "success", error_message: errMsg || undefined });
            console.log("[creez:task] headlessRunner executeTask done", { taskId, chatId, success: !errMsg });
          } catch (e) {
            console.warn("[creez:scheduler] updateMessage on agent_end failed", e?.message || e);
          } finally {
            removeListener(headlessSessionKey, "ui:" + chatId);
            releaseChatRoutingFromHeadless(chatId, headlessSessionKey, contactId);
          }
        }
      },
      isDestroyed() {
        return false;
      },
    };

    const engine = config.engine;
    await engine.init({
      ...config,
      sendEvent: (data) => headlessSender.send("agent:event", data),
      sendError: (msg) => headlessSender.send("agent:event", { type: "agent_end", isError: msg }),
    });
    console.log("[creez:task] headlessRunner engine.init done (headless session, no chat history)");

    try {
      await engine.prompt({
        chatId,
        text: taskPrompt,
        images: [],
        streamingBehavior: "followUp",
      });
      console.log("[creez:task] headlessRunner engine.prompt returned (may be queued)");
    } catch (promptErr) {
      removeListener(headlessSessionKey, "ui:" + chatId);
      releaseChatRoutingFromHeadless(chatId, headlessSessionKey, contactId);
      throw promptErr;
    }
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[creez:scheduler] executeTask error", { taskId, chatId, message });
    try {
      removeListener(headlessSessionKey, "ui:" + chatId);
      releaseChatRoutingFromHeadless(chatId, headlessSessionKey, contactId);
    } catch (e) {
      console.warn("[creez:scheduler] headless routing cleanup after error", e?.message || e);
    }
    taskRepository.insertLog({ task_id: taskId, status: "failed", error_message: message });
    if (assistantMessageId && chatRepository) {
      try {
        chatRepository.updateMessage({
          id: assistantMessageId,
          content: `[定时任务执行失败] ${message}`,
          status: "error",
          errorMessage: message,
          updatedAt: Math.floor(Date.now() / 1000),
        });
        if (sendToRenderer) {
          sendToRenderer({
            type: "chat:message_appended",
            chatId,
            message: {
              id: assistantMessageId,
              sender: "assistant",
              content: `[定时任务执行失败] ${message}`,
              status: "error",
            },
          });
        }
      } catch (e) {
        console.warn("[creez:scheduler] updateMessage on error failed", e?.message || e);
      }
    }
    if (sendToRenderer) {
      sendToRenderer({
        type: "scheduled_task_failed",
        chatId,
        taskId,
        message,
      });
    }
  }
}

module.exports = {
  executeTask,
};
