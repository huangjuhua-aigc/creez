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

/** Sessions keyed by contactId (bot id). One session per bot, shared across channels. */
const sessionsByBot = new Map();

/** Reverse map: any key (chatId, feishu:chatId, etc.) → contactId, so callers can look up by chatId. */
const keyToContactId = new Map();

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

/**
 * Resolve a lookup key (chatId, contactId, feishu:xxx, etc.) to the bot's contactId session key.
 */
function resolveSessionKey(key) {
  if (key == null || String(key).trim() === "") return "";
  const k = String(key).trim();
  if (sessionsByBot.has(k)) return k;
  return keyToContactId.get(k) || k;
}

/**
 * Add event listener to a bot session.
 * @param {string} contactId - bot id (session key)
 * @param {string} listenerId - unique id for this listener (e.g. "ui", "feishu:abc")
 * @param {{ send: (channel: string, data: any) => void, isDestroyed?: () => boolean }} senderLike
 */
export function addListener(contactId, listenerId, senderLike) {
  const entry = sessionsByBot.get(contactId);
  if (entry?.listeners) {
    entry.listeners.set(listenerId, senderLike);
  }
}

/**
 * Remove event listener from a bot session.
 */
export function removeListener(contactId, listenerId) {
  const entry = sessionsByBot.get(contactId);
  if (entry?.listeners) {
    entry.listeners.delete(listenerId);
  }
}

/**
 * Create a session for a bot if it doesn't exist yet.
 * If it already exists, update model/apiKey and register the sender as a listener.
 */
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
  const botKey = contactId || chatId || "";
  const listenerId = chatId ? `ui:${chatId}` : "ui";

  if (chatId && chatId !== botKey) {
    keyToContactId.set(chatId, botKey);
  }

  const cwd = workDir || process.cwd();
  const existing = sessionsByBot.get(botKey);
  // Reuse only if workDir matches, so pi's bash/read/edit/write always run in current user workspace
  if (existing?.session && existing.workDir === cwd) {
    existing.listeners.set(listenerId, sender);
    if (existing.authStorage && apiKey) {
      existing.authStorage.setRuntimeApiKey(provider, apiKey);
    }
    const model = resolveModel(provider, modelId);
    if (model && existing.session.setModel) {
      try { await existing.session.setModel(model); } catch { /* ignore */ }
    }
    console.log("[creez:chat] session reused", { botKey, listenerId, chatId });
    sender.send("agent:event", { type: "agent_ready", chatId: chatId ?? undefined });
    return;
  }

  if (existing?.unsubscribe) {
    existing.unsubscribe();
  }
  sessionsByBot.delete(botKey);

  // cwd already set above
  const resolvedAgentDir = agentDir || path.join(process.cwd(), ".creez");
  log("create:start", { provider, modelId, cwd, agentDir: resolvedAgentDir, botKey, chatId: chatId || null });

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

  const listeners = new Map();
  listeners.set(listenerId, sender);

  const broadcast = (channel, data) => {
    for (const [id, s] of listeners) {
      try {
        if (s && typeof s.isDestroyed === "function" && s.isDestroyed()) {
          listeners.delete(id);
          continue;
        }
        s.send(channel, data);
      } catch { /* ignore dead listeners */ }
    }
  };

  const safeCwd = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const safeBotKey = botKey.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
  const sessionDir = path.join(resolvedAgentDir, "sessions", safeCwd, safeBotKey);
  const sessionManager = SessionManager.continueRecent(cwd, sessionDir);
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
      workDir: cwd,
    },
    onEvent: (builtinEv) => {
      broadcast("agent:event", { ...builtinEv, chatId: chatId ?? undefined });
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
  await resourceLoader.reload();

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
  }

  const sessionEntry = { session, unsubscribe: null, authStorage, listeners, workDir: cwd };
  let errorNotifiedThisTurn = false;
  const unsubscribe = session.subscribe((ev) => {
    try {
      const role = ev.message?.role || "";
      const toolName = ev.toolName || ev.message?.toolName || "";
      const contentStr =
        typeof ev.message?.content === "string"
          ? ev.message.content
          : Array.isArray(ev.message?.content)
            ? String(ev.message.content.find((c) => c?.type === "text")?.text || "")
            : "";
      const textLen = contentStr.length;
      if (ev.type !== "message_update") {
        log("event", { type: ev.type, role, toolName, textLen, botKey });
      }
      if (ev.type === "message_start" && ev.message?.role === "assistant") {
        const userPreview = sessionEntry.lastPromptText != null ? sessionEntry.lastPromptText : undefined;
        console.log("[creez:chat] reply_start", {
          botKey,
          chatId: chatId ?? undefined,
          userPromptPreview: userPreview,
        });
      }
      if (ev.type === "message_end" && ev.message?.role === "assistant") {
        const replyPreview = contentStr.slice(0, 350).replace(/\s+/g, " ").trim();
        console.log("[creez:chat] reply_done message_end", {
          botKey,
          chatId: chatId ?? undefined,
          contentLen: textLen,
          replyPreview: replyPreview ? `${replyPreview}${contentStr.length > 350 ? "…" : ""}` : null,
        });
      }
      if (ev.type === "agent_end") {
        console.log("[creez:chat] agent_end", { botKey, chatId: chatId ?? undefined });
      }
      const errorMsg = ev.isError ?? ev.message?.errorMessage ?? null;
      if (errorMsg) {
        log("event:error", errorMsg);
        const shouldNotify =
          typeof errorMsg === "string" &&
          ((ev.type === "message_end" && ev.message?.role === "assistant") || ev.type === "agent_end");
        if (shouldNotify && !errorNotifiedThisTurn) {
          broadcast("agent:eventError", errorMsg);
          errorNotifiedThisTurn = true;
        }
      }
      if (ev.type === "agent_end") errorNotifiedThisTurn = false;
      broadcast("agent:event", { ...serializeEvent(ev), chatId: chatId ?? undefined });
    } catch (error) {
      console.error("[creezv2 agent-runner] event forward error:", error?.message || String(error));
    }
  });

  sessionEntry.unsubscribe = unsubscribe;
  sessionsByBot.set(botKey, sessionEntry);

  const builtinIds = builtinExecutor.listEnabledSkillIds();
  const configSkills = assistantConfig?.skills && typeof assistantConfig.skills === "object"
    ? Object.entries(assistantConfig.skills).filter(([, on]) => Boolean(on)).map(([id]) => id)
    : [];
  console.log("[creez:agent] skills", {
    botKey,
    builtin: builtinIds.length ? builtinIds : "(none)",
    config: configSkills.length ? configSkills : "(none)",
  });

  console.log("[creez:chat] session created", { botKey, listenerId, chatId });
  sender.send("agent:event", { type: "agent_ready", chatId: chatId ?? undefined });
}

export async function prompt(payload) {
  const rawKey = payload?.chatId != null && String(payload.chatId).trim() !== "" ? String(payload.chatId).trim() : "";
  const botKey = resolveSessionKey(rawKey);
  const entry = sessionsByBot.get(botKey);
  if (!entry?.session) return;
  const { text, images } = payload || {};
  if (!text && (!images || images.length === 0)) return;
  const promptText = String(text || "");
  entry.lastPromptText = promptText.slice(0, 300).replace(/\s+/g, " ").trim();
  if (promptText.length > 300) entry.lastPromptText += "…";

  const imageCount = Array.isArray(images) ? images.length : 0;
  console.log("[creez:agent] prompt to pi", { botKey, chatId: rawKey || undefined, textLen: promptText.length, imageCount });
  console.log("[creez:agent] prompt body:\n", promptText || "(empty)");

  log("prompt:start", { botKey, textLen: promptText.length });
  await entry.session.prompt(text || "", {
    images: Array.isArray(images) ? images : [],
    expandPromptTemplates: false,
  });
  log("prompt:end", { botKey });
}

export async function setModel(chatId, config) {
  const botKey = resolveSessionKey(chatId);
  const entry = sessionsByBot.get(botKey);
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
  log("setModel:ok", { provider, modelId, botKey });
  return true;
}

export function abort(chatId) {
  const botKey = resolveSessionKey(chatId);
  const entry = sessionsByBot.get(botKey);
  if (entry?.session?.agent) {
    log("abort", { botKey });
    entry.session.agent.abort();
  }
}

export function hasSession(chatId) {
  if (chatId != null && String(chatId).trim() !== "") {
    const botKey = resolveSessionKey(chatId);
    return Boolean(sessionsByBot.get(botKey));
  }
  return sessionsByBot.size > 0;
}

export function dispose() {
  for (const [, entry] of sessionsByBot.entries()) {
    if (entry?.unsubscribe) {
      entry.unsubscribe();
      entry.unsubscribe = null;
    }
  }
  sessionsByBot.clear();
  keyToContactId.clear();
}
