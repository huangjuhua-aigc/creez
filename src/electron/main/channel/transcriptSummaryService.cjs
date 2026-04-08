/**
 * Shared Pi-based transcript → Markdown summary + notify default assistant main chat.
 * Used by SessionTracker (idle channel sessions) and A2ASessionOrchestrator (close + 30min idle on bot-owner side).
 */

const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { AgentConfigBuilder } = require("../AgentConfigBuilder.cjs");

/**
 * Run default-assistant Pi session once: full transcript + Chinese structured-summary instructions.
 *
 * @param {{
 *   contactRepository: object,
 *   assistantConfigRepository: object,
 *   appStateStore?: object,
 * }} deps
 * @param {{
 *   transcript: string,
 *   botName: string,
 *   channelType: string,
 *   scenarioDescription: string,
 *   summarySessionKeyPrefix: string,
 * }} opts
 * @returns {Promise<string>} model Markdown output
 */
async function summarizeTranscriptWithDefaultPiAssistant(deps, opts) {
  const { contactRepository, assistantConfigRepository, appStateStore } = deps;
  const {
    transcript,
    botName,
    channelType,
    scenarioDescription,
    summarySessionKeyPrefix,
  } = opts;

  const { getRunner } = require("../conversation/PiConversationEngine.cjs");

  const defaultContactId = contactRepository.getDefaultAssistantConfigId();
  const summarySessionKey = `${summarySessionKeyPrefix}:${Date.now()}`;

  const config = await new AgentConfigBuilder()
    .setContactId(defaultContactId)
    .setScenario("summary")
    .setDeps({ contactRepository, assistantConfigRepository, appStateStore })
    .setChatId(summarySessionKey)
    .setSessionKey(summarySessionKey)
    .setSystemPromptOverride("你是一个专业的对话摘要助手。请简洁、准确地总结对话内容，输出 Markdown 格式。")
    .build();

  if (!config.provider || !config.modelId || !config.apiKey) {
    throw new Error("no active model/apiKey for summary generation");
  }

  const summaryPromptText = [
    scenarioDescription,
    "",
    "请根据以下**完整**对话记录生成结构化摘要（中文）。",
    "",
    "要求输出：",
    "1. **会话概览**（1-2句话概括）",
    "2. **关键诉求/问题**（列表，最多5条）",
    "3. **结论与下一步**（列表，最多3条）",
    "4. **风险/注意事项**（如有）",
    "",
    "---",
    "对话记录：",
    transcript,
  ].join("\n");

  let summaryResult = "";
  const collector = {
    send(channel, data) {
      if (data.type === "message_end" && data.message?.content) {
        const c = data.message.content;
        summaryResult =
          typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c.filter((x) => x.type === "text").map((x) => x.text).join("")
              : "";
      }
    },
    isDestroyed() {
      return false;
    },
  };

  const runner = await getRunner();
  await runner.createAndSubscribe(collector, config);

  await runner.prompt({ chatId: summarySessionKey, text: summaryPromptText, images: [] });

  try {
    runner.abort(summarySessionKey);
  } catch {}

  if (!summaryResult) {
    throw new Error("empty summary from LLM");
  }
  return summaryResult;
}

/**
 * Append a message to the default assistant's main chat and ping renderer.
 *
 * @param {{ contactRepository: object, chatRepository: object }} deps
 * @param {{ content: string, notifyChannel?: string }} opts
 */
function appendToDefaultAssistantMainChat(deps, opts) {
  const { contactRepository, chatRepository } = deps;
  const { content, notifyChannel = "channel:newMessage" } = opts;

  const defaultContactId = contactRepository.getDefaultAssistantConfigId();
  const { chatId: ownerChatId } = chatRepository.getOrCreateMainChatForContact({
    contactId: defaultContactId,
  });

  const nowTs = Math.floor(Date.now() / 1000);
  chatRepository.appendMessage({
    id: randomUUID(),
    chatId: ownerChatId,
    sender: "assistant",
    botId: defaultContactId,
    content,
    status: "done",
    createdAt: nowTs,
    updatedAt: nowTs,
  });

  try {
    const { BrowserWindow } = require("electron");
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents && !win.isDestroyed()) {
        win.webContents.send(notifyChannel, { chatId: ownerChatId });
      }
    }
  } catch {}
}

module.exports = {
  summarizeTranscriptWithDefaultPiAssistant,
  appendToDefaultAssistantMainChat,
};
