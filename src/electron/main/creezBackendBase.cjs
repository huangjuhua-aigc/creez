/**
 * Single Creez backend HTTP origin (no trailing slash).
 * Used for: A2A Gateway, sync pull, Agent Builder API, remote agent config,
 * knowledge search, VC lead capture, etc.
 *
 * Override with env (either name):
 *   CREEZ_A2A_GATEWAY_BASE=https://your-host
 *   CREEZ_BACKEND_URL=https://your-host
 */

const DEFAULT_CREEZ_BACKEND_BASE = "https://creez.lighton.video";

function resolveCreezBackendBase() {
  const raw = String(
    process.env.CREEZ_A2A_GATEWAY_BASE || process.env.CREEZ_BACKEND_URL || ""
  ).trim();
  if (!raw) return DEFAULT_CREEZ_BACKEND_BASE;
  return raw.replace(/\/+$/, "");
}

module.exports = {
  DEFAULT_CREEZ_BACKEND_BASE,
  resolveCreezBackendBase,
};
