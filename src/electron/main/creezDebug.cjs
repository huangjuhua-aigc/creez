/**
 * Verbose dev logging (agent timing, full prompts/replies, stream-debug, backend fetch traces).
 * Default off. Set CREEZ_DEBUG_VERBOSE=1 (or true) when debugging.
 *
 * Unrelated: CREEZ_DEBUG=1 (index.cjs) opens DevTools; CREEZ_DEBUG_FULL_SYSTEM_PROMPT=1 (agent-runner)
 * logs one-line system prompt JSON only.
 */
function isCreezVerboseDebug() {
  const v = process.env.CREEZ_DEBUG_VERBOSE;
  return v === "1" || String(v).toLowerCase() === "true";
}

module.exports = { isCreezVerboseDebug };
