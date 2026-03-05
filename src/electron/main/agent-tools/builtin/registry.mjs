import { createRequire } from "node:module";
import { Type } from "@sinclair/typebox";
import { createKnowledgeSearchHandler } from "./handlers/knowledgeSearchHandler.mjs";
import { createVcLeadCaptureHandler } from "./handlers/vcLeadCaptureHandler.mjs";
import { scheduledTaskHandler } from "./handlers/scheduledTaskHandler.mjs";

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

function isScheduledTaskEnabled(runtimeContext = {}) {
  const assistantConfigId = runtimeContext?.assistantConfigId;
  const defaultContactId = runtimeContext?.defaultContactId;
  if (assistantConfigId == null || defaultContactId == null) return false;
  return String(assistantConfigId) === String(defaultContactId);
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

  definitions.set("scheduled_task", {
    id: "scheduled_task",
    label: "Scheduled Task",
    description:
      "Manage recurring scheduled tasks for the default bot in this chat: list existing tasks, create a new one (cron + prompt), or delete by task id. Choose 'action' from list/create/delete based on user intent and supply the corresponding parameters.",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("list"),
          Type.Literal("create"),
          Type.Literal("delete"),
        ],
        { description: "Operation: 'list' to show tasks in this chat; 'create' to add one (requires cron_expression and task_prompt); 'delete' to remove one (requires task_id from a prior list)." }
      ),
      task_id: Type.Optional(Type.String({ description: "Required when action is 'delete'. Task id from a previous list result." })),
      cron_expression: Type.Optional(Type.String({ description: "Required when action is 'create'. Standard 5-field cron, e.g. '0 8 * * *' for 8:00 daily." })),
      task_prompt: Type.Optional(Type.String({ description: "Required when action is 'create'. Instruction sent to the agent at each run." })),
    }),
    isEnabled: isScheduledTaskEnabled,
    createHandler: scheduledTaskHandler,
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
