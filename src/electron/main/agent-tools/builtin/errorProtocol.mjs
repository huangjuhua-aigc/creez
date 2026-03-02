const PROTOCOL_VERSION = "creez.builtin-skill.error.v1";

function buildErrorEnvelope({
  toolName,
  code,
  message,
  retryable = false,
  nextAction = "",
  details = {},
} = {}) {
  return {
    ok: false,
    protocol: PROTOCOL_VERSION,
    toolName: String(toolName || ""),
    error: {
      code: String(code || "BUILTIN_SKILL_ERROR"),
      message: String(message || "Unknown builtin skill error."),
      retryable: Boolean(retryable),
      nextAction: String(nextAction || ""),
      details: details && typeof details === "object" ? details : {},
    },
  };
}

function buildSuccessEnvelope({ toolName, data = {} } = {}) {
  return {
    ok: true,
    protocol: PROTOCOL_VERSION,
    toolName: String(toolName || ""),
    data: data && typeof data === "object" ? data : {},
  };
}

function asTextEnvelope(envelope, title) {
  const prefix = envelope?.ok ? "BUILTIN_SKILL_OK" : "BUILTIN_SKILL_ERROR";
  const header = title ? `${prefix}: ${title}` : prefix;
  return `${header}\n${JSON.stringify(envelope, null, 2)}`;
}

export {
  PROTOCOL_VERSION,
  asTextEnvelope,
  buildErrorEnvelope,
  buildSuccessEnvelope,
};
