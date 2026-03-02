import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { createRequire } from "node:module";
import { createBuiltinSkillRegistry } from "./agent-tools/builtin/registry.mjs";
import { createBuiltinSkillExecutor } from "./agent-tools/builtin/executor.mjs";
import { loadBuiltinReplyInstructions } from "./agent-tools/builtin/loadReplyInstructions.mjs";
import { buildSystemPrompt } from "./system-prompt.mjs";

const require = createRequire(import.meta.url);
const { BUILTIN_SKILL_IDS } = require("./builtinSkillIds.cjs");

const RUNNER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT_DIR = path.join(RUNNER_DIR, "..", "..");

/** Sessions keyed by chatId so multiple bots can reply concurrently. */
const sessionsByChatId = new Map();
const DEBUG_AGENT = false;

function log(scope, details) {
  if (!DEBUG_AGENT) return;
  const ts = new Date().toISOString();
  try {
    console.log(`[creezv2 agent-runner][${ts}][${scope}]`, details || "");
  } catch {
    // no-op
  }
}

function serializeMessage(msg) {
  if (!msg) return msg;
  const out = { role: msg.role };
  if (msg.content !== undefined) out.content = msg.content;
  if (msg.toolCallId !== undefined) out.toolCallId = msg.toolCallId;
  if (msg.toolName !== undefined) out.toolName = msg.toolName;
  if (msg.errorMessage !== undefined) out.errorMessage = msg.errorMessage;
  return out;
}

function serializeEvent(ev) {
  const out = { type: ev.type };
  if (ev.message) out.message = serializeMessage(ev.message);
  if (Array.isArray(ev.messages)) out.messages = ev.messages.map(serializeMessage);
  if (ev.toolCallId !== undefined) out.toolCallId = ev.toolCallId;
  if (ev.toolName !== undefined) out.toolName = ev.toolName;
  if (ev.args !== undefined) out.args = ev.args;
  if (ev.result !== undefined) out.result = ev.result;
  if (ev.partialResult !== undefined) out.partialResult = ev.partialResult;
  if (ev.isError !== undefined) out.isError = ev.isError;
  if (ev.assistantMessageEvent !== undefined) out.assistantMessageEvent = ev.assistantMessageEvent;
  return out;
}

function resolveModel(provider, modelId) {
  return getModel(provider, modelId) || null;
}

export async function createAndSubscribe(sender, config) {
  const {
    provider,
    modelId,
    apiKey,
    contactId,
    assistantConfigId,
    defaultContactId,
    workDir,
    agentDir,
    assistantConfig,
    memoryContent,
    memoryPath,
    chatId: configChatId,
  } = config;
  const chatId = configChatId != null && String(configChatId).trim() !== "" ? String(configChatId).trim() : null;
  const sessionKey = chatId ?? "";

  const existing = sessionsByChatId.get(sessionKey);
  if (existing?.unsubscribe) {
    existing.unsubscribe();
    existing.unsubscribe = null;
  }
  sessionsByChatId.delete(sessionKey);

  const cwd = workDir || process.cwd();
  const resolvedAgentDir = agentDir || path.join(process.cwd(), ".creez");
  log("create:start", {
    provider,
    modelId,
    cwd,
    agentDir: resolvedAgentDir,
    chatId: chatId || null,
    memoryLen: String(memoryContent || "").length,
  });

  const authPath = path.join(resolvedAgentDir, "auth.json");
  const authStorage = new AuthStorage(authPath);
  authStorage.setRuntimeApiKey(provider, apiKey);

  const modelRegistry = new ModelRegistry(authStorage);
  const model = resolveModel(provider, modelId);
  if (!model) {
    log("create:model-miss", { provider, modelId });
    sender.send("agent:eventError", `Unsupported model: ${provider}/${modelId}`);
    return;
  }
  log("create:model-hit", { modelId: model.id, modelName: model.name });

  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const sessionDir = path.join(resolvedAgentDir, "sessions", safePath);
  const sessionManager = SessionManager.create(cwd, sessionDir);
  const settingsManager = SettingsManager.create(cwd, resolvedAgentDir);

  const additionalSkillPath = path.join(cwd, ".creez", "skills");
  const builtinSkillPath = path.join(APP_ROOT_DIR, "skills", "builtin", "skills");
  const replyInstructions = loadBuiltinReplyInstructions(builtinSkillPath, BUILTIN_SKILL_IDS);
  const builtinRegistry = createBuiltinSkillRegistry();
  const builtinExecutor = createBuiltinSkillExecutor({
    registry: builtinRegistry,
    runtimeContext: {
      contactId: contactId || null,
      assistantConfigId: assistantConfigId || null,
      defaultContactId: defaultContactId || null,
      chatId: chatId || null,
    },
    onEvent: (builtinEv) => {
      sender.send("agent:event", { ...builtinEv, chatId: chatId ?? undefined });
    },
    replyInstructions,
  });
  const customTools = builtinExecutor.listEnabledToolDefinitions();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: resolvedAgentDir,
    settingsManager,
    noExtensions: true,
    additionalSkillPaths: [additionalSkillPath, builtinSkillPath],
  });
  log("create:resource-loader", { additionalSkillPath, builtinSkillPath, customToolCount: customTools.length });
  await resourceLoader.reload();
  log("create:resource-loader:reloaded", "");

  const { session } = await createAgentSession({
    cwd,
    agentDir: resolvedAgentDir,
    model,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    sessionManager,
    settingsManager,
    resourceLoader,
    customTools,
  });
  log("create:session-created", "");

  const systemPrompt = await buildSystemPrompt({
    agentDir: resolvedAgentDir,
    assistantConfig,
    workDir: cwd,
    contactId: contactId || null,
    memoryContent,
    memoryPath,
    chatId,
    builtinSkills: builtinExecutor.listEnabledSkillIds(),
  });
  if (systemPrompt) {
    session.agent.setSystemPrompt(systemPrompt);
    log("create:system-prompt", { length: systemPrompt.length });
  }

  let errorNotifiedThisTurn = false;
  const unsubscribe = session.subscribe((ev) => {
    try {
      const role = ev.message?.role || "";
      const toolName = ev.toolName || ev.message?.toolName || "";
      const textLen =
        typeof ev.message?.content === "string"
          ? ev.message.content.length
          : Array.isArray(ev.message?.content)
            ? String(ev.message.content.find((c) => c?.type === "text")?.text || "").length
            : 0;
      if (ev.type !== "message_update") {
        log("event", { type: ev.type, role, toolName, textLen, chatId: chatId || null });
      }
      const errorMsg = ev.isError ?? ev.message?.errorMessage ?? null;
      if (errorMsg) {
        log("event:error", errorMsg);
        const shouldNotify =
          typeof errorMsg === "string" &&
          sender &&
          typeof sender.isDestroyed === "function" &&
          !sender.isDestroyed() &&
          ((ev.type === "message_end" && ev.message?.role === "assistant") || ev.type === "agent_end");
        if (shouldNotify && !errorNotifiedThisTurn) {
          sender.send("agent:eventError", errorMsg);
          errorNotifiedThisTurn = true;
        }
      }
      if (ev.type === "agent_end") errorNotifiedThisTurn = false;
      sender.send("agent:event", { ...serializeEvent(ev), chatId: chatId ?? undefined });
    } catch (error) {
      const msg = error?.message || String(error);
      console.error("[creezv2 agent-runner] event forward error:", msg);
    }
  });

  sessionsByChatId.set(sessionKey, { session, unsubscribe, authStorage });
  console.log("[creez:flow] agent-runner agent_ready sent", { chatId: chatId ?? null, sessionKey });
  sender.send("agent:event", { type: "agent_ready", chatId: chatId ?? undefined });
  log("create:ready", { chatId: chatId || null });
}

export async function prompt(payload) {
  const chatId = payload?.chatId != null && String(payload.chatId).trim() !== "" ? String(payload.chatId).trim() : "";
  const entry = sessionsByChatId.get(chatId);
  if (!entry?.session) return;
  const { text, images } = payload || {};
  if (!text && (!images || images.length === 0)) return;
  log("prompt:start", {
    chatId: chatId || null,
    textLen: String(text || "").length,
    imageCount: Array.isArray(images) ? images.length : 0,
  });
  await entry.session.prompt(text || "", {
    images: Array.isArray(images) ? images : [],
    expandPromptTemplates: false,
  });
  log("prompt:end", { chatId: chatId || null });
}

export async function setModel(chatId, config) {
  const key = chatId != null && String(chatId).trim() !== "" ? String(chatId).trim() : "";
  const entry = sessionsByChatId.get(key);
  if (!entry?.session) return false;
  const provider = String(config?.provider || "").trim();
  const modelId = String(config?.modelId || "").trim();
  const apiKey = String(config?.apiKey || "").trim();
  if (!provider || !modelId || !apiKey) return false;

  const model = resolveModel(provider, modelId);
  if (!model) {
    log("setModel:model-miss", { provider, modelId });
    return false;
  }

  if (entry.authStorage) {
    entry.authStorage.setRuntimeApiKey(provider, apiKey);
  }
  await entry.session.setModel(model);
  log("setModel:ok", { provider, modelId, chatId: key || null });
  return true;
}

export function abort(chatId) {
  const key = chatId != null && String(chatId).trim() !== "" ? String(chatId).trim() : "";
  const entry = sessionsByChatId.get(key);
  if (entry?.session?.agent) {
    log("abort", { chatId: key || null });
    entry.session.agent.abort();
  }
}

export function hasSession(chatId) {
  if (chatId != null && String(chatId).trim() !== "") {
    return Boolean(sessionsByChatId.get(String(chatId).trim()));
  }
  return sessionsByChatId.size > 0;
}

export function dispose() {
  for (const [id, entry] of sessionsByChatId.entries()) {
    if (entry?.unsubscribe) {
      entry.unsubscribe();
      entry.unsubscribe = null;
    }
  }
  sessionsByChatId.clear();
}
