const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const { ensureCreezDirs } = require("./creezPaths.cjs");

function writeCrashLog(message) {
  try {
    const logDir = path.join(os.homedir(), ".creez", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "startup.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
    return logPath;
  } catch {
    return null;
  }
}

process.on("uncaughtException", (err) => {
  const msg = err && err.stack ? err.stack : String(err);
  const logPath = writeCrashLog("uncaughtException: " + msg);
  if (typeof dialog !== "undefined" && dialog.showErrorBox) {
    dialog.showErrorBox(
      "Creez 启动失败",
      "应用发生未捕获错误。\n\n" + (logPath ? `日志: ${logPath}` : msg)
    );
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  const msg = reason && (reason.stack || reason) ? String(reason.stack || reason) : String(reason);
  writeCrashLog("unhandledRejection: " + msg);
});
const { AppStateStore } = require("./appStateStore.cjs");
const { registerAppStateIpc } = require("./appStateIpc.cjs");
const { registerChatIpc } = require("./chatIpc.cjs");
const { registerContactIpc } = require("./contactIpc.cjs");
const { registerSettingsIpc } = require("./settingsIpc.cjs");
const { registerWorkspaceIpc } = require("./workspaceIpc.cjs");
const { registerAgentIpc } = require("./agentIpc.cjs");
const { registerAttachmentIpc } = require("./attachmentIpc.cjs");
const { startSyncPullTask, stopSyncPullTask } = require("./syncPullTask.cjs");
const { CreezDatabase } = require("./db/database.cjs");
const { seedIfEmpty } = require("./db/seed.cjs");
const { AppStateRepository } = require("./repositories/appStateRepository.cjs");
const { ChatRepository } = require("./repositories/chatRepository.cjs");
const { ContactRepository } = require("./repositories/contactRepository.cjs");
const { TaskRepository } = require("./repositories/taskRepository.cjs");
const { AssistantConfigRepository } = require("./repositories/assistantConfigRepository.cjs");
const { ChannelConfigRepository } = require("./repositories/channelConfigRepository.cjs");
const { setSchedulerDeps } = require("./scheduler/deps.cjs");
const cronManager = require("./scheduler/cronManager.cjs");
const { CHANNELS } = require("./channels.cjs");
const { registerChannelIpc } = require("./channelIpc.cjs");
const { registerTaskIpc } = require("./taskIpc.cjs");
const { ChannelManager } = require("./channel/ChannelManager.cjs");
const { MemoryStore } = require("./memoryStore.cjs");
const { SkillManager } = require("./skillManager.cjs");

const isMac = process.platform === "darwin";
const isDev = !app.isPackaged || Boolean(process.env.VITE_DEV_SERVER_URL);
let creezDb = null;
let channelManager = null;

function getStartupLogPath() {
  const homeDir = app.getPath("home");
  return path.join(homeDir, ".creez", "logs", "startup.log");
}

/** Write a line to ~/.creez/logs/startup.log (and console). Call only after app is ready. */
function startupLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    const logPath = getStartupLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line + "\n", "utf8");
  } catch (e) {
    console.error("startupLog write failed:", e);
  }
}

function appendStartupLog(error) {
  const logPath = getStartupLogPath();
  const message = error && error.stack ? error.stack : String(error);
  const content = `[${new Date().toISOString()}] ${message}\n`;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, content, "utf8");
  return logPath;
}

function escapeHtml(s) {
  if (s == null) return "";
  const str = String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

function showStartupErrorWindow(error, logPath) {
  const title = "Creez 启动失败";
  const detail = error && error.stack ? error.stack : String(error);
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 24px;
      background: #fff;
      color: #1a1a1a;
      line-height: 1.5;
    }
    h1 { font-size: 18px; margin: 0 0 16px; color: #c00; }
    p { margin: 0 0 12px; }
    .log-path { font-size: 12px; color: #666; word-break: break-all; }
    pre {
      background: #f5f5f5;
      padding: 12px;
      border-radius: 6px;
      font-size: 12px;
      overflow: auto;
      max-height: 240px;
      margin: 12px 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    button {
      margin-top: 16px;
      padding: 8px 16px;
      background: #07C160;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>应用启动时发生错误，请查看下方详情或日志文件后重试。</p>
  ${logPath ? `<p class="log-path">日志文件：${escapeHtml(logPath)}</p>` : ""}
  <pre>${escapeHtml(detail)}</pre>
  <button type="button" id="closeBtn">关闭</button>
  <script>
    document.getElementById("closeBtn").onclick = function() {
      try {
        if (typeof require !== "undefined") {
          require("electron").ipcRenderer.send("startup-error-window-close");
        }
      } catch (e) {}
    };
  </script>
</body>
</html>`;
  const win = new BrowserWindow({
    width: 560,
    height: 420,
    title,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.on("closed", () => {
    app.quit();
  });
  ipcMain.once("startup-error-window-close", () => {
    if (win && !win.isDestroyed()) win.close();
  });
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  win.once("ready-to-show", () => win.show());
}

function handleStartupFailure(error) {
  const logPath = appendStartupLog(error);
  try {
    showStartupErrorWindow(error, logPath);
  } catch (e) {
    const message =
      "应用无法启动。\n\n" +
      (logPath ? `日志文件: ${logPath}\n\n` : "") +
      (error && error.stack ? error.stack : String(error));
    dialog.showErrorBox("Creez 启动失败", message);
    app.quit();
  }
}

const isDebug = process.env.CREEZ_DEBUG === "1";

/** Inline HTML for startup splash (spinner + text) to show while init runs. */
function getSplashWindowHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Creez</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(255,255,255,0.15);
      border-top-color: #07C160;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .text {
      margin-top: 20px;
      font-size: 15px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="spinner" aria-hidden="true"></div>
  <p class="text">正在启动 Creez…</p>
</body>
</html>`;
}

/** Load the main app (Vite dev or dist) into an existing window. */
function loadMainAppInto(mainWindow) {
  const basePath = app.isPackaged ? app.getAppPath() : path.join(__dirname, "..", "..");
  const indexPath = path.join(basePath, "dist", "index.html");
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(indexPath);
  }
}

/**
 * Create main window. If loadSplash is true, show spinner and return (call loadMainAppInto later).
 * If false, load main app immediately (e.g. for activate).
 */
function createWindow(loadSplash = false) {
  startupLog("createWindow: start (loadSplash=" + loadSplash + ")");
  const basePath = app.isPackaged ? app.getAppPath() : path.join(__dirname, "..", "..");
  const iconPath = path.join(basePath, "icons", "icon_256x256.png");
  const preloadPath = path.join(basePath, "electron", "preload", "index.cjs");
  const indexPath = path.join(basePath, "dist", "index.html");
  startupLog("createWindow: indexPath=" + indexPath);

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    const msg = `did-fail-load: code=${errorCode} desc=${errorDescription} url=${validatedURL}`;
    startupLog(msg);
    if (app.isPackaged && dialog && dialog.showMessageBoxSync) {
      dialog.showMessageBoxSync(mainWindow, {
        type: "error",
        title: "Creez 加载失败",
        message: "页面加载失败",
        detail: msg + "\n\n日志: " + getStartupLogPath(),
      });
    }
  });

  if (loadSplash) {
    mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(getSplashWindowHtml()));
  } else {
    loadMainAppInto(mainWindow);
  }

  // DevTools shortcuts in desktop app:
  // - F12
  // - Ctrl/Cmd + Shift + I
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key || "").toLowerCase();
    const isToggleShortcut =
      key === "f12" || ((input.control || input.meta) && input.shift && key === "i");

    if (!isToggleShortcut) return;
    mainWindow.webContents.toggleDevTools();
    event.preventDefault();
  });

  const openDevTools = isDev || isDebug;
  if (openDevTools) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.openDevTools({ mode: "detach" });
      startupLog("createWindow: DevTools opened (isDev=" + isDev + " CREEZ_DEBUG=" + !!process.env.CREEZ_DEBUG + ")");
    });
  }
  startupLog("createWindow: done");
  return mainWindow;
}

app.whenReady().then(async () => {
  startupLog("app ready");
  Menu.setApplicationMenu(null);
  try {
    const creezHome = app.getPath("home");
    ensureCreezDirs(creezHome);
    startupLog("ensureCreezDirs done");

    // Show window with spinner immediately so user sees progress during init
    const mainWindow = createWindow(true);
    startupLog("splash window shown");

    creezDb = new CreezDatabase({ homeDir: creezHome }).init();
    seedIfEmpty(creezDb.db, { homeDir: creezHome });
    startupLog("DB init and seed done");
    const appStateRepository = new AppStateRepository(creezDb.db);
    const chatRepository = new ChatRepository(creezDb.db);
    const contactRepository = new ContactRepository(creezDb.db);
    const taskRepository = new TaskRepository(creezDb.db);
    const assistantConfigRepository = new AssistantConfigRepository(creezDb.db);
    const channelConfigRepository = new ChannelConfigRepository(creezDb.db);
    const memoryStore = new MemoryStore({ homeDir: creezHome });
    const skillManager = new SkillManager({ homeDir: creezHome });

    const { ensureBundledSkillsInConfig } = require("./ensureSkillsConfig.cjs");
    const defaultContactId = contactRepository.getDefaultAssistantConfigId();
    await ensureBundledSkillsInConfig(skillManager, assistantConfigRepository, defaultContactId);

    // Sync default bot's model config (with API key) to all other bots so RoundCloser etc. have correct config in DB
    const rawDefault = assistantConfigRepository.getRawConfigById(defaultContactId);
    if (rawDefault?.models?.length && typeof contactRepository.getNonDefaultBotAssistantConfigIds === "function") {
      const otherIds = contactRepository.getNonDefaultBotAssistantConfigIds();
      for (const configId of otherIds) {
        try {
          assistantConfigRepository.saveConfigById(configId, { models: rawDefault.models });
        } catch (e) {
          if (typeof console?.warn === "function") console.warn("[creez] syncAllBotModelConfigFromDefault", configId, e?.message || e);
        }
      }
    }

    const appStateStore = new AppStateStore({ repository: appStateRepository, homeDir: creezHome });
    registerAppStateIpc(ipcMain, appStateStore);
    registerChatIpc(ipcMain, chatRepository);
    registerContactIpc(ipcMain, contactRepository);
    channelManager = new ChannelManager({
      channelConfigRepository,
      contactRepository,
      chatRepository,
      assistantConfigRepository,
      appStateStore,
    });
    registerChannelIpc(ipcMain, { channelConfigRepository, contactRepository, channelManager });
    registerSettingsIpc(ipcMain, assistantConfigRepository, memoryStore, skillManager, contactRepository, { creezHome });
    registerTaskIpc(ipcMain);
    registerWorkspaceIpc(ipcMain, appStateStore);
    registerAttachmentIpc(ipcMain);
    registerAgentIpc(ipcMain, {
      assistantConfigRepository,
      appStateStore,
      memoryStore,
      contactRepository,
      chatRepository,
      creezHome,
    });

    function sendToRenderer(payload) {
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.webContents && !win.isDestroyed()) {
            win.webContents.send(CHANNELS.CHAT_MESSAGE_APPENDED, payload);
          }
        }
      } catch (e) {
        console.warn("[creez:scheduler] sendToRenderer failed", e?.message || e);
      }
    }

    setSchedulerDeps({ taskRepository, cronManager });
    cronManager.setDeps({
      taskRepository,
      chatRepository,
      contactRepository,
      assistantConfigRepository,
      appStateStore,
      memoryStore,
      creezHome,
      sendToRenderer,
    });
    await cronManager.initAll();

    loadMainAppInto(mainWindow);
    startupLog("after loadMainAppInto");
    startSyncPullTask(contactRepository);
    startupLog("before channelManager.startAll");
    channelManager.startAll()
      .then(() => startupLog("channelManager.startAll done"))
      .catch((e) => {
        const msg = e?.message || String(e);
        startupLog("channelManager.startAll error: " + msg);
        console.warn("[creez] channelManager.startAll:", msg);
      });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(false);
      }
    });
  } catch (error) {
    handleStartupFailure(error);
  }
}).catch((error) => {
  handleStartupFailure(error);
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

app.on("before-quit", async () => {
  stopSyncPullTask();
  if (channelManager) {
    await channelManager.stopAll().catch(() => {});
    channelManager = null;
  }
  if (creezDb) {
    creezDb.close();
    creezDb = null;
  }
});
