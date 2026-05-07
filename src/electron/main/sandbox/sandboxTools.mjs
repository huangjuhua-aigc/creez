import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const require = createRequire(import.meta.url);
const { globSync } = require("glob");
const {
  executeCommand,
  ensureHostWriteThrough,
  ensureWritableParent,
  requestPathAccess,
  validatePathAccess,
} = require("./sandboxRunner.cjs");
const { isSensitivePath } = require("./sandboxPolicy.cjs");

function readOps(policy) {
  return {
    async readFile(absolutePath) {
      const safe = await requestPathAccess(policy, absolutePath, "read");
      return fs.readFile(safe);
    },
    async access(absolutePath) {
      const safe = await requestPathAccess(policy, absolutePath, "read");
      await fs.access(safe);
    },
    async detectImageMimeType() {
      return undefined;
    },
  };
}

function writeOps(policy) {
  return {
    async mkdir(dir) {
      ensureHostWriteThrough(policy, "mkdir", dir);
      const safe = await requestPathAccess(policy, dir, "write");
      await fs.mkdir(safe, { recursive: true });
    },
    async writeFile(absolutePath, content) {
      ensureHostWriteThrough(policy, "write", absolutePath);
      const safe = await ensureWritableParent(policy, absolutePath);
      await fs.writeFile(safe, content, "utf8");
    },
  };
}

function editOps(policy) {
  return {
    async readFile(absolutePath) {
      const safe = await requestPathAccess(policy, absolutePath, "read");
      return fs.readFile(safe);
    },
    async writeFile(absolutePath, content) {
      ensureHostWriteThrough(policy, "edit", absolutePath);
      const safe = await ensureWritableParent(policy, absolutePath);
      await fs.writeFile(safe, content, "utf8");
    },
    async access(absolutePath) {
      const safeRead = await requestPathAccess(policy, absolutePath, "read");
      await requestPathAccess(policy, absolutePath, "write");
      await fs.access(safeRead);
    },
  };
}

function lsOps(policy) {
  return {
    async exists(absolutePath) {
      try {
        const safe = await requestPathAccess(policy, absolutePath, "read");
        await fs.access(safe);
        return true;
      } catch {
        return false;
      }
    },
    async stat(absolutePath) {
      const safe = await requestPathAccess(policy, absolutePath, "read");
      return fs.stat(safe);
    },
    async readdir(absolutePath) {
      const safe = await requestPathAccess(policy, absolutePath, "read");
      return fs.readdir(safe);
    },
  };
}

function findOps(policy) {
  return {
    async exists(absolutePath) {
      try {
        const safe = await requestPathAccess(policy, absolutePath, "read");
        await fs.access(safe);
        return true;
      } catch {
        return false;
      }
    },
    glob(pattern, cwd, options = {}) {
      const safeCwd = validatePathAccess(policy, cwd, "read");
      const results = globSync(pattern, {
        cwd: safeCwd,
        dot: true,
        nodir: false,
        ignore: options.ignore || ["**/node_modules/**", "**/.git/**"],
        absolute: false,
      });
      return results.slice(0, Math.max(1, options.limit || 1000));
    },
  };
}

function createSafeGrepTool(policy) {
  return {
    name: "grep",
    label: "grep",
    description:
      "Safely search readable, non-sensitive files for a pattern. Skips .git, node_modules, and sensitive files such as .env, keys, and credentials.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Search pattern (regex by default, literal when literal=true)." }),
      path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)." })),
      glob: Type.Optional(Type.String({ description: "Optional glob, e.g. **/*.ts." })),
      ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search." })),
      literal: Type.Optional(Type.Boolean({ description: "Treat pattern as a literal string." })),
      context: Type.Optional(Type.Number({ description: "Context lines before and after each match." })),
      limit: Type.Optional(Type.Number({ description: "Maximum matches, default 100." })),
    }),
    async execute(_toolCallId, args = {}) {
      const root = await requestPathAccess(policy, path.resolve(policy.workDir, args.path || "."), "read");
      const stat = await fs.stat(root);
      const max = Math.max(1, Math.min(Number(args.limit || 100), 500));
      const context = Math.max(0, Math.min(Number(args.context || 0), 5));
      const matcher = args.literal
        ? null
        : new RegExp(String(args.pattern || ""), args.ignoreCase ? "i" : "");
      const literalNeedle = args.ignoreCase
        ? String(args.pattern || "").toLowerCase()
        : String(args.pattern || "");
      const files = stat.isDirectory()
        ? globSync(args.glob || "**/*", {
            cwd: root,
            dot: true,
            nodir: true,
            absolute: true,
            ignore: ["**/node_modules/**", "**/.git/**"],
          })
        : [root];
      const lines = [];
      let count = 0;
      for (const file of files) {
        if (count >= max) break;
        let safe;
        try {
          safe = await requestPathAccess(policy, file, "read");
          if (isSensitivePath(safe)) continue;
          const content = await fs.readFile(safe, "utf8");
          const fileLines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
          for (let i = 0; i < fileLines.length && count < max; i++) {
            const line = fileLines[i];
            const haystack = args.ignoreCase ? line.toLowerCase() : line;
            const matched = matcher ? matcher.test(line) : haystack.includes(literalNeedle);
            if (!matched) continue;
            const rel = path.relative(root, safe) || path.basename(safe);
            const start = Math.max(0, i - context);
            const end = Math.min(fileLines.length - 1, i + context);
            for (let j = start; j <= end; j++) {
              const prefix = j === i ? ":" : "-";
              lines.push(`${rel}:${j + 1}${prefix}${fileLines[j].slice(0, 500)}`);
            }
            count++;
          }
        } catch {
          // Skip unreadable or invalid text files.
        }
      }
      const text = lines.length
        ? lines.join("\n") + (count >= max ? `\n\n[Stopped after ${max} matches.]` : "")
        : "No matches found.";
      return { content: [{ type: "text", text }] };
    },
  };
}

function bashOps(policy) {
  return {
    exec(command, cwd, options = {}) {
      console.log("[creez:sandbox] bash exec requested", {
        mode: policy?.mode,
        backend: policy?.backend,
        cwd,
        command: String(command || "").slice(0, 300),
      });
      return executeCommand(command, cwd, {
        policy,
        onData: options.onData,
        signal: options.signal,
        timeout: options.timeout,
        env: options.env,
      });
    },
  };
}

export function createCreezSandboxTools({ cwd, policy } = {}) {
  const root = cwd || policy?.workDir || process.cwd();
  const tools = [
    createReadTool(root, { operations: readOps(policy) }),
    createSafeGrepTool(policy),
    createFindTool(root, { operations: findOps(policy) }),
    createLsTool(root, { operations: lsOps(policy) }),
  ];

  if (policy?.allowWrite) {
    tools.push(
      createEditTool(root, { operations: editOps(policy) }),
      createWriteTool(root, { operations: writeOps(policy) }),
    );
  }

  if (policy?.allowBash) {
    tools.push(createBashTool(root, { operations: bashOps(policy) }));
  }

  return tools;
}
