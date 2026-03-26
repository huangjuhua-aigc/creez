/**
 * Pi-based conversation engine. Adapts agent-runner (createAndSubscribe, prompt, setModel, abort)
 * to the conversation engine contract. Sessions are keyed by chatId so multiple bots can reply concurrently.
 */

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { AGENT_EVENT_CHANNEL, AGENT_EVENT_ERROR_CHANNEL } = require("./contract.cjs");

let agentRunnerModule = null;

async function getRunner() {
  if (!agentRunnerModule) {
    const runnerPath = path.join(__dirname, "..", "agent-runner.mjs");
    agentRunnerModule = await import(pathToFileURL(runnerPath).href);
  }
  return agentRunnerModule;
}

/**
 * Builds a sender-like object that the agent-runner expects (sender.send(channel, data)),
 * forwarding to the context's sendEvent / sendError.
 */
function createSenderAdapter(context) {
  const sendEvent = context.sendEvent && typeof context.sendEvent === "function" ? context.sendEvent : () => {};
  const sendError = context.sendError && typeof context.sendError === "function" ? context.sendError : () => {};
  return {
    send(channel, data) {
      if (channel === AGENT_EVENT_CHANNEL) sendEvent(data);
      else if (channel === AGENT_EVENT_ERROR_CHANNEL) sendError(typeof data === "string" ? data : String(data));
    },
    isDestroyed() {
      return false;
    },
  };
}

class PiConversationEngine {
  async init(context) {
    if (!context || typeof context.sendEvent !== "function") {
      throw new Error("PiConversationEngine.init: context.sendEvent is required.");
    }
    const runner = await getRunner();
    const sender = createSenderAdapter(context);
    const workDir = context.workDir != null ? context.workDir : process.cwd();
    const agentDir = context.agentDir || path.join(process.env.HOME || process.env.USERPROFILE || "", ".creez");
    const config = {
      provider: context.provider,
      modelId: context.modelId,
      apiKey: context.apiKey,
      contactId: context.contactId || null,
      assistantConfigId: context.assistantConfigId || null,
      defaultContactId: context.defaultContactId || null,
      workDir,
      agentDir,
      assistantConfig: context.assistantConfig || {},
      memoryContent: context.memoryContent || "",
      memoryPath: context.memoryPath || "",
      chatId: context.chatId || null,
      sessionKey: context.sessionKey || null,
      channelSend: context.channelSend,
    };
    await runner.createAndSubscribe(sender, config);
  }

  async prompt(payload) {
    const runner = await getRunner();
    const chatId = payload?.chatId ?? "";
    if (!runner.hasSession(chatId)) return;
    const text = payload?.text ?? "";
    const images = Array.isArray(payload?.images) ? payload.images : [];
    if (!text && images.length === 0) return;
    await runner.prompt({
      chatId,
      text,
      images,
      streamingBehavior: payload?.streamingBehavior,
    });
  }

  async setModel(chatId, config) {
    const runner = await getRunner();
    if (!runner.hasSession(chatId)) return false;
    return runner.setModel(chatId, config);
  }

  abort(chatId) {
    return getRunner().then((r) => {
      r.abort(chatId);
    });
  }

  async hasSession(chatId) {
    const runner = await getRunner();
    return Boolean(runner.hasSession && runner.hasSession(chatId));
  }
}

module.exports = {
  PiConversationEngine,
  createSenderAdapter,
  getRunner,
};
