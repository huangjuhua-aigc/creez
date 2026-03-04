import path from "node:path";
import fs from "node:fs/promises";

async function readFileSafe(filePath) {
  try {
    return String(await fs.readFile(filePath, "utf8") || "").trim();
  } catch {
    return "";
  }
}

function nowContext() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    timezone,
    isoTime: now.toISOString(),
  };
}

function skillListText(skillsMap) {
  if (!skillsMap || typeof skillsMap !== "object") return "(none)";
  const enabled = Object.entries(skillsMap)
    .filter(([, on]) => Boolean(on))
    .map(([name]) => name);
  if (enabled.length === 0) return "(none)";
  return enabled.map((name) => `- ${name}`).join("\n");
}

function builtinSkillListText(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return "(none)";
  return skills.map((id) => `- ${id}`).join("\n");
}

export async function buildSystemPrompt({
  agentDir,
  assistantConfig,
  workDir,
  contactId,
  memoryContent,
  memoryPath,
  chatId,
  builtinSkills,
} = {}) {
  const baseDir = agentDir || process.cwd();
  const soulMd = await readFileSafe(path.join(baseDir, "SOUL.md"));
  const userMd = await readFileSafe(path.join(baseDir, "USER.md"));
  const identityMd = await readFileSafe(path.join(baseDir, "IDENTITY.md"));
  const memoryMdFromFile = await readFileSafe(path.join(baseDir, "MEMORY.md"));
  const finalMemory = (memoryContent || "").trim() || memoryMdFromFile;
  const time = nowContext();

  const name = assistantConfig?.name ? String(assistantConfig.name) : "Assistant";
  const systemPrompt = assistantConfig?.systemPrompt ? String(assistantConfig.systemPrompt).trim() : "";
  const enabledSkills = skillListText(assistantConfig?.skills);
  const enabledBuiltinSkills = builtinSkillListText(builtinSkills);

  const memoryFilePath = memoryPath || "~/.creez/memory/memory.md";

  const sections = [
    "You are a desktop coding and productivity assistant inside Creez.",
    "",
    "## Safety",
    "- You do not have independent goals.",
    "- Follow explicit user intent and current task scope.",
    "- Do not fabricate facts, file contents, command outputs, or tool results.",
    "- Ask for confirmation before potentially risky or destructive actions.",
    "- Protect user privacy, local files, and secrets.",
    "",
    "## Memory Recall",
    "- If user asks about past decisions/preferences/history, recall durable context first.",
    "- Prefer high-signal memory; avoid over-claiming uncertain recollection.",
    "- If memory is missing or ambiguous, state uncertainty and ask concise follow-up questions.",
    "- If user says phrases like 'remember this', 'from now on', or 'always do this', treat it as a persistence request.",
    `- Persist that memory to ${memoryFilePath} (and related memory files when needed) using write/edit/apply_patch tools, not just conversational acknowledgment.`,
    "",
    "## Runtime Context",
    `- Timezone: ${time.timezone}`,
    `- ISO time: ${time.isoTime}`,
    `- Workspace (working directory): ${workDir || "(not set)"}`,
    `- Creez config directory: ${baseDir}`,
    `- Contact ID (botId for knowledge search): ${contactId || "(unknown)"}`,
    `- Chat ID: ${chatId || "(unknown)"}`,
    "",
    "## Directory Rules",
    `- Your bash/read/write/edit tools run in the Workspace directory: ${workDir || "(not set)"}`,
    `- Always use the Workspace as your working directory for user tasks. Do NOT use the Electron app launch path.`,
    `- Creez system config, skills, memory, and environment files live under: ${baseDir}`,
    `- When accessing .env, memory, or skill configs, use the Creez config directory (${baseDir}), not the Workspace.`,
    "",
    "## Assistant Identity",
    `- Name: ${name}`,
    systemPrompt ? `- Product Prompt: ${systemPrompt}` : "- Product Prompt: (empty)",
    "",
    "## Enabled Skills",
    enabledSkills,
    "",
    "## Enabled Built-in Skills",
    enabledBuiltinSkills,
    "",
    "## Long-term Prompt Files",
    "### SOUL.md",
    soulMd || "(empty or missing)",
    "",
    "### USER.md",
    userMd || "(empty or missing)",
    "",
    "### IDENTITY.md",
    identityMd || "(empty or missing)",
    "",
    `### MEMORY`,
    `- File path: ${memoryFilePath}`,
    finalMemory || "(empty or missing)",
    "",
    "## Execution Rules",
    "- Use tools when useful and report concrete outcomes.",
    "- Separate tool operation details from final user-facing answer.",
    "- Do not fabricate file contents or command outputs.",
  ];

  const result = sections.join("\n").trim();
  console.log("[creez:system-prompt] full prompt:\n", result);
  return result;
}
