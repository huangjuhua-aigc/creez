export {};

type AppStatePayload = {
  lastTab?: string;
  lastChatId?: string | null;
  workspaceRoot?: string | null;
  isLoggedIn?: boolean;
};

type IpcOk<T> = { ok: true; data: T };
type IpcErr = { ok: false; error: { code: string; message: string; details?: unknown } };
type IpcResult<T> = IpcOk<T> | IpcErr;

declare global {
  interface Window {
    electron?: {
      app: {
        getState: () => Promise<
          IpcResult<{
            lastTab: string;
            lastChatId: string | null;
            workspaceRoot: string | null;
            isLoggedIn: boolean;
          }>
        >;
        setState: (
          payload: AppStatePayload
        ) => Promise<IpcResult<{ updated: boolean; state: AppStatePayload }>>;
      };
      shell?: {
        open: (payload: { target: string }) => Promise<IpcResult<{ kind: string }>>;
        showItemInFolder: (payload: { path: string }) => Promise<IpcResult<{ revealed: boolean }>>;
      };
      chat: {
        list: (payload?: { limit?: number; offset?: number; keyword?: string }) => Promise<
          IpcResult<{
            items: Array<{
              id: string;
              title: string;
              contactId: string | null;
              contactAvatarPath: string | null;
              lastMessage: string | null;
              lastMessageAt: number | null;
              unreadCount: number;
              modelUsed: string | null;
              channelType?: string;
              channelChatId?: string | null;
            }>;
            total: number;
          }>
        >;
        getMessages: (payload: { chatId: string; limit?: number; before?: number }) => Promise<
          IpcResult<{
            items: Array<{
              id: string;
              chatId: string;
              sender: "user" | "assistant" | "system";
              content: string;
              botId: string | null;
              createdAt: number;
              status: "pending" | "streaming" | "done" | "error";
              modelUsed: string | null;
              channelType?: string | null;
              channelMessageId?: string | null;
            }>;
            hasMore: boolean;
            nextBefore: number | null;
          }>
        >;
        getOrCreateByContact: (payload: { contactId: string }) => Promise<
          IpcResult<{
            chatId: string;
            created: boolean;
          }>
        >;
        appendMessage: (payload: {
          id: string;
          chatId: string;
          sender: "user" | "assistant" | "system";
          botId?: string | null;
          content: string;
          status?: "pending" | "streaming" | "done" | "error";
          modelUsed?: string | null;
          errorCode?: string | null;
          errorMessage?: string | null;
          createdAt?: number;
          updatedAt?: number;
        }) => Promise<IpcResult<{ id: string; chatId: string; sender: string; createdAt: number; updatedAt: number }>>;
        updateMessage: (payload: {
          id: string;
          content?: string;
          status?: "pending" | "streaming" | "done" | "error";
          modelUsed?: string | null;
          errorCode?: string | null;
          errorMessage?: string | null;
          updatedAt?: number;
        }) => Promise<IpcResult<{ updated: boolean; id?: string }>>;
        delete: (payload: { chatId: string }) => Promise<IpcResult<{
          deleted: boolean;
          chatId: string;
          contactId?: string | null;
          messagesDeleted: number;
        }>>;
        onMessageAppended: (listener: (payload: { type?: string; chatId?: string; message?: unknown }) => void) => () => void;
      };
      contact: {
        list: (payload?: { type?: "bot" | "human" | "group" }) => Promise<
          IpcResult<{
            items: Array<{
              id: string;
              type: "bot" | "human" | "group";
              name: string;
              avatarPath: string | null;
              isDefault: boolean;
            }>;
            total: number;
          }>
        >;
        createBotFromTemplate: (payload: { templateId: string }) => Promise<
          IpcResult<{
            contactId: string;
            chatId: string;
            assistantConfigId: number;
            messageId: string;
            name: string;
          }>
        >;
        getDefaultBotId: () => Promise<IpcResult<{ botId: string }>>;
        addRemoteAgent: (payload: {
          agentId: string;
          name: string;
          avatarUrl?: string | null;
          greetingMessage?: string;
        }) => Promise<IpcResult<{ contactId: string; chatId: string | null; alreadyExists: boolean }>>;
        delete: (payload: { contactId: string }) => Promise<IpcResult<{ deleted: boolean; chatsRemoved: number }>>;
        onListChanged: (listener: (payload: unknown) => void) => () => void;
      };
      channel: {
        listConfigs: (payload?: { botId?: string } | undefined) => Promise<
          IpcResult<{
            items: Array<{
              id: string;
              botId: string;
              channelType: string;
              enabled: boolean;
              values: Record<string, string>;
              createdAt?: number;
              updatedAt?: number;
            }>;
            botId: string;
          }>
        >;
        saveConfig: (payload: {
          botId?: string;
          channelType: string;
          enabled: boolean;
          values: Record<string, string>;
        }) => Promise<IpcResult<{ id: string; updated: boolean }>>;
        deleteConfig: (payload: { botId?: string; channelType: string }) => Promise<IpcResult<{ deleted: boolean }>>;
        onNewMessage?: (listener: (payload: { chatId: string; channelType: string }) => void) => (() => void) | undefined;
      };
      workspace: {
        getTree: (payload?: { depth?: number }) => Promise<
          IpcResult<{
            rootPath: string;
            nodes: Array<{
              name: string;
              path: string;
              type: "file" | "folder";
              children?: Array<any>;
            }>;
          }>
        >;
        create: (payload: {
          parentPath: string;
          name: string;
          type: "file" | "folder";
          content?: string;
        }) => Promise<IpcResult<{ path: string }>>;
        rename: (payload: { path: string; newName: string }) => Promise<IpcResult<{ path: string }>>;
        delete: (payload: { path: string; recursive?: boolean }) => Promise<IpcResult<{ deleted: boolean }>>;
        readFile: (payload: { path: string; encoding?: "utf8" | "base64" }) => Promise<
          IpcResult<{ content: string; encoding: "utf8" | "base64"; stat: { size: number; mtimeMs: number } }>
        >;
        writeFile: (payload: {
          path: string;
          content: string;
          encoding?: "utf8" | "base64";
          createIfMissing?: boolean;
        }) => Promise<IpcResult<{ updated: boolean; stat: { size: number; mtimeMs: number } }>>;
      };
      settings: {
        getAssistantConfig: (payload?: { contactId?: string | null; assistantConfigId?: number | null }) => Promise<
          IpcResult<{
            name: string;
            avatar: string | null;
            systemPrompt: string;
            skills: Record<string, boolean>;
            models: Array<{
              id: string;
              provider: string;
              model: string;
              apiBase: string;
              apiKey: string;
              apiKeyMasked: string;
              active: boolean;
            }>;
          }>
        >;
        getModelApiKey: (payload: { modelId: string; contactId?: string | null; assistantConfigId?: number | null }) => Promise<
          IpcResult<{
            modelId: string;
            apiKey: string;
          }>
        >;
        saveAssistantConfig: (payload: {
          contactId?: string | null;
          assistantConfigId?: number | null;
          name?: string;
          avatar?: string | null;
          systemPrompt?: string;
          skills?: Record<string, boolean>;
          models?: Array<{
            id: string;
            provider: string;
            model: string;
            apiBase?: string;
            apiKey?: string;
            active?: boolean;
          }>;
        }) => Promise<IpcResult<{ updated: boolean; updatedAt: number }>>;
        uploadAvatar: (payload: { dataUrl: string; fileName?: string; contactId?: string | null; assistantConfigId?: number | null }) => Promise<
          IpcResult<{ avatarPath: string }>
        >;
        selectWorkplaceDirectory: () => Promise<IpcResult<{ path: string | null }>>;
        readImageDataUrl: (payload: { path: string }) => Promise<IpcResult<{ dataUrl: string }>>;
        listAvailableSkills: () => Promise<
          IpcResult<{
            items: Array<{ id: string; name: string; description: string; enabled: boolean }>;
          }>
        >;
        getSkillEnv: (payload: { skillId: string }) => Promise<IpcResult<{ env: Record<string, string> }>>;
        saveSkillEnv: (payload: { skillId: string; env: Record<string, string> }) => Promise<IpcResult<{ updated: boolean }>>;
        onAssistantConfigChanged?: (listener: () => void) => (() => void) | undefined;
      };
      attachment: {
        save: (payload: { buffer: ArrayBuffer; fileName: string }) => Promise<
          IpcResult<{ path: string }>
        >;
      };
      memory: {
        read: (payload?: { path?: string }) => Promise<IpcResult<{ content: string; path: string }>>;
        write: (payload: { content: string; path?: string }) => Promise<
          IpcResult<{ updated: boolean; path: string; updatedAt: number }>
        >;
      };
      sync: {
        /** Subscribe to pending bot messages pushed from backend. Returns unsubscribe. */
        onPendingMessages: (
          listener: (payload: {
            items: Array<{ id: string; bot_id: string; message: string; created_at: string }>;
          }) => void
        ) => () => void;
      };
      agent: {
        init: (payload: {
          provider: string;
          modelId: string;
          apiKey: string;
          modelConfigId?: string;
          workDir?: string | null;
          chatId?: string | null;
          contactId?: string | null;
          memoryPath?: string;
          sandboxPermissionMode?: "default" | "full_access";
        }) => void;
        setModel: (payload: { provider: string; modelId: string; apiKey: string }) => Promise<{
          ok: boolean;
          error?: { code?: string; message?: string; details?: unknown };
          data?: { changed: boolean; provider: string; modelId: string };
        }>;
        prompt: (payload: {
          text: string;
          images?: Array<{ type: "image"; data: string; mimeType?: string }>;
        }) => void;
        abort: () => void;
        onEvent: (
          listener: (payload: {
            type: string;
            message?: {
              role?: string;
              content?: string | Array<{ type?: string; text?: string }>;
              toolCallId?: string;
              toolName?: string;
              errorMessage?: string;
            };
            toolCallId?: string;
            toolName?: string;
            args?: unknown;
            result?: unknown;
            partialResult?: unknown;
            isError?: unknown;
          }) => void
        ) => () => void;
        onError: (listener: (message: string) => void) => () => void;
      };
      sandbox?: {
        getStatus: () => Promise<IpcResult<{
          available: boolean;
          mode: string;
          backend: string;
          summary: string;
          note?: string;
        }>>;
        decideApproval: (payload: {
          id: string;
          allowed: boolean;
          reason?: string;
        }) => Promise<IpcResult<{ resolved: boolean }>>;
      };
      agentBuilder: {
        list: () => Promise<IpcResult<{ items: Array<{ id: string; name: string; avatar_url: string | null; status: string; updated_at: string }> }>>;
        get: (payload: { id: string }) => Promise<IpcResult<{
          id: string;
          creator_device_id: string;
          name: string;
          avatar_url: string | null;
          system_prompt: string;
          greeting_message: string;
          knowledge: string;
          skills_json: Record<string, boolean>;
          notify_channels: Array<{
            id: string;
            channel_type: string;
            enabled: boolean;
            config: Record<string, string>;
          }>;
          status: string;
          qrcode_data_uri: string | null;
          created_at: string;
          updated_at: string;
        }>>;
        create: (payload: {
          name: string;
          system_prompt?: string;
          greeting_message?: string;
          knowledge?: string;
          avatar_url?: string | null;
          notify_channels?: Array<{ id: string; channel_type: string; enabled: boolean; config: Record<string, string> }>;
        }) => Promise<IpcResult<{ id: string; created_at: string }>>;
        update: (payload: {
          id: string;
          name?: string;
          system_prompt?: string;
          greeting_message?: string;
          knowledge?: string;
          avatar_url?: string | null;
          notify_channels?: Array<{ id: string; channel_type: string; enabled: boolean; config: Record<string, string> }>;
        }) => Promise<IpcResult<{ id: string; updated_at: string }>>;
        publish: (payload: { id: string }) => Promise<IpcResult<{ id: string; status: string; updated_at: string }>>;
        delete: (payload: { id: string }) => Promise<IpcResult<Record<string, never>>>;
        search: (payload: { q: string }) => Promise<IpcResult<{ items: Array<{ id: string; name: string; avatar_url: string | null; description: string; updated_at: string }> }>>;
        recent: () => Promise<IpcResult<{ items: Array<{ id: string; name: string; avatar_url: string | null; description: string; created_at: string }> }>>;
        generateQrcode: (payload: {
          agentId: string;
          avatarUrl?: string | null;
          page?: string;
          envVersion?: "release" | "trial" | "develop";
        }) => Promise<IpcResult<{ image: string }>>;
        getQrcode: (payload: { agentId: string }) => Promise<IpcResult<{ image: string | null }>>;
        getDeviceId: () => Promise<IpcResult<{ deviceId: string }>>;
      };
      storyboard: {
        list: () => Promise<
          IpcResult<{
            items: Array<{
              id: string;
              title: string;
              thumbnailPath?: string;
              thumbnailUrl?: string | null;
              createdAt: number;
              updatedAt: number;
            }>;
          }>
        >;
        get: (payload: { projectId: string }) => Promise<
          IpcResult<{
            id: string;
            title: string;
            thumbnailUrl: string | null;
            createdAt: number;
            updatedAt: number;
            prompt: string;
            supplementPayload?: unknown;
            content: import("./types/storyboard").StoryboardContent;
          }>
        >;
        create: (payload?: { title?: string; prompt?: string }) => Promise<IpcResult<{ projectId: string }>>;
        update: (payload: {
          projectId: string;
          meta?: Record<string, unknown>;
          content?: import("./types/storyboard").StoryboardContent;
        }) => Promise<IpcResult<{ updated: boolean }>>;
        getAssetUrl: (payload: { projectId: string; relativePath: string }) => Promise<IpcResult<{ url: string }>>;
        setActive: (payload: {
          projectId: string;
          resourceType: "artAsset" | "sceneImage" | "sceneVideo";
          resourceId: string;
          activeSource: "upload" | "ai_generation";
          activeGenerationId?: string;
        }) => Promise<IpcResult<{ updated: boolean }>>;
        deleteResource: (payload: {
          projectId: string;
          resourceType: "artAsset" | "sceneImage" | "sceneVideo";
          resourceId: string;
        }) => Promise<IpcResult<{ deleted: boolean }>>;
        deleteGeneration: (payload: {
          projectId: string;
          resourceType: "artAsset" | "sceneImage" | "sceneVideo";
          resourceId: string;
          generationId: string;
        }) => Promise<IpcResult<{ deleted: boolean }>>;
        generateImage: (payload: {
          projectId: string;
          resourceType?: "artAsset" | "sceneImage";
          resourceId: string;
          prompt?: string;
          model?: string;
          ratio?: string;
          numImages?: number;
          enableWebSearch?: boolean;
          referenceImageUrls?: string[];
          referenceImageBase64s?: string[];
        }) => Promise<IpcResult<{ generationId: string; url: string; generationIds?: string[]; urls?: string[] }>>;
        generateVideo: (payload: {
          projectId: string;
          resourceId: string;
          prompt?: string;
          model?: string;
          ratio?: string;
          duration?: string;
          startFrameUrl: string;
          endFrameUrl?: string;
        }) => Promise<IpcResult<{ generationId: string; url: string; taskId?: string }>>;
        addResource: (payload: {
          projectId: string;
          resourceType: "artAsset" | "sceneImage" | "sceneVideo";
          name: string;
          activeSource?: "ai_generation" | "local_disk";
          localPath?: string;
        }) => Promise<IpcResult<{ id: string }>>;
        uploadLocalAsset: (payload: {
          projectId: string;
          resourceType: "artAsset" | "sceneImage";
          resourceId: string;
          fileData: string;
          filename?: string;
        }) => Promise<IpcResult<{ localImage: string }>>;
        agentCreate: (payload: {
          title?: string;
          prompt: string;
        }) => Promise<IpcResult<{
          projectId: string;
          status: "ready";
        }>>;
      };
    };
  }
}
