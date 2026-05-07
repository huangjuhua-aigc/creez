import { readLocalImageDataUrl } from "./settings";

export type ChatListItem = {
  id: string;
  name: string;
  avatar: string;
  contactId?: string | null;
  contactAvatarPath?: string | null;
  contactBotOrigin?: string | null;
  lastMessage: string;
  unread: number;
  time: string;
  channelType?: string;
  channelChatId?: string | null;
};

export type ChatMessageItem = {
  id: string;
  sender: "me" | "other" | "system";
  name: string;
  avatar: string;
  botId?: string | null;
  content: string;
  timestamp: string;
  type: "text" | "tool" | "system";
  channelType?: string | null;
  channelMessageId?: string | null;
};

function formatTime(ts: number | null): string {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function avatarFromName(name: string): string {
  const safe = encodeURIComponent(name || "C");
  return `https://ui-avatars.com/api/?name=${safe}&background=07C160&color=fff`;
}

export async function fetchChatList(): Promise<ChatListItem[]> {
  const api = window.electron?.chat;
  if (!api) return [];

  const result = await api.list({ limit: 100, offset: 0 });
  if (!result.ok) {
    console.warn("[creezv2] chat:list failed:", result.error.message);
    return [];
  }

  const mapped = await Promise.all(result.data.items.map(async (item) => {
    const name = item.title || "Untitled";
    let avatarFromContact: string | null = null;
    if (item.contactAvatarPath) {
      if (
        item.contactAvatarPath.startsWith("data:") ||
        item.contactAvatarPath.startsWith("http://") ||
        item.contactAvatarPath.startsWith("https://")
      ) {
        avatarFromContact = item.contactAvatarPath;
      } else {
        avatarFromContact = await readLocalImageDataUrl(item.contactAvatarPath);
      }
    }
    return {
      id: item.id,
      name,
      avatar: avatarFromContact || avatarFromName(name),
      contactId: item.contactId || null,
      contactAvatarPath: item.contactAvatarPath || null,
      contactBotOrigin: item.contactBotOrigin ?? null,
      lastMessage: item.lastMessage || "",
      unread: item.unreadCount || 0,
      time: formatTime(item.lastMessageAt),
      channelType: item.channelType ?? undefined,
      channelChatId: item.channelChatId ?? null,
    };
  }));
  return mapped;
}

export async function createBotFromTemplate(templateId: string): Promise<{ contactId: string; chatId: string } | null> {
  const api = window.electron?.contact;
  if (!api || typeof api.createBotFromTemplate !== "function") return null;
  const result = await api.createBotFromTemplate({ templateId });
  if (!result.ok) return null;
  const contactId = result.data?.contactId ? String(result.data.contactId) : "";
  const chatId = result.data?.chatId ? String(result.data.chatId) : "";
  if (!contactId || !chatId) return null;
  return { contactId, chatId };
}

export async function fetchChatMessages(chatId: string, chatName: string, avatar: string): Promise<ChatMessageItem[]> {
  const api = window.electron?.chat;
  if (!api || !chatId) return [];

  const result = await api.getMessages({ chatId, limit: 200 });
  if (!result.ok) {
    console.warn("[creezv2] chat:getMessages failed:", result.error.message);
    return [];
  }

  type ToolCallStored = {
    id: string;
    toolName: string;
    parameters: Record<string, unknown>;
    status: "success" | "failure" | "running";
    result?: string;
  };
  const normalizeToolCalls = (raw: unknown): ToolCallStored[] | undefined => {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return raw.map((t) => ({
      id: String(t?.id ?? ""),
      toolName: String(t?.toolName ?? ""),
      parameters: t && typeof t === "object" && t !== null && typeof (t as Record<string, unknown>).parameters === "object"
        ? (t as { parameters: Record<string, unknown> }).parameters
        : {},
      status: (["success", "failure", "running"].includes(String(t?.status))
        ? (t as { status: "success" | "failure" | "running" }).status
        : "success") as "success" | "failure" | "running",
      result: t && typeof t === "object" && t !== null && (t as Record<string, unknown>).result != null
        ? String((t as Record<string, unknown>).result)
        : undefined,
    })) as ToolCallStored[];
  };

  const reversed = [...result.data.items].reverse();
  return reversed.map((msg) => {
    const toolCalls = normalizeToolCalls((msg as { toolCalls?: unknown }).toolCalls);
    return {
      id: msg.id,
      sender: msg.sender === "user" ? "me" : msg.sender === "system" ? "system" : "other",
      name: msg.sender === "user" ? "Me" : msg.sender === "system" ? "System" : chatName,
      avatar: msg.sender === "user" ? avatarFromName("Me") : msg.sender === "system" ? "" : avatar,
      botId: msg.botId || null,
      content: msg.content,
      timestamp: formatTime(msg.createdAt),
      type: msg.sender === "system" ? "system" : "text",
      channelType: (msg as { channelType?: string | null }).channelType ?? null,
      channelMessageId: (msg as { channelMessageId?: string | null }).channelMessageId ?? null,
      ...(toolCalls ? { toolCalls } : {}),
    };
  });
}

export type AgentEventPayload = {
  type: string;
  /** When set, event is for this chat; frontend routes to the matching chat only. */
  chatId?: string | null;
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
  request?: {
    id: string;
    kind?: string;
    action?: string;
    risk?: string;
    title?: string;
    message?: string;
    path?: string;
    command?: string;
    sandboxMode?: string;
    sandboxBackend?: string;
    timeoutMs?: number;
    createdAt?: number;
  };
};

export function initAgent(payload: {
  provider: string;
  modelId: string;
  apiKey: string;
  modelConfigId?: string;
  workDir?: string | null;
  chatId?: string | null;
  contactId?: string | null;
  memoryPath?: string;
}) {
  if (typeof console?.log === "function") {
    console.log("[creezv2 renderer] initAgent", {
      contactId: payload.contactId ?? null,
      chatId: payload.chatId ?? null,
      modelConfigId: payload.modelConfigId,
      provider: payload.provider,
      modelId: payload.modelId,
      hasApiKey: Boolean(payload.apiKey),
      hasWorkDir: Boolean(payload.workDir),
    });
  }
  window.electron?.agent?.init(payload);
}

export async function switchAgentModel(payload: {
  chatId: string | null;
  provider: string;
  modelId: string;
  apiKey: string;
}): Promise<boolean> {
  const api = window.electron?.agent;
  if (!api || typeof api.setModel !== "function") return false;
  const result = await api.setModel(payload);
  return Boolean(result?.ok);
}

export function sendAgentPrompt(payload: {
  chatId: string | null;
  text: string;
  images?: Array<{ type: "image"; data: string; mimeType?: string }>;
}) {
  if (typeof console?.log === "function") {
    console.log("[creezv2 renderer] sendAgentPrompt", {
      chatId: payload.chatId ?? null,
      textLen: payload.text?.length ?? 0,
      imageCount: payload.images?.length ?? 0,
    });
  }
  window.electron?.agent?.prompt(payload);
}

export function abortAgentPrompt(chatId: string | null) {
  window.electron?.agent?.abort(chatId ?? "");
}

export async function saveAttachment(buffer: ArrayBuffer, fileName: string): Promise<{ ok: true; path: string } | { ok: false; error: { message?: string } }> {
  const api = window.electron?.attachment;
  if (!api || typeof api.save !== "function") {
    return { ok: false, error: { message: "Attachment API not available." } };
  }
  const result = await api.save({ buffer, fileName });
  if (result.ok && result.data?.path) {
    return { ok: true, path: result.data.path };
  }
  return {
    ok: false,
    error: !result.ok && result.error ? result.error : { message: "Save failed." },
  };
}

export function onAgentEvent(listener: (payload: AgentEventPayload) => void): () => void {
  if (!window.electron?.agent?.onEvent) return () => {};
  return window.electron.agent.onEvent(listener);
}

export function onAgentError(listener: (message: string) => void): () => void {
  if (!window.electron?.agent?.onError) return () => {};
  return window.electron.agent.onError(listener);
}

export function onChatMessageAppended(
  listener: (payload: { type?: string; chatId?: string; message?: unknown }) => void
): () => void {
  if (!window.electron?.chat?.onMessageAppended) return () => {};
  return window.electron.chat.onMessageAppended(listener);
}

export type ToolCallPayload = {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: "success" | "failure" | "running";
  result?: string;
};

export async function appendChatMessage(payload: {
  id: string;
  chatId: string;
  sender: "user" | "assistant" | "system";
  botId?: string | null;
  content: string;
  status?: "pending" | "streaming" | "done" | "error";
  modelUsed?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  toolCalls?: ToolCallPayload[];
  createdAt?: number;
  updatedAt?: number;
}): Promise<boolean> {
  const api = window.electron?.chat;
  if (!api || typeof api.appendMessage !== "function") return false;
  const result = await api.appendMessage(payload);
  return Boolean(result.ok);
}

export async function updateChatMessage(payload: {
  id: string;
  content?: string;
  status?: "pending" | "streaming" | "done" | "error";
  modelUsed?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  toolCalls?: ToolCallPayload[];
  updatedAt?: number;
}): Promise<boolean> {
  const api = window.electron?.chat;
  if (!api || typeof api.updateMessage !== "function") return false;
  const result = await api.updateMessage(payload);
  return Boolean(result.ok);
}

export async function deleteChat(chatId: string): Promise<boolean> {
  const api = window.electron?.chat;
  if (!api || typeof api.delete !== "function") return false;
  const result = await api.delete({ chatId });
  if (!result.ok) {
    console.warn("[creezv2] chat:delete failed:", result.error.message);
    return false;
  }
  return Boolean(result.data?.deleted);
}
