import path from "node:path";
import fs from "node:fs";
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
import { createCreezSandboxTools } from "./sandbox/sandboxTools.mjs";
import sandboxPolicyModule from "./sandbox/sandboxPolicy.cjs";
import sandboxApprovalModule from "./sandbox/sandboxApproval.cjs";
import { buildSystemPrompt } from "./system-prompt.mjs";

const require = createRequire(import.meta.url);
const { BUILTIN_SKILL_IDS } = require("./builtinSkillIds.cjs");
const { isCreezVerboseDebug } = require("./creezDebug.cjs");
const { requestGmailAuth } = require("./google/gmailAuthRequest.cjs");
const { createSandboxPolicy, explainPolicy } = sandboxPolicyModule;
const { requestSandboxApproval } = sandboxApprovalModule;

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
  const builtIn = getModel(provider, modelId);
  if (builtIn) return builtIn;

  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const id = String(modelId || "").trim();
  if (!id) return null;

  if (normalizedProvider === "deepseek") {
    const isReasoningModel = /(^|[-_/])(reasoner|r1|pro)($|[-_/])|deepseek-v4/i.test(id);
    return {
      id,
      name: `DeepSeek ${id}`,
      api: "openai-completions",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      reasoning: isReasoningModel,
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 1048576,
      maxTokens: 262144,
      compat: {
        supportsDeveloperRole: false,
      },
    };
  }

  if (normalizedProvider === "doubao") {
    return {
      id,
      name: `Doubao ${id}`,
      api: "openai-responses",
      provider: "doubao",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      reasoning: false,
      input: ["text", "image"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 262144,
      maxTokens: 32768,
    };
  }

  return null;
}

const SANDBOX_TOOLING_VERSION = "creez-sandbox-tools-v4-gmail";

/** Fingerprint of assistant config and execution policy that affects session tools/prompt. */
function configFingerprint(assistantConfig, assistantConfigId, defaultContactId, execution = {}) {
  if (!assistantConfig) return "";
  const systemPrompt = (assistantConfig.systemPrompt && String(assistantConfig.systemPrompt).trim()) || "";
  return JSON.stringify({
    systemPrompt,
    sandboxToolingVersion: SANDBOX_TOOLING_VERSION,
    scenario: execution.scenario || "unknown",
    isExternalUser: Boolean(execution.isExternalUser),
    sandboxPermissionMode: execution.sandboxPermissionMode === "full_access" ? "full_access" : "default",
  });
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
 * Headless cron uses createAndSubscribe({ sessionKey: "headless:…", chatId }).
 * That registers keyToContactId.set(chatId, headlessBotKey) so prompt({ chatId }) hits the task session.
 * When the task ends, removeListener alone does not remove that map entry — the next user prompt
 * still resolves to the headless session (often with no UI listener), so agent:event never reaches
 * the renderer and the chat stays on "···". Clear the headless mapping and restore chatId → contactId
 * when the desktop session for that bot is still alive.
 *
 * @param {string} chatId
 * @param {string} headlessBotKey - e.g. "headless:<taskId>"
 * @param {string|null|undefined} contactId
 */
export function releaseChatRoutingFromHeadless(chatId, headlessBotKey, contactId) {
  const cChat = String(chatId || "").trim();
  const hKey = String(headlessBotKey || "").trim();
  if (!cChat || !hKey) return;
  if (keyToContactId.get(cChat) !== hKey) return;
  keyToContactId.delete(cChat);
  const cContact = String(contactId || "").trim();
  if (cContact && cContact !== cChat && sessionsByBot.has(cContact)) {
    keyToContactId.set(cChat, cContact);
  }
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
  const explicitSessionKey =
    configSessionKey != null && String(configSessionKey).trim() !== "" ? String(configSessionKey).trim() : null;
  const botKey = explicitSessionKey || contactId || chatId || "";
  /** External user sessions (remote_user / a2a_agent / auto_discovery): restrict Pi tools + builtin whitelist. */
  const isExternalUser = Boolean(config.isExternalUser);
  const sandboxPermissionMode = config.sandboxPermissionMode === "full_access" ? "full_access" : "default";
  const listenerId = chatId ? `ui:${chatId}` : "ui";

  if (chatId && chatId !== botKey) {
    keyToContactId.set(chatId, botKey);
  }

  let cwd = workDir;
  if (!cwd && contactId) {
    try {
      const { resolveCreezHome, ensureBotDir } = require("./creezPaths.cjs");
      cwd = ensureBotDir(resolveCreezHome(), contactId);
    } catch { /* fall through */ }
  }
  if (!cwd) cwd = process.cwd();
  const existing = sessionsByBot.get(botKey);
  const fingerprint = configFingerprint(assistantConfig, assistantConfigId, defaultContactId, {
    scenario: config.scenario,
    isExternalUser,
    sandboxPermissionMode,
  });
  console.log("[creez:sandbox] session check", {
    botKey,
    scenario: config.scenario || "unknown",
    isExternalUser,
    hasExistingSession: Boolean(existing?.session),
    fingerprintChanged: Boolean(existing?.session && existing.configFingerprint !== fingerprint),
  });
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
    console.log("[creez:sandbox] rebuilding session for sandbox policy", {
      botKey,
      scenario: config.scenario || "unknown",
      previousFingerprint: existing.configFingerprint || "",
    });
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

  const isDefaultBot = assistantConfigId != null && defaultContactId != null
    && String(assistantConfigId) === String(defaultContactId);

  let botDir = null;
  if (!isDefaultBot && contactId) {
    const { resolveCreezHome: rch, getBotDir } = require("./creezPaths.cjs");
    botDir = getBotDir(rch(), contactId);
  }

  let sessionDir;
  if (botDir) {
    const safeBotKey = botKey.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
    sessionDir = path.join(botDir, "sessions", safeBotKey);
  } else {
    const safeCwd = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    const safeBotKey = botKey.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
    sessionDir = path.join(resolvedAgentDir, "sessions", safeCwd, safeBotKey);
  }
  const sessionManager = SessionManager.continueRecent(cwd, sessionDir);
  const settingsManager = SettingsManager.create(cwd, resolvedAgentDir);
  let sessionEntryForEvents = null;
  const requestApproval = (approvalRequest) => {
    if (sandboxPermissionMode === "full_access") {
      return Promise.resolve({ allowed: true, reason: "Allowed by full access mode." });
    }
    const resolved =
      sessionEntryForEvents?.lastPromptChatId != null && String(sessionEntryForEvents.lastPromptChatId).trim() !== ""
        ? String(sessionEntryForEvents.lastPromptChatId).trim()
        : (chatId ?? undefined);
    return requestSandboxApproval({
      request: {
        ...approvalRequest,
        chatId: resolved ?? null,
        scenario: config.scenario,
        sandboxMode: sandboxPolicy?.mode,
        sandboxBackend: sandboxPolicy?.backend,
      },
      sendRequest: (payload) => {
        broadcast("agent:event", {
          type: "sandbox_approval_request",
          chatId: resolved,
          request: payload,
        });
      },
    });
  };
  const requestGmailAuthorization = (authRequest = {}) => {
    const resolved =
      sessionEntryForEvents?.lastPromptChatId != null && String(sessionEntryForEvents.lastPromptChatId).trim() !== ""
        ? String(sessionEntryForEvents.lastPromptChatId).trim()
        : (chatId ?? undefined);
    return requestGmailAuth({
      request: {
        title: "Connect Gmail",
        message: "Creez needs Google authorization before this agent can use Gmail.",
        action: "gmail",
        ...(authRequest && typeof authRequest === "object" ? authRequest : {}),
        chatId: resolved ?? null,
      },
      sendRequest: (payload) => {
        broadcast("agent:event", {
          type: "gmail_auth_required",
          chatId: resolved,
          request: payload,
          title: payload.title,
          message: payload.message,
          action: payload.action,
        });
      },
    });
  };
  const sandboxPolicy = createSandboxPolicy({
    scenario: config.scenario,
    isExternalUser,
    workDir: cwd,
    agentDir: resolvedAgentDir,
    requestApproval,
  });
  const sandboxTools = createCreezSandboxTools({ cwd, policy: sandboxPolicy });
  log("sandbox_policy", {
    botKey,
    mode: sandboxPolicy.mode,
    backend: sandboxPolicy.backend,
    tools: sandboxTools.map((t) => t.name),
  });
  console.log("[creez:sandbox] enabled", {
    botKey,
    scenario: config.scenario,
    policy: explainPolicy(sandboxPolicy),
    tools: sandboxTools.map((t) => t.name).join(","),
  });

  const botSkillPath = botDir ? path.join(botDir, "skills") : null;
  const globalSkillPath = path.join(resolvedAgentDir, "skills");
  const builtinSkillPath = path.join(APP_ROOT_DIR, "skills", "builtin", "skills");
  const replyInstructions = loadBuiltinReplyInstructions(builtinSkillPath, BUILTIN_SKILL_IDS);
  const builtinRegistry = createBuiltinSkillRegistry();
  /** Set after sessionEntry is created; used so tool/builtin events use the chatId of the active prompt turn (not only init-time chatId). */
  const builtinExecutor = createBuiltinSkillExecutor({
    registry: builtinRegistry,
    runtimeContext: {
      scenario: config.scenario || null,
      isExternalUser,
      contactId: contactId || null,
      assistantConfigId: assistantConfigId || null,
      defaultContactId: defaultContactId || null,
      chatId: chatId || null,
      workDir: cwd,
      channelSend: config.channelSend,
      gmailClient: config.gmailClient || null,
      requestApproval,
      requestGmailAuth: requestGmailAuthorization,
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
  const allCustomTools = builtinExecutor.listEnabledToolDefinitions();
  const EXTERNAL_ALLOWED_TOOLS = new Set(["knowledge_search", "web_fetch"]);
  const customTools = isExternalUser
    ? allCustomTools.filter((t) => EXTERNAL_ALLOWED_TOOLS.has(t.name))
    : allCustomTools;
  if (isExternalUser && allCustomTools.length !== customTools.length) {
    console.log(`[agent-runner] external user session: filtered tools from ${allCustomTools.length} to ${customTools.length}`);
  }
  if (isExternalUser && customTools.length === 0) {
    console.warn(
      "[agent-runner] external user session: no knowledge_search/web_fetch after whitelist. KB search unavailable.",
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
      sandbox: sandboxPolicy,
      sandboxPermissionMode,
      toolNames: sandboxTools.map((tool) => tool.name),
    });
  } else {
    const basePrompt = (assistantConfig?.systemPrompt && String(assistantConfig.systemPrompt).trim()) || "";
    const botMemory = memoryContent && String(memoryContent).trim()
      ? `\n\n## Memory\n${String(memoryContent).trim()}`
      : "";
    systemPrompt = `${basePrompt}${botMemory}`.trim();
    log("system_prompt:custom_agent", { length: systemPrompt.length });
  }

  const skillsOverrideFn = isExternalUser
    ? (base) => ({ ...base, skills: [] })
    : (base) => base;

  const isNonDefaultBot = !isDefaultBot;
  const additionalSkillPaths = isExternalUser
    ? []
    : isNonDefaultBot
      ? [botSkillPath, builtinSkillPath].filter(Boolean)
      : [globalSkillPath, builtinSkillPath].filter(Boolean);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: resolvedAgentDir,
    settingsManager,
    noExtensions: true,
    noSkills: isNonDefaultBot,
    additionalSkillPaths,
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
    tools: sandboxTools,
    ...(initialThinkingLevel ? { thinkingLevel: initialThinkingLevel } : {}),
  });
  const sandboxToolNames = sandboxTools.map((tool) => tool.name);
  const sandboxToolOverride = Object.fromEntries(sandboxTools.map((tool) => [tool.name, tool]));
  if (typeof session._buildRuntime === "function") {
    session._baseToolsOverride = sandboxToolOverride;
    session._buildRuntime({
      activeToolNames: sandboxToolNames,
      includeAllExtensionTools: true,
    });
    console.log("[creez:sandbox] base tools overridden", {
      botKey,
      tools: sandboxToolNames.join(","),
      activeTools: session.getActiveToolNames ? session.getActiveToolNames().join(",") : "",
    });
  } else {
    console.warn("[creez:sandbox] unable to override pi base tools; sandbox enforcement may be incomplete", { botKey });
  }
  if (isCreezVerboseDebug()) {
    console.log(`[agent-runner] createAndSubscribe: createAgentSession done (${Date.now() - t0}ms)`);
  }

  const sessionEntry = {
    session,
    unsubscribe: null,
    authStorage,
    listeners,
    workDir: cwd,
    sessionDir,
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
        console.log("[creez:diag:event]", ev.type, {
          role, toolName, textLen, botKey,
          ...(ev.type === "tool_result" || ev.type === "tool_call_result"
            ? { isError: ev.isError, resultPreview: String(ev.result || ev.partialResult || "").slice(0, 200) }
            : {}),
          ...(ev.type.startsWith("tool") ? { toolCallId: ev.toolCallId || null } : {}),
          ...(ev.isError != null ? { isError: ev.isError } : {}),
          ...(ev.message?.errorMessage ? { errorMessage: String(ev.message.errorMessage).slice(0, 200) } : {}),
        });
      }
      if (ev.type === "message_end" && ev.message?.role === "assistant") {
        console.log("[creez:diag] message_end assistant", {
          botKey,
          chatId: chatId ?? null,
          contentType: typeof ev.message?.content,
          contentIsArray: Array.isArray(ev.message?.content),
          contentStr: contentStr.slice(0, 200),
          contentLen: contentStr.length,
          rawContentPreview: JSON.stringify(ev.message?.content)?.slice(0, 300),
        });
        if (!contentStr) {
          const history = session.state?.messages;
          const historyLen = Array.isArray(history) ? history.length : -1;
          const lastFew = Array.isArray(history) ? history.slice(-6).map((m, i) => ({
            i: historyLen - 6 + i,
            role: m.role,
            hasContent: m.content != null,
            contentType: typeof m.content,
            isArray: Array.isArray(m.content),
            contentPreview: typeof m.content === "string"
              ? m.content.slice(0, 80)
              : Array.isArray(m.content)
                ? JSON.stringify(m.content.map(c => ({ type: c.type, len: (c.text || c.thinking || "").length }))).slice(0, 200)
                : String(m.content).slice(0, 80),
            toolCallId: m.toolCallId || undefined,
            toolName: m.toolName || undefined,
          })) : [];
          console.log("[creez:diag] EMPTY assistant response — session history dump", {
            historyLen,
            lastMessages: lastFew,
          });
        } else {
          turnHadSuccessfulReply = true;
        }
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
        if (!turnHadSuccessfulReply) {
          console.warn("[agent-runner] empty assistant response detected — invalidating session fingerprint for rebuild on next init", { botKey });
          sessionEntry.configFingerprint = "__invalidated__";
          if (pendingErrorMsg) {
            broadcast("agent:eventError", pendingErrorMsg);
          } else {
            broadcast("agent:eventError", "Agent returned an empty response. Please resend your message.");
          }
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

export function forgetSession(key, options = {}) {
  const rawKey = key != null && String(key).trim() !== "" ? String(key).trim() : "";
  if (!rawKey) return false;
  const botKey = resolveSessionKey(rawKey);
  const entry = sessionsByBot.get(botKey);
  if (entry?.session?.agent) {
    try {
      entry.session.agent.abort();
    } catch {
      // ignore abort failures during cleanup
    }
  }
  if (entry?.unsubscribe) {
    try {
      entry.unsubscribe();
    } catch {
      // ignore unsubscribe failures during cleanup
    }
    entry.unsubscribe = null;
  }
  sessionsByBot.delete(botKey);
  for (const [mappedKey, mappedBotKey] of Array.from(keyToContactId.entries())) {
    if (mappedKey === rawKey || mappedKey === botKey || mappedBotKey === botKey || mappedBotKey === rawKey) {
      keyToContactId.delete(mappedKey);
    }
  }
  if (options?.deletePersisted && entry?.sessionDir) {
    try {
      fs.rmSync(entry.sessionDir, { recursive: true, force: true });
      console.log("[agent-runner] forgot persisted session", { key: rawKey, botKey, sessionDir: entry.sessionDir });
    } catch (e) {
      console.warn("[agent-runner] failed to delete persisted session", { key: rawKey, botKey, message: e?.message || String(e) });
    }
  }
  return Boolean(entry);
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
