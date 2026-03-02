/**
 * Ensures assistant_config.skills_json only stores file skills.
 * - Adds missing bundled file skills as false (for settings UI consistency)
 * - Removes builtin skill ids from DB-stored skills_json (approach #1)
 *
 * Call once at app startup after SkillManager and AssistantConfigRepository are ready.
 */

const { stripBuiltinSkillFlags } = require("./builtinSkillIds.cjs");

/**
 * @param {{ listAvailableSkills: () => Promise<Array<{ id: string }>> }} skillManager
 * @param {{ getRawConfigById: (id: string) => any, saveConfigById: (id: string, patch: object) => any }} assistantConfigRepository
 * @param {string} defaultContactId - Default bot contact id (config id = contact id)
 * @returns {Promise<boolean>} true if config was updated
 */
async function ensureBundledSkillsInConfig(skillManager, assistantConfigRepository, defaultContactId) {
  if (!skillManager || typeof skillManager.listAvailableSkills !== "function") return false;
  if (!assistantConfigRepository || typeof assistantConfigRepository.getRawConfigById !== "function") return false;
  if (!defaultContactId || typeof defaultContactId !== "string") return false;

  const available = await skillManager.listAvailableSkills();
  const skillIds = available.map((s) => s.id).filter(Boolean);
  if (skillIds.length === 0) return false;

  const raw = assistantConfigRepository.getRawConfigById(defaultContactId);
  const currentRaw = raw?.skills && typeof raw.skills === "object" ? raw.skills : {};
  const current = stripBuiltinSkillFlags(currentRaw);
  const next = { ...current };
  let changed = JSON.stringify(currentRaw) !== JSON.stringify(current);
  for (const id of skillIds) {
    if (next[id] === undefined) {
      next[id] = false;
      changed = true;
    }
  }
  if (!changed) return false;

  assistantConfigRepository.saveConfigById(defaultContactId, { skills: next });
  return true;
}

module.exports = {
  ensureBundledSkillsInConfig,
};
