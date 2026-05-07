const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Type } = require("@sinclair/typebox");
const { copySkillRefs } = require("./openClawImport.cjs");

const NORMALIZER_DIR = path.join(os.tmpdir(), "creez_openclaw_import_normalizer");

let cachedSdk = null;
let sdkPromise = null;

async function getSdk() {
  if (cachedSdk) return cachedSdk;
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import("@mariozechner/pi-coding-agent"),
      import("@mariozechner/pi-ai"),
    ]).then(([piAgent, piAi]) => {
      cachedSdk = {
        AuthStorage: piAgent.AuthStorage,
        DefaultResourceLoader: piAgent.DefaultResourceLoader,
        ModelRegistry: piAgent.ModelRegistry,
        SessionManager: piAgent.SessionManager,
        SettingsManager: piAgent.SettingsManager,
        createAgentSession: piAgent.createAgentSession,
        getModel: piAi.getModel,
      };
      return cachedSdk;
    });
  }
  return sdkPromise;
}

function activeModelFrom(defaultConfig) {
  const models = Array.isArray(defaultConfig?.models) ? defaultConfig.models : [];
  return models.find((m) => m?.active) || models[0] || null;
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Pi agent returned empty output.");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error("Pi agent did not return valid JSON.");
  }
}

function trimJson(value, maxChars) {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...TRUNCATED...";
}

function normalizeDraft(raw, fallback = {}) {
  const obj = raw && typeof raw === "object" ? raw : {};
  return {
    name: String(obj.name || fallback.name || "OpenClaw Agent").trim().slice(0, 80),
    greeting_message: String(obj.greeting_message || fallback.greeting_message || "").trim().slice(0, 240),
    system_prompt: String(obj.system_prompt || fallback.system_prompt || "").trim(),
    knowledge: String(obj.knowledge || fallback.knowledge || "").trim(),
    migration_notes: Array.isArray(obj.migration_notes)
      ? obj.migration_notes.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 20)
      : [],
  };
}

function assertNotAborted(signal) {
  if (signal?.aborted) {
    const e = new Error("OpenClaw import cancelled.");
    e.code = "CANCELLED";
    throw e;
  }
}

async function normalizeOpenClawWithPi({
  openClawConfig,
  pickedAgent,
  extractedSystemPrompt,
  extractedMemory,
  skillRefs,
  defaultConfig,
  creezHome,
  botId,
  status,
  signal,
}) {
  assertNotAborted(signal);
  const active = activeModelFrom(defaultConfig);
  const provider = String(active?.provider || "").trim().toLowerCase();
  const modelId = String(active?.model || "").trim();
  const apiKey = String(active?.apiKey || "").trim();
  if (!provider || !modelId || !apiKey) {
    status("Default model is not configured; using rule-based OpenClaw migration.");
    return null;
  }

  const sdk = await getSdk();
  const model = sdk.getModel(provider, modelId);
  if (!model) {
    status(`Default model is not available in Pi registry (${provider}/${modelId}); using rule-based migration.`);
    return null;
  }

  status(`Asking Pi agent to normalize OpenClaw data (${provider}/${modelId}).`);
  await fs.mkdir(NORMALIZER_DIR, { recursive: true });
  const authStorage = new sdk.AuthStorage(path.join(NORMALIZER_DIR, "auth.json"));
  authStorage.setRuntimeApiKey(provider, apiKey);
  const modelRegistry = new sdk.ModelRegistry(authStorage);
  const sessionManager = sdk.SessionManager.inMemory();
  const settingsManager = sdk.SettingsManager.create(NORMALIZER_DIR, NORMALIZER_DIR);
  const targetBotDir = path.join(creezHome, "bots", botId);
  const targetSkillsDir = path.join(targetBotDir, "skills");
  const skillCopyResultRef = { value: null };
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd: NORMALIZER_DIR,
    agentDir: NORMALIZER_DIR,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    systemPrompt: [
      "You migrate OpenClaw bot configuration into a Creez draft bot.",
      "Return strict JSON only. Do not include Markdown fences.",
      "Do not invent file paths. Do not issue shell commands.",
      "You may call the provided copy_openclaw_skills tool exactly once to copy the source skill folders/files into the prepared Creez bot skill directory.",
      "Do not output an agent_card field.",
      "Preserve the user's persona and important operating instructions.",
      "Keep system_prompt complete enough for the bot to behave like the source bot.",
    ].join("\n"),
  });
  await resourceLoader.reload();

  const copyOpenClawSkillsTool = {
    name: "copy_openclaw_skills",
    label: "Copy OpenClaw skills into Creez bot directory",
    description:
      "Copy the prevalidated OpenClaw skill files/directories into the prepared Creez bot skill directory. This tool only copies the skill sources listed in the migration context.",
    parameters: Type.Object({}),
    execute: async () => {
      assertNotAborted(signal);
      status(`Pi agent requested skill copy into: ${targetSkillsDir}`);
      const result = await copySkillRefs(skillRefs, targetSkillsDir, status, signal);
      skillCopyResultRef.value = result;
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  };

  const { session } = await sdk.createAgentSession({
    cwd: NORMALIZER_DIR,
    agentDir: NORMALIZER_DIR,
    model,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    sessionManager,
    settingsManager,
    resourceLoader,
    customTools: [copyOpenClawSkillsTool],
  });

  const prompt = [
    "Create a Creez bot draft from the OpenClaw source below.",
    "Before your final JSON, call copy_openclaw_skills once if any skill files/directories are listed.",
    "",
    "Creez data definition:",
    JSON.stringify({
      assistant_config: {
        name: "string, <=80 chars",
        greeting_message: "string, <=240 chars",
        system_prompt: "string, full persona and behavior instructions",
        knowledge: "markdown string copied from memory/knowledge context",
        migration_notes: ["short notes for the user"],
      },
      storage: {
        botDir: targetBotDir,
        skillDir: targetSkillsDir,
        memoryFile: path.join(targetBotDir, "data", "memory.md"),
      },
    }, null, 2),
    "",
    "OpenClaw selected agent/defaults:",
    trimJson(pickedAgent, 12000),
    "",
    "OpenClaw full config excerpt:",
    trimJson(openClawConfig, 18000),
    "",
    "Extracted persona/system prompt:",
    String(extractedSystemPrompt || "").slice(0, 20000),
    "",
    "Extracted memory/knowledge markdown:",
    String(extractedMemory || "").slice(0, 16000),
    "",
    "Skill files/directories available to copy through copy_openclaw_skills:",
    trimJson(skillRefs, 8000),
    "",
    "Return exactly this JSON shape:",
    JSON.stringify({
      name: "Bot name",
      greeting_message: "Short greeting",
      system_prompt: "Full system prompt",
      knowledge: "Markdown memory/knowledge content",
      migration_notes: ["Any uncertainty or fallback used"],
    }, null, 2),
  ].join("\n");

  let lastAssistantText = "";
  let unsubscribe = () => {};
  const collectPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { unsubscribe(); } catch {}
      reject(new Error("Pi normalization timed out."));
    }, 90000);
    const abort = () => {
      clearTimeout(timeout);
      try { unsubscribe(); } catch {}
      const e = new Error("OpenClaw import cancelled.");
      e.code = "CANCELLED";
      reject(e);
    };
    if (signal) signal.addEventListener("abort", abort, { once: true });
    unsubscribe = session.subscribe((ev) => {
      const content =
        typeof ev.content === "string" ? ev.content :
        typeof ev.message?.content === "string" ? ev.message.content :
        ev.choices?.[0]?.message?.content || "";
      if (content) lastAssistantText = content;
      if (ev.type === "agent_end") {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", abort);
        try { unsubscribe(); } catch {}
        resolve(lastAssistantText);
      }
    });
  });

  await session.prompt(prompt, { expandPromptTemplates: false });
  const text = await collectPromise;
  assertNotAborted(signal);
  const parsed = extractJsonObject(text);
  const fallback = {
    system_prompt: extractedSystemPrompt,
    knowledge: extractedMemory,
  };
  const draft = normalizeDraft(parsed, fallback);
  if (!draft.system_prompt) throw new Error("Pi normalization produced an empty system_prompt.");
  draft.skillCopyResult = skillCopyResultRef.value;
  status("Pi agent generated a Creez draft JSON.");
  return draft;
}

module.exports = {
  normalizeOpenClawWithPi,
  normalizeDraft,
};
