const os = require("node:os");
const path = require("node:path");

const READ_ONLY_SCENARIOS = new Set([
  "default",
  "remote_user",
  "a2a_agent",
  "auto_discovery",
  "headless",
  "summary",
  "channel",
]);

const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  "auth.json",
  "credentials",
  "credentials.json",
  "known_hosts",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

const SENSITIVE_DIR_SEGMENTS = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".docker",
  ".kube",
  "keychains",
  "cookies",
]);

const SENSITIVE_EXTENSIONS = new Set([
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  ".crt",
  ".cer",
]);

function toPlatformBackend(platform = process.platform) {
  if (platform === "win32") return "windows-native";
  if (platform === "darwin") return "macos-seatbelt";
  return "linux-bwrap";
}

function normalizePath(p) {
  return path.resolve(String(p || ""));
}

function isSubPath(rootPath, targetPath) {
  const root = normalizePath(rootPath);
  const target = normalizePath(targetPath);
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSensitivePath(targetPath) {
  const resolved = normalizePath(targetPath);
  const basename = path.basename(resolved).toLowerCase();
  if (SENSITIVE_BASENAMES.has(basename)) return true;
  if (SENSITIVE_EXTENSIONS.has(path.extname(basename).toLowerCase())) return true;
  const segments = resolved
    .split(path.sep)
    .map((segment) => segment.toLowerCase())
    .filter(Boolean);
  return segments.some((segment) => SENSITIVE_DIR_SEGMENTS.has(segment));
}

function createSandboxPolicy({
  scenario,
  isExternalUser,
  workDir,
  agentDir,
  platform = process.platform,
  requestApproval,
} = {}) {
  const normalizedScenario = String(scenario || "").trim();
  const mode = isExternalUser || READ_ONLY_SCENARIOS.has(normalizedScenario)
    ? "read-only"
    : "workspace-write";
  const hostWriteThrough = mode === "workspace-write" && normalizedScenario === "default_assistant";
  const root = normalizePath(workDir || process.cwd());
  const writableRoots = mode === "workspace-write" ? [root] : [];
  const readableRoots = [root];
  if (!isExternalUser && agentDir) {
    readableRoots.push(normalizePath(path.join(agentDir, "skills")));
  }

  return Object.freeze({
    mode,
    scenario: normalizedScenario || "unknown",
    backend: toPlatformBackend(platform),
    workDir: root,
    agentDir: agentDir ? normalizePath(agentDir) : "",
    readableRoots,
    writableRoots,
    networkAccess: false,
    allowBash: mode === "workspace-write",
    allowWrite: mode === "workspace-write",
    allowDelete: false,
    hostWriteThrough,
    envMode: "minimal",
    requestApproval: typeof requestApproval === "function" ? requestApproval : null,
  });
}

function explainPolicy(policy) {
  return `${policy.mode} via ${policy.backend}`;
}

module.exports = {
  createSandboxPolicy,
  explainPolicy,
  isSensitivePath,
  isSubPath,
  normalizePath,
  SENSITIVE_BASENAMES,
};
