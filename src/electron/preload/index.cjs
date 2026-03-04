const { contextBridge, ipcRenderer } = require("electron");
const { CHANNELS } = require("../main/channels.cjs");

contextBridge.exposeInMainWorld("electron", {
  app: {
    getState: () => ipcRenderer.invoke(CHANNELS.APP_GET_STATE),
    setState: (payload) => ipcRenderer.invoke(CHANNELS.APP_SET_STATE, payload),
  },
  chat: {
    list: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_LIST, payload),
    getMessages: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_GET_MESSAGES, payload),
    getOrCreateByContact: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_GET_OR_CREATE_BY_CONTACT, payload),
    appendMessage: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_APPEND_MESSAGE, payload),
    updateMessage: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_UPDATE_MESSAGE, payload),
  },
  contact: {
    list: (payload) => ipcRenderer.invoke(CHANNELS.CONTACT_LIST, payload),
    createBotFromTemplate: (payload) => ipcRenderer.invoke(CHANNELS.CONTACT_CREATE_BOT_FROM_TEMPLATE, payload),
    getDefaultBotId: () => ipcRenderer.invoke(CHANNELS.CONTACT_GET_DEFAULT_BOT_ID),
  },
  channel: {
    listConfigs: (payload) => ipcRenderer.invoke(CHANNELS.CHANNEL_LIST_CONFIGS, payload ?? {}),
    saveConfig: (payload) => ipcRenderer.invoke(CHANNELS.CHANNEL_SAVE_CONFIG, payload),
    deleteConfig: (payload) => ipcRenderer.invoke(CHANNELS.CHANNEL_DELETE_CONFIG, payload),
    onNewMessage: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on("channel:newMessage", wrapped);
      return () => ipcRenderer.removeListener("channel:newMessage", wrapped);
    },
  },
  workspace: {
    getTree: (payload) => ipcRenderer.invoke(CHANNELS.WORKSPACE_GET_TREE, payload),
    create: (payload) => ipcRenderer.invoke(CHANNELS.WORKSPACE_CREATE, payload),
    rename: (payload) => ipcRenderer.invoke(CHANNELS.WORKSPACE_RENAME, payload),
    delete: (payload) => ipcRenderer.invoke(CHANNELS.WORKSPACE_DELETE, payload),
    readFile: (payload) => ipcRenderer.invoke(CHANNELS.WORKSPACE_READ_FILE, payload),
    writeFile: (payload) => ipcRenderer.invoke(CHANNELS.WORKSPACE_WRITE_FILE, payload),
  },
  settings: {
    getAssistantConfig: (payload) => ipcRenderer.invoke(CHANNELS.SETTINGS_GET_ASSISTANT_CONFIG, payload),
    getModelApiKey: (payload) => ipcRenderer.invoke(CHANNELS.SETTINGS_GET_MODEL_API_KEY, payload),
    saveAssistantConfig: (payload) => ipcRenderer.invoke(CHANNELS.SETTINGS_SAVE_ASSISTANT_CONFIG, payload),
    uploadAvatar: (payload) => ipcRenderer.invoke(CHANNELS.SETTINGS_UPLOAD_AVATAR, payload),
    selectWorkplaceDirectory: () => ipcRenderer.invoke(CHANNELS.SETTINGS_SELECT_WORKPLACE_DIRECTORY),
    readImageDataUrl: (payload) => ipcRenderer.invoke(CHANNELS.SETTINGS_READ_IMAGE_DATA_URL, payload),
    listAvailableSkills: () => ipcRenderer.invoke(CHANNELS.SETTINGS_LIST_AVAILABLE_SKILLS),
    getSkillEnv: (payload) => ipcRenderer.invoke(CHANNELS.SETTINGS_GET_SKILL_ENV, payload),
    saveSkillEnv: (payload) => ipcRenderer.invoke(CHANNELS.SETTINGS_SAVE_SKILL_ENV, payload),
  },
  memory: {
    read: (payload) => ipcRenderer.invoke(CHANNELS.MEMORY_READ, payload),
    write: (payload) => ipcRenderer.invoke(CHANNELS.MEMORY_WRITE, payload),
  },
  attachment: {
    save: (payload) => ipcRenderer.invoke(CHANNELS.ATTACHMENT_SAVE, payload),
  },
  sync: {
    onPendingMessages: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on(CHANNELS.SYNC_PENDING_MESSAGES, wrapped);
      return () => ipcRenderer.removeListener(CHANNELS.SYNC_PENDING_MESSAGES, wrapped);
    },
  },
  agent: {
    init: (payload) => ipcRenderer.send(CHANNELS.AGENT_INIT, payload),
    setModel: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_SET_MODEL, payload),
    prompt: (payload) => ipcRenderer.send(CHANNELS.AGENT_PROMPT, payload),
    abort: (chatId) => ipcRenderer.send(CHANNELS.AGENT_ABORT, chatId ?? ""),
    onEvent: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on(CHANNELS.AGENT_EVENT, wrapped);
      return () => ipcRenderer.removeListener(CHANNELS.AGENT_EVENT, wrapped);
    },
    onError: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on(CHANNELS.AGENT_EVENT_ERROR, wrapped);
      return () => ipcRenderer.removeListener(CHANNELS.AGENT_EVENT_ERROR, wrapped);
    },
  },
});
