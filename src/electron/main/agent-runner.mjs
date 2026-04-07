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
const { isCreezVerboseDebug } = require("./creezDebug.cjs");

const RUNNER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT_DIR = path.join(RUNNER_DIR, "..", "..");



/** Sessions keyed by contactId (bot id). One session per bot, shared across channels. */
const sessionsByBot = new Map();

/** Reverse map: any key (chatId, feishu:chatId, etc.) → contactId, so callers can look up by chatId. */
const keyToContactId = new Map();

/** Single-line JSON log of full system prompt on each agent_start (set CREEZ_DEBUG_FULL_SYSTEM_PROMPT=1). */
const DEBUG_FULL_SYSTEM_PROMPT = process.env.CREEZ_DEBUG_FULL_SYSTEM_PROMPT === "1";

function log(scope, details) {
  if (!isCreezVerboseDebug()) return;
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

/** Fingerprint of assistant config that affects session (skills, systemPrompt). Used to invalidate session when user changes config. Default bot excludes skills so toggling "copy to ~/.creez/skills" does not rebuild session. */
function configFingerprint(assistantConfig, assistantConfigId, defaultContactId) {
  if (!assistantConfig) return "";
  const systemPrompt = (assistantConfig.systemPrompt && String(assistantConfig.systemPrompt).trim()) || "";
  const isDefaultBot = assistantConfigId != null && defaultContactId != null
    && String(assistantConfigId) === String(defaultContactId);
  if (isDefaultBot) return systemPrompt;
  const skills = assistantConfig.skills && typeof assistantConfig.skills === "object"
    ? Object.keys(assistantConfig.skills).sort().map((k) => `${k}:${!!assistantConfig.skills[k]}`).join("|")
    : "";
  return `${skills}\n${systemPrompt}`;
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
    sessionKey: configSessionKey,
  } = config;
  const chatId = configChatId != null && String(configChatId).trim() !== "" ? String(configChatId).trim() : null;
  /** Optional: channel external sessions — isolate runner key while keeping contactId for tools (see PiConversationEngine). */
  const explicitSessionKey =
    configSessionKey != null && String(configSessionKey).trim() !== "" ? String(configSessionKey).trim() : null;
  const botKey = explicitSessionKey || contactId || chatId || "";
  /** Gateway A2A turns use sessionKey/chatId `a2a:<id>` — no Pi coding tools (read/bash/edit/write). */
  const isA2aSession =
    String(botKey).startsWith("a2a:")
    || (chatId && String(chatId).startsWith("a2a:"))
    || (explicitSessionKey && String(explicitSessionKey).startsWith("a2a:"));
  const listenerId = chatId ? `ui:${chatId}` : "ui";

  if (chatId && chatId !== botKey) {
    keyToContactId.set(chatId, botKey);
  }

  let cwd = workDir;
  if (!cwd && contactId) {
    try {
      const { resolveCreezHome, ensureBotWorkplace } = require("./creezPaths.cjs");
      cwd = ensureBotWorkplace(resolveCreezHome(), contactId);
    } catch { /* fall through */ }
  }
  if (!cwd) cwd = process.cwd();
  const existing = sessionsByBot.get(botKey);
  const fingerprint = configFingerprint(assistantConfig, assistantConfigId, defaultContactId);
  // Reuse only if workDir and assistant config (skills, systemPrompt) match
  if (
    existing?.session &&
    existing.workDir === cwd &&
    existing.configFingerprint === fingerprint
  ) {
    existing.listeners.set(listenerId, sender);
    if (existing.authStorage && apiKey) {
      existing.authStorage.setRuntimeApiKey(provider, apiKey);
    }
    const model = resolveModel(provider, modelId);
    if (model && existing.session.setModel) {
      try {
        await existing.session.setModel(model);
      } catch (e) {
        log("session_reused:setModel_error", e?.message || String(e));
      }
      // If reasoning model ended up with thinkingLevel "off", fix it — the pi-ai
      // library would send `reasoning: { effort: "none" }` which is rejected by
      // endpoints where reasoning is mandatory.
      if (model.reasoning && existing.session.thinkingLevel === "off" && existing.session.setThinkingLevel) {
        try { existing.session.setThinkingLevel("medium"); } catch { /* ignore */ }
      }
    }
    log("session_reused", { botKey, listenerId, chatId });
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
  const t0 = Date.now();

  const authPath = path.join(resolvedAgentDir, "auth.json");
  const authStorage = new AuthStorage(authPath);
  authStorage.setRuntimeApiKey(provider, apiKey);
  log("auth_set", { provider, keyLength: typeof apiKey === "string" ? apiKey.length : 0 });

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

  const isDefaultBot = assistantConfigId != null && defaultContactId != null
    && String(assistantConfigId) === String(defaultContactId);
  const skillsConfig = assistantConfig?.skills && typeof assistantConfig.skills === "object" ? assistantConfig.skills : {};
  /** Non-default bots: builtins are gated by skills_json (registry listEnabled uses allowedBuiltinIds). */
  const A2A_DEFAULT_READ_BUILTINS = ["knowledge_search", "web_fetch"];
  let enabledSkillIds;
  if (isDefaultBot) {
    enabledSkillIds = undefined;
  } else {
    enabledSkillIds = new Set(Object.keys(skillsConfig).filter((id) => skillsConfig[id] !== false));
    // 小程序 / A2A 访客会话：不加载磁盘 skill 目录（skillsOverride 清空），仅靠 customTools。
    // 若本地 skills_json 为空或漏配，会导致 knowledge_search 从未注册；访客端无法检索已同步到网关的知识库。
    if (isA2aSession) {
      for (const id of A2A_DEFAULT_READ_BUILTINS) {
        if (skillsConfig[id] !== false) enabledSkillIds.add(id);
      }
    }
  }

  const additionalSkillPath = path.join(cwd, ".creez", "skills");
  const builtinSkillPath = path.join(APP_ROOT_DIR, "skills", "builtin", "skills");
  const replyInstructions = loadBuiltinReplyInstructions(builtinSkillPath, BUILTIN_SKILL_IDS);
  const builtinRegistry = createBuiltinSkillRegistry();
  /** Set after sessionEntry is created; used so tool/builtin events use the chatId of the active prompt turn (not only init-time chatId). */
  let sessionEntryForEvents = null;
  const builtinExecutor = createBuiltinSkillExecutor({
    registry: builtinRegistry,
    runtimeContext: {
      contactId: contactId || null,
      assistantConfigId: assistantConfigId || null,
      defaultContactId: defaultContactId || null,
      chatId: chatId || null,
      workDir: cwd,
      channelSend: config.channelSend,
      ...(isDefaultBot ? {} : { allowedBuiltinIds: enabledSkillIds }),
    },
    onEvent: (builtinEv) => {
      const resolved =
        sessionEntryForEvents?.lastPromptChatId != null && String(sessionEntryForEvents.lastPromptChatId).trim() !== ""
          ? String(sessionEntryForEvents.lastPromptChatId).trim()
          : (chatId ?? undefined);
      broadcast("agent:event", { ...builtinEv, chatId: resolved });
    },
    replyInstructions,
  });
  const A2A_ALLOWED_TOOLS = new Set(["knowledge_search", "web_fetch"]);
  const allCustomTools = builtinExecutor.listEnabledToolDefinitions();
  const customTools = isA2aSession
    ? allCustomTools.filter((t) => A2A_ALLOWED_TOOLS.has(t.name))
    : allCustomTools;
  if (isA2aSession && allCustomTools.length !== customTools.length) {
    console.log(`[agent-runner] A2A session: filtered tools from ${allCustomTools.length} to ${customTools.length} (read-only)`);
  }
  if (isA2aSession && customTools.length === 0) {
    console.warn(
      "[agent-runner] A2A session has no custom tools (check skills_json / knowledge_search not false). Miniapp KB search will be unavailable.",
    );
  }

  // Build system prompt BEFORE resource loader — PI's AgentSession overrides
  // agent.setSystemPrompt() every turn, so the only way to inject our prompt
  // is via DefaultResourceLoader's `systemPrompt` option (used as customPrompt).
  let systemPrompt;
  if (isDefaultBot) {
    systemPrompt = await buildSystemPrompt({
      agentDir: resolvedAgentDir,
      assistantConfig,
      workDir: cwd,
      contactId: contactId || null,
      memoryContent,
      memoryPath,
      chatId,
      builtinSkills: builtinExecutor.listEnabledSkillIds(),
    });
  } else {
    systemPrompt = (assistantConfig?.systemPrompt && String(assistantConfig.systemPrompt).trim()) || "";
    log("system_prompt:custom_agent", { length: systemPrompt.length });
  }

  const skillsOverrideFn = isA2aSession
    ? (base) => ({ ...base, skills: [] })
    : isDefaultBot
      ? (base) => base
      : (base) => ({
          ...base,
          skills: base.skills.filter((s) => enabledSkillIds.has(s.name)),
        });

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: resolvedAgentDir,
    settingsManager,
    noExtensions: true,
    additionalSkillPaths: isA2aSession ? [] : [additionalSkillPath, builtinSkillPath],
    systemPrompt: systemPrompt || undefined,
    skillsOverride: skillsOverrideFn,
  });
  if (isCreezVerboseDebug()) {
    console.log(`[agent-runner] createAndSubscribe: resourceLoader.reload start (${Date.now() - t0}ms)`);
  }
  await resourceLoader.reload();
  if (isCreezVerboseDebug()) {
    console.log(`[agent-runner] createAndSubscribe: resourceLoader.reload done (${Date.now() - t0}ms)`);
  }

  // Reasoning models (e.g. gpt-5, gpt-5-mini) require reasoning to be enabled.
  // The pi-ai library sends `reasoning: { effort: "none" }` when thinkingLevel is "off",
  // which causes a 400 error on endpoints that mandate reasoning.
  // Ensure reasoning models start with at least "medium" thinking level.
  let initialThinkingLevel;
  if (model?.reasoning) {
    const saved = settingsManager?.getDefaultThinkingLevel?.();
    initialThinkingLevel = saved && saved !== "off" ? saved : "medium";
  }

  if (isCreezVerboseDebug()) {
    console.log(`[agent-runner] createAndSubscribe: createAgentSession start (${Date.now() - t0}ms)`);
  }
  const { session } = await createAgentSession({
    cwd,
    agentDir: resolvedAgentDir,
    model,
    authStorage,
    modelRegistry,
    sessionManager,
    settingsManager,
    resourceLoader,
    customTools,
    ...(initialThinkingLevel ? { thinkingLevel: initialThinkingLevel } : {}),
    // A2A: only allow read (filesystem browsing); bash/edit/write are destructive and must be blocked.
    ...(isA2aSession ? { tools: ["read"] } : {}),
  });
  if (isCreezVerboseDebug()) {
    console.log(`[agent-runner] createAndSubscribe: createAgentSession done (${Date.now() - t0}ms)`);
  }

  const sessionEntry = {
    session,
    unsubscribe: null,
    authStorage,
    listeners,
    workDir: cwd,
    configFingerprint: fingerprint,
    resourceLoader,
    /** Creez chatId for the in-flight prompt(); events must use this when session is reused across chats. */
    lastPromptChatId: null,
  };
  sessionEntryForEvents = sessionEntry;
  let pendingErrorMsg = null;
  let turnHadSuccessfulReply = false;
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
      if (ev.type === "agent_start") {
        const activeTools = session.getActiveToolNames ? session.getActiveToolNames() : [];
        const toolDefs = (session.state?.tools || []).map((t) => `  - ${t.name}: ${t.description || "(no desc)"}`);
        const loadedSkills = resourceLoader.getSkills ? resourceLoader.getSkills().skills || [] : [];
        const skillDefs = loadedSkills.map((s) => `  - ${s.name}: ${(s.description || "").slice(0, 120)}`);
        if (DEBUG_FULL_SYSTEM_PROMPT) {
          console.log(
            "[creez:agent] system_prompt_full_json=" + JSON.stringify(session.systemPrompt ?? ""),
          );
        }
        if (isCreezVerboseDebug()) {
          console.log("[creez:agent] === DEBUG: agent_start ===");
          console.log("[creez:agent] active tools (" + activeTools.length + "):\n" + (toolDefs.join("\n") || "  (none)"));
          console.log("[creez:agent] loaded skills (" + loadedSkills.length + "):\n" + (skillDefs.join("\n") || "  (none)"));
          console.log("[creez:agent] system prompt (sent to model):\n", session.systemPrompt || "(empty)");
          console.log("[creez:agent] === END DEBUG ===");
        }
        pendingErrorMsg = null;
        turnHadSuccessfulReply = false;
      }
      if (ev.type !== "message_update") {
        log("event", { type: ev.type, role, toolName, textLen, botKey });
      }
      if (ev.type === "message_end" && ev.message?.role === "assistant" && contentStr) {
        if (isCreezVerboseDebug()) {
          console.log("[creez:agent] LLM reply:\n", contentStr);
        }
        turnHadSuccessfulReply = true;
      }
      if (ev.type === "agent_end") {
        log("reply_done", { botKey, chatId: chatId ?? undefined });
      }
      const errorMsg = ev.isError ?? ev.message?.errorMessage ?? null;
      if (errorMsg) {
        log("event:error", errorMsg);
        if (typeof errorMsg === "string") {
          pendingErrorMsg = errorMsg;
        }
      }
      if (ev.type === "agent_end") {
        if (pendingErrorMsg && !turnHadSuccessfulReply) {
          broadcast("agent:eventError", pendingErrorMsg);
        }
        pendingErrorMsg = null;
        turnHadSuccessfulReply = false;
      }
      const resolvedEventChatId =
        sessionEntry.lastPromptChatId != null && String(sessionEntry.lastPromptChatId).trim() !== ""
          ? String(sessionEntry.lastPromptChatId).trim()
          : (chatId ?? undefined);
      if (isCreezVerboseDebug() && (ev.type === "agent_end" || ev.type === "message_end")) {
        console.log("[creez:stream-debug][main] broadcast to renderer", {
          type: ev.type,
          botKey,
          initChatId: chatId ?? null,
          lastPromptChatId: sessionEntry.lastPromptChatId ?? null,
          resolvedEventChatId: resolvedEventChatId ?? null,
        });
      }
      broadcast("agent:event", { ...serializeEvent(ev), chatId: resolvedEventChatId });
    } catch (error) {
      console.error("[creezv2 agent-runner] event forward error:", error?.message || String(error));
    }
  });

  sessionEntry.unsubscribe = unsubscribe;
  sessionsByBot.set(botKey, sessionEntry);

  const builtinIds = builtinExecutor.listEnabledSkillIds();
  log("session_created", { botKey, listenerId, chatId, builtinSkills: builtinIds.length });
  if (isCreezVerboseDebug()) {
    console.log(`[agent-runner] createAndSubscribe: sending agent_ready (total ${Date.now() - t0}ms)`, { botKey, chatId });
  }
  sender.send("agent:event", { type: "agent_ready", chatId: chatId ?? undefined });
}

export async function prompt(payload) {
  const rawKey = payload?.chatId != null && String(payload.chatId).trim() !== "" ? String(payload.chatId).trim() : "";
  const botKey = resolveSessionKey(rawKey);
  const entry = sessionsByBot.get(botKey);
  if (!entry?.session) return;
  const { text, images, streamingBehavior } = payload || {};
  if (!text && (!images || images.length === 0)) return;

  if (entry._promptInProgress) {
    log("prompt:serialize:wait", { botKey });
    try { await entry._promptInProgress; } catch { /* previous prompt error is handled elsewhere */ }
  }

  const run = async () => {
    entry.lastPromptChatId = rawKey || null;
    if (isCreezVerboseDebug()) {
      console.log("[creez:stream-debug][main] prompt() run", {
        botKey,
        rawChatId: rawKey || null,
        lastPromptChatId: entry.lastPromptChatId,
      });
    }
    const promptText = String(text || "");
    entry.lastPromptText = promptText.slice(0, 300).replace(/\s+/g, " ").trim();
    if (promptText.length > 300) entry.lastPromptText += "…";

    if (entry.resourceLoader && typeof entry.resourceLoader.reload === "function") {
      try {
        await entry.resourceLoader.reload();
      } catch (e) {
        log("prompt:reload_skills", e?.message || String(e));
      }
    }

    const imageCount = Array.isArray(images) ? images.length : 0;
    log("prompt", { botKey, chatId: rawKey || undefined, textLen: promptText.length, imageCount });

    // ── Full prompt dump (temporary debug) ──
    console.log("\n========== [CREEZ PROMPT DEBUG] ==========");
    console.log("[PROMPT DEBUG] botKey:", botKey);
    console.log("[PROMPT DEBUG] chatId:", rawKey || "(none)");
    console.log("[PROMPT DEBUG] user text:\n" + promptText);
    console.log("[PROMPT DEBUG] systemPrompt:\n" + (entry.session.systemPrompt || "(empty)"));
    const historyMessages = entry.session.state?.messages;
    if (Array.isArray(historyMessages)) {
      console.log("[PROMPT DEBUG] conversation history (" + historyMessages.length + " messages):");
      for (const m of historyMessages) {
        const role = m.role || "?";
        const c = typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.filter(p => p?.type === "text").map(p => p.text).join("")
            : JSON.stringify(m.content);
        console.log(`  [${role}] ${c}`);
      }
    } else {
      console.log("[PROMPT DEBUG] conversation history: (unavailable)");
    }
    console.log("========== [/CREEZ PROMPT DEBUG] ==========\n");

    log("prompt:start", { botKey, textLen: promptText.length });
    const options = {
      images: Array.isArray(images) ? images : [],
      expandPromptTemplates: false,
    };
    if (streamingBehavior === "followUp" || streamingBehavior === "steer") {
      options.streamingBehavior = streamingBehavior;
    }
    await entry.session.prompt(text || "", options);
    log("prompt:end", { botKey });
  };

  entry._promptInProgress = run();
  try {
    await entry._promptInProgress;
  } finally {
    entry._promptInProgress = null;
  }
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
