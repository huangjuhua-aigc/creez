/**
 * Pi AgentSession runner for Creez (OpenClaw-style).
 * Uses createAgentSession; session owns conversation state; we forward events to renderer.
 * ESM so we can import @mariozechner/pi-coding-agent and pi-ai.
 */

import path from "node:path";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

let sessionRef = null;
let unsubscribe = null;
let senderRef = null;
/** 当前轮次是否已向前端发送过 eventError，避免重复弹窗 */
let _errorNotifiedThisTurn = false;

function serializeEvent(ev) {
  const out = { type: ev.type };
  if (ev.message) {
    out.message = serializeMessage(ev.message);
  }
  if (ev.messages && Array.isArray(ev.messages)) {
    out.messages = ev.messages.map(serializeMessage);
  }
  if (ev.toolCallId !== undefined) out.toolCallId = ev.toolCallId;
  if (ev.toolName !== undefined) out.toolName = ev.toolName;
  if (ev.args !== undefined) out.args = ev.args;
  if (ev.result !== undefined) out.result = ev.result;
  if (ev.partialResult !== undefined) out.partialResult = ev.partialResult;
  if (ev.isError !== undefined) out.isError = ev.isError;
  if (ev.assistantMessageEvent !== undefined) out.assistantMessageEvent = ev.assistantMessageEvent;
  return out;
}

function serializeMessage(msg) {
  if (!msg) return msg;
  const m = { role: msg.role };
  if (msg.content !== undefined) m.content = msg.content;
  if (msg.toolCallId !== undefined) m.toolCallId = msg.toolCallId;
  if (msg.toolName !== undefined) m.toolName = msg.toolName;
  if (msg.errorMessage !== undefined) m.errorMessage = msg.errorMessage;
  return m;
}

/** 豆包：OpenAI 兼容 API，复用 openai-completions，仅自定义 baseUrl 与 provider */
const DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

function createDoubaoModel(modelId) {
  return {
    id: modelId,
    name: `Doubao ${modelId}`,
    api: "openai-completions",
    provider: "doubao",
    baseUrl: DOUBAO_BASE_URL,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}

function resolveModel(provider, modelId, authStorage) {
  if (provider === "doubao") {
    return createDoubaoModel(modelId || "doubao-1.5-pro-32k");
  }
  const model = getModel(provider, modelId);
  return model || null;
}

/**
 * Create AgentSession and subscribe to events; forward events to sender (WebContents).
 * @param {import("electron").WebContents} sender
 * @param {{ provider: string, modelId: string, apiKey: string, workDir: string, agentDir: string }} config
 */
export async function createAndSubscribe(sender, config) {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  sessionRef = null;

  const { provider, modelId, apiKey, workDir, agentDir } = config;
  const cwd = workDir || process.cwd();
  const authPath = path.join(agentDir || process.cwd(), "auth.json");
  const authStorage = new AuthStorage(authPath);
  authStorage.setRuntimeApiKey(provider, apiKey);

  const modelRegistry = new ModelRegistry(authStorage);
  const model = resolveModel(provider, modelId, authStorage);
  if (!model) {
    sender.send("agent:eventError", `不支持的模型: ${provider}/${modelId}。请使用 pi-ai 支持的 provider 与 model id，或选择豆包(doubao)。`);
    return;
  }

  // Session persistence: under agentDir/sessions/<encoded-workDir>/
  const safePath = `--${(workDir || cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const sessionDir = path.join(agentDir || process.cwd(), "sessions", safePath);
  const sessionManager = SessionManager.create(cwd, sessionDir);
  const resolvedAgentDir = agentDir || path.join(process.cwd(), ".creez");
  const settingsManager = SettingsManager.create(cwd, resolvedAgentDir);

  // agentDir 已为 ~/.creez，Pi 默认会从 agentDir/skills（即 ~/.creez/skills）和 cwd/.pi/skills 加载；此处仅额外加上工作区 .creez/skills
  const workDirSkillsPath = path.join(cwd, ".creez", "skills");
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: resolvedAgentDir,
    settingsManager,
    noExtensions: true,
    additionalSkillPaths: [workDirSkillsPath],
  });
  await resourceLoader.reload();

  // 不传 tools 时 Pi 使用默认 defaultActiveToolNames = ["read", "bash", "edit", "write"]，
  // 且 session 内用 createAllTools(this._cwd) 创建工具，执行目录 = workDir（沙箱目录）
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
  });

  const log = (msg, extra = "") => {
    try {
      console.log("[Creez agent-runner]", msg, extra);
    } catch (_) {}
  };

  sessionRef = session;
  senderRef = sender;
  unsubscribe = session.subscribe((ev) => {
    try {
      // 调试：打印大模型侧事件，便于查「无回复/报错」
      const role = ev.message?.role;
      const contentPreview =
        ev.message?.content == null
          ? ""
          : typeof ev.message.content === "string"
            ? ev.message.content.slice(0, 80)
            : Array.isArray(ev.message.content)
              ? (ev.message.content.find((c) => c.type === "text")?.text ?? "").slice(0, 80)
              : String(ev.message.content).slice(0, 80);
      if (ev.type === "message_update" || ev.type === "message_end") {
        log(`event ${ev.type} role=${role}`, contentPreview ? `contentLen≈${contentPreview.length}` : "no-content");
      } else {
        log(`event ${ev.type}`, role != null ? `role=${role}` : "");
      }
      const errorMsg = ev.isError ?? ev.message?.errorMessage ?? null;
      if (errorMsg) {
        log("error in event", errorMsg);
        // 把事件流中的错误（如 403 地域限制）通知前端，一次对话只发一次
        const shouldNotify =
          typeof errorMsg === "string" &&
          senderRef &&
          !senderRef.isDestroyed() &&
          ((ev.type === "message_end" && ev.message?.role === "assistant") || ev.type === "agent_end");
        if (shouldNotify && !_errorNotifiedThisTurn) {
          try {
            sender.send("agent:eventError", errorMsg);
            _errorNotifiedThisTurn = true;
          } catch (_) {}
        }
      }
      if (ev.type === "agent_end") _errorNotifiedThisTurn = false;
      sender.send("agent:event", serializeEvent(ev));
    } catch (e) {
      log("subscribe send error", e && e.message ? e.message : String(e));
    }
  });

  sender.send("agent:event", { type: "agent_ready" });
}

/**
 * @param {{ text: string, images?: Array<{ type: string, data?: string, mimeType?: string }> }} payload
 */
export async function prompt(payload) {
  if (!sessionRef) return;
  const { text, images } = payload || {};
  if (!text && (!images || images.length === 0)) return;
  try {
    await sessionRef.prompt(text || "", { images: images || [], expandPromptTemplates: false });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error("[Creez agent-runner] prompt error:", msg, err && err.stack ? "\n" + err.stack : "");
    if (senderRef && !senderRef.isDestroyed()) {
      try {
        senderRef.send("agent:eventError", msg);
      } catch (_) {}
    }
    throw err;
  }
}

export function abort() {
  if (sessionRef && sessionRef.agent) {
    sessionRef.agent.abort();
  }
}

export function dispose() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  sessionRef = null;
  senderRef = null;
}

export function hasSession() {
  return sessionRef != null;
}
