import { Plus, ChevronDown, Folder, Laugh } from "lucide-react";
import { cn } from "../../utils/cn";
import React, { useState, useEffect, useRef } from "react";
import { SearchBar } from "./ui/SearchBar";
import { ToolCallGroup, type ToolCall } from "./ToolCallPanel";
import {
  abortAgentPrompt,
  appendChatMessage,
  fetchChatList,
  fetchChatMessages,
  initAgent,
  onAgentError,
  onAgentEvent,
  saveAttachment,
  switchAgentModel,
  sendAgentPrompt,
  updateChatMessage,
  type AgentEventPayload,
  type ChatListItem,
  type ChatMessageItem,
} from "../services/chat";
import { fetchAssistantConfig, fetchModelApiKey, readLocalImageDataUrl } from "../services/settings";

interface ChatWindowProps {
  activeChatId?: number | string;
  onSelectChat?: (chatId: string) => void;
  onNavigateToSettings?: () => void;
}

const BOT_CHAT_ID = "1f2e3d4c-5b6a-47d8-9c01-23456789abcd";
const EMOJIS = ["😀", "😄", "😁", "😂", "😊", "😉", "😍", "🤔", "😎", "👍", "👏", "🙏", "🔥", "🎉", "💡", "🧠", "🚀", "💻", "📁", "✅"];
const DEBUG_CHAT = false;
const CHAT_LIST_PREVIEW_LEN = 40;

type ModelOption = {
  id: string;
  label: string;
};

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

type ChatMessageItemWithTools = ChatMessageItem & { toolCalls?: ToolCall[] };

function parseAssistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const textPart = content.find((part) => part && part.type === "text");
  return textPart?.text || "";
}

function formatNowTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function avatarFallback(name: string) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "Assistant")}&background=07C160&color=fff`;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)}${units[idx]}`;
}

function fileExtLabel(name: string) {
  const lower = String(name || "").toLowerCase();
  const i = lower.lastIndexOf(".");
  if (i === -1 || i === lower.length - 1) return "FILE";
  return lower.slice(i + 1, i + 5).toUpperCase();
}

type ContentSegment =
  | { type: "text"; value: string }
  | { type: "image"; path: string }
  | { type: "file"; path: string }
  | { type: "link"; label: string; target: string };

/** Splits text into text and link segments for [label](target) pattern. */
function parseLinksInText(text: string): Array<{ type: "text"; value: string } | { type: "link"; label: string; target: string }> {
  const out: Array<{ type: "text"; value: string } | { type: "link"; label: string; target: string }> = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      out.push({ type: "text", value: text.slice(lastIndex, m.index) });
    }
    out.push({ type: "link", label: m[1], target: m[2] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    out.push({ type: "text", value: text.slice(lastIndex) });
  }
  if (out.length === 0) {
    out.push({ type: "text", value: text });
  }
  return out;
}

function parseContentWithAttachments(content: string): ContentSegment[] {
  if (!content || typeof content !== "string") return [{ type: "text", value: "" }];
  const parts: ContentSegment[] = [];
  const re = /\[(Image|File): ##(.+?)##\]/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIndex) {
      const textSeg = content.slice(lastIndex, m.index);
      parts.push(...parseLinksInText(textSeg));
    }
    parts.push({
      type: m[1] === "Image" ? "image" : "file",
      path: m[2],
    });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < content.length) {
    parts.push(...parseLinksInText(content.slice(lastIndex)));
  }
  if (parts.length === 0) {
    parts.push({ type: "text", value: content });
  }
  return parts;
}

function fileNameFromPath(filePath: string): string {
  const s = String(filePath || "").replace(/\\/g, "/");
  const idx = s.lastIndexOf("/");
  return idx >= 0 ? s.slice(idx + 1) : s || "file";
}

function ImageChipFromPath({ path, className = "" }: { path: string; className?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    readLocalImageDataUrl(path).then((url) => {
      if (!cancelled && url) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!dataUrl) {
    return (
      <span className={cn("inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-gray-100 text-gray-500 text-xs", className)}>
        图片加载中…
      </span>
    );
  }
  return (
    <span className={cn("inline-flex mr-1 mb-1", className)}>
      <img src={dataUrl} alt="" className="w-14 h-14 rounded-lg object-cover bg-white border border-gray-200" />
    </span>
  );
}

function FileChipFromPath({ path, className = "" }: { path: string; className?: string }) {
  const name = fileNameFromPath(path);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 mr-1 mb-1 bg-[#F0F0F0] border border-gray-200 rounded-xl align-middle",
        className
      )}
    >
      <span className="w-10 h-12 rounded-md bg-[#F25F3A] text-white text-xs font-bold flex items-center justify-center shrink-0">
        {fileExtLabel(name)}
      </span>
      <span className="text-[12px] text-gray-800 truncate max-w-[200px]">{name}</span>
    </span>
  );
}

function MessageContentWithChips({
  content,
  className = "",
  onNavigateToSettings,
}: {
  content: string;
  className?: string;
  onNavigateToSettings?: () => void;
}) {
  const segments = parseContentWithAttachments(content);
  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <React.Fragment key={i}>{seg.value}</React.Fragment>;
        }
        if (seg.type === "image") {
          return <ImageChipFromPath key={i} path={seg.path} />;
        }
        if (seg.type === "file") {
          return <FileChipFromPath key={i} path={seg.path} />;
        }
        if (seg.type === "link" && seg.target === "settings" && onNavigateToSettings) {
          return (
            <button
              key={i}
              type="button"
              className="text-[#07C160] underline cursor-pointer hover:opacity-80"
              onClick={(e) => {
                e.preventDefault();
                onNavigateToSettings();
              }}
            >
              {seg.label}
            </button>
          );
        }
        if (seg.type === "link") {
          return (
            <span key={i} className="text-[#07C160] underline">
              {seg.label}
            </span>
          );
        }
        return null;
      })}
    </span>
  );
}

function chatLog(scope: string, details?: unknown) {
  if (!DEBUG_CHAT) return;
  const ts = new Date().toISOString();
  try {
    // eslint-disable-next-line no-console
    console.log(`[creezv2 chat][${ts}][${scope}]`, details ?? "");
  } catch {
    // no-op
  }
}

export function ChatWindow({ activeChatId, onSelectChat, onNavigateToSettings }: ChatWindowProps) {
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string>(activeChatId ? String(activeChatId) : "");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isDragOverInput, setIsDragOverInput] = useState(false);
  const [composerVersion, setComposerVersion] = useState(0);
  const [botName, setBotName] = useState("Assistant");
  const [botAvatar, setBotAvatar] = useState(avatarFallback("Assistant"));
  const dropdownRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const initializedModelRef = useRef<string>("");
  const initializedScopeRef = useRef<string>("");
  const agentReadyRef = useRef(false);
  const initInFlightRef = useRef<Promise<boolean> | null>(null);
  const initResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const initRejectRef = useRef<((error: Error) => void) | null>(null);
  /** Chat we're currently initializing for; agent_ready is accepted for this chat even if user switched away. */
  const pendingInitChatIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const activeToolMessageIdRef = useRef<string | null>(null);
  const streamedTextRef = useRef<string>("");
  const activeStreamChatIdRef = useRef<string | null>(null);
  const activeStreamBotIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [waitingDots, setWaitingDots] = useState("·");
  const isStreamingRef = useRef(false);
  const selectedChatIdRef = useRef(selectedChatId);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const activeToolCallsRef = useRef<ToolCall[]>([]);

  const scrollMessagesToBottom = () => {
    const el = messagesScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    scrollMessagesToBottom();
  }, [messages, waitingDots]);

  const reloadChats = async (preferredChatId?: string | null) => {
    setIsLoadingChats(true);
    const [assistantConfig, items] = await Promise.all([fetchAssistantConfig(), fetchChatList()]);

    const assistantName = assistantConfig.name || "Assistant";
    const assistantAvatar = assistantConfig.avatar
      ? (await readLocalImageDataUrl(assistantConfig.avatar)) || avatarFallback(assistantName)
      : avatarFallback(assistantName);

    const configuredModels = (assistantConfig.models || []).map((item) => ({
      id: item.id,
      label: `${String(item.provider || "Provider")} / ${String(item.model || "Model")}`,
    }));
    setModelOptions(configuredModels);
    const activeModel = assistantConfig.models?.find((m) => m.active) || assistantConfig.models?.[0];
    if (activeModel?.id) {
      setSelectedModelId(activeModel.id);
    } else if (configuredModels[0]) {
      setSelectedModelId(configuredModels[0].id);
    }

    setBotName(assistantName);
    setBotAvatar(assistantAvatar);
    const merged = items
      .filter((chat) => !String(chat.id).startsWith("chat_demo_"))
      .map((chat) => (chat.id === BOT_CHAT_ID ? { ...chat, name: assistantName, avatar: assistantAvatar } : chat));
    setChatList(merged);
    setIsLoadingChats(false);

    const nextChatId = preferredChatId || (activeChatId ? String(activeChatId) : selectedChatId);
    if (nextChatId && merged.some((c) => c.id === nextChatId)) {
      setSelectedChatId(nextChatId);
      onSelectChat?.(nextChatId);
      return;
    }
    if (merged.length > 0) {
      setSelectedChatId(merged[0].id);
      onSelectChat?.(merged[0].id);
    }
  };

  useEffect(() => {
    void reloadChats();
    return () => {};
  }, []);

  useEffect(() => {
    if (activeChatId) {
      const nextId = String(activeChatId);
      setSelectedChatId(nextId);
      onSelectChat?.(nextId);
    }
  }, [activeChatId, onSelectChat]);

  useEffect(() => {
    if (chatList.length === 0) return;
    const exists = chatList.some((chat) => chat.id === selectedChatId);
    if (exists) return;
    const fallbackId = chatList[0].id;
    setSelectedChatId(fallbackId);
    onSelectChat?.(fallbackId);
  }, [chatList, selectedChatId, onSelectChat]);

  useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      return;
    }
    const currentChat = chatList.find((c) => c.id === selectedChatId);
    if (!currentChat) return;
    const chatId = currentChat.id;
    const chatName = currentChat.name;
    const chatAvatar = currentChat.avatar;

    let cancelled = false;
    async function loadMessages() {
      setIsLoadingMessages(true);
      const items = await fetchChatMessages(chatId, chatName, chatAvatar);
      if (cancelled) return;
      setMessages(items);
      setIsLoadingMessages(false);
    }
    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [selectedChatId, chatList]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
      if (emojiRef.current && !emojiRef.current.contains(event.target as Node)) {
        setShowEmojiPanel(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const offEvent = onAgentEvent((payload) => handleIncomingAgentEvent(payload));
    const offError = onAgentError((message) => {
      const text = message || "Request failed.";
      chatLog("agent:error", text);
      if (initRejectRef.current && !agentReadyRef.current) {
        initRejectRef.current(new Error(text));
        initRejectRef.current = null;
        initResolveRef.current = null;
        initInFlightRef.current = null;
        pendingInitChatIdRef.current = null;
      }
      const assistantId = activeAssistantMessageIdRef.current;
      if (assistantId) {
        void updateChatMessage({
          id: assistantId,
          content: streamedTextRef.current || text,
          status: "error",
          errorCode: "AGENT_ERROR",
          errorMessage: text,
          updatedAt: Math.floor(Date.now() / 1000),
        });
      }
      setMessages((prev) => {
        const next = prev.filter((msg) => msg.id !== assistantId);
        next.push({
          id: `${Date.now()}-system-error`,
          sender: "system",
          name: "System",
          avatar: "",
          content: text,
          timestamp: formatNowTime(),
          type: "system",
        });
        return next;
      });
      const errChatId = activeStreamChatIdRef.current;
      if (errChatId) {
        void appendChatMessage({
          id: `${Date.now()}-system-error`,
          chatId: errChatId,
          sender: "system",
          content: text,
          status: "error",
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
          errorCode: "AGENT_ERROR",
          errorMessage: text,
        });
        const preview = text.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
        setChatList((prev) =>
          prev.map((c) => (c.id === errChatId ? { ...c, lastMessage: preview, time: formatNowTime() } : c))
        );
      }
      const errorInCurrentChat = errChatId == null || errChatId === selectedChatIdRef.current;
      activeAssistantMessageIdRef.current = null;
      activeToolMessageIdRef.current = null;
      activeToolCallsRef.current = [];
      streamedTextRef.current = "";
      activeStreamChatIdRef.current = null;
      activeStreamBotIdRef.current = null;
      if (errorInCurrentChat) {
        setIsStreaming(false);
      }
    });
    return () => {
      offEvent();
      offError();
    };
  }, [botAvatar, botName]);

  const activeChat = chatList.find((c) => c.id === selectedChatId) || null;
  const selectedModel = modelOptions.find((item) => item.id === selectedModelId) || modelOptions[0] || null;

  useEffect(() => {
    initializedModelRef.current = "";
    initializedScopeRef.current = "";
    agentReadyRef.current = false;
    initInFlightRef.current = null;
    initResolveRef.current = null;
    initRejectRef.current = null;
    pendingInitChatIdRef.current = null;
  }, [selectedModelId]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);
  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
    const streamingHere = activeStreamChatIdRef.current != null && activeStreamChatIdRef.current === selectedChatId;
    setIsStreaming(streamingHere);
  }, [selectedChatId]);

  useEffect(() => {
    if (!isStreaming) {
      setWaitingDots("·");
      return;
    }
    const frames = ["·", "··", "···"];
    let idx = 0;
    const timer = window.setInterval(() => {
      idx = (idx + 1) % frames.length;
      setWaitingDots(frames[idx]);
    }, 350);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  const getFileSignature = (file: File) => `${file.name}__${file.size}__${file.lastModified}__${file.type}`;

  const createAttachment = (file: File): PendingAttachment => {
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (previewUrl) previewUrlsRef.current.add(previewUrl);
    return {
      id: `${getFileSignature(file)}__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl,
    };
  };

  const saveSelectionInComposer = () => {
    const root = composerRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return;
    savedRangeRef.current = range.cloneRange();
  };

  const placeCaretAfterNode = (node: Node) => {
    const root = composerRef.current;
    if (!root) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const insertNodeAtCaret = (node: Node) => {
    const root = composerRef.current;
    if (!root) return;
    root.focus();
    const selection = window.getSelection();
    let range: Range;
    if (savedRangeRef.current && root.contains(savedRangeRef.current.startContainer)) {
      range = savedRangeRef.current.cloneRange();
    } else if (selection && selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).startContainer)) {
      range = selection.getRangeAt(0).cloneRange();
    } else {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }

    range.deleteContents();
    range.insertNode(node);
    placeCaretAfterNode(node);
  };

  const insertTextAtCaret = (text: string) => {
    const textNode = document.createTextNode(text);
    insertNodeAtCaret(textNode);
    setComposerVersion((v) => v + 1);
  };

  const serializeComposer = () => {
    const root = composerRef.current;
    if (!root) return "";
    let output = "";
    for (const node of Array.from(root.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        output += node.textContent || "";
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const attachmentId = el.dataset.attachmentId;
        if (attachmentId) {
          const attachment = pendingAttachments.find((item) => item.id === attachmentId);
          if (attachment) {
            const tag = attachment.file.type.startsWith("image/") ? "Image" : "File";
            output += `[${tag}:${attachment.file.name}] `;
          }
          continue;
        }
        output += el.textContent || "";
      }
    }
    return output.trim();
  };

  const revokeAttachment = (attachment: PendingAttachment) => {
    if (!attachment.previewUrl) return;
    URL.revokeObjectURL(attachment.previewUrl);
    previewUrlsRef.current.delete(attachment.previewUrl);
  };

  const removeAttachmentById = (id: string) => {
    const root = composerRef.current;
    if (root) {
      root.querySelectorAll(`[data-attachment-id="${id}"]`).forEach((n) => n.remove());
    }
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) revokeAttachment(target);
      return prev.filter((item) => item.id !== id);
    });
    setComposerVersion((v) => v + 1);
    setTimeout(() => {
      root?.focus();
      saveSelectionInComposer();
    }, 0);
  };

  const makeAttachmentChip = (attachment: PendingAttachment) => {
    const chip = document.createElement("span");
    chip.dataset.attachmentId = attachment.id;
    chip.contentEditable = "false";
    chip.className = "inline-flex items-center gap-3 px-3 py-2 mr-1 mb-1 bg-[#F0F0F0] border border-gray-200 rounded-xl align-middle max-w-[520px]";

    if (attachment.previewUrl) {
      const img = document.createElement("img");
      img.src = attachment.previewUrl;
      img.alt = attachment.file.name;
      img.className = "w-14 h-14 rounded-lg object-cover bg-white";
      chip.appendChild(img);
    } else {
      const icon = document.createElement("div");
      icon.className = "w-10 h-12 rounded-md bg-[#F25F3A] text-white text-xs font-bold flex items-center justify-center";
      icon.textContent = fileExtLabel(attachment.file.name);
      chip.appendChild(icon);
    }

    const meta = document.createElement("div");
    meta.className = "min-w-0";
    const name = document.createElement("div");
    name.className = "text-[12px] text-gray-800 truncate max-w-[320px]";
    name.textContent = attachment.file.name;
    const size = document.createElement("div");
    size.className = "text-[11px] text-gray-500 mt-0.5";
    size.textContent = formatFileSize(attachment.file.size);
    meta.appendChild(name);
    meta.appendChild(size);
    chip.appendChild(meta);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "w-5 h-5 rounded text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-700";
    close.textContent = "x";
    close.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeAttachmentById(attachment.id);
    };
    chip.appendChild(close);

    return chip;
  };

  const appendFiles = (files: File[]) => {
    if (!Array.isArray(files) || files.length === 0) return;
    const appended: PendingAttachment[] = [];
    setPendingAttachments((prev) => {
      const merged = [...prev];
      const exists = new Set(prev.map((a) => getFileSignature(a.file)));
      for (const file of files) {
        const signature = getFileSignature(file);
        if (exists.has(signature)) continue;
        const created = createAttachment(file);
        merged.push(created);
        appended.push(created);
        exists.add(signature);
      }
      return merged;
    });
    if (appended.length === 0) return;
    for (const item of appended) {
      const chip = makeAttachmentChip(item);
      insertNodeAtCaret(chip);
      insertTextAtCaret(" ");
    }
    setTimeout(() => {
      composerRef.current?.focus();
      saveSelectionInComposer();
    }, 0);
  };

  const upsertToolCall = (toolCall: Partial<ToolCall> & { id: string; toolName: string }) => {
    const assistantId = activeAssistantMessageIdRef.current;
    if (!assistantId) return;
    const params = (toolCall.parameters ?? (toolCall as { args?: unknown }).args) as Record<string, unknown> | undefined;
    const parameters = params && typeof params === "object" && Object.keys(params).length > 0 ? params : {};
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== assistantId) return msg;
        const existing = (msg as ChatMessageItemWithTools).toolCalls ?? [];
        const idx = existing.findIndex((tc) => tc.id === toolCall.id);
        const base = idx >= 0 ? existing[idx] : null;
        const merged: ToolCall = {
          id: toolCall.id,
          toolName: toolCall.toolName,
          parameters: Object.keys(parameters).length > 0 ? parameters : (base?.parameters ?? {}),
          status: toolCall.status ?? base?.status ?? "running",
          result: toolCall.result ?? base?.result,
        };
        const toolCalls =
          idx >= 0
            ? existing.map((tc) => (tc.id === toolCall.id ? merged : tc))
            : [...existing, merged];
        activeToolCallsRef.current = toolCalls;
        return { ...msg, toolCalls } as ChatMessageItemWithTools;
      })
    );
  };

  const handleIncomingAgentEvent = (event: AgentEventPayload) => {
    const eventChatId = event.chatId ?? null;
    const currentSelectedChatId = selectedChatIdRef.current;
    const pendingInitChatId = pendingInitChatIdRef.current ?? null;
    const isForPendingInit =
      event.type === "agent_ready" &&
      initResolveRef.current != null &&
      (eventChatId == null || pendingInitChatId == null || String(eventChatId) === String(pendingInitChatId));
    const isForOtherChat =
      eventChatId != null &&
      currentSelectedChatId != null &&
      String(eventChatId) !== String(currentSelectedChatId) &&
      !isForPendingInit;
    if (isForOtherChat) {
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const finalText = parseAssistantText(event.message?.content) || "";
        if (finalText) {
          const preview = finalText.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
          setChatList((prev) =>
            prev.map((c) => (c.id === eventChatId ? { ...c, lastMessage: preview, time: formatNowTime() } : c))
          );
        }
      }
      return;
    }
    if (event.type !== "message_update") {
      chatLog("agent:event", {
        type: event.type,
        chatId: eventChatId ?? null,
        role: event.message?.role || "",
        toolName: event.toolName || event.message?.toolName || "",
      });
    }
    switch (event.type) {
      case "agent_start":
      case "message_start":
        return;
      case "agent_ready":
        console.log("[creez:flow] agent_ready applied", {
          eventChatId,
          currentSelectedChatId,
          pendingInitChatId: pendingInitChatIdRef.current ?? null,
        });
        agentReadyRef.current = true;
        if (initResolveRef.current) {
          initResolveRef.current(true);
          initResolveRef.current = null;
          initRejectRef.current = null;
          initInFlightRef.current = null;
          pendingInitChatIdRef.current = null;
        }
        return;
      case "message_update": {
        if (event.message?.role !== "assistant") return;
        const nextRaw = parseAssistantText(event.message?.content);
        if (!nextRaw) return;
        const prev = streamedTextRef.current || "";
        const fullText = nextRaw.startsWith(prev) ? nextRaw : `${prev}${nextRaw}`;
        streamedTextRef.current = fullText;
        const assistantId = activeAssistantMessageIdRef.current;
        if (!assistantId) return;
        setMessages((prevMessages) =>
          prevMessages.map((msg) => (msg.id === assistantId ? { ...msg, content: fullText } : msg))
        );
        return;
      }
      case "message_end": {
        if (event.message?.role !== "assistant") return;
        const finalText = parseAssistantText(event.message?.content) || streamedTextRef.current || "";
        streamedTextRef.current = finalText;
        const assistantId = activeAssistantMessageIdRef.current;
        const streamChatId = activeStreamChatIdRef.current;
        if (!assistantId) return;
        setMessages((prevMessages) =>
          prevMessages.map((msg) => (msg.id === assistantId ? { ...msg, content: finalText } : msg))
        );
        void updateChatMessage({
          id: assistantId,
          content: finalText,
          status: "done",
          toolCalls: activeToolCallsRef.current?.length ? activeToolCallsRef.current : undefined,
          updatedAt: Math.floor(Date.now() / 1000),
        });
        if (streamChatId) {
          const preview = finalText.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
          setChatList((prev) =>
            prev.map((c) => (c.id === streamChatId ? { ...c, lastMessage: preview, time: formatNowTime() } : c))
          );
        }
        return;
      }
      case "agent_end": {
        const endAssistantId = activeAssistantMessageIdRef.current;
        const endChatId = activeStreamChatIdRef.current;
        const endContent = streamedTextRef.current || "";
        if (endAssistantId) {
          void updateChatMessage({
            id: endAssistantId,
            content: endContent,
            status: "done",
            toolCalls: activeToolCallsRef.current?.length ? activeToolCallsRef.current : undefined,
            updatedAt: Math.floor(Date.now() / 1000),
          });
        }
        activeToolCallsRef.current = [];
        if (endChatId) {
          const preview = endContent.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
          setChatList((prev) =>
            prev.map((c) => (c.id === endChatId ? { ...c, lastMessage: preview, time: formatNowTime() } : c))
          );
        }
        if (endChatId == null || endChatId === currentSelectedChatId) {
          setIsStreaming(false);
        }
        activeAssistantMessageIdRef.current = null;
        activeToolMessageIdRef.current = null;
        streamedTextRef.current = "";
        activeStreamChatIdRef.current = null;
        activeStreamBotIdRef.current = null;
        return;
      }
      default: {
        if (!isStreamingRef.current) return;
        const isToolLikeEvent =
          event.type.startsWith("tool_") ||
          Boolean(event.toolName) ||
          Boolean(event.toolCallId) ||
          event.type === "tool_call" ||
          event.type === "tool_result";
        if (!isToolLikeEvent) return;
        const toolName = event.toolName || event.message?.toolName || "";
        const toolCallId = event.toolCallId || event.message?.toolCallId || "";
        if (!toolName) return;
        const id = toolCallId || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (event.result !== undefined || event.isError) {
          const status = event.isError ? "failure" : "success";
          const result =
            typeof event.result === "string"
              ? event.result
              : event.result !== undefined
                ? JSON.stringify(event.result)
                : event.message?.errorMessage || "";
          upsertToolCall({
            id,
            toolName,
            parameters: event.args && typeof event.args === "object" ? (event.args as Record<string, unknown>) : {},
            status,
            result: status === "failure" ? (event.message?.errorMessage || result) : result,
          });
        } else if (event.args !== undefined || event.type === "tool_call" || event.type?.startsWith("tool_call")) {
          upsertToolCall({
            id,
            toolName,
            parameters: event.args && typeof event.args === "object" ? (event.args as Record<string, unknown>) : {},
            status: "running",
          });
        }
      }
    }
  };

  const ensureAgentInitialized = async (): Promise<boolean> => {
    const currentChat = chatList.find((c) => c.id === selectedChatId);
    const contactId = currentChat?.contactId ?? null;
    console.log("[creez:flow] ensureAgentInitialized start", {
      selectedChatId,
      contactId,
      hasCurrentChat: Boolean(currentChat),
    });
    const config = await fetchAssistantConfig({ contactId });
    console.log("[creez:flow] ensureAgentInitialized config", {
      contactId,
      modelCount: config.models?.length ?? 0,
      modelIds: (config.models || []).map((m) => m?.id).filter(Boolean),
      selectedModelId,
    });
    chatLog("agent:init:config", {
      modelCount: config.models?.length ?? 0,
      selectedModelId,
      hasSkills: Object.keys(config.skills || {}).length,
    });
    const targetModel =
      config.models.find((item) => item.id === selectedModelId) || config.models.find((item) => item.active) || config.models[0];
    if (!targetModel?.id || !targetModel.model || !targetModel.provider) {
      console.log("[creez:flow] ensureAgentInitialized fail: no targetModel or missing id/model/provider", {
        contactId,
        hasTargetModel: Boolean(targetModel),
        targetModelId: targetModel?.id,
        targetModelProvider: targetModel?.provider,
        targetModelModel: targetModel?.model,
      });
      chatLog("agent:init:skip", "no targetModel or missing id/model/provider");
      return false;
    }
    const apiKey = await fetchModelApiKey(targetModel.id, { contactId });
    if (!apiKey) {
      console.log("[creez:flow] ensureAgentInitialized fail: fetchModelApiKey returned empty", {
        contactId,
        modelId: targetModel.id,
      });
      chatLog("agent:init:skip", { reason: "fetchModelApiKey returned empty", modelId: targetModel.id });
      return false;
    }
    console.log("[creez:flow] ensureAgentInitialized has apiKey", { contactId, modelId: targetModel.id });

    const appState = await (window as any).electron?.app?.getState?.();
    const workDir = appState?.ok ? appState.data.workspaceRoot : null;
    const scopeSignature = `${contactId || ""}:${selectedChatId || ""}:${workDir || ""}`;
    const modelSignature = `${targetModel.id}:${targetModel.provider}:${targetModel.model}`;
    if (
      initializedScopeRef.current === scopeSignature &&
      initializedModelRef.current === modelSignature &&
      agentReadyRef.current
    ) {
      return true;
    }
    if (
      initializedScopeRef.current === scopeSignature &&
      initializedModelRef.current === modelSignature &&
      initInFlightRef.current
    ) {
      return await initInFlightRef.current;
    }

    if (
      agentReadyRef.current &&
      initializedScopeRef.current === scopeSignature &&
      initializedModelRef.current &&
      initializedModelRef.current !== modelSignature
    ) {
      chatLog("agent:setModel", {
        provider: String(targetModel.provider),
        modelId: String(targetModel.model),
        modelConfigId: targetModel.id,
      });
      const changed = await switchAgentModel({
        chatId: selectedChatId ?? null,
        provider: String(targetModel.provider),
        modelId: String(targetModel.model),
        apiKey,
      });
      if (!changed) {
        chatLog("agent:setModel:failed", `${String(targetModel.provider)}/${String(targetModel.model)}`);
        return false;
      }
      initializedScopeRef.current = scopeSignature;
      initializedModelRef.current = modelSignature;
      return true;
    }

    chatLog("agent:init", {
      selectedChatId,
      chatListLen: chatList.length,
      contactId: contactId ?? null,
      hasCurrentChat: Boolean(currentChat),
      modelConfigId: targetModel.id,
      provider: String(targetModel.provider),
      modelId: String(targetModel.model),
      workDir: workDir || null,
      chatId: selectedChatId || null,
      hasApiKey: Boolean(apiKey),
    });
    agentReadyRef.current = false;
    pendingInitChatIdRef.current = selectedChatId ?? null;
    initAgent({
      modelConfigId: targetModel.id,
      provider: String(targetModel.provider),
      modelId: String(targetModel.model),
      apiKey,
      workDir,
      chatId: selectedChatId || null,
      contactId,
    });
    initializedScopeRef.current = scopeSignature;
    initializedModelRef.current = modelSignature;

    const waitReady = new Promise<boolean>((resolve, reject) => {
      initResolveRef.current = resolve;
      initRejectRef.current = reject;
      window.setTimeout(() => {
        if (!agentReadyRef.current) {
          console.log("[creez:flow] ensureAgentInitialized fail: timeout (no agent_ready)", {
            contactId,
            chatId: selectedChatId,
          });
          reject(new Error("Agent init timeout. No agent_ready received."));
        }
      }, 10000);
    });
    initInFlightRef.current = waitReady;
    try {
      const ok = await waitReady;
      if (ok) console.log("[creez:flow] ensureAgentInitialized ok", { contactId, chatId: selectedChatId });
      return ok;
    } catch (error) {
      console.log("[creez:flow] ensureAgentInitialized fail: timeout or error", {
        contactId,
        chatId: selectedChatId,
        message: (error as Error)?.message || String(error),
      });
      chatLog("agent:init:timeout-or-error", (error as Error)?.message || String(error));
      return false;
    } finally {
      initInFlightRef.current = null;
      initResolveRef.current = null;
      initRejectRef.current = null;
      pendingInitChatIdRef.current = null;
    }
  };

  const stopStreaming = () => {
    const currentChatId = selectedChatIdRef.current;
    const streamingChatId = activeStreamChatIdRef.current;
    if (!streamingChatId || streamingChatId !== currentChatId) {
      setIsStreaming(false);
      return;
    }
    chatLog("agent:abort", "stop button clicked");
    abortAgentPrompt(streamingChatId);
    if (activeAssistantMessageIdRef.current) {
      void updateChatMessage({
        id: activeAssistantMessageIdRef.current,
        content: streamedTextRef.current || "",
        status: "error",
        errorCode: "ABORTED",
        errorMessage: "Stopped by user.",
        updatedAt: Math.floor(Date.now() / 1000),
      });
    }
    void appendChatMessage({
      id: `${Date.now()}-system-stop`,
      chatId: streamingChatId,
      sender: "system",
      content: "Response stopped.",
      status: "done",
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    });
    const preview = (streamedTextRef.current || "Response stopped.").slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
    setChatList((prev) =>
      prev.map((c) => (c.id === streamingChatId ? { ...c, lastMessage: preview, time: formatNowTime() } : c))
    );
    setIsStreaming(false);
    activeAssistantMessageIdRef.current = null;
    activeToolMessageIdRef.current = null;
    activeToolCallsRef.current = [];
    streamedTextRef.current = "";
    activeStreamChatIdRef.current = null;
    activeStreamBotIdRef.current = null;
  };

  const handleSend = async () => {
    const currentChatId = selectedChatIdRef.current;
    const streamingThisChat = activeStreamChatIdRef.current != null && activeStreamChatIdRef.current === currentChatId;
    if (streamingThisChat) {
      stopStreaming();
      return;
    }
    const composedContent = serializeComposer();
    if (!composedContent && pendingAttachments.length === 0) return;
    if (!activeChat) return;

    let contentWithPaths = composedContent;
    if (pendingAttachments.length > 0) {
      const savedResults = await Promise.all(
        pendingAttachments.map(async (att) => {
          const buf = await att.file.arrayBuffer();
          const res = await saveAttachment(buf, att.file.name);
          const type = att.file.type.startsWith("image/") ? "Image" : "File";
          return { type, path: res.ok ? res.path : null };
        })
      );
      let idx = 0;
      contentWithPaths = composedContent.replace(/\[(Image|File):[^\]]+\]/g, (match) => {
        const r = savedResults[idx++];
        return r?.path != null ? `[${r.type}: ##${r.path}##]` : match;
      });
    }

    const nowTs = Math.floor(Date.now() / 1000);
    const userMessageId = String(Date.now());
    const userMessage: ChatMessageItem = {
      id: userMessageId,
      sender: "me",
      name: "Me",
      avatar: "https://ui-avatars.com/api/?name=Me&background=111827&color=fff",
      content: contentWithPaths,
      timestamp: formatNowTime(),
      type: "text",
    };

    setMessages((prev) => [...prev, userMessage]);
    const preview = contentWithPaths.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
    setChatList((prev) =>
      prev.map((c) =>
        c.id === activeChat.id ? { ...c, lastMessage: preview, time: formatNowTime() } : c
      )
    );
    void appendChatMessage({
      id: userMessageId,
      chatId: activeChat.id,
      sender: "user",
      content: contentWithPaths,
      status: "done",
      createdAt: nowTs,
      updatedAt: nowTs,
    });
    composerRef.current && (composerRef.current.innerHTML = "");
    setPendingAttachments((prev) => {
      for (const item of prev) revokeAttachment(item);
      return [];
    });
    setComposerVersion((v) => v + 1);
    setShowEmojiPanel(false);

    if (!activeChat.contactId) return;

    const ready = await ensureAgentInitialized();
    if (!ready) {
      chatLog("agent:init:failed", "model config incomplete");
      setIsStreaming(false);
      const sysId = `${Date.now()}-system-init-error`;
      const errorMessage: ChatMessageItem = {
        id: sysId,
        sender: "system",
        name: "System",
        avatar: "",
        content: "Model config is incomplete. Please set provider/model/API key in settings.",
        timestamp: formatNowTime(),
        type: "system",
      };
      setMessages((prev) => [...prev, errorMessage]);
      void appendChatMessage({
        id: sysId,
        chatId: activeChat.id,
        sender: "system",
        content: errorMessage.content,
        status: "error",
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        errorCode: "INIT_INVALID",
        errorMessage: errorMessage.content,
      });
      const preview = errorMessage.content.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
      setChatList((prev) =>
        prev.map((c) => (c.id === activeChat.id ? { ...c, lastMessage: preview, time: formatNowTime() } : c))
      );
      return;
    }

    const prevStreamChatId = activeStreamChatIdRef.current;
    const prevAssistantId = activeAssistantMessageIdRef.current;
    const prevContent = streamedTextRef.current || "";
    if (prevStreamChatId === activeChat.id) {
      abortAgentPrompt(activeChat.id);
    } else if (prevStreamChatId && prevAssistantId) {
      const savedContent = prevContent || "(对方正在回复中…)";
      void updateChatMessage({
        id: prevAssistantId,
        content: savedContent,
        status: "done",
        toolCalls: activeToolCallsRef.current?.length ? activeToolCallsRef.current : undefined,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      const preview = savedContent.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
      setChatList((prev) =>
        prev.map((c) => (c.id === prevStreamChatId ? { ...c, lastMessage: preview, time: formatNowTime() } : c))
      );
    }
    streamedTextRef.current = "";
    activeToolMessageIdRef.current = null;
    activeToolCallsRef.current = [];
    const assistantId = `${Date.now()}-assistant-stream`;
    activeAssistantMessageIdRef.current = assistantId;
    activeStreamChatIdRef.current = activeChat.id;
    activeStreamBotIdRef.current = activeChat.contactId || null;
    setIsStreaming(true);
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        sender: "other",
        name: activeChat.name || botName,
        avatar: activeChat.avatar || botAvatar,
        content: "",
        timestamp: formatNowTime(),
        type: "text",
      },
    ]);
    if (activeChat.contactId) {
      void appendChatMessage({
        id: assistantId,
        chatId: activeChat.id,
        sender: "assistant",
        botId: activeChat.contactId,
        content: "",
        status: "streaming",
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });
    }

    const imageAttachments = pendingAttachments.filter((item) => item.file.type.startsWith("image/"));
    const images = await Promise.all(
      imageAttachments.map(async (attachment) => {
        const data = await attachment.file.arrayBuffer();
        const base64 = btoa(
          Array.from(new Uint8Array(data))
            .map((byte) => String.fromCharCode(byte))
            .join("")
        );
        return {
          type: "image" as const,
          data: base64,
          mimeType: attachment.file.type || "image/png",
        };
      })
    );

    sendAgentPrompt({
      chatId: selectedChatId ?? null,
      text: contentWithPaths,
      images,
    });
    chatLog("agent:prompt", {
      textLen: contentWithPaths.length,
      imageCount: images.length,
      modelId: selectedModel?.id || "",
    });
  };

  const focusInputToEnd = () => {
    const root = composerRef.current;
    if (!root) return;
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      previewUrlsRef.current.clear();
    };
  }, []);

  const canSend = (serializeComposer().trim().length > 0 || pendingAttachments.length > 0) && Boolean(activeChat);
  const disablePrimaryButton = !isStreaming && !canSend;
  return (
    <div className="flex h-full w-full bg-[#F5F5F5]">
      <div className="w-[250px] flex flex-col border-r border-[#E7E7E7] bg-[#F7F7F7] flex-shrink-0">
        <SearchBar placeholder="搜索" rightElement={<Plus size={16} />} />

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoadingChats && <div className="px-3 py-3 text-xs text-gray-500">Loading chats...</div>}
          {!isLoadingChats &&
            chatList.map((chat) => (
              <div
                key={chat.id}
                onClick={() => {
                  setSelectedChatId(chat.id);
                  onSelectChat?.(chat.id);
                }}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 cursor-pointer relative",
                  selectedChatId === chat.id ? "bg-[#C6C6C6]" : "hover:bg-[#D9D9D9]"
                )}
              >
                <div className="relative flex-shrink-0">
                  <img src={chat.avatar} alt={chat.name} className="w-10 h-10 rounded-[4px] object-cover" />
                  {chat.unread > 0 && (
                    <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center border border-[#F7F7F7]">
                      <span className="text-[10px] text-white transform scale-90 font-medium">{chat.unread}</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-0.5">
                    <h3 className="text-[13px] font-normal text-black truncate pr-1">{chat.name}</h3>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{chat.time}</span>
                  </div>
                  <p className="text-[12px] text-gray-500 truncate leading-tight font-light">{chat.lastMessage}</p>
                </div>
              </div>
            ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-[#F5F5F5] min-w-0">
        <div className="h-16 flex items-center px-6 border-b border-[#E7E7E7] flex-shrink-0">
          <h2 className="text-[19px] font-medium text-[#1a1a1a] truncate max-w-[80%]">{activeChat?.name || "No chat selected"}</h2>
        </div>

        <div ref={messagesScrollRef} className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
          {isLoadingMessages ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm h-full">Loading messages...</div>
          ) : messages.length > 0 ? (
            messages.map((msg) => {
              if (msg.type === "system") {
                return (
                  <div key={msg.id} className="text-center text-[12px] text-gray-400 select-text">
                    {msg.content}
                  </div>
                );
              }
              const isMe = msg.sender === "me";
              const toolCalls = (msg as ChatMessageItemWithTools).toolCalls;
              const showContent =
                msg.content ||
                (isStreaming && msg.id === activeAssistantMessageIdRef.current ? waitingDots : "");
              const hasContent = Boolean(msg.content?.trim());
              const showContentBubble = hasContent || (isStreaming && msg.id === activeAssistantMessageIdRef.current);
              return (
                <div key={msg.id} className={cn("flex gap-3", isMe ? "flex-row-reverse" : "flex-row")}>
                  <div className="flex-shrink-0">
                    <img src={msg.avatar} alt={msg.sender} className="w-9 h-9 rounded-[4px] object-cover" />
                  </div>
                  <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                    {!isMe && (
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-xs text-gray-500">{msg.name}</span>
                        <span className="text-xs text-gray-400">{msg.timestamp}</span>
                      </div>
                    )}
                    {showContentBubble && (
                      <div
                        className={cn(
                          "p-3 rounded-[4px] shadow-[0_1px_2px_rgba(0,0,0,0.05)] max-w-xl text-[14px] leading-relaxed select-text",
                          isMe ? "bg-[#95EC69] text-[#1a1a1a]" : "bg-white text-[#1a1a1a]"
                        )}
                      >
                        <MessageContentWithChips content={showContent} onNavigateToSettings={onNavigateToSettings} />
                      </div>
                    )}
                    {!isMe && toolCalls && toolCalls.length > 0 && (
                      <ToolCallGroup toolCalls={toolCalls} />
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm h-full">No messages yet</div>
          )}
        </div>

        <div className="h-[200px] border-t border-[#E7E7E7] bg-[#F5F5F5] flex flex-col flex-shrink-0 relative">
          <div className="h-10 px-4 flex items-center justify-between text-gray-500 pt-2">
            <div className="flex items-center gap-5">
              <button className="hover:text-[#07C160] transition-colors" title="Emoji" onClick={() => setShowEmojiPanel((prev) => !prev)}>
                <Laugh size={22} strokeWidth={1.2} />
              </button>
              <button
                className="hover:text-[#07C160] transition-colors"
                title="Send file"
                onClick={() => {
                  saveSelectionInComposer();
                  fileInputRef.current?.click();
                }}
              >
                <Folder size={22} strokeWidth={1.2} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  appendFiles(files);
                  e.currentTarget.value = "";
                }}
              />
            </div>

            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-200 rounded text-xs font-medium text-gray-600 transition-colors"
              >
                <span>{modelOptions.length > 0 ? (selectedModel?.label || "Select model") : "Add model"}</span>
                <ChevronDown size={12} />
              </button>

              {showModelDropdown && (
                <div className="absolute bottom-full right-0 mb-1 w-56 bg-white rounded-lg shadow-lg border border-gray-100 py-1 overflow-hidden z-20">
                  {modelOptions.length === 0 ? (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs text-green-600 font-medium hover:bg-green-50 transition-colors"
                      onClick={() => {
                        setShowModelDropdown(false);
                        onNavigateToSettings?.();
                      }}
                    >
                      Add model
                    </button>
                  ) : (
                    modelOptions.map((model) => (
                      <button
                        key={model.id}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors",
                          selectedModel?.id === model.id ? "text-green-600 font-medium bg-green-50" : "text-gray-700"
                        )}
                        onClick={() => {
                          setSelectedModelId(model.id);
                          setShowModelDropdown(false);
                        }}
                      >
                        {model.label}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {showEmojiPanel && (
            <div ref={emojiRef} className="absolute left-4 bottom-[160px] w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30">
              <div className="grid grid-cols-10 gap-2">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="text-lg hover:bg-gray-100 rounded"
                    onClick={() => {
                      insertTextAtCaret(emoji);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            className={cn(
              "flex-1 px-4 py-2 min-h-0 flex flex-col rounded-md transition-colors",
              isDragOverInput ? "bg-[#eaf7ef] ring-1 ring-[#07C160]/30" : ""
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOverInput(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setIsDragOverInput(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOverInput(false);
              const files = Array.from(e.dataTransfer.files || []);
              appendFiles(files);
            }}
            onClick={focusInputToEnd}
          >
            <div
              ref={composerRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => {
                saveSelectionInComposer();
                setComposerVersion((v) => v + 1);
              }}
              onClick={saveSelectionInComposer}
              onKeyUp={saveSelectionInComposer}
              onMouseUp={saveSelectionInComposer}
              onBlur={saveSelectionInComposer}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSend();
                  return;
                }
                if (e.key === "Backspace") {
                  // Keep default contenteditable deletion behavior for inline chips.
                  setTimeout(() => {
                    const root = composerRef.current;
                    if (!root) return;
                    const alive = new Set<string>();
                    root.querySelectorAll("[data-attachment-id]").forEach((el) => {
                      const id = (el as HTMLElement).dataset.attachmentId;
                      if (id) alive.add(id);
                    });
                    setPendingAttachments((prev) => {
                      const next = prev.filter((item) => alive.has(item.id));
                      for (const removed of prev) {
                        if (!alive.has(removed.id)) revokeAttachment(removed);
                      }
                      return next;
                    });
                    setComposerVersion((v) => v + 1);
                  }, 0);
                }
              }}
              className="w-full flex-1 min-h-[96px] bg-transparent outline-none text-base leading-6 text-gray-800 font-sans whitespace-pre-wrap break-words"
              data-version={composerVersion}
            />
          </div>

          <div className="h-12 px-6 flex items-center justify-end pb-4">
            <button
              onClick={() => void handleSend()}
              disabled={disablePrimaryButton}
              className={cn(
                "px-7 py-1.5 text-sm rounded-[4px] transition-colors font-medium",
                isStreaming
                  ? "bg-[#FDECEC] text-[#E53935] hover:bg-[#FAD4D4]"
                  : canSend
                    ? "bg-[#E9E9E9] text-[#07C160] hover:text-[#06ad56] hover:bg-[#D2D2D2]"
                    : "bg-[#F0F0F0] text-gray-400 cursor-not-allowed"
              )}
            >
              {isStreaming ? "停止" : "发送(S)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
