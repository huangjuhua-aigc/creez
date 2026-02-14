import { marked } from "marked";
import {
  renderSceneBoardEditor as renderSceneBoardEditorModule,
  isTabDirty as isTabDirtyModule,
  renderTabs as renderTabsModule,
  reorderTabs as reorderTabsModule,
  closeTab as closeTabModule,
  renderEditor as renderEditorModule,
} from "./modules/workspace/index.js";
import { createFileTreeModule } from "./modules/file-tree/index.js";
import { createChatModule } from "./modules/chat/index.js";
import {
  showConfirm as showConfirmModule,
} from "./modules/ui/modals.js";

const mainView = document.getElementById("main-view");
const configForm = document.getElementById("config-form");
const providerInput = document.getElementById("provider-input");
const apikeyInput = document.getElementById("apikey-input");
const modelInput = document.getElementById("model-input");
const workdirInput = document.getElementById("workdir-input");
const pickWorkdirButton = document.getElementById("pick-workdir");
const treeSearchInput = document.getElementById("tree-search-input");
const openConfigButton = document.getElementById("open-config");
const configModal = document.getElementById("config-modal");
const closeConfigButton = document.getElementById("close-config");
const cancelConfigButton = document.getElementById("cancel-config");

const fileTreeContainer = document.getElementById("file-tree");
const refreshTreeButton = document.getElementById("refresh-tree");
const tabsContainer = document.getElementById("tabs");
const editorContent = document.getElementById("editor-content");

const chatMessages = document.getElementById("chat-messages");
const chatInputArea = document.getElementById("chat-input-area");
const chatAttachmentsEl = document.getElementById("chat-attachments");
const chatUploadImage = document.getElementById("chat-upload-image");
const chatUploadVideo = document.getElementById("chat-upload-video");
const btnUploadImage = document.getElementById("btn-upload-image");
const btnUploadVideo = document.getElementById("btn-upload-video");
const chatInputWrap = document.querySelector(".chat-input-inner");
const sendMessageButton = document.getElementById("send-message");
const mentionDropdown = document.getElementById("mention-dropdown");

const contextMenu = document.getElementById("context-menu");

let currentConfig = null;
let treeData = null;
let workspaceFiles = [];
let openTabs = [];
let activeTabPath = null;
let selectedTreePath = null;
let recentFiles = [];
let treeQuery = "";
let fileTreeModule = null;
let chatModule = null;

/** 文件类型 -> Codicon 类名（参考 VS Code）。分镜板用导演板 emoji。 */
const FILE_ICON_MAP = {
  scene_board: "emoji:🎬",
  time_line: "codicon-file",
  js: "codicon-file-code",
  mjs: "codicon-file-code",
  cjs: "codicon-file-code",
  ts: "codicon-file-code",
  tsx: "codicon-file-code",
  jsx: "codicon-file-code",
  json: "codicon-file",
  html: "codicon-file-code",
  htm: "codicon-file-code",
  css: "codicon-file-code",
  scss: "codicon-file-code",
  less: "codicon-file-code",
  md: "codicon-file",
  yml: "codicon-file",
  yaml: "codicon-file",
  py: "codicon-file-code",
  java: "codicon-file-code",
  c: "codicon-file-code",
  cpp: "codicon-file-code",
  h: "codicon-file-code",
  hpp: "codicon-file-code",
  go: "codicon-file-code",
  rs: "codicon-file-code",
  sql: "codicon-file-code",
  sh: "codicon-file-code",
  bat: "codicon-file-code",
  cmd: "codicon-file-code",
  ps1: "codicon-file-code",
  pdf: "codicon-file-pdf",
  png: "codicon-file-media",
  jpg: "codicon-file-media",
  jpeg: "codicon-file-media",
  gif: "codicon-file-media",
  svg: "codicon-file-media",
  webp: "codicon-file-media",
};

function getFileIcon(path) {
  const ext = (path.split(/[/\\\\]/).pop() || "").split(".").pop()?.toLowerCase() || "";
  const mapped = FILE_ICON_MAP[ext];
  if (mapped?.startsWith("emoji:")) return { type: "emoji", char: mapped.slice(6) };
  if (mapped) return { type: "codicon", class: mapped };
  return { type: "codicon", class: "codicon-file-text" };
}
let chatHistory = [];
let activeStreamController = null;

// 模型名称由用户自行输入，此处仅列出 provider 下拉项（与 pi-ai 及 Creez 自定义一致）
const PROVIDER_OPTIONS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "minimax",
  "minimax-cn",
  "azure-openai-responses",
  "openai-codex",
  "zai",
  "doubao",
];

function fillConfigForm(config) {
  const provider = config?.modelProvider || "openai";
  providerInput.innerHTML = "";
  PROVIDER_OPTIONS.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    providerInput.appendChild(option);
  });
  providerInput.value = provider;
  modelInput.value = config?.modelName || "";
  apikeyInput.value = config?.apiKey || "";
  workdirInput.value = config?.workDir || "";
}

function showView(view) {
  mainView.classList.add("hidden");
  view.classList.remove("hidden");
}

async function loadConfig() {
  const config = await window.creez.getConfig();
  showView(mainView);
  currentConfig = config || {};
  fillConfigForm(currentConfig);

  const hasWorkDir = !!(currentConfig?.workDir && String(currentConfig.workDir).trim());
  if (!hasWorkDir) {
    await promptWorkdirIfNeeded("您尚未设置工作目录，建议在设置中选择工作目录以便管理项目文件。点击「确定」打开设置。");
  } else {
    await refreshFileTree();
    window.creez.watchWorkDir(currentConfig.workDir).catch(() => {});
    initAgentSession();
  }
}

/** 使用 createAgentSession 初始化 Pi Agent（OpenClaw 方式）；配置就绪或保存后调用 */
function initAgentSession() {
  if (!currentConfig?.workDir || !currentConfig?.modelProvider || !(currentConfig?.modelName || "").trim() || !(currentConfig?.apiKey || "").trim()) return;
  window.creez.send("agent:init", {
    provider: currentConfig.modelProvider,
    modelId: (currentConfig.modelName || "").trim(),
    apiKey: (currentConfig.apiKey || "").trim(),
    workDir: currentConfig.workDir,
  });
}

async function refreshFileTree() {
  if (!currentConfig?.workDir?.trim()) {
    await promptWorkdirIfNeeded("刷新文件树需要先设置工作目录。点击「确定」打开设置。");
    return;
  }
  try {
    treeData = await window.creez.readDirTree(currentConfig.workDir, 6);
  } catch (error) {
    alert("读取目录失败，请检查工作目录权限。");
    return;
  }
  workspaceFiles = [];
  flattenTree(treeData);
  fileTreeContainer.innerHTML = "";
  renderTree(treeData, fileTreeContainer);
  if (currentConfig?.workDir) window.creez.watchWorkDir(currentConfig.workDir).catch(() => {});
}

function flattenTree(node) {
  if (!node) return;
  if (node.type === "file") {
    workspaceFiles.push(node);
    return;
  }
  if (node.children) {
    node.children.forEach(flattenTree);
  }
}

function renderTree(node, container) {
  fileTreeModule?.renderTree(node, container);
}

function startInlineCreate(type) {
  fileTreeModule?.startInlineCreate(type);
}

function startInlineRename(path) {
  fileTreeModule?.startInlineRename(path);
}

function setActiveTreeItem(path) {
  selectedTreePath = path;
  document.querySelectorAll(".tree-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.path === path);
  });
}

function toggleDirectory(path) {
  fileTreeModule?.toggleDirectory(path);
}

function showContextMenu(x, y, targetPath, targetType) {
  fileTreeModule?.showContextMenu(x, y, targetPath, targetType);
}

function hideContextMenu() {
  fileTreeModule?.hideContextMenu();
}

async function openFile(filePath) {
  const existing = openTabs.find((tab) => tab.path === filePath);
  if (!existing) {
    let payload = null;
    try {
      payload = await window.creez.readFile(filePath, currentConfig.workDir);
    } catch (error) {
      alert("读取文件失败。");
      return;
    }
    const tab = {
      path: filePath,
      name: filePath.split(/[/\\\\]/).pop(),
      data: payload,
      draft: payload.kind === "text" ? payload.content : "",
      savedContent: payload.kind === "text" ? payload.content : "",
    };
    openTabs.push(tab);
  }
  activateTab(filePath);
  addRecentFile(filePath);
}

function addRecentFile(filePath) {
  recentFiles = [filePath, ...recentFiles.filter((item) => item !== filePath)].slice(0, 3);
}

function activateTab(filePath) {
  activeTabPath = filePath;
  renderTabs();
  renderEditor();
}

function isTabDirty(tab) {
  return isTabDirtyModule(tab);
}

function renderTabs() {
  renderTabsModule({
    tabsContainer,
    openTabs,
    activeTabPath,
    activateTab,
    closeTab,
    reorderTabs,
    isTabDirtyFn: isTabDirty,
  });
}

function reorderTabs(fromIndex, toIndex) {
  openTabs = reorderTabsModule(openTabs, fromIndex, toIndex);
  renderTabs();
}

function renderSceneBoardEditor(tab, onUpdate, _workDir, onSave) {
  const workDir = _workDir ?? currentConfig?.workDir ?? "";
  return renderSceneBoardEditorModule(tab, onUpdate, workDir, onSave);
}

async function closeTab(filePath) {
  const result = await closeTabModule({
    filePath,
    openTabs,
    activeTabPath,
    currentConfig,
    creez: window.creez,
    isTabDirtyFn: isTabDirty,
  });
  if (result.cancelled) return;
  openTabs = result.openTabs;
  activeTabPath = result.activeTabPath;
  renderTabs();
  renderEditor();
}

function renderEditor() {
  renderEditorModule({
    editorContent,
    openTabs,
    activeTabPath,
    renderTabs,
    renderEditor,
    renderSceneBoardEditor,
    onSceneBoardSave: saveActiveFile,
  });
}

async function saveActiveFile() {
  const tab = openTabs.find((item) => item.path === activeTabPath);
  if (!tab || !tab.data.isEditable) return;
  await window.creez.writeFile(tab.path, tab.draft || "", currentConfig.workDir);
  tab.savedContent = tab.draft;
  renderTabs();
}

async function saveTabsByPaths(paths) {
  if (!currentConfig?.workDir) return;
  for (const filePath of paths) {
    const tab = openTabs.find((t) => t.path === filePath);
    if (tab && isTabDirty(tab)) {
      await window.creez.writeFile(tab.path, tab.draft || "", currentConfig.workDir);
      tab.savedContent = tab.draft;
    }
  }
}

function getUnsavedTabPaths() {
  return openTabs.filter(isTabDirty).map((t) => t.path);
}

const DEFAULT_SCENE_BOARD_JSON = JSON.stringify(
  { name: "", style: "", scene_board: [], art_materials: { asset: [] } },
  null,
  2
);

async function handleContextAction(action) {
  const targetPath = contextMenu.dataset.path;
  if (!currentConfig?.workDir) return;

  if (targetPath && targetPath === currentConfig.workDir && ["rename", "delete"].includes(action)) {
    alert("工作目录不能执行该操作。");
    return;
  }

  if (action === "delete" && targetPath) {
    const ok = await showConfirm("确认删除吗？");
    if (!ok) return;
    await window.creez.deletePath(targetPath, currentConfig.workDir);
  }

  if (action === "copy-path") {
    await window.creez.copyPath(targetPath || currentConfig.workDir, currentConfig.workDir);
  }

  if (action === "reveal") {
    await window.creez.revealInFolder(targetPath || currentConfig.workDir, currentConfig.workDir);
  }

  await refreshFileTree();
}

function pathSeparator() {
  return currentConfig?.workDir?.includes("\\") ? "\\" : "/";
}

function joinPath(...parts) {
  const separator = pathSeparator();
  const raw = parts.filter(Boolean).join(separator);
  return raw.replace(/[\\/]+/g, separator);
}

function initModules() {
  fileTreeModule = createFileTreeModule({
    fileTreeContainer,
    contextMenu,
    getTreeQuery: () => treeQuery,
    getTreeData: () => treeData,
    getCurrentConfig: () => currentConfig,
    getFileIcon,
    joinPath,
    pathSeparator,
    windowCreez: window.creez,
    defaultSceneBoardJson: DEFAULT_SCENE_BOARD_JSON,
    openFile,
    setActiveTreeItem,
    refreshFileTree,
  });
  chatModule = createChatModule({
    chatMessages,
    chatInputArea,
    chatAttachmentsEl,
    chatUploadImage,
    chatUploadVideo,
    btnUploadImage,
    btnUploadVideo,
    chatInputWrap,
    sendMessageButton,
    mentionDropdown,
    renderMarkdownToSafeHtml,
    getWorkspaceFiles: () => workspaceFiles,
    getRecentFiles: () => recentFiles,
    listSkillNames,
    onSendMessage: (finalMessage, attachmentsToSend) => sendMessageToAgent(finalMessage, attachmentsToSend),
  });
  chatModule.init();
}

/** 供聊天输入 /skill:xxx 补全使用，仅拉取 skill 名称列表 */
async function listSkillNames(query) {
  if (!currentConfig?.workDir) return [];
  const items = await window.creez.listSkills(currentConfig.workDir);
  const normalized = (query || "").toLowerCase();
  return items
    .map((item) => item.name)
    .filter((name) => name.toLowerCase().includes(normalized))
    .slice(0, 20);
}

function openConfigModal() {
  configModal.classList.remove("hidden");
}

/** 工作目录为空时提示用户设置，不阻碍应用运行；返回 true 表示用户点击了「确定」去打开设置 */
async function promptWorkdirIfNeeded(message) {
  const go = await showConfirm(message || "您尚未设置工作目录，建议在设置中选择工作目录以便管理项目文件。点击「确定」打开设置。");
  if (go) openConfigModal();
  return go;
}

function closeConfigModal() {
  configModal.classList.add("hidden");
}

function showConfirm(message) {
  return showConfirmModule({ message });
}

/**
 * 从对话展示/历史中移除工具调用段落，不把 <|tool_calls_section_begin|>...<|tool_calls_section_end|> 等返回给用户。
 * 与 Python Agent 一致：只展示面向用户的文本，工具调用仅用于执行。
 */
function stripToolCallSections(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, "")
    .replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/g, "");
  return out.trim();
}

const MARKDOWN_SAFE_TAGS = new Set(
  "p br strong b em i code pre ul ol li a h1 h2 h3 h4 h5 h6 blockquote hr span div".split(" ")
);
const MARKDOWN_BLOCK_TAGS = new Set("script iframe form object embed style link meta input button".split(" "));

function sanitizeHtmlForChat(html) {
  if (typeof html !== "string" || !html) return "";
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const walk = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node.tagName || "").toLowerCase();
    if (MARKDOWN_BLOCK_TAGS.has(tag)) {
      node.remove();
      return;
    }
    if (!MARKDOWN_SAFE_TAGS.has(tag)) {
      const children = [...node.childNodes];
      node.replaceWith(...children);
      children.filter((c) => c.nodeType === Node.ELEMENT_NODE).forEach(walk);
      return;
    }
    if (tag === "a") {
      const href = (node.getAttribute("href") || "").trim();
      if (href.startsWith("javascript:") || href.startsWith("data:")) node.removeAttribute("href");
    }
    for (const name of [...node.attributes].map((a) => a.name)) {
      if (name.startsWith("on") || name === "style") node.removeAttribute(name);
    }
    node.childNodes.forEach((c) => walk(c));
  };
  walk(wrap);
  return wrap.innerHTML;
}

function renderMarkdownToSafeHtml(text) {
  if (typeof text !== "string") return "";
  if (!text.trim()) return "";
  try {
    const raw = marked.parse(text, { async: false });
    return sanitizeHtmlForChat(typeof raw === "string" ? raw : String(raw));
  } catch {
    return sanitizeHtmlForChat(text.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  }
}

/** 当前流式回复的会话状态，由主进程 agent:event 更新（与 pi-mono AgentInterface 一致） */
let currentStream = null;

/**
 * 用户 query 传给 session.prompt(text)。会话状态由主进程 Pi AgentSession 持有；
 * 只发当前输入，不传历史；渲染进程通过 agent:event 更新流式气泡与本地 chatHistory 展示。
 */
async function sendMessageToAgent(text, attachments = []) {
  if (activeStreamController) {
    window.creez.send("agent:abort");
    activeStreamController = null;
  }
  currentStream = null;

  const provider = currentConfig?.modelProvider;
  const modelName = currentConfig?.modelName;
  const apiKey = (currentConfig?.apiKey || "").trim();

  if (!provider || !modelName || !apiKey) {
    chatModule?.appendMessage("请先在设置中配置模型供应商、模型名称与 API Key。", "assistant");
    return;
  }
  if (!currentConfig?.workDir?.trim()) {
    await promptWorkdirIfNeeded("发送消息需要先设置工作目录。点击「确定」打开设置。");
    return;
  }

  let userContent = text;
  const images = [];
  if (attachments.length > 0) {
    attachments.forEach((att) => {
      if (att.type === "image" && att.dataUrl) {
        const match = att.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        images.push({
          type: "image",
          data: match ? match[2] : att.dataUrl.replace(/^data:[^;]+;base64,/, ""),
          mimeType: match ? match[1] : "image/png",
        });
      }
    });
    if (text) userContent = text;
  }

  const assistantMsg = chatModule?.appendMessage("", "assistant");
  if (!assistantMsg) return;
  const contentEl = document.createElement("div");
  contentEl.className = "chat-message-content";
  contentEl.textContent = "";
  const breathingEl = document.createElement("span");
  breathingEl.className = "chat-breathing";
  breathingEl.setAttribute("aria-hidden", "true");
  assistantMsg.textContent = "";
  assistantMsg.appendChild(contentEl);
  assistantMsg.appendChild(breathingEl);

  currentStream = { assistantMsg, contentEl, breathingEl, fullText: "", userContent };
  activeStreamController = { active: true };

  // 测试用 log：发送内容与附件
  const logText = typeof userContent === "string" ? userContent : "(多模态)";
  console.log("[Creez] 发送对话:", { text: logText.slice(0, 80) + (logText.length > 80 ? "…" : ""), imagesCount: images.length });
  window.creez.send("agent:prompt", { text: userContent || "", images });
}

pickWorkdirButton.addEventListener("click", async () => {
  const selected = await window.creez.selectDirectory();
  if (selected) {
    workdirInput.value = selected;
  }
});

configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const config = {
    modelProvider: providerInput.value.trim(),
    apiKey: apikeyInput.value.trim(),
    modelName: modelInput.value.trim(),
    workDir: workdirInput.value.trim(),
  };
  if (!config.modelProvider || !config.modelName || !config.workDir) {
    alert("请填写完整配置。");
    return;
  }
  try {
    const result = await window.creez.saveConfig(config);
    if (result && result.ok === false) {
      alert("配置保存失败：" + (result.error || "未知错误"));
      return;
    }
    currentConfig = config;
    closeConfigModal();
    await refreshFileTree();
    initAgentSession();
  } catch (e) {
    alert("配置保存失败：" + (e && e.message ? e.message : String(e)));
  }
});

openConfigButton.addEventListener("click", () => {
  fillConfigForm(currentConfig || {});
  openConfigModal();
});

refreshTreeButton.addEventListener("click", () => refreshFileTree());
closeConfigButton?.addEventListener("click", closeConfigModal);
cancelConfigButton.addEventListener("click", closeConfigModal);
configModal.addEventListener("click", (event) => {
  if (event.target === configModal) {
    closeConfigModal();
  }
});

// 模型名称为用户输入，切换 provider 时无需改动

treeSearchInput.addEventListener("input", (event) => {
  treeQuery = event.target.value.trim();
  fileTreeContainer.innerHTML = "";
  renderTree(treeData, fileTreeContainer);
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "s") {
    event.preventDefault();
    saveActiveFile();
  }
});

document.addEventListener("click", () => {
  hideContextMenu();
  chatModule?.hideDropdown();
});

contextMenu.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-action]");
  const action = btn?.dataset?.action;
  if (action) {
    hideContextMenu();
    if (action === "new-file" || action === "new-folder" || action === "new-scene-board") {
      startInlineCreate(
        action === "new-scene-board" ? "scene_board" : action === "new-file" ? "file" : "folder"
      );
      return;
    }
    if (action === "rename" && contextMenu.dataset.path) {
      startInlineRename(contextMenu.dataset.path);
      return;
    }
    try {
      await handleContextAction(action);
    } catch (e) {
      alert("操作失败: " + (e?.message || String(e)));
    }
  }
});

window.addEventListener("contextmenu", (event) => {
  if (event.target.closest("#file-tree")) return;
  hideContextMenu();
});

fileTreeContainer.addEventListener("contextmenu", (event) => {
  if (event.target.closest(".tree-item")) return;
  event.preventDefault();
  if (currentConfig?.workDir) {
    showContextMenu(event.clientX, event.clientY, currentConfig.workDir, "blank");
  }
});

let treeInvalidateTimer = null;
window.creez.on("fs:treeInvalidate", () => {
  clearTimeout(treeInvalidateTimer);
  treeInvalidateTimer = setTimeout(() => refreshFileTree(), 400);
});

window.creez.on("app:checkUnsaved", () => {
  const paths = getUnsavedTabPaths();
  window.creez.send("app:unsavedResult", { hasUnsaved: paths.length > 0, paths });
});

window.creez.on("app:saveAndQuit", async (paths) => {
  await saveTabsByPaths(paths);
  window.creez.send("app:quitDone");
});

// 调试：是否打印每条 message 事件的完整结构（便于查大模型回复/报错）
const DEBUG_DUMP_MESSAGE_EVENTS = true;

// 订阅 Pi AgentSession 事件（与 AgentInterface session.subscribe 一致）
// 注意：Pi 顺序为先 message_end(用户)，再 message_start(助理)、message_update(助理)、message_end(助理)，只在助理结束时清空 currentStream
window.creez.on("agent:event", (ev) => {
  if (ev.type !== "message_update") {
    console.log("[Creez] agent:event", ev.type, ev.message?.role != null ? `role=${ev.message.role}` : "");
  }
  if (DEBUG_DUMP_MESSAGE_EVENTS && (ev.type === "message_update" || ev.type === "message_end")) {
    const safe = { type: ev.type, role: ev.message?.role, hasContent: ev.message?.content != null };
    if (ev.message?.content != null) {
      if (typeof ev.message.content === "string") safe.contentPreview = ev.message.content.slice(0, 100);
      else if (Array.isArray(ev.message.content)) {
        const textPart = ev.message.content.find((c) => c && c.type === "text");
        safe.contentPreview = textPart?.text != null ? String(textPart.text).slice(0, 100) : "(array)";
      }
    }
    console.log("[Creez] 前端收到 message 事件:", safe);
  }
  switch (ev.type) {
    case "agent_ready":
      break;
    case "agent_start":
    case "message_start":
      break;
    case "message_update":
      if (ev.message?.role !== "assistant") {
        if (DEBUG_DUMP_MESSAGE_EVENTS) console.log("[Creez] 跳过 message_update: role 不是 assistant", ev.message?.role);
        return;
      }
      if (!currentStream) {
        if (DEBUG_DUMP_MESSAGE_EVENTS) console.warn("[Creez] 跳过 message_update: currentStream 为 null");
        return;
      }
      if (ev.message?.content) {
        const textPart = Array.isArray(ev.message.content) ? ev.message.content.find((c) => c.type === "text") : null;
        const raw = textPart && textPart.text != null ? textPart.text : (typeof ev.message.content === "string" ? ev.message.content : "");
        if (raw === undefined) break;
        const prev = currentStream.fullText || "";
        if (prev.length > 0 && raw.length >= prev.length && raw.startsWith(prev)) {
          currentStream.fullText = raw;
        } else {
          currentStream.fullText = prev + raw;
        }
        const displayText = stripToolCallSections(currentStream.fullText);
        const html = renderMarkdownToSafeHtml(displayText);
        if (currentStream.contentEl) {
          currentStream.contentEl.innerHTML = html;
        } else {
          currentStream.assistantMsg.innerHTML = html;
        }
        if (displayText.length > 0 && !currentStream._loggedFirstChunk) {
          console.log("[Creez] 模型回复(流式):", displayText.slice(0, 120) + (displayText.length > 120 ? "…" : ""));
          currentStream._loggedFirstChunk = true;
        }
      }
      break;
    case "message_end":
      // 只更新 currentStream.fullText，不做收尾；整轮对话结束以 agent_end 为准
      if (ev.message?.role !== "assistant") {
        if (DEBUG_DUMP_MESSAGE_EVENTS) console.log("[Creez] 跳过 message_end: role 不是 assistant", ev.message?.role);
        break;
      }
      if (!currentStream) break;
      {
        const raw =
          typeof ev.message?.content === "string"
            ? ev.message.content
            : (Array.isArray(ev.message?.content) && ev.message.content.find((c) => c.type === "text"))?.text ?? "";
        if (raw) currentStream.fullText = raw;
      }
      break;
    case "agent_end":
      // 整轮对话结束只以 agent_end 为准：隐藏呼吸、写入历史、清空 currentStream
      if (DEBUG_DUMP_MESSAGE_EVENTS && currentStream) console.log("[Creez] agent_end 收尾，currentStream.fullText 长度:", (currentStream.fullText || "").length);
      if (currentStream) {
        const agentEndDisplay = stripToolCallSections(currentStream.fullText || "");
        if (currentStream.breathingEl) currentStream.breathingEl.classList.add("hidden");
        const endHtml = renderMarkdownToSafeHtml(agentEndDisplay);
        if (currentStream.contentEl) {
          currentStream.contentEl.innerHTML = endHtml;
        } else {
          currentStream.assistantMsg.innerHTML = endHtml;
        }
        if (agentEndDisplay.trim() || currentStream.userContent) {
          chatHistory.push({ role: "user", content: currentStream.userContent });
          chatHistory.push({ role: "assistant", content: agentEndDisplay });
        }
        console.log("[Creez] 模型回复(agent_end 收尾):", agentEndDisplay.slice(0, 200) + (agentEndDisplay.length > 200 ? "…" : ""));
        currentStream = null;
        activeStreamController = null;
      }
      break;
    default:
      break;
  }
});
window.creez.on("agent:eventError", (message) => {
  const text = message || "请求失败";
  console.log("[Creez] agent:eventError", text);
  if (currentStream) {
    if (currentStream.breathingEl) currentStream.breathingEl.classList.add("hidden");
    if (currentStream.contentEl) {
      currentStream.contentEl.textContent = text;
    } else {
      currentStream.assistantMsg.textContent = text;
    }
    currentStream = null;
    activeStreamController = null;
  }
  // 用错误弹窗区别于正常回复，避免用户忽略
  window.alert("Creez 请求错误\n\n" + text);
});

initModules();
loadConfig();
