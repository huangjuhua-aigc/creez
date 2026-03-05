/**
 * Headless executor: when a cron fires, runs the default bot with no conversation context.
 * Uses a dedicated session key (headless:taskId) so no prior chat history is loaded;
 * only the task_prompt is sent and the reply is persisted to the chat.
 */

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { getEngineForContact } = require("../conversation/engineRegistry.cjs");
const { CHANNELS } = require("../channels.cjs");
const { addListener, removeListener } = require("../agent-runner.mjs");

const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".creez", "workplace");

function resolveWorkDir(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const home = os.homedir();
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) {
    return path.join(home, s.slice(1).replace(/\//g, path.sep));
  }
  return path.resolve(s);
}

function pickActiveModel(models) {
  const list = Array.isArray(models) ? models : [];
  return list.find((item) => item && item.active) || list[0] || null;
}

function normalizeProvider(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const alias = { OpenRouter: "openrouter", OpenAI: "openai", Anthropic: "anthropic", Google: "google" };
  return alias[value] || value.toLowerCase();
}

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

  console.log("[creez:task] headlessRunner.executeTask start", { taskId, chatId, promptLen: taskPrompt.length });

  if (!taskPrompt) {
    console.warn("[creez:scheduler] executeTask: empty task_prompt", { taskId, chatId });
    return;
  }

  const agentDir = creezHome ? path.join(creezHome, ".creez") : path.join(os.homedir(), ".creez");

  try {
    taskRepository.insertLog({ task_id: taskId, status: "running" });
  } catch (e) {
    console.warn("[creez:scheduler] task_log insert failed", e?.message || e);
  }

  let assistantMessageId = null;

  try {
    const { engine, rawConfig, assistantConfigId, defaultContactId } = getEngineForContact(contactId, {
      contactRepository,
      assistantConfigRepository,
    });
    console.log("[creez:task] headlessRunner getEngineForContact ok", { contactId, assistantConfigId });

    const appState = appStateStore ? await appStateStore.getState() : {};
    const activeModel = pickActiveModel(rawConfig?.models);
    const provider = normalizeProvider(activeModel?.provider);
    const modelId = activeModel?.model || "";
    let apiKey = (activeModel?.apiKey && String(activeModel.apiKey).trim()) || "";
    if (!apiKey && assistantConfigRepository?.getModelApiKeyFromConfig) {
      apiKey = assistantConfigRepository.getModelApiKeyFromConfig(assistantConfigId, activeModel?.id) || "";
    }
    if (!apiKey && assistantConfigRepository?.getModelApiKey) {
      apiKey = assistantConfigRepository.getModelApiKey(activeModel?.id, defaultContactId) || "";
    }

    const rawRoot = appState?.workspaceRoot || null;
    const workDir = resolveWorkDir(rawRoot) || DEFAULT_WORKSPACE_ROOT;
    try {
      await fs.mkdir(workDir, { recursive: true });
    } catch (e) {
      console.warn("[creez:scheduler] workDir mkdir failed", e?.message || e);
    }

    let memoryContent = "";
    let memoryPath = "";
    if (memoryStore) {
      try {
        const memory = await memoryStore.read();
        memoryContent = memory?.content || "";
        memoryPath = memory?.path || "";
      } catch {
        // ignore
      }
    }

    // No chat history: headless runs with only the task prompt, no prior conversation context.

    if (!provider || !modelId || !apiKey) {
      const errMsg = "Scheduled task skipped: no model/apiKey configured for default bot.";
      console.warn("[creez:scheduler]", errMsg, { taskId, chatId });
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
    const sessionKey = "headless:" + taskId;
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
          try {
            chatRepository.updateMessage({
              id: assistantMessageId,
              content: contentStr,
              status: "done",
              updatedAt: Math.floor(Date.now() / 1000),
            });
            console.log("[creez:task] headlessRunner message_end persisted", { chatId, contentLen: contentStr.length });
            if (sendToRenderer) {
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
          try {
            chatRepository.updateMessage({
              id: assistantMessageId,
              content: contentStr || (errMsg ? `[Error] ${errMsg}` : ""),
              status: errMsg ? "error" : "done",
              errorMessage: errMsg || undefined,
              updatedAt: Math.floor(Date.now() / 1000),
            });
            console.log("[creez:task] headlessRunner agent_end persisted", { chatId, hasError: Boolean(errMsg) });
            if (sendToRenderer) {
              sendToRenderer({
                type: "chat:message_appended",
                chatId,
                message: {
                  id: assistantMessageId,
                  sender: "assistant",
                  content: contentStr || (errMsg ? `[Error] ${errMsg}` : ""),
                  status: errMsg ? "error" : "done",
                },
              });
            }
            taskRepository.insertLog({ task_id: taskId, status: errMsg ? "failed" : "success", error_message: errMsg || undefined });
            console.log("[creez:task] headlessRunner executeTask done", { taskId, chatId, success: !errMsg });
          } catch (e) {
            console.warn("[creez:scheduler] updateMessage on agent_end failed", e?.message || e);
          } finally {
            removeListener(sessionKey, "ui:" + chatId);
          }
        }
      },
      isDestroyed() {
        return false;
      },
    };

    const context = {
      chatId,
      contactId: sessionKey,
      assistantConfigId,
      defaultContactId: defaultContactId ?? null,
      assistantConfig: rawConfig,
      workDir,
      agentDir,
      memoryContent,
      memoryPath,
      provider,
      modelId,
      apiKey,
      sendEvent: (data) => headlessSender.send("agent:event", data),
      sendError: (msg) => headlessSender.send("agent:event", { type: "agent_end", isError: msg }),
    };

    await engine.init(context);
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
      removeListener(sessionKey, "ui:" + chatId);
      throw promptErr;
    }
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[creez:scheduler] executeTask error", { taskId, chatId, message });
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
