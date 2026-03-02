const fs = require("node:fs/promises");
const path = require("node:path");
const { CHANNELS } = require("./channels.cjs");

function ok(data) {
  return { ok: true, data };
}

function err(code, message, details) {
  return { ok: false, error: { code, message, details } };
}

function toPosixPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function isSubPath(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateName(name) {
  if (!name || typeof name !== "string") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return true;
}

async function readWorkspaceRoot(appStateStore) {
  const state = await appStateStore.getState();
  const workspaceRoot = state?.workspaceRoot ? String(state.workspaceRoot) : "";
  if (!workspaceRoot) return null;
  return path.resolve(workspaceRoot);
}

async function assertPathInWorkspace(appStateStore, rawPath) {
  const workspaceRoot = await readWorkspaceRoot(appStateStore);
  if (!workspaceRoot) {
    return { ok: false, error: err("ROOT_NOT_SET", "Workspace root is not configured.") };
  }
  if (!rawPath || typeof rawPath !== "string") {
    return { ok: false, error: err("VALIDATION_ERROR", "path is required.") };
  }
  const resolved = path.resolve(rawPath);
  if (!isSubPath(workspaceRoot, resolved)) {
    return { ok: false, error: err("FORBIDDEN_PATH", "Path is outside workspace root.") };
  }
  return { ok: true, workspaceRoot, resolved };
}

async function listTree(rootPath, depth) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: toPosixPath(fullPath),
        type: "folder",
        children: depth > 1 ? await listTree(fullPath, depth - 1) : [],
      });
      continue;
    }
    nodes.push({
      name: entry.name,
      path: toPosixPath(fullPath),
      type: "file",
    });
  }
  return nodes;
}

function mapFsError(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "ENOENT") return err("NOT_FOUND", "Path does not exist.", error?.message || String(error));
  if (code === "EEXIST") return err("ALREADY_EXISTS", "Target already exists.", error?.message || String(error));
  if (code === "ENOTDIR") return err("NOT_DIRECTORY", "Target is not a directory.", error?.message || String(error));
  if (code === "EISDIR") return err("IS_DIRECTORY", "Target is a directory.", error?.message || String(error));
  return err("FS_ERROR", fallbackMessage, error?.message || String(error));
}

function registerWorkspaceIpc(ipcMain, appStateStore) {
  ipcMain.handle(CHANNELS.WORKSPACE_GET_TREE, async (_event, payload = {}) => {
    const depth = Number(payload?.depth || 4);
    const safeDepth = Number.isFinite(depth) ? Math.min(Math.max(depth, 1), 8) : 4;
    const workspaceRoot = await readWorkspaceRoot(appStateStore);
    if (!workspaceRoot) {
      return err("ROOT_NOT_SET", "Workspace root is not configured.");
    }

    try {
      await fs.mkdir(workspaceRoot, { recursive: true });
      const nodes = await listTree(workspaceRoot, safeDepth);
      return ok({ rootPath: toPosixPath(workspaceRoot), nodes });
    } catch (error) {
      return mapFsError(error, "Failed to list workspace tree.");
    }
  });

  ipcMain.handle(CHANNELS.WORKSPACE_CREATE, async (_event, payload = {}) => {
    const { parentPath, name, type, content } = payload || {};
    if (!validateName(name)) {
      return err("VALIDATION_ERROR", "Invalid name.");
    }
    if (type !== "file" && type !== "folder") {
      return err("VALIDATION_ERROR", "type must be file or folder.");
    }
    const checked = await assertPathInWorkspace(appStateStore, parentPath);
    if (!checked.ok) return checked.error;

    const targetPath = path.join(checked.resolved, name);
    if (!isSubPath(checked.workspaceRoot, path.resolve(targetPath))) {
      return err("FORBIDDEN_PATH", "Path is outside workspace root.");
    }

    try {
      if (type === "folder") {
        await fs.mkdir(targetPath, { recursive: false });
      } else {
        await fs.writeFile(targetPath, typeof content === "string" ? content : "", "utf8");
      }
      return ok({ path: toPosixPath(targetPath) });
    } catch (error) {
      return mapFsError(error, "Failed to create target.");
    }
  });

  ipcMain.handle(CHANNELS.WORKSPACE_RENAME, async (_event, payload = {}) => {
    const { path: oldPath, newName } = payload || {};
    if (!validateName(newName)) {
      return err("VALIDATION_ERROR", "Invalid newName.");
    }
    const checked = await assertPathInWorkspace(appStateStore, oldPath);
    if (!checked.ok) return checked.error;

    const nextPath = path.join(path.dirname(checked.resolved), newName);
    if (!isSubPath(checked.workspaceRoot, path.resolve(nextPath))) {
      return err("FORBIDDEN_PATH", "Path is outside workspace root.");
    }

    try {
      await fs.rename(checked.resolved, nextPath);
      return ok({ path: toPosixPath(nextPath) });
    } catch (error) {
      return mapFsError(error, "Failed to rename target.");
    }
  });

  ipcMain.handle(CHANNELS.WORKSPACE_DELETE, async (_event, payload = {}) => {
    const { path: targetPath, recursive } = payload || {};
    const checked = await assertPathInWorkspace(appStateStore, targetPath);
    if (!checked.ok) return checked.error;

    try {
      await fs.rm(checked.resolved, { recursive: Boolean(recursive), force: false });
      return ok({ deleted: true });
    } catch (error) {
      return mapFsError(error, "Failed to delete target.");
    }
  });

  ipcMain.handle(CHANNELS.WORKSPACE_READ_FILE, async (_event, payload = {}) => {
    const { path: targetPath, encoding } = payload || {};
    const checked = await assertPathInWorkspace(appStateStore, targetPath);
    if (!checked.ok) return checked.error;

    const fileEncoding = encoding === "base64" ? "base64" : "utf8";
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(checked.resolved, fileEncoding),
        fs.stat(checked.resolved),
      ]);
      return ok({
        content,
        encoding: fileEncoding,
        stat: { size: stat.size, mtimeMs: stat.mtimeMs },
      });
    } catch (error) {
      return mapFsError(error, "Failed to read file.");
    }
  });

  ipcMain.handle(CHANNELS.WORKSPACE_WRITE_FILE, async (_event, payload = {}) => {
    const { path: targetPath, content, encoding, createIfMissing } = payload || {};
    if (typeof content !== "string") {
      return err("VALIDATION_ERROR", "content must be a string.");
    }
    const checked = await assertPathInWorkspace(appStateStore, targetPath);
    if (!checked.ok) return checked.error;

    const fileEncoding = encoding === "base64" ? "base64" : "utf8";
    try {
      if (createIfMissing) {
        await fs.mkdir(path.dirname(checked.resolved), { recursive: true });
      } else {
        await fs.access(checked.resolved);
      }
      await fs.writeFile(checked.resolved, content, fileEncoding);
      const stat = await fs.stat(checked.resolved);
      return ok({ updated: true, stat: { size: stat.size, mtimeMs: stat.mtimeMs } });
    } catch (error) {
      return mapFsError(error, "Failed to write file.");
    }
  });
}

module.exports = {
  registerWorkspaceIpc,
};
