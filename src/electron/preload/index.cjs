const { contextBridge, ipcRenderer } = require("electron");
const { CHANNELS } = require("../main/channels.cjs");

contextBridge.exposeInMainWorld("electron", {
  app: {
    getState: () => ipcRenderer.invoke(CHANNELS.APP_GET_STATE),
    setState: (payload) => ipcRenderer.invoke(CHANNELS.APP_SET_STATE, payload),
  },
  shell: {
    open: (payload) => ipcRenderer.invoke(CHANNELS.SHELL_OPEN, payload),
    showItemInFolder: (payload) => ipcRenderer.invoke(CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER, payload),
  },
  chat: {
    list: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_LIST, payload),
    getMessages: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_GET_MESSAGES, payload),
    getOrCreateByContact: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_GET_OR_CREATE_BY_CONTACT, payload),
    appendMessage: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_APPEND_MESSAGE, payload),
    updateMessage: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_UPDATE_MESSAGE, payload),
    delete: (payload) => ipcRenderer.invoke(CHANNELS.CHAT_DELETE, payload),
    onMessageAppended: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on(CHANNELS.CHAT_MESSAGE_APPENDED, wrapped);
      return () => ipcRenderer.removeListener(CHANNELS.CHAT_MESSAGE_APPENDED, wrapped);
    },
  },
  contact: {
    list: (payload) => ipcRenderer.invoke(CHANNELS.CONTACT_LIST, payload),
    createBotFromTemplate: (payload) => ipcRenderer.invoke(CHANNELS.CONTACT_CREATE_BOT_FROM_TEMPLATE, payload),
    getDefaultBotId: () => ipcRenderer.invoke(CHANNELS.CONTACT_GET_DEFAULT_BOT_ID),
    addRemoteAgent: (payload) => ipcRenderer.invoke(CHANNELS.CONTACT_ADD_REMOTE_AGENT, payload),
    delete: (payload) => ipcRenderer.invoke(CHANNELS.CONTACT_DELETE, payload),
    onListChanged: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on(CHANNELS.CONTACT_LIST_CHANGED, wrapped);
      return () => ipcRenderer.removeListener(CHANNELS.CONTACT_LIST_CHANGED, wrapped);
    },
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
  weixin: {
    qrStart: () => ipcRenderer.invoke(CHANNELS.WEIXIN_QR_START),
    qrWait: (payload) => ipcRenderer.invoke(CHANNELS.WEIXIN_QR_WAIT, payload),
    status: () => ipcRenderer.invoke(CHANNELS.WEIXIN_STATUS),
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
    onAssistantConfigChanged: (listener) => {
      const wrapped = () => listener();
      ipcRenderer.on(CHANNELS.SETTINGS_ASSISTANT_CONFIG_CHANGED, wrapped);
      return () => ipcRenderer.removeListener(CHANNELS.SETTINGS_ASSISTANT_CONFIG_CHANGED, wrapped);
    },
  },
  memory: {
    read: (payload) => ipcRenderer.invoke(CHANNELS.MEMORY_READ, payload),
    write: (payload) => ipcRenderer.invoke(CHANNELS.MEMORY_WRITE, payload),
  },
  scheduledTasks: {
    list: () => ipcRenderer.invoke(CHANNELS.SCHEDULED_TASKS_LIST),
    create: (payload) => ipcRenderer.invoke(CHANNELS.SCHEDULED_TASKS_CREATE, payload),
    update: (payload) => ipcRenderer.invoke(CHANNELS.SCHEDULED_TASKS_UPDATE, payload),
    delete: (payload) => ipcRenderer.invoke(CHANNELS.SCHEDULED_TASKS_DELETE, payload),
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
  sandbox: {
    getStatus: () => ipcRenderer.invoke(CHANNELS.SANDBOX_GET_STATUS),
    decideApproval: (payload) => ipcRenderer.invoke(CHANNELS.SANDBOX_APPROVAL_DECIDE, payload),
  },
  agentBuilder: {
    list: () => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_LIST),
    get: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_GET, payload),
    create: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_CREATE, payload),
    update: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_UPDATE, payload),
    publish: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_PUBLISH, payload),
    delete: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_DELETE, payload),
    search: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_SEARCH, payload),
    recent: () => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_RECENT),
    importOpenClaw: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_IMPORT_OPENCLAW, payload ?? {}),
    cancelOpenClawImport: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_CANCEL_OPENCLAW_IMPORT, payload ?? {}),
    onOpenClawImportProgress: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on(CHANNELS.AGENT_BUILDER_OPENCLAW_IMPORT_PROGRESS, wrapped);
      return () => ipcRenderer.removeListener(CHANNELS.AGENT_BUILDER_OPENCLAW_IMPORT_PROGRESS, wrapped);
    },
    generateQrcode: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_GENERATE_QRCODE, payload),
    getQrcode: (payload) => ipcRenderer.invoke(CHANNELS.AGENT_BUILDER_GET_QRCODE, payload),
    getDeviceId: () => ipcRenderer.invoke(CHANNELS.APP_GET_DEVICE_ID),
  },
  a2a: {
    getStatus: () => ipcRenderer.invoke(CHANNELS.A2A_GET_STATUS),
    discover: (payload) => ipcRenderer.invoke(CHANNELS.A2A_DISCOVER, payload),
    openSession: (payload) => ipcRenderer.invoke(CHANNELS.A2A_OPEN_SESSION, payload),
    sendMessage: (payload) => ipcRenderer.invoke(CHANNELS.A2A_SEND_MESSAGE, payload),
    closeSession: (payload) => ipcRenderer.invoke(CHANNELS.A2A_CLOSE_SESSION, payload),
    fetchMessages: (payload) => ipcRenderer.invoke(CHANNELS.A2A_FETCH_MESSAGES, payload),
    onSessionEvent: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on(CHANNELS.A2A_SESSION_EVENT, wrapped);
      return () => ipcRenderer.removeListener(CHANNELS.A2A_SESSION_EVENT, wrapped);
    },
    sendToRemoteBot: (payload) => ipcRenderer.invoke(CHANNELS.A2A_SEND_TO_REMOTE_BOT, payload),
    refreshRegistration: () => ipcRenderer.invoke(CHANNELS.A2A_REFRESH_REGISTRATION),
    triggerAutoDiscovery: (payload) => ipcRenderer.invoke(CHANNELS.A2A_TRIGGER_AUTO_DISCOVERY, payload),
  },
  storyboard: {
    list: () => ipcRenderer.invoke(CHANNELS.STORYBOARD_LIST),
    get: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_GET, payload),
    create: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_CREATE, payload),
    update: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_UPDATE, payload),
    getAssetUrl: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_GET_ASSET_URL, payload),
    setActive: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_SET_ACTIVE, payload),
    deleteResource: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_DELETE_RESOURCE, payload),
    deleteGeneration: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_DELETE_GENERATION, payload),
    generateImage: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_GENERATE_IMAGE, payload),
    generateVideo: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_GENERATE_VIDEO, payload),
    addResource: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_ADD_RESOURCE, payload),
    uploadLocalAsset: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_UPLOAD_LOCAL_ASSET, payload),
    agentCreate: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_AGENT_CREATE, payload),
    deleteProject: (payload) => ipcRenderer.invoke(CHANNELS.STORYBOARD_DELETE_PROJECT, payload),
  },
});
