const BUILTIN_SKILL_IDS = Object.freeze([
  "knowledge_search",
  "vc_lead_capture",
  "scheduled_task",
  "web_fetch",
  "image_generator",
  "video_generator",
  "channel_send",
  "gmail",
]);

function isBuiltinSkillId(skillId) {
  if (!skillId || typeof skillId !== "string") return false;
  return BUILTIN_SKILL_IDS.includes(skillId.trim());
}

function stripBuiltinSkillFlags(skillsMap) {
  if (!skillsMap || typeof skillsMap !== "object") return {};
  const next = {};
  for (const [id, enabled] of Object.entries(skillsMap)) {
    if (isBuiltinSkillId(id)) continue;
    next[id] = Boolean(enabled);
  }
  return next;
}

module.exports = {
  BUILTIN_SKILL_IDS,
  isBuiltinSkillId,
  stripBuiltinSkillFlags,
};
