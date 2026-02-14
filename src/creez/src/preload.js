const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("creez", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  selectDirectory: () => ipcRenderer.invoke("dialog:selectDirectory"),
  showSaveDialog: (options) => ipcRenderer.invoke("dialog:showSaveDialog", options),
  writeFileAbsolute: (filePath, content) =>
    ipcRenderer.invoke("fs:writeFileAbsolute", filePath, content),
  readDirTree: (workDir, maxDepth) => ipcRenderer.invoke("fs:readDirTree", workDir, maxDepth),
  readFile: (filePath, workDir) => ipcRenderer.invoke("fs:readFile", filePath, workDir),
  writeFile: (filePath, content, workDir) =>
    ipcRenderer.invoke("fs:writeFile", filePath, content, workDir),
  pathExists: (filePath, workDir, excludePath) =>
    ipcRenderer.invoke("fs:exists", filePath, workDir, excludePath),
  createFile: (filePath, workDir) => ipcRenderer.invoke("fs:createFile", filePath, workDir),
  createFolder: (dirPath, workDir) => ipcRenderer.invoke("fs:createFolder", dirPath, workDir),
  renamePath: (oldPath, newPath, workDir) =>
    ipcRenderer.invoke("fs:rename", oldPath, newPath, workDir),
  movePath: (oldPath, newPath, workDir) => ipcRenderer.invoke("fs:move", oldPath, newPath, workDir),
  deletePath: (targetPath, workDir) => ipcRenderer.invoke("fs:delete", targetPath, workDir),
  copyPath: (targetPath, workDir) => ipcRenderer.invoke("fs:copyPath", targetPath, workDir),
  revealInFolder: (targetPath, workDir) =>
    ipcRenderer.invoke("fs:revealInFolder", targetPath, workDir),
  watchWorkDir: (workDir) => ipcRenderer.invoke("fs:watchWorkDir", workDir),

  listSkills: (workDir) => ipcRenderer.invoke("skills:list", workDir),
  readSkill: (workDir, name) => ipcRenderer.invoke("skills:read", workDir, name),
  saveSkill: (workDir, skill) => ipcRenderer.invoke("skills:save", workDir, skill),
  deleteSkill: (workDir, name) => ipcRenderer.invoke("skills:delete", workDir, name),
  showSaveConfirm: (message) => ipcRenderer.invoke("dialog:saveConfirm", message),
  getCreezUserId: () => ipcRenderer.invoke("creez:getUserId"),
  imageGenGeneratePrompt: (opts) => ipcRenderer.invoke("imageGen:generatePrompt", opts),
  imageGenCreate: (opts) => ipcRenderer.invoke("imageGen:create", opts),
  imageGenPoll: (opts) => ipcRenderer.invoke("imageGen:poll", opts),
  imageGenDownloadAndSave: (opts) => ipcRenderer.invoke("imageGen:downloadAndSave", opts),
  videoGenCreate: (opts) => ipcRenderer.invoke("videoGen:create", opts),
  videoGenPoll: (opts) => ipcRenderer.invoke("videoGen:poll", opts),
  readFileAsDataUrl: (filePath, workDir) => ipcRenderer.invoke("file:readAsDataUrl", filePath, workDir),
  saveDataUrl: (opts) => ipcRenderer.invoke("file:saveDataUrl", opts),
  on: (channel, fn) => {
    ipcRenderer.on(channel, (_event, ...args) => fn(...args));
  },
  send: (channel, ...args) => {
    ipcRenderer.send(channel, ...args);
  },
});
