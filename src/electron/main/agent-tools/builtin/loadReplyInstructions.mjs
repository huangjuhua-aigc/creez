/**
 * Load reply_instruction from each built-in skill's SKILL.md frontmatter.
 * Returns a map skillId -> string (empty string if missing or parse fails).
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Extract reply_instruction from YAML-like frontmatter (between --- and ---).
 * Supports: reply_instruction: "value" | 'value' | value
 */
function parseReplyInstructionFromFrontmatter(text) {
  if (!text || typeof text !== "string") return "";
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return "";
  const block = match[1];
  const lineMatch = block.match(/reply_instruction\s*:\s*(.+?)(?=\r?\n[A-Za-z_#]|\r?\n---|$)/s);
  if (!lineMatch) return "";
  let value = lineMatch[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return value.trim();
}

/**
 * @param {string} builtinSkillPath - e.g. path.join(APP_ROOT, "skills", "builtin", "skills")
 * @param {string[]} skillIds - e.g. ["knowledge_search"]
 * @returns {Record<string, string>} skillId -> reply_instruction (empty string if none)
 */
export function loadBuiltinReplyInstructions(builtinSkillPath, skillIds) {
  const out = {};
  if (!builtinSkillPath || !Array.isArray(skillIds)) return out;
  for (const id of skillIds) {
    if (!id || typeof id !== "string") continue;
    const skillMd = path.join(builtinSkillPath, id.trim(), "SKILL.md");
    try {
      const raw = fs.readFileSync(skillMd, "utf8");
      const instruction = parseReplyInstructionFromFrontmatter(raw);
      out[id.trim()] = instruction || "";
    } catch {
      out[id.trim()] = "";
    }
  }
  return out;
}
