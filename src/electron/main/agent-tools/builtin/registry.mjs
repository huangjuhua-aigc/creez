import { createRequire } from "node:module";
import { Type } from "@sinclair/typebox";
import { createKnowledgeSearchHandler } from "./handlers/knowledgeSearchHandler.mjs";
import { createVcLeadCaptureHandler } from "./handlers/vcLeadCaptureHandler.mjs";

const require = createRequire(import.meta.url);
const { BUILTIN_SKILL_IDS } = require("../../builtinSkillIds.cjs");

function isKnowledgeSearchEnabled(runtimeContext = {}) {
  const allowDefault = String(process.env.CREEZ_ENABLE_DEFAULT_BOT_KNOWLEDGE || "") === "1";
  const assistantConfigId = runtimeContext?.assistantConfigId;
  const defaultContactId = runtimeContext?.defaultContactId;
  if (allowDefault) return true;
  if (assistantConfigId == null || defaultContactId == null) return false;
  return String(assistantConfigId) !== String(defaultContactId);
}

function isVcLeadCaptureEnabled(runtimeContext = {}) {
  const assistantConfigId = runtimeContext?.assistantConfigId;
  const defaultContactId = runtimeContext?.defaultContactId;
  if (assistantConfigId == null || defaultContactId == null) return false;
  return String(assistantConfigId) !== String(defaultContactId);
}

function createBuiltinSkillRegistry() {
  const definitions = new Map();

  definitions.set("knowledge_search", {
    id: "knowledge_search",
    label: "Knowledge Search",
    description: "Search bot-scoped knowledge snippets for factual answers.",
    parameters: Type.Object({
      query: Type.String({ description: "Question or fact query to search in bot knowledge base." }),
      topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Max snippets to retrieve (default 5)." })),
    }),
    isEnabled: isKnowledgeSearchEnabled,
    createHandler: createKnowledgeSearchHandler,
  });

  definitions.set("vc_lead_capture", {
    id: "vc_lead_capture",
    label: "VC Lead Capture",
    description: "Submit user contact info to product owner when user is a serious VC lead (after substantive conversation or explicit meeting request). Call only when contact (name + email or wechat) is already collected.",
    parameters: Type.Object({
      name: Type.String({ description: "User's full name or how they want to be called." }),
      email: Type.Optional(Type.String({ description: "User's email address." })),
      company: Type.Optional(Type.String({ description: "Company or fund name." })),
      wechat: Type.Optional(Type.String({ description: "WeChat ID." })),
      message: Type.Optional(Type.String({ description: "Short note, availability, or reason for contact." })),
    }),
    isEnabled: isVcLeadCaptureEnabled,
    createHandler: createVcLeadCaptureHandler,
  });

  return {
    builtinSkillIds: BUILTIN_SKILL_IDS,
    get(skillId) {
      return definitions.get(skillId);
    },
    listEnabled(runtimeContext = {}) {
      const out = [];
      for (const definition of definitions.values()) {
        if (typeof definition.isEnabled !== "function" || definition.isEnabled(runtimeContext)) {
          out.push(definition);
        }
      }
      return out;
    },
  };
}

export { createBuiltinSkillRegistry };
