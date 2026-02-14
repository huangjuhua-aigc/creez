const { app, BrowserWindow, dialog, ipcMain, clipboard, shell, Menu, globalShortcut } = require("electron");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { pathToFileURL } = require("url");

/** 将 Creez 的 chat_id/panel_id（可能是文件路径）转为合法 UUID，供后端 token_usage 等表使用 */
function toUuidForBackend(value) {
  const s = value && String(value).trim();
  if (!s || s === "creez") return "00000000-0000-0000-0000-000000000001";
  const hash = crypto.createHash("sha256").update(s, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
const mammoth = require("mammoth");
const xlsx = require("xlsx");

let _configDir = null;
function getConfigDir() {
  if (_configDir == null) _configDir = path.join(app.getPath("home"), ".creez");
  return _configDir;
}
function getConfigPath() {
  return path.join(getConfigDir(), "config.json");
}
/** 预置 skills 路径：打包后从 resources/skills 读取，开发/构建后从项目根 skills 读取 */
function getBundledSkillsDir() {
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, "skills");
  }
  return path.join(__dirname, "..", "skills");
}

const isDev = !app.isPackaged;
const CREEZ_DEBUG = process.env.CREEZ_DEBUG === "1" || process.env.CREEZ_DEBUG === "true";
// Creez 专用后端：开发时 localhost:8081，生产环境为 int 部署地址，可通过 IMAGE_GEN_BASE_URL 覆盖
const IMAGE_GEN_BASE_URL =
  process.env.IMAGE_GEN_BASE_URL || (isDev ? "http://localhost:8081" : "https://int-creez.lighton.video");
const IMAGE_GEN_USER_ID = process.env.CREEZ_USER_ID || "cbaef461-ae6e-46d8-bd06-cb4b94d68349";

/** 调试日志：打包后写入 ~/.creez/creez-debug.log，便于排查网络/键盘等问题；开发时 CREEZ_DEBUG=1 也会写 */
function debugLog(...args) {
  const line = [new Date().toISOString(), "[Creez]", ...args].join(" ") + "\n";
  console.log(...args);
  if (!isDev || CREEZ_DEBUG) {
    try {
      fsSync.mkdirSync(getConfigDir(), { recursive: true });
      fsSync.appendFileSync(path.join(getConfigDir(), "creez-debug.log"), line);
    } catch (_) {}
  }
}

/** 构建发往 Creez 后端的请求头；user_id 优先用调用方传入，否则用 IMAGE_GEN_USER_ID */
function creezHeaders(userId) {
  const uid = userId != null && String(userId).trim() !== "" ? String(userId).trim() : IMAGE_GEN_USER_ID;
  return {
    "Content-Type": "application/json",
    "X-User-Id": uid,
  };
}

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".csv",
  ".tsv",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".go",
  ".rs",
  ".php",
  ".rb",
  ".swift",
  ".kt",
  ".kts",
  ".m",
  ".mm",
  ".pl",
  ".r",
  ".sql",
  ".graphql",
  ".gql",
  ".ini",
  ".conf",
  ".config",
  ".properties",
  ".ps1",
  ".bat",
  ".cmd",
  ".sh",
  ".zsh",
  ".bash",
  ".scene_board",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogg", ".mov", ".mkv"]);

const PDF_EXTENSIONS = new Set([".pdf"]);
const DOCX_EXTENSIONS = new Set([".docx"]);
const XLSX_EXTENSIONS = new Set([".xlsx", ".xls"]);

function ensureInsideWorkDir(targetPath, workDir) {
  if (targetPath == null || typeof targetPath !== "string" || workDir == null || typeof workDir !== "string") {
    throw new Error("Path or workDir is missing.");
  }
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(workDir);
  if (resolvedTarget === resolvedRoot) return;
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path is outside of workspace.");
  }
}

/** 确保 ~/.creez/skills 目录存在（不在此处复制预置 skill，改为用户首次启用时复制）。 */
async function ensureUserSkillsDir() {
  const targetSkillsDir = path.join(getConfigDir(), "skills");
  try {
    await fs.mkdir(targetSkillsDir, { recursive: true });
  } catch (e) {
    console.error("[Creez] ensureUserSkillsDir failed:", e && e.message ? e.message : e);
  }
}

/**
 * 当用户首次在消息中使用 /skill:xxx 时，将应用自带的预置 skill（安装包或源码 skills/ 目录）
 * 复制到 ~/.creez/skills/xxx（若该目录已存在则跳过）。不是“新建” skill，而是把已有预置
 * 安装到用户目录，以便 Pi Agent 从 agentDir/skills（即 ~/.creez/skills）加载；复制后用户
 * 可在 ~/.creez/skills 中自行修改。
 */
async function ensureSkillInUserDir(skillName) {
  const normalized = normalizeSkillName(skillName);
  if (!normalized) return;
  const targetSkillsDir = path.join(getConfigDir(), "skills");
  const destDir = path.join(targetSkillsDir, normalized);
  if (fsSync.existsSync(destDir)) return;
  const bundledDir = getBundledSkillsDir();
  const srcDir = path.join(bundledDir, normalized);
  if (!fsSync.existsSync(srcDir) || !fsSync.statSync(srcDir).isDirectory()) return;
  try {
    await fs.mkdir(targetSkillsDir, { recursive: true });
    await fs.cp(srcDir, destDir, { recursive: true });
    console.log("[Creez] skill copied to ~/.creez/skills:", normalized);
  } catch (e) {
    console.error("[Creez] ensureSkillInUserDir failed:", normalized, e && e.message ? e.message : e);
  }
}

async function readConfig() {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    return null;
  }
}

async function writeConfig(config) {
  await fs.mkdir(getConfigDir(), { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
}

async function buildTree(dirPath, maxDepth = 6, depth = 0) {
  const name = path.basename(dirPath);
  const node = { name, path: dirPath, type: "dir", children: [] };
  if (depth >= maxDepth) {
    return node;
  }

  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    return node;
  }

  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sorted) {
    const childPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      node.children.push(await buildTree(childPath, maxDepth, depth + 1));
    } else {
      node.children.push({ name: entry.name, path: childPath, type: "file" });
    }
  }

  return node;
}

function getFileKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return "text";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (DOCX_EXTENSIONS.has(ext)) return "docx";
  if (XLSX_EXTENSIONS.has(ext)) return "xlsx";
  return "binary";
}

function normalizeSkillName(name) {
  return name.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
}

function skillsBaseDir(workDir) {
  return path.join(workDir, ".pi", "skills");
}

async function listSkillsFromDir(root) {
  if (!fsSync.existsSync(root) || !fsSync.statSync(root).isDirectory()) return [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(root, entry.name, "SKILL.md");
      if (fsSync.existsSync(skillPath)) {
        const raw = await fs.readFile(skillPath, "utf8");
        const matchDesc = raw.match(/description:\s*(.+)/);
        skills.push({
          name: entry.name,
          description: matchDesc ? matchDesc[1].trim() : "",
          path: skillPath,
        });
      }
    }
    return skills;
  } catch (error) {
    return [];
  }
}

/** 列出技能：工作区 .pi/skills、~/.creez/skills、预置 skills 合并（按此顺序，同名前者优先），供 /skill: 补全等使用 */
async function listSkills(workDir) {
  const byName = new Map();
  const roots = [
    workDir ? skillsBaseDir(workDir) : null,
    path.join(getConfigDir(), "skills"),
    getBundledSkillsDir(),
  ].filter(Boolean);
  for (const root of roots) {
    const list = await listSkillsFromDir(root);
    for (const s of list) {
      if (!byName.has(s.name)) byName.set(s.name, s);
    }
  }
  return Array.from(byName.values());
}

async function readSkill(workDir, name) {
  const normalized = normalizeSkillName(name);
  const skillPath = path.join(skillsBaseDir(workDir), normalized, "SKILL.md");
  ensureInsideWorkDir(skillPath, workDir);
  const raw = await fs.readFile(skillPath, "utf8");
  const frontmatterMatch = raw.match(/---\n([\s\S]*?)\n---\n([\s\S]*)/);
  if (!frontmatterMatch) {
    return { name: normalized, description: "", body: raw };
  }
  const fm = frontmatterMatch[1];
  const body = frontmatterMatch[2] || "";
  const nameMatch = fm.match(/name:\s*(.+)/);
  const descMatch = fm.match(/description:\s*(.+)/);
  return {
    name: nameMatch ? nameMatch[1].trim() : normalized,
    description: descMatch ? descMatch[1].trim() : "",
    body: body.trim(),
  };
}

async function saveSkill(workDir, skill) {
  const normalized = normalizeSkillName(skill.name);
  if (!normalized) {
    throw new Error("Invalid skill name");
  }
  const baseDir = skillsBaseDir(workDir);
  const skillDir = path.join(baseDir, normalized);
  ensureInsideWorkDir(skillDir, workDir);
  await fs.mkdir(skillDir, { recursive: true });
  const contents = `---\nname: ${normalized}\ndescription: ${skill.description || ""}\n---\n\n${
    skill.body || ""
  }\n`;
  await fs.writeFile(path.join(skillDir, "SKILL.md"), contents, "utf8");
  return true;
}

async function deleteSkill(workDir, name) {
  const normalized = normalizeSkillName(name);
  const skillDir = path.join(skillsBaseDir(workDir), normalized);
  ensureInsideWorkDir(skillDir, workDir);
  if (fsSync.existsSync(skillDir)) {
    await fs.rm(skillDir, { recursive: true, force: true });
  }
  return true;
}

async function readFileForDisplay(filePath) {
  if (filePath == null || typeof filePath !== "string") {
    throw new Error("filePath is required.");
  }
  const ext = path.extname(filePath).toLowerCase();
  const kind = getFileKind(filePath);
  const fileUrl = pathToFileURL(path.resolve(filePath)).href;

  if (kind === "text") {
    const content = await fs.readFile(filePath, "utf8");
    return { kind: "text", content, isEditable: true };
  }

  if (kind === "docx") {
    const result = await mammoth.convertToHtml({ path: filePath });
    return { kind: "html", content: result.value, isEditable: false };
  }

  if (kind === "xlsx") {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const html = xlsx.utils.sheet_to_html(sheet);
    return { kind: "html", content: html, isEditable: false };
  }

  if (kind === "pdf") {
    return { kind: "pdf", fileUrl, isEditable: false };
  }

  if (kind === "image") {
    return { kind: "image", fileUrl, isEditable: false };
  }

  if (kind === "audio") {
    return { kind: "audio", fileUrl, isEditable: false };
  }

  if (kind === "video") {
    return { kind: "video", fileUrl, isEditable: false };
  }

  const stats = await fs.stat(filePath);
  return {
    kind: "binary",
    fileUrl,
    size: stats.size,
    extension: ext,
    isEditable: false,
  };
}

let mainWindow = null;
let treeWatchWatcher = null;

// Pi AgentSession (OpenClaw-style): createAgentSession in main, events forwarded to renderer.
let agentRunnerModule = null;

async function getAgentRunner() {
  if (!agentRunnerModule) {
    const bundlePath = path.join(__dirname, "agent-runner.bundle.cjs");
    if (fsSync.existsSync(bundlePath)) {
      agentRunnerModule = require(bundlePath);
    } else {
      const { pathToFileURL } = require("url");
      const runnerPath = path.join(__dirname, "agent-runner.mjs");
      agentRunnerModule = await import(pathToFileURL(runnerPath).href);
    }
  }
  return agentRunnerModule;
}

ipcMain.on("agent:init", async (_event, config) => {
  const sender = _event.sender;
  try {
    if (!config || typeof config !== "object") {
      sender.send("agent:eventError", "配置缺失");
      return;
    }
    const os = require("os");
    const workDir = (config.workDir && String(config.workDir).trim()) || os.homedir();
    const agentDir = getConfigDir();
    const runner = await getAgentRunner();
    await runner.createAndSubscribe(sender, {
      provider: config.provider,
      modelId: config.modelId,
      apiKey: config.apiKey,
      workDir,
      agentDir,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error("[Creez main] agent:init 失败:", msg);
    sender.send("agent:eventError", msg);
  }
});

/** 从消息文本中提取 /skill:xxx 中的 skill 名称 */
function extractSkillNamesFromText(text) {
  if (typeof text !== "string" || !text) return [];
  const names = [];
  const re = /\/skill:([\w\-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

ipcMain.on("agent:prompt", async (_event, payload) => {
  const text = payload?.text;
  const imagesCount = payload?.images?.length ?? 0;
  console.log("[Creez main] agent:prompt", { textLen: typeof text === "string" ? text.length : 0, imagesCount });
  try {
    const skillNames = extractSkillNamesFromText(text);
    for (const name of skillNames) {
      await ensureSkillInUserDir(name);
    }
    const runner = await getAgentRunner();
    if (runner.hasSession()) {
      await runner.prompt(payload || {});
    } else {
      const msg = "Agent not initialized. Call agent:init first with provider, modelId, apiKey, workDir.";
      console.error("[Creez main]", msg);
      _event.sender.send("agent:eventError", msg);
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const msg = err && err.message ? err.message : String(err);
      console.error("[Creez main] agent:prompt 错误:", msg);
      _event.sender.send("agent:eventError", msg);
    }
  }
});

ipcMain.on("agent:abort", async () => {
  try {
    const runner = await getAgentRunner();
    runner.abort();
  } catch (_) {}
});

// Register dialog handler early so it exists before any renderer invoke
ipcMain.handle("dialog:saveConfirm", async (_event, message) => {
  if (!mainWindow || mainWindow.isDestroyed()) return 2;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["保存", "不保存", "取消"],
    defaultId: 0,
    cancelId: 2,
    title: "未保存的修改",
    message: message || "当前文件已修改，是否保存？",
  });
  return response;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow = win;

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "renderer", "index.html"));
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
  }

  // 应用里看 log：按 F12 打开/关闭开发者工具（Console 里看 [Creez] 等输出）
  win.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12") {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (CREEZ_DEBUG) {
    win.webContents.once("did-finish-load", () => win.webContents.openDevTools());
  }
}

let quitHandled = false;

app.whenReady().then(async () => {
  await ensureUserSkillsDir();
  debugLog("BASE_URL=", IMAGE_GEN_BASE_URL, "isPackaged=", app.isPackaged, "CREEZ_DEBUG=", CREEZ_DEBUG);
  Menu.setApplicationMenu(null);
  createWindow();

  // F12 打开开发者工具，便于在应用端看渲染进程 log
  globalShortcut.register("F12", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  globalShortcut.unregister("F12");
  if (quitHandled) return;
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:checkUnsaved");
  } else {
    quitHandled = true;
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.on("app:unsavedResult", (_event, { hasUnsaved, paths }) => {
  if (!hasUnsaved || !mainWindow) {
    quitHandled = true;
    app.quit();
    return;
  }
  dialog
    .showMessageBox(mainWindow, {
      type: "question",
      buttons: ["保存并退出", "不保存并退出", "取消"],
      defaultId: 0,
      cancelId: 2,
      title: "未保存的修改",
      message: "有文件未保存，是否保存？",
    })
    .then(({ response }) => {
      if (response === 0) {
        mainWindow.webContents.send("app:saveAndQuit", paths);
      } else if (response === 1) {
        quitHandled = true;
        app.quit();
      }
    });
});

ipcMain.on("app:quitDone", () => {
  quitHandled = true;
  app.quit();
});

ipcMain.handle("config:get", async () => {
  return await readConfig();
});

ipcMain.handle("config:save", async (_event, config) => {
  try {
  await fs.mkdir(getConfigDir(), { recursive: true });
  const configPath = getConfigPath();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    return { ok: true, configPath };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return { ok: false, error: message };
  }
});

ipcMain.handle("dialog:selectDirectory", async () => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = await dialog.showOpenDialog(win, {
    title: "选择工作目录",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("dialog:showSaveDialog", async (_event, options = {}) => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = await dialog.showSaveDialog(win, {
    title: options.title || "保存文件",
    defaultPath: options.defaultPath || "project.xml",
    filters: options.filters || [{ name: "XML", extensions: ["xml"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  return { filePath: result.filePath };
});

ipcMain.handle("fs:writeFileAbsolute", async (_event, filePath, content) => {
  if (!filePath || typeof filePath !== "string") throw new Error("Invalid file path");
  await fs.writeFile(filePath, content, "utf8");
  return true;
});

ipcMain.handle("fs:watchWorkDir", (_event, workDir) => {
  if (treeWatchWatcher) {
    try {
      treeWatchWatcher.close();
    } catch (_) {}
    treeWatchWatcher = null;
  }
  if (!workDir || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    treeWatchWatcher = fsSync.watch(workDir, { recursive: true }, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("fs:treeInvalidate");
      }
    });
  } catch (_) {}
});

ipcMain.handle("fs:readDirTree", async (_event, workDir, maxDepth) => {
  if (workDir == null || typeof workDir !== "string") return { name: "", path: "", type: "dir", children: [] };
  ensureInsideWorkDir(workDir, workDir);
  return await buildTree(workDir, maxDepth ?? 6);
});

ipcMain.handle("fs:readFile", async (_event, filePath, workDir) => {
  if (filePath == null || typeof filePath !== "string") {
    throw new Error("filePath is required.");
  }
  if (workDir) ensureInsideWorkDir(filePath, workDir);
  return await readFileForDisplay(filePath);
});

const LOCK_RETRIES = 20;
const LOCK_RETRY_MS = 80;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withFileLock(filePath, workDir, fn) {
  const lockPath = filePath + ".lock";
  if (workDir) ensureInsideWorkDir(lockPath, workDir);
  for (let i = 0; i < LOCK_RETRIES; i++) {
    try {
      await fs.writeFile(lockPath, process.pid.toString(), { flag: "wx" });
      break;
    } catch (e) {
      if (e.code === "EEXIST" && i < LOCK_RETRIES - 1) await sleep(LOCK_RETRY_MS);
      else throw e;
    }
  }
  try {
    return await fn();
  } finally {
    await fs.unlink(lockPath).catch(() => {});
  }
}

ipcMain.handle("fs:writeFile", async (_event, filePath, content, workDir) => {
  ensureInsideWorkDir(filePath, workDir);
  await withFileLock(filePath, workDir, async () => {
    await fs.writeFile(filePath, content, "utf8");
  });
  return true;
});

ipcMain.handle("fs:exists", async (_event, filePath, workDir, excludePath) => {
  if (workDir) ensureInsideWorkDir(filePath, workDir);
  if (excludePath && workDir) ensureInsideWorkDir(excludePath, workDir);
  try {
    await fs.access(filePath);
    if (excludePath) {
      try {
        const [realPath, realExclude] = await Promise.all([
          fs.realpath(filePath),
          fs.realpath(excludePath),
        ]);
        if (realPath === realExclude) return false;
      } catch {
        // excludePath may not exist (e.g. already renamed); treat as distinct
      }
    }
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("fs:createFile", async (_event, filePath, workDir) => {
  ensureInsideWorkDir(filePath, workDir);
  await fs.writeFile(filePath, "", "utf8");
  return true;
});

ipcMain.handle("fs:createFolder", async (_event, dirPath, workDir) => {
  ensureInsideWorkDir(dirPath, workDir);
  await fs.mkdir(dirPath, { recursive: true });
  return true;
});

ipcMain.handle("fs:rename", async (_event, oldPath, newPath, workDir) => {
  ensureInsideWorkDir(oldPath, workDir);
  ensureInsideWorkDir(newPath, workDir);
  await fs.rename(oldPath, newPath);
  return true;
});

ipcMain.handle("fs:move", async (_event, oldPath, newPath, workDir) => {
  ensureInsideWorkDir(oldPath, workDir);
  ensureInsideWorkDir(newPath, workDir);
  await fs.rename(oldPath, newPath);
  return true;
});

ipcMain.handle("fs:delete", async (_event, targetPath, workDir) => {
  ensureInsideWorkDir(targetPath, workDir);
  if (fsSync.existsSync(targetPath)) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
  return true;
});

ipcMain.handle("fs:copyPath", async (_event, targetPath, workDir) => {
  ensureInsideWorkDir(targetPath, workDir);
  clipboard.writeText(targetPath);
  return true;
});

ipcMain.handle("fs:revealInFolder", async (_event, targetPath, workDir) => {
  ensureInsideWorkDir(targetPath, workDir);
  await shell.showItemInFolder(targetPath);
  return true;
});

ipcMain.handle("skills:list", async (_event, workDir) => {
  if (workDir) ensureInsideWorkDir(workDir, workDir);
  return await listSkills(workDir || null);
});

ipcMain.handle("skills:read", async (_event, workDir, name) => {
  ensureInsideWorkDir(workDir, workDir);
  return await readSkill(workDir, name);
});

ipcMain.handle("skills:save", async (_event, workDir, skill) => {
  ensureInsideWorkDir(workDir, workDir);
  return await saveSkill(workDir, skill);
});

ipcMain.handle("skills:delete", async (_event, workDir, name) => {
  ensureInsideWorkDir(workDir, workDir);
  return await deleteSkill(workDir, name);
});

// 供 renderer 获取当前用户 id，调用生图/生视频时传入
ipcMain.handle("creez:getUserId", async () => IMAGE_GEN_USER_ID);

// AI 生图：生成创意描述 prompt（Creez 专用后端）
ipcMain.handle("imageGen:generatePrompt", async (_event, { scene, user_id: userId }) => {
  const url = IMAGE_GEN_BASE_URL.replace(/\/$/, "") + "/creez/images/generate_prompt";
  const payload = {
    project_id: toUuidForBackend("creez"),
    chat_id: toUuidForBackend(scene?.chat_id || scene?.panel_id),
    type: scene?.type || "",
    movement: scene?.movement || "",
    description: scene?.description || "",
    active_assets: scene?.active_assets || [],
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: creezHeaders(userId),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.detail || data?.error || data?.message || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (err) {
    debugLog("imageGen:generatePrompt fetch failed", "url=", url, "err=", err?.message, err?.cause?.code || err?.code);
    return { ok: false, error: err?.message || String(err) };
  }
});

// AI 生图：创建任务（Creez 专用后端，X-User-Id 由调用方传入并在 header 中发送）
ipcMain.handle("imageGen:create", async (_event, { body, user_id: userId }) => {
  const url = IMAGE_GEN_BASE_URL.replace(/\/$/, "") + "/creez/images/async_generations";
  const payload = {
    prompt: body.prompt,
    model: body.model || "doubao-seedream-4-0",
    aspect_ratio: body.aspect_ratio || "16:9",
    reference_image_list: body.reference_image_list || [],
    project_id: toUuidForBackend("creez"),
    chat_id: toUuidForBackend(body.chat_id || body.panel_id),
  };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(url, {
      method: "POST",
      headers: creezHeaders(userId),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.detail || data?.message || `HTTP ${res.status}` };
    }
    if (data.task_id) {
      return { ok: true, task_id: data.task_id };
    }
    return { ok: false, error: "未返回 task_id" };
  } catch (err) {
    const code = err?.cause?.code || err?.code;
    const msg = err?.message || String(err);
    const detail = code ? `${msg} (${code})` : msg;
    debugLog("imageGen:create fetch failed", "url=", url, "err=", detail, err?.cause || "");
    return { ok: false, error: msg.includes("abort") ? "请求超时" : msg };
  }
});

// AI 生图：轮询任务结果（Creez 专用后端）
ipcMain.handle("imageGen:poll", async (_event, { task_ids, user_id: userId }) => {
  if (!Array.isArray(task_ids) || task_ids.length === 0) {
    return { ok: true, data: {} };
  }
  const url = IMAGE_GEN_BASE_URL.replace(/\/$/, "") + "/creez/images/pollimages";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: creezHeaders(userId),
      body: JSON.stringify({ task_ids }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.detail || data?.message || `HTTP ${res.status}` };
    }
    return { ok: true, data: data?.data ?? data ?? {} };
  } catch (err) {
    debugLog("imageGen:poll fetch failed", "url=", url, "err=", err?.message, err?.cause?.code || err?.code);
    return { ok: false, error: err?.message || String(err) };
  }
});

// AI 视频：创建任务（Creez 专用后端，X-User-Id 由调用方传入并在 header 中发送）
ipcMain.handle("videoGen:create", async (_event, { body, user_id: userId }) => {
  const url = IMAGE_GEN_BASE_URL.replace(/\/$/, "") + "/creez/videos/async_generations";
  const payload = {
    prompt: body.prompt,
    frames: Array.isArray(body.frames) ? body.frames : [],
    model: body.model || "doubao-seedance-pro",
    duration: body.duration || 5,
    aspect_ratio: body.aspect_ratio || "16:9",
    generate_audio: body.generate_audio || false,
    project_id: toUuidForBackend("creez"),
    chat_id: toUuidForBackend(body.chat_id || body.panel_id),
  };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(url, {
      method: "POST",
      headers: creezHeaders(userId),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.detail || data?.message || `HTTP ${res.status}` };
    }
    if (data.task_id) {
      return { ok: true, task_id: data.task_id };
    }
    return { ok: false, error: "未返回 task_id" };
  } catch (err) {
    const msg = err?.message || String(err);
    debugLog("videoGen:create fetch failed", "url=", url, "err=", msg, err?.cause?.code || err?.code);
    return { ok: false, error: msg.includes("abort") ? "请求超时" : msg };
  }
});

// AI 视频：轮询任务结果
ipcMain.handle("videoGen:poll", async (_event, { task_ids, user_id: userId }) => {
  if (!Array.isArray(task_ids) || task_ids.length === 0) {
    return { ok: true, data: {} };
  }
  const url = IMAGE_GEN_BASE_URL.replace(/\/$/, "") + "/creez/videos/pollvideos";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: creezHeaders(userId),
      body: JSON.stringify({ task_ids }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.detail || data?.message || `HTTP ${res.status}` };
    }
    return { ok: true, data: data?.data ?? data ?? {} };
  } catch (err) {
    debugLog("videoGen:poll fetch failed", "url=", url, "err=", err?.message, err?.cause?.code || err?.code);
    return { ok: false, error: err?.message || String(err) };
  }
});

// AI 生图：下载远程图片并保存到工作目录
ipcMain.handle("imageGen:downloadAndSave", async (_event, { imageUrl, workDir, saveRelativePath }) => {
  if (!workDir || !saveRelativePath) return { ok: false, error: "缺少 workDir 或 saveRelativePath" };
  const absPath = path.join(workDir, saveRelativePath);
  try {
    ensureInsideWorkDir(absPath, workDir);
  } catch {
    return { ok: false, error: "路径超出工作目录" };
  }
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "";
    const ext = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : contentType.includes("gif") ? ".gif" : ".jpg";
    const finalPath = path.extname(absPath) ? absPath : absPath + ext;
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.writeFile(finalPath, buf);
    const finalRelative = path.relative(workDir, finalPath).replace(/\\/g, "/");
    return { ok: true, relativePath: finalRelative };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// 读取本地图片为 data URL（用于参考图）
ipcMain.handle("file:readAsDataUrl", async (_event, filePath, workDir) => {
  if (!filePath) return { ok: false, error: "路径为空" };
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(workDir || "", filePath);
  if (workDir) {
    try {
      ensureInsideWorkDir(absPath, workDir);
    } catch {
      return { ok: false, error: "路径超出工作目录" };
    }
  }
  try {
    const buf = await fs.readFile(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }[ext] || "image/png";
    const base64 = buf.toString("base64");
    return { ok: true, dataUrl: `data:${mime};base64,${base64}` };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// 将 data URL 保存到工作目录（落盘为文件，避免在 JSON 里存 base64）
ipcMain.handle("file:saveDataUrl", async (_event, { dataUrl, workDir, relativePath }) => {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return { ok: false, error: "无效的 data URL" };
  if (!workDir || !relativePath) return { ok: false, error: "缺少 workDir 或 relativePath" };
  const absPath = path.join(workDir, relativePath);
  try {
    ensureInsideWorkDir(absPath, workDir);
  } catch {
    return { ok: false, error: "路径超出工作目录" };
  }
  try {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return { ok: false, error: "data URL 格式错误" };
    const buf = Buffer.from(m[2], "base64");
    const ext = (m[1] === "image/png" ? ".png" : m[1] === "image/webp" ? ".webp" : m[1] === "image/gif" ? ".gif" : ".jpg");
    const finalPath = path.extname(absPath) ? absPath : absPath + ext;
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.writeFile(finalPath, buf);
    const finalRelative = path.relative(workDir, finalPath).replace(/\\/g, "/");
    return { ok: true, relativePath: finalRelative };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});
