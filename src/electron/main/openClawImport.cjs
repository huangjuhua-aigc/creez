const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const s = String(value || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function pushText(parts, label, value) {
  const s = normalizeText(value);
  if (!s) return;
  parts.push(label ? `## ${label}\n${s}` : s);
}

function normalizeText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join("\n\n");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, val]) => {
        const text = normalizeText(val);
        return text ? `${key}:\n${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return String(value).trim();
}

function safeFilename(name) {
  return String(name || "skill")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80)
    || "skill";
}

function parseJson5(raw) {
  try {
    return require("json5").parse(raw);
  } catch (json5Error) {
    try {
      return JSON.parse(raw);
    } catch {
      throw json5Error;
    }
  }
}

function execFileSafe(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 6000, windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        command,
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        error: error?.message || "",
      });
    });
  });
}

function openClawCommandCandidates() {
  const candidates = [];
  const add = (value) => {
    const s = String(value || "").trim();
    if (s && !candidates.includes(s)) candidates.push(s);
  };
  add(process.env.OPENCLAW_CLI_PATH);
  add("openclaw");
  if (process.platform === "win32") {
    add("openclaw.cmd");
    add(path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm", "openclaw.cmd"));
    add(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Volta", "bin", "openclaw.cmd"));
  }
  return candidates;
}

async function execOpenClaw(args, status) {
  const errors = [];
  for (const candidate of openClawCommandCandidates()) {
    const useShell = process.platform === "win32" && /\.cmd$/i.test(candidate);
    const r = await execFileSafe(candidate, args, { shell: useShell });
    if (r.ok) {
      if (status) status(`OpenClaw CLI command worked: ${candidate}`);
      return r;
    }
    errors.push(`${candidate}: ${r.error || r.stderr || "failed"}`);
  }
  return {
    ok: false,
    command: "openclaw",
    stdout: "",
    stderr: "",
    error: errors.join(" | "),
  };
}

function pickConfigPathFromCliOutput(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const line of [...lines].reverse()) {
    const normalized = line.replace(/^["']|["']$/g, "");
    if (/[\\/]openclaw\.(json|json5|js|cjs|mjs)$/i.test(normalized)) return normalized;
    if (fsSync.existsSync(normalized)) return normalized;
  }
  return "";
}

function resolveOpenClawHome() {
  return path.resolve(String(process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw")));
}

function looksLikeOpenClawHome(home) {
  if (!home || !fsSync.existsSync(home)) return false;
  return ["agents", "skills", "memory", "extensions"].some((name) => {
    try {
      return fsSync.existsSync(path.join(home, name));
    } catch {
      return false;
    }
  });
}

function listDirNames(dir) {
  try {
    return fsSync.readdirSync(dir, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name);
  } catch {
    return [];
  }
}

function readJsonFileIfSafe(file) {
  const base = path.basename(file).toLowerCase();
  if (/(model|provider|credential|secret|token|key|auth)/i.test(base)) return null;
  try {
    const raw = fsSync.readFileSync(file, "utf8");
    if (raw.length > 500_000) return null;
    return parseJson5(raw);
  } catch {
    return null;
  }
}

function readSafeJsonConfigs(dir) {
  const merged = {};
  try {
    const files = fsSync.readdirSync(dir, { withFileTypes: true })
      .filter((item) => item.isFile() && /\.(json|json5)$/i.test(item.name))
      .map((item) => path.join(dir, item.name));
    for (const file of files) {
      const parsed = readJsonFileIfSafe(file);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(merged, deepMerge(merged, parsed));
      }
    }
  } catch {
    // best-effort directory import
  }
  return merged;
}

async function readOpenClawHomeConfig(home, status, signal = null) {
  assertNotAborted(signal);
  const agentsDir = path.join(home, "agents");
  const skillNames = listDirNames(path.join(home, "skills"));
  const agentNames = listDirNames(agentsDir);
  const list = [];
  for (const name of agentNames) {
    assertNotAborted(signal);
    const agentRoot = path.join(agentsDir, name);
    const agentConfigDir = path.join(agentRoot, "agent");
    const fromRoot = readSafeJsonConfigs(agentRoot);
    const fromAgentDir = readSafeJsonConfigs(agentConfigDir);
    list.push({
      id: name,
      name,
      default: name === "main" || list.length === 0,
      ...fromRoot,
      ...fromAgentDir,
    });
  }
  const memoryChunks = [];
  const memoryDir = path.join(home, "memory");
  for (const file of ["main.md", "memory.md"]) {
    const p = path.join(memoryDir, file);
    if (fsSync.existsSync(p)) memoryChunks.push(await fs.readFile(p, "utf8").catch(() => ""));
  }
  const sqliteMemoryPath = path.join(memoryDir, "main.sqlite");
  if (fsSync.existsSync(sqliteMemoryPath)) {
    status("Skipping OpenClaw sqlite memory index; only markdown memory files are imported.");
  }
  return {
    openClawHome: home,
    agents: {
      defaults: {
        skills: skillNames,
        systemPrompt: [
          "You are an OpenClaw agent migrated into Creez.",
          "Preserve the behavior implied by the migrated OpenClaw memory and skills.",
          "Use the migrated skills when they are relevant to the user's request.",
        ].join("\n"),
      },
      list: list.length ? list : [{ id: "main", name: "main", default: true }],
    },
    memory: uniq(memoryChunks).join("\n\n").trim(),
  };
}

async function resolveOpenClawSource(status) {
  status("Checking OpenClaw data directory.");
  const home = resolveOpenClawHome();
  if (looksLikeOpenClawHome(home)) {
    status(`OpenClaw data directory found: ${home}`);
    return { type: "home", home };
  }

  status("Checking for OpenClaw CLI.");
  const cli = await execOpenClaw(["config", "file"], status);
  if (cli.ok && cli.stdout) {
    const configPath = pickConfigPathFromCliOutput(cli.stdout);
    if (configPath) {
      status(`OpenClaw CLI found. Reported config path: ${configPath}`);
      return { type: "config", configPath };
    }
    status(`OpenClaw CLI responded but no config path was recognized. Output: ${cli.stdout.slice(0, 300)}`);
  } else {
    status(`OpenClaw CLI not available${cli.error ? ` (${cli.error})` : ""}.`);
  }

  status("Checking OPENCLAW_CONFIG_PATH.");
  const fromEnv = String(process.env.OPENCLAW_CONFIG_PATH || "").trim();
  if (fromEnv) {
    status(`OPENCLAW_CONFIG_PATH is set: ${fromEnv}`);
    return { type: "config", configPath: fromEnv };
  }

  const fallbackCandidates = [
    path.join(home, "openclaw.json"),
    path.join(home, "openclaw.json5"),
    path.join(home, "config.json"),
    path.join(home, "config.json5"),
  ];
  for (const fallback of fallbackCandidates) {
    status(`Checking default OpenClaw config path: ${fallback}`);
    if (fsSync.existsSync(fallback)) return { type: "config", configPath: fallback };
  }
  return { type: "missing", configPath: fallbackCandidates[0], home };
}

function assertNotAborted(signal) {
  if (signal?.aborted) {
    const e = new Error("OpenClaw import cancelled.");
    e.code = "CANCELLED";
    throw e;
  }
}

async function resolveOpenClawConfigPath(status) {
  status("Checking for OpenClaw CLI.");
  const cli = await execOpenClaw(["config", "file"], status);
  if (cli.ok && cli.stdout) {
    const configPath = pickConfigPathFromCliOutput(cli.stdout);
    if (configPath) {
      status(`OpenClaw CLI found. Reported config path: ${configPath}`);
      return configPath;
    }
    status(`OpenClaw CLI responded but no config path was recognized. Output: ${cli.stdout.slice(0, 300)}`);
  } else {
    status(`OpenClaw CLI not available${cli.error ? ` (${cli.error})` : ""}.`);
  }

  status("Checking OPENCLAW_CONFIG_PATH.");
  const fromEnv = String(process.env.OPENCLAW_CONFIG_PATH || "").trim();
  if (fromEnv) {
    status(`OPENCLAW_CONFIG_PATH is set: ${fromEnv}`);
    return fromEnv;
  }

  const fallbackCandidates = [
    path.join(os.homedir(), ".openclaw", "openclaw.json"),
    path.join(os.homedir(), ".openclaw", "openclaw.json5"),
    path.join(os.homedir(), ".openclaw", "config.json"),
    path.join(os.homedir(), ".openclaw", "config.json5"),
  ];
  for (const fallback of fallbackCandidates) {
    status(`Checking default OpenClaw config path: ${fallback}`);
    if (fsSync.existsSync(fallback)) return fallback;
  }
  return fallbackCandidates[0];
}

async function readConfigWithIncludes(configPath, status, seen = new Set(), signal = null) {
  assertNotAborted(signal);
  const abs = path.resolve(configPath);
  if (seen.has(abs)) throw new Error(`Circular OpenClaw $include detected: ${abs}`);
  seen.add(abs);
  const raw = await fs.readFile(abs, "utf8");
  const parsed = parseJson5(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const includes = parsed.$include;
  delete parsed.$include;
  const list = Array.isArray(includes) ? includes : includes ? [includes] : [];
  let merged = {};
  for (const item of list) {
    assertNotAborted(signal);
    const includePath = path.isAbsolute(String(item))
      ? String(item)
      : path.resolve(path.dirname(abs), String(item));
    status(`Reading included OpenClaw config: ${includePath}`);
    merged = deepMerge(merged, await readConfigWithIncludes(includePath, status, seen, signal));
  }
  return deepMerge(merged, parsed);
}

function deepMerge(a, b) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return b;
  if (!b || typeof b !== "object" || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) {
    out[key] = deepMerge(out[key], value);
  }
  return out;
}

function pickOpenClawAgent(config) {
  const agents = config?.agents && typeof config.agents === "object" ? config.agents : {};
  const list = Array.isArray(agents.list) ? agents.list : [];
  const picked = list.find((item) => item?.default) || list[0] || {};
  return {
    defaults: agents.defaults && typeof agents.defaults === "object" ? agents.defaults : {},
    agent: picked && typeof picked === "object" ? picked : {},
    agentCount: list.length,
  };
}

function buildSystemPrompt(defaults, agent) {
  const parts = [];
  pushText(parts, "OpenClaw Defaults Persona", defaults.systemPromptOverride || defaults.systemPrompt || defaults.persona || defaults.instructions);
  pushText(parts, "OpenClaw Agent Persona", agent.systemPromptOverride || agent.systemPrompt || agent.persona || agent.instructions || agent.prompt);
  pushText(parts, "OpenClaw Default Prompt Overlays", defaults.promptOverlays || defaults.prompt_overlays);
  pushText(parts, "OpenClaw Agent Prompt Overlays", agent.promptOverlays || agent.prompt_overlays);
  return uniq(parts).join("\n\n").trim();
}

function collectSkillRefs(defaults, agent, configDir) {
  const raw = [
    defaults.skills,
    defaults.skillPaths,
    defaults.skill_paths,
    agent.skills,
    agent.skillPaths,
    agent.skill_paths,
  ];
  const refs = [];
  for (const item of raw) {
    if (!item) continue;
    if (Array.isArray(item)) refs.push(...item);
    else if (typeof item === "object") refs.push(...Object.values(item));
    else refs.push(item);
  }
  return uniq(refs).map((ref) => {
    const s = String(ref).trim();
    let resolved = path.isAbsolute(s) ? s : path.resolve(configDir, s);
    if (!fsSync.existsSync(resolved) && !path.isAbsolute(s) && !s.includes("/") && !s.includes("\\")) {
      resolved = path.join(os.homedir(), ".openclaw", "skills", s);
    }
    return { raw: s, path: resolved };
  });
}

async function readMemoryCandidate(value, configDir) {
  if (!value) return "";
  if (typeof value === "string") {
    const maybePath = path.isAbsolute(value) ? value : path.resolve(configDir, value);
    if (fsSync.existsSync(maybePath) && fsSync.statSync(maybePath).isFile()) {
      return fs.readFile(maybePath, "utf8");
    }
    return value.trim();
  }
  if (Array.isArray(value)) {
    const chunks = [];
    for (const item of value) {
      const text = await readMemoryCandidate(item, configDir);
      if (text) chunks.push(text);
    }
    return chunks.join("\n\n");
  }
  if (typeof value === "object") {
    const direct = value.content || value.text || value.notes;
    if (direct) return readMemoryCandidate(direct, configDir);
    const file = value.path || value.file || value.memoryPath || value.memory_path;
    if (file) return readMemoryCandidate(String(file), configDir);
    return normalizeText(value);
  }
  return String(value).trim();
}

async function extractMemory(config, defaults, agent, configDir) {
  const chunks = [];
  for (const item of [config.memory, defaults.memory, agent.memory, agent.memories, agent.memoryPath, agent.memory_path]) {
    const text = await readMemoryCandidate(item, configDir);
    if (text) chunks.push(text);
  }
  return uniq(chunks).join("\n\n").trim();
}

async function copySkillRefs(skillRefs, targetSkillsDir, status, signal = null) {
  await fs.mkdir(targetSkillsDir, { recursive: true });
  const copied = [];
  const skipped = [];
  for (const ref of skillRefs) {
    assertNotAborted(signal);
    try {
      if (!fsSync.existsSync(ref.path)) {
        skipped.push({ source: ref.raw, reason: "not found" });
        status(`Skill skipped (not found): ${ref.raw}`);
        continue;
      }
      const stat = fsSync.statSync(ref.path);
      const base = safeFilename(path.basename(ref.path));
      const target = path.join(targetSkillsDir, base);
      if (stat.isDirectory()) {
        await fs.cp(ref.path, target, { recursive: true, force: true });
      } else if (stat.isFile()) {
        await fs.mkdir(path.join(targetSkillsDir, base.replace(/\.[^.]+$/, "")), { recursive: true });
        await fs.copyFile(ref.path, path.join(targetSkillsDir, base.replace(/\.[^.]+$/, ""), path.basename(ref.path)));
      } else {
        skipped.push({ source: ref.raw, reason: "not a file or directory" });
        continue;
      }
      copied.push({ source: ref.raw, target });
      status(`Copied skill: ${ref.raw}`);
    } catch (e) {
      skipped.push({ source: ref.raw, reason: e?.message || String(e) });
      status(`Skill copy failed: ${ref.raw}`);
    }
  }
  return { copied, skipped };
}


function deriveLocalName(agent, systemPrompt) {
  const raw = agent.name || agent.displayName || agent.display_name || agent.id || "";
  const fromConfig = String(raw || "").trim();
  if (fromConfig) return fromConfig.slice(0, 60);
  const firstLine = String(systemPrompt || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  const match = firstLine.match(/(?:you are|\u4f60\u662f)\s+([^,.\uff0c\u3002\uff1a:]{2,40})/i);
  if (match?.[1]) return match[1].trim().slice(0, 40);
  return "OpenClaw Agent";
}

function deriveLocalGreeting(name, systemPrompt) {
  const s = String(systemPrompt || "").toLowerCase();
  if (s.includes("invest") || s.includes("vc") || s.includes("\u878d\u8d44")) {
    return `\u4f60\u597d\uff0c\u6211\u662f ${name}\u3002\u53ef\u4ee5\u548c\u6211\u804a\u804a\u4f60\u7684\u9879\u76ee\u3001\u878d\u8d44\u8ba1\u5212\u6216\u6295\u8d44\u5224\u65ad\u3002`;
  }
  return `\u4f60\u597d\uff0c\u6211\u662f ${name}\u3002\u6211\u5df2\u7ecf\u4ece OpenClaw \u8fc1\u79fb\u8fc7\u6765\uff0c\u53ef\u4ee5\u7ee7\u7eed\u5e2e\u4f60\u5904\u7406\u76f8\u5173\u4efb\u52a1\u3002`;
}

async function generateNameAndGreeting({ agent, systemPrompt, memory, defaultConfig, status, signal = null }) {
  assertNotAborted(signal);
  const fallbackName = deriveLocalName(agent, systemPrompt);
  const fallbackGreeting = deriveLocalGreeting(fallbackName, systemPrompt);
  const hasName = Boolean(String(agent.name || agent.displayName || agent.display_name || "").trim());
  const hasGreeting = Boolean(String(agent.greetingMessage || agent.greeting_message || agent.greeting || "").trim());
  if (hasName && hasGreeting) {
    return {
      name: String(agent.name || agent.displayName || agent.display_name).trim(),
      greetingMessage: String(agent.greetingMessage || agent.greeting_message || agent.greeting).trim(),
      generated: false,
    };
  }

  // Runtime LLM generation is best-effort. If no compatible key is available,
  // deterministic local generation keeps the import offline and predictable.
  const active = Array.isArray(defaultConfig?.models) ? defaultConfig.models.find((m) => m?.active) || defaultConfig.models[0] : null;
  if (!active?.apiKey || !active?.model) {
    status("No default model API key available; generated name and greeting locally.");
    return {
      name: hasName ? String(agent.name || agent.displayName || agent.display_name).trim() : fallbackName,
      greetingMessage: hasGreeting ? String(agent.greetingMessage || agent.greeting_message || agent.greeting).trim() : fallbackGreeting,
      generated: true,
    };
  }

  // Keep this intentionally provider-limited; unsupported providers fall back.
  const provider = String(active.provider || "").toLowerCase();
  const base =
    active.apiBase ||
    (provider === "openrouter" ? "https://openrouter.ai/api/v1" : "") ||
    (provider === "openai" ? "https://api.openai.com/v1" : "") ||
    (provider === "deepseek" ? "https://api.deepseek.com/v1" : "");
  if (!base) {
    status("Default model provider is not OpenAI-compatible; generated name and greeting locally.");
    return {
      name: hasName ? String(agent.name || agent.displayName || agent.display_name).trim() : fallbackName,
      greetingMessage: hasGreeting ? String(agent.greetingMessage || agent.greeting_message || agent.greeting).trim() : fallbackGreeting,
      generated: true,
    };
  }

  try {
    assertNotAborted(signal);
    status("Generating missing name/greeting with the default model.");
    const prompt = [
      "Return strict JSON only: {\"name\":\"...\",\"greeting_message\":\"...\"}.",
      "Generate a concise bot display name and a short Chinese greeting.",
      "Preserve the persona implied by the source prompt and memory.",
      `System prompt:\n${String(systemPrompt || "").slice(0, 6000)}`,
      `Memory:\n${String(memory || "").slice(0, 2000)}`,
    ].join("\n\n");
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (signal) signal.addEventListener("abort", abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${active.apiKey}`,
        },
        body: JSON.stringify({
          model: active.model,
          temperature: 0.2,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortFromParent);
    }
    assertNotAborted(signal);
    const body = await res.json().catch(() => null);
    const content = body?.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(String(content).replace(/^```json\s*|\s*```$/g, "").trim());
    const name = hasName ? String(agent.name || agent.displayName || agent.display_name).trim() : String(parsed.name || fallbackName).trim();
    const greetingMessage = hasGreeting
      ? String(agent.greetingMessage || agent.greeting_message || agent.greeting).trim()
      : String(parsed.greeting_message || fallbackGreeting).trim();
    return { name: name.slice(0, 80), greetingMessage: greetingMessage.slice(0, 240), generated: true };
  } catch (e) {
    status(`Model generation failed; generated locally: ${e?.message || String(e)}`);
    return {
      name: hasName ? String(agent.name || agent.displayName || agent.display_name).trim() : fallbackName,
      greetingMessage: hasGreeting ? String(agent.greetingMessage || agent.greeting_message || agent.greeting).trim() : fallbackGreeting,
      generated: true,
    };
  }
}

module.exports = {
  resolveOpenClawSource,
  resolveOpenClawConfigPath,
  readOpenClawHomeConfig,
  readConfigWithIncludes,
  pickOpenClawAgent,
  buildSystemPrompt,
  collectSkillRefs,
  extractMemory,
  copySkillRefs,
  generateNameAndGreeting,
};
