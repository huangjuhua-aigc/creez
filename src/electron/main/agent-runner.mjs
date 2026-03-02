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

let sessionRef = null;
let unsubscribe = null;
let senderRef = null;
let errorNotifiedThisTurn = false;
let authStorageRef = null;
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
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  sessionRef = null;

  const {
    provider,
    modelId,
    apiKey,
    contactId,
    assistantConfigId,
    workDir,
    agentDir,
    assistantConfig,
    memoryContent,
    memoryPath,
    chatId,
  } = config;
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
  authStorageRef = authStorage;

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
      chatId: chatId || null,
    },
    onEvent: (builtinEv) => {
      sender.send("agent:event", builtinEv);
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

  sessionRef = session;
  senderRef = sender;
  unsubscribe = session.subscribe((ev) => {
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
        log("event", { type: ev.type, role, toolName, textLen });
      }
      const errorMsg = ev.isError ?? ev.message?.errorMessage ?? null;
      if (errorMsg) {
        log("event:error", errorMsg);
        const shouldNotify =
          typeof errorMsg === "string" &&
          senderRef &&
          !senderRef.isDestroyed() &&
          ((ev.type === "message_end" && ev.message?.role === "assistant") || ev.type === "agent_end");
        if (shouldNotify && !errorNotifiedThisTurn) {
          sender.send("agent:eventError", errorMsg);
          errorNotifiedThisTurn = true;
        }
      }
      if (ev.type === "agent_end") errorNotifiedThisTurn = false;
      sender.send("agent:event", serializeEvent(ev));
    } catch (error) {
      const msg = error?.message || String(error);
      console.error("[creezv2 agent-runner] event forward error:", msg);
    }
  });

  sender.send("agent:event", { type: "agent_ready" });
  log("create:ready", "");
}

export async function prompt(payload) {
  if (!sessionRef) return;
  const { text, images } = payload || {};
  if (!text && (!images || images.length === 0)) return;
  log("prompt:start", {
    textLen: String(text || "").length,
    imageCount: Array.isArray(images) ? images.length : 0,
  });
  await sessionRef.prompt(text || "", {
    images: Array.isArray(images) ? images : [],
    expandPromptTemplates: false,
  });
  log("prompt:end", "");
}

export async function setModel(config) {
  if (!sessionRef) return false;
  const provider = String(config?.provider || "").trim();
  const modelId = String(config?.modelId || "").trim();
  const apiKey = String(config?.apiKey || "").trim();
  if (!provider || !modelId || !apiKey) return false;

  const model = resolveModel(provider, modelId);
  if (!model) {
    log("setModel:model-miss", { provider, modelId });
    return false;
  }

  if (authStorageRef) {
    authStorageRef.setRuntimeApiKey(provider, apiKey);
  }
  await sessionRef.setModel(model);
  log("setModel:ok", { provider, modelId });
  return true;
}

export function abort() {
  if (sessionRef?.agent) {
    log("abort", "abort requested");
    sessionRef.agent.abort();
  }
}

export function hasSession() {
  return Boolean(sessionRef);
}

export function dispose() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  sessionRef = null;
  senderRef = null;
  authStorageRef = null;
}
