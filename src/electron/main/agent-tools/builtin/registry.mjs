import { createRequire } from "node:module";
import { Type } from "@sinclair/typebox";
import { createKnowledgeSearchHandler } from "./handlers/knowledgeSearchHandler.mjs";
import { createVcLeadCaptureHandler } from "./handlers/vcLeadCaptureHandler.mjs";
import { scheduledTaskHandler } from "./handlers/scheduledTaskHandler.mjs";
import { createWebFetchHandler } from "./handlers/webFetchHandler.mjs";
import { createImageGeneratorHandler } from "./handlers/imageGeneratorHandler.mjs";
import { createVideoGeneratorHandler } from "./handlers/videoGeneratorHandler.mjs";
import { createChannelSendHandler } from "./handlers/channelSendHandler.mjs";
import { createGmailHandler } from "./handlers/gmailHandler.mjs";

const require = createRequire(import.meta.url);
const { BUILTIN_SKILL_IDS } = require("../../builtinSkillIds.cjs");

function isDefaultBot(runtimeContext = {}) {
  const { assistantConfigId, defaultContactId } = runtimeContext;
  if (assistantConfigId == null || defaultContactId == null) return false;
  return String(assistantConfigId) === String(defaultContactId);
}

function isNonDefaultBot(runtimeContext = {}) {
  const { assistantConfigId, defaultContactId } = runtimeContext;
  if (assistantConfigId == null || defaultContactId == null) return false;
  return String(assistantConfigId) !== String(defaultContactId);
}

function isKnowledgeSearchEnabled(runtimeContext = {}) {
  const allowDefault = String(process.env.CREEZ_ENABLE_DEFAULT_BOT_KNOWLEDGE || "") === "1";
  if (allowDefault) return true;
  return isNonDefaultBot(runtimeContext);
}

function isVcLeadCaptureEnabled(runtimeContext = {}) {
  return isNonDefaultBot(runtimeContext);
}

function isScheduledTaskEnabled(runtimeContext = {}) {
  return isDefaultBot(runtimeContext);
}

/** web_fetch / image_generator / video_generator / channel_send — default and non-default bots (not gated by skills_json). */
function isDefaultBotToolEnabled(runtimeContext = {}) {
  return isDefaultBot(runtimeContext) || isNonDefaultBot(runtimeContext);
}

function isGmailEnabled(runtimeContext = {}) {
  if (runtimeContext.isExternalUser) return false;
  return isDefaultBotToolEnabled(runtimeContext);
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

  definitions.set("web_fetch", {
    id: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and extract readable content from a URL (HTML pages, JSON APIs, plain text). Returns text content with metadata. Use for lightweight page access.",
    parameters: Type.Object({
      url: Type.String({ description: "HTTP or HTTPS URL to fetch." }),
      extractMode: Type.Optional(
        Type.Union([Type.Literal("markdown"), Type.Literal("text")], {
          description: 'Extraction mode: "markdown" or "text". Default "text".',
        }),
      ),
      maxChars: Type.Optional(
        Type.Integer({ minimum: 100, maximum: 50000, description: "Max characters to return (default 50000)." }),
      ),
    }),
    isEnabled: isDefaultBotToolEnabled,
    createHandler: createWebFetchHandler,
  });

  definitions.set("image_generator", {
    id: "image_generator",
    label: "Image Generator",
    description:
      "Generate images from a text prompt via Creez backend. Returns image URLs. Use when user asks for image generation or the task requires creating images.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Text description of the image to generate." }),
      ratio: Type.Optional(Type.String({ description: 'Aspect ratio, e.g. "16:9", "1:1". Default "16:9".' })),
      numImages: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Number of images to generate (1-10, default 1)." })),
      enableWebSearch: Type.Optional(Type.Boolean({ description: "Enable web search to enhance prompt. Default false." })),
      referenceImagePaths: Type.Optional(
        Type.Array(Type.String(), {
          maxItems: 5,
          description:
            "Optional reference images (max 5). Each: workspace-relative or absolute file path, file:// URL, https URL, or data:image/...;base64,... . Loaded locally or fetched, then sent as base64 to the backend.",
        }),
      ),
    }),
    isEnabled: isDefaultBotToolEnabled,
    createHandler: createImageGeneratorHandler,
  });

  definitions.set("video_generator", {
    id: "video_generator",
    label: "Video Generator",
    description:
      "Generate a short video from a start frame image (and optional end frame) with a motion prompt. Returns video URL. Use when user asks for video generation.",
    parameters: Type.Object({
      startFrameUrl: Type.Optional(Type.String({ description: "URL of the first frame image (required unless keyframes provided)." })),
      endFrameUrl: Type.Optional(Type.String({ description: "URL of the last frame image (optional)." })),
      keyframes: Type.Optional(Type.Array(Type.String(), { description: "Array of frame URLs; first = start, last = end." })),
      prompt: Type.Optional(Type.String({ description: "Motion/action description for the video." })),
      duration: Type.Optional(Type.String({ description: 'Video duration in seconds, e.g. "5", "10". Default "5".' })),
      ratio: Type.Optional(Type.String({ description: 'Aspect ratio, e.g. "16:9", "adaptive". Default "adaptive".' })),
      wait: Type.Optional(Type.Boolean({ description: "Wait for generation to complete. Default true." })),
    }),
    isEnabled: isDefaultBotToolEnabled,
    createHandler: createVideoGeneratorHandler,
  });

  definitions.set("channel_send", {
    id: "channel_send",
    label: "Channel Send",
    description:
      "Send a message to an external channel by user request. When the user says to send something to Feishu (飞书), e.g. '通过飞书发送xxx', '发送xxx给飞书', use channel 'feishu'. When the user says to send something to WeCom (企业微信/企微), e.g. '通过企微发送xxx', '发送xxx给企业微信', use channel 'wecom'. Target recipient is read from channel config automatically.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel to send to. Use 'feishu' for Feishu / 飞书, 'wecom' for WeCom / 企业微信 / 企微." }),
      content: Type.String({ description: "The message text to send." }),
    }),
    isEnabled: isDefaultBotToolEnabled,
    createHandler: createChannelSendHandler,
  });

  definitions.set("gmail", {
    id: "gmail",
    label: "Gmail",
    description:
      "Use or connect the user's Gmail account. When the user asks to connect/link Gmail, call action='connect'. Supports action='status' to check connection, action='list' to search/list messages, action='read' to read a message by id, and action='send' to send an email. Sending email requires user confirmation.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("connect"), Type.Literal("status"), Type.Literal("list"), Type.Literal("read"), Type.Literal("send")], {
        description: "Operation: connect, status, list, read, or send.",
      }),
      query: Type.Optional(Type.String({ description: "Gmail search query for action=list, e.g. from:a@example.com newer_than:7d." })),
      maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Max messages for action=list. Default 10." })),
      pageToken: Type.Optional(Type.String({ description: "Optional Gmail list pagination token." })),
      id: Type.Optional(Type.String({ description: "Message id for action=read." })),
      messageId: Type.Optional(Type.String({ description: "Alias for id when action=read." })),
      maxChars: Type.Optional(Type.Integer({ minimum: 1000, maximum: 50000, description: "Max body characters for action=read." })),
      to: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "Recipient(s) for action=send." })),
      cc: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "Cc recipient(s) for action=send." })),
      bcc: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "Bcc recipient(s) for action=send." })),
      subject: Type.Optional(Type.String({ description: "Email subject for action=send." })),
      body: Type.Optional(Type.String({ description: "Plain-text email body for action=send." })),
    }),
    isEnabled: isGmailEnabled,
    createHandler: createGmailHandler,
  });

  return {
    builtinSkillIds: BUILTIN_SKILL_IDS,
    get(skillId) {
      return definitions.get(skillId);
    },
    listEnabled(runtimeContext = {}) {
      const allowedIds = runtimeContext.allowedBuiltinIds;
      if (allowedIds != null) {
        const set = allowedIds instanceof Set ? allowedIds : new Set(Array.isArray(allowedIds) ? allowedIds : []);
        return [...definitions.values()].filter((d) => set.has(d.id));
      }
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
