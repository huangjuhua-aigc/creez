/**
 * Single Creez backend HTTP origin (no trailing slash).
 * Used for: A2A Gateway, sync pull, Agent Builder API, remote agent config,
 * knowledge search, VC lead capture, etc.
 *
 * Set env: CREEZ_A2A_GATEWAY_BASE=http://localhost:3000
 */

const DEFAULT_CREEZ_BACKEND_BASE = "https://creez.lighton.video";

function resolveCreezBackendBase() {
  const raw = String(process.env.CREEZ_A2A_GATEWAY_BASE || "").trim();
  if (!raw) return DEFAULT_CREEZ_BACKEND_BASE;
  return raw.replace(/\/+$/, "");
}

module.exports = {
  DEFAULT_CREEZ_BACKEND_BASE,
  resolveCreezBackendBase,
};
