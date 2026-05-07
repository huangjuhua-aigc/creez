const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { isSensitivePath, isSubPath, normalizePath } = require("./sandboxPolicy.cjs");

const SECRET_ENV_PATTERN = /(KEY|SECRET|TOKEN|PASSWORD|PASS|COOKIE|CREDENTIAL|AUTH|SESSION)/i;

const DELETE_COMMAND_PATTERNS = [
  /\bRemove-Item\b[\s\S]+/i,
  /\bRemove-ItemProperty\b[\s\S]+/i,
  /\bgit\s+clean\b/i,
];

const DANGEROUS_COMMAND_PATTERNS = [
  ...DELETE_COMMAND_PATTERNS,
  /\bformat\b/i,
  /\bdiskpart\b/i,
  /\breg\s+(?:add|delete|import)\b/i,
  /\bchmod\s+(?:-R|777)\b/i,
  /\bchown\s+-R\b/i,
  /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[\s\S]*(?:\|\s*(?:sh|bash|powershell)|-o\s+-)/i,
  /\b(?:scp|sftp|ssh|rsync)\b/i,
];

const NETWORK_COMMAND_PATTERNS = [
  /\b(?:curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm|ssh|scp|sftp|rsync|nc|netcat)\b/i,
];

const FILE_MUTATION_COMMAND_PATTERNS = [
  /\b(?:mkdir|md|copy|xcopy|robocopy|move|ren|rename)\b/i,
  /\b(?:New-Item|Set-Content|Add-Content|Out-File|Copy-Item|Move-Item)\b/i,
  /(^|[^<])>>?[^>&]/,
];

const DELETE_COMMAND_NAMES = new Set(["rm", "unlink", "rmdir", "del", "erase"]);

function splitCommandSegments(command) {
  return String(command || "")
    .split(/&&|\|\||[;\n|]/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function firstCommandToken(segment) {
  const text = String(segment || "").trim();
  const match = text.match(/^["']?([A-Za-z0-9_.:/\\-]+)["']?/);
  if (!match) return "";
  const raw = match[1].replace(/\\/g, "/");
  const base = raw.slice(raw.lastIndexOf("/") + 1).toLowerCase();
  return base.replace(/\.(?:exe|cmd|bat|ps1)$/i, "");
}

function parseCommandTokens(text) {
  const input = String(text || "");
  const tokens = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = "";
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function isDeleteCommand(command) {
  if (DELETE_COMMAND_PATTERNS.some((pattern) => pattern.test(String(command || "")))) return true;
  return splitCommandSegments(command).some((segment) => {
    const token = firstCommandToken(segment);
    if (DELETE_COMMAND_NAMES.has(token)) return true;
    if (token === "git" && /\bgit\s+clean\b/i.test(segment)) return true;
    if ((token === "powershell" || token === "pwsh") && /\bRemove-Item\b/i.test(segment)) return true;
    if (token === "cmd" && /\b(?:del|erase|rmdir)\b/i.test(segment)) return true;
    return false;
  });
}

function isFileMutationCommand(command) {
  const text = String(command || "");
  return isDeleteCommand(text) || FILE_MUTATION_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
}

function parsePowershellRemoveItemTarget(command) {
  const text = String(command || "").trim();
  if (!/\b(?:powershell|pwsh)\b/i.test(text) || !/\bRemove-Item\b/i.test(text)) return null;
  const scriptMatch = text.match(/(?:-Command|-c)\s+("([\s\S]*)"|'([\s\S]*)'|([\s\S]+))$/i);
  const script = String(scriptMatch?.[2] || scriptMatch?.[3] || scriptMatch?.[4] || text);
  const literalMatch = script.match(/\bRemove-Item\b\s+(?:-LiteralPath\s+|-Path\s+)?(?:"([^"]+)"|'([^']+)'|([^\s|;&]+))/i);
  const target = literalMatch?.[1] || literalMatch?.[2] || literalMatch?.[3] || "";
  if (!target || target.startsWith("-")) return null;
  return {
    target,
    recursive: /\s-(?:Recurse|r)\b/i.test(script),
  };
}

function getSimpleDeleteCommand(command) {
  const text = String(command || "").trim();
  const segments = splitCommandSegments(text);
  if (segments.length !== 1) return null;
  const ps = parsePowershellRemoveItemTarget(text);
  if (ps) return ps;

  const tokens = parseCommandTokens(segments[0]);
  if (tokens.length < 2) return null;
  const commandName = firstCommandToken(tokens[0]);
  if (!DELETE_COMMAND_NAMES.has(commandName)) return null;

  const optionPattern = commandName === "del" || commandName === "erase" || commandName === "rmdir"
    ? /^[-/]/ // Windows commands commonly use /F, /Q, /S.
    : /^-/;
  const targets = tokens.slice(1).filter((token) => !optionPattern.test(token));
  if (targets.length !== 1) return null;
  return {
    target: targets[0],
    recursive: commandName === "rmdir" || tokens.some((token) => /^-(?:r|R|rf|fr|recursive)$/i.test(token) || /^\/s$/i.test(token)),
  };
}

function sandboxError(code, message, details = {}) {
  const error = new Error(`[Creez sandbox:${code}] ${message}`);
  error.code = code;
  error.details = details;
  return error;
}

function sanitizeEnv(input = process.env, policy = {}) {
  const keep = new Set([
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "CI",
    "NODE_OPTIONS",
  ]);
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (SECRET_ENV_PATTERN.test(key)) continue;
    if (policy.envMode === "minimal" && !keep.has(key)) continue;
    output[key] = value;
  }
  return output;
}

function validatePathAccess(policy, targetPath, action) {
  const resolved = normalizePath(targetPath);
  if (action === "write" && !policy.allowWrite) {
    throw sandboxError("READ_ONLY", "Write denied by read-only sandbox policy.", { path: resolved });
  }
  const roots = action === "write" ? policy.writableRoots : policy.readableRoots;
  if (!roots.some((root) => isSubPath(root, resolved))) {
    throw sandboxError("PATH_OUTSIDE_SANDBOX", `${action} denied outside sandbox roots.`, {
      action,
      path: resolved,
      roots,
    });
  }
  if (isSensitivePath(resolved)) {
    throw sandboxError("SENSITIVE_PATH", `${action} denied for sensitive path.`, {
      action,
      path: resolved,
    });
  }
  return resolved;
}

async function requestApproval(policy, request) {
  if (typeof policy?.requestApproval !== "function") {
    return { allowed: false, reason: "Approval is not available." };
  }
  try {
    return await policy.requestApproval(request);
  } catch (error) {
    return { allowed: false, reason: error?.message || String(error) };
  }
}

async function requestPathAccess(policy, targetPath, action) {
  const resolved = normalizePath(targetPath);
  try {
    return validatePathAccess(policy, resolved, action);
  } catch (error) {
    if (
      error?.code === "SENSITIVE_PATH" &&
      policy?.mode === "workspace-write" &&
      (action === "read" || action === "write")
    ) {
      const decision = await requestApproval(policy, {
        kind: "path",
        action,
        risk: "sensitive_path",
        title: action === "read" ? "Read sensitive file?" : "Modify sensitive file?",
        message: `The agent wants to ${action} a sensitive path.`,
        path: resolved,
      });
      if (decision?.allowed) return resolved;
    }
    throw error;
  }
}

async function analyzeCommand(policy, command) {
  const text = String(command || "");
  if (!policy.allowBash) {
    throw sandboxError("BASH_DISABLED", "Shell commands are disabled for this sandbox policy.", {
      mode: policy.mode,
    });
  }
  if (!policy.networkAccess && NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(text))) {
    console.log("[creez:sandbox] approval requested", {
      action: "network",
      risk: "network_disabled",
      command: text.slice(0, 300),
    });
    const decision = await requestApproval(policy, {
      kind: "command",
      action: "network",
      risk: "network_disabled",
      title: "Allow network-capable command?",
      message: "The agent wants to run a command that can access the network.",
      command: text,
    });
    if (!decision?.allowed) {
      throw sandboxError("NETWORK_DISABLED", "Network-capable command was denied.", { command: text });
    }
  }
  if (isDeleteCommand(text) || DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(text))) {
    console.log("[creez:sandbox] approval requested", {
      action: "dangerous",
      risk: "dangerous_command",
      command: text.slice(0, 300),
    });
    const decision = await requestApproval(policy, {
      kind: "command",
      action: "dangerous",
      risk: "dangerous_command",
      title: "Allow dangerous command?",
      message: "The agent wants to run a command that may delete files, change permissions, or modify system state.",
      command: text,
    });
    if (!decision?.allowed) {
      throw sandboxError("DANGEROUS_COMMAND", "Dangerous shell command was denied.", { command: text });
    }
    if (isFileMutationCommand(text) && !policy.hostWriteThrough) {
      throw sandboxError(
        "HOST_WRITE_DISABLED",
        "Host filesystem mutations from shell commands are only enabled for the default assistant scenario.",
        { command: text, scenario: policy.scenario },
      );
    }
    return;
  }
  if (isFileMutationCommand(text)) {
    if (!policy.hostWriteThrough) {
      throw sandboxError(
        "HOST_WRITE_DISABLED",
        "Host filesystem mutations from shell commands are only enabled for the default assistant scenario.",
        { command: text, scenario: policy.scenario },
      );
    }
    console.log("[creez:sandbox] approval requested", {
      action: "write",
      risk: "host_filesystem_mutation",
      command: text.slice(0, 300),
    });
    const decision = await requestApproval(policy, {
      kind: "command",
      action: "write",
      risk: "host_filesystem_mutation",
      title: "Allow filesystem change?",
      message: "The agent wants to run a command that may create, overwrite, copy, move, or rename files.",
      command: text,
    });
    if (!decision?.allowed) {
      throw sandboxError("HOST_WRITE_DENIED", "Filesystem mutation command was denied.", { command: text });
    }
  }
}

function getShellCommand(command) {
  if (process.platform === "win32") {
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }
  return {
    file: process.env.SHELL || "/bin/sh",
    args: ["-lc", command],
  };
}

async function executeCommand(command, cwd, { policy, onData, signal, timeout, env } = {}) {
  const safePolicy = policy || {};
  const safeCwd = await requestPathAccess(safePolicy, cwd || safePolicy.workDir || process.cwd(), "read");
  await analyzeCommand(safePolicy, command);
  const simpleDelete = getSimpleDeleteCommand(command);
  if (simpleDelete && safePolicy.hostWriteThrough) {
    const targetPath = path.isAbsolute(simpleDelete.target)
      ? simpleDelete.target
      : path.resolve(safeCwd, simpleDelete.target);
    const safeTarget = await requestPathAccess(safePolicy, targetPath, "write");
    await fs.rm(safeTarget, { force: true, recursive: Boolean(simpleDelete.recursive) });
    const message = `Deleted ${safeTarget}\n`;
    onData?.(Buffer.from(message, "utf8"));
    console.log("[creez:sandbox] command executed by host delete adapter", {
      mode: safePolicy.mode,
      backend: safePolicy.backend,
      scenario: safePolicy.scenario,
      path: safeTarget,
      recursive: Boolean(simpleDelete.recursive),
    });
    return { exitCode: 0 };
  }
  console.log("[creez:sandbox] command approved for execution", {
    mode: safePolicy.mode,
    backend: safePolicy.backend,
    cwd: safeCwd,
    command: String(command || "").slice(0, 300),
  });

  return new Promise((resolve, reject) => {
    const shell = getShellCommand(command);
    const child = spawn(shell.file, shell.args, {
      cwd: safeCwd,
      env: sanitizeEnv(env || process.env, safePolicy),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let finished = false;
    let timeoutHandle = null;

    const settle = (fn) => {
      if (finished) return;
      finished = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const kill = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    };

    const onAbort = () => {
      kill();
      settle(() => reject(new Error("aborted")));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    if (timeout && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        kill();
        settle(() => reject(new Error(`timeout:${timeout}`)));
      }, timeout * 1000);
    }

    child.stdout?.on("data", (chunk) => onData?.(chunk));
    child.stderr?.on("data", (chunk) => onData?.(chunk));
    child.on("error", (error) => settle(() => reject(error)));
    child.on("close", (code) => settle(() => resolve({ exitCode: code })));
  });
}

async function ensureWritableParent(policy, targetPath) {
  ensureHostWriteThrough(policy, "write", targetPath);
  const resolved = await requestPathAccess(policy, targetPath, "write");
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  return resolved;
}

function ensureHostWriteThrough(policy, action = "write", targetPath = "") {
  if (policy?.hostWriteThrough) return;
  throw sandboxError(
    "HOST_WRITE_DISABLED",
    "Host filesystem mutations are only enabled for the default assistant scenario.",
    {
      action,
      scenario: policy?.scenario || "unknown",
      path: targetPath ? normalizePath(targetPath) : undefined,
    },
  );
}

module.exports = {
  analyzeCommand,
  executeCommand,
  getSimpleDeleteCommand,
  ensureHostWriteThrough,
  ensureWritableParent,
  isDeleteCommand,
  isFileMutationCommand,
  requestPathAccess,
  sandboxError,
  sanitizeEnv,
  validatePathAccess,
};
