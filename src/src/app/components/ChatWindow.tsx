import { Plus, ChevronDown, Folder, Laugh } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "../../utils/cn";
import React, { useState, useEffect, useRef, useCallback } from "react";
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
  onChatMessageAppended,
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

type ChatStreamState = {
  assistantMessageId: string;
  streamedText: string;
  botId: string | null;
  toolCalls: ToolCall[];
  toolMessageId: string | null;
};

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

function fileNameFromPath(filePath: string): string {
  const s = String(filePath || "").replace(/\\/g, "/");
  const idx = s.lastIndexOf("/");
  return idx >= 0 ? s.slice(idx + 1) : s || "file";
}

function isHttpUrl(s: string): boolean {
  const t = String(s || "").trim();
  return t.startsWith("http://") || t.startsWith("https://");
}

const LOCAL_IMG_MARKER = "https://__creez_local_img__/";

function isLocalImageMarker(s: string): boolean {
  return s.startsWith(LOCAL_IMG_MARKER);
}

function decodeLocalImageMarker(s: string): string {
  return decodeURIComponent(s.slice(LOCAL_IMG_MARKER.length));
}

function encodeLocalImageMarker(localPath: string): string {
  return LOCAL_IMG_MARKER + encodeURIComponent(localPath.replace(/\\/g, "/"));
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function ImageContextMenu({
  x,
  y,
  onCopy,
  onClose,
}: {
  x: number;
  y: number;
  onCopy: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  const menuStyle: React.CSSProperties = {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 10000,
  };

  return (
    <div ref={ref} style={menuStyle} className="bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[100px]">
      <button
        type="button"
        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
        onClick={() => { onCopy(); onClose(); }}
      >
        复制图片
      </button>
    </div>
  );
}

async function copyImageToClipboard(src: string): Promise<void> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
  });
  img.src = src;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas context unavailable");
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

const imageDataUrlCache = new Map<string, string>();

function ImageChipFromPath({ path: rawPath, className = "" }: { path: string; className?: string }) {
  const resolvedPath = isLocalImageMarker(rawPath) ? decodeLocalImageMarker(rawPath) : rawPath;
  const cached = imageDataUrlCache.get(resolvedPath) ?? null;
  const [dataUrl, setDataUrl] = useState<string | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [copyToast, setCopyToast] = useState(false);
  const isUrl = isHttpUrl(resolvedPath) && !isLocalImageMarker(rawPath);

  useEffect(() => {
    if (isUrl) {
      imageDataUrlCache.set(resolvedPath, resolvedPath);
      setDataUrl(resolvedPath);
      return;
    }
    if (imageDataUrlCache.has(resolvedPath)) {
      setDataUrl(imageDataUrlCache.get(resolvedPath)!);
      return;
    }
    let cancelled = false;
    readLocalImageDataUrl(resolvedPath)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          imageDataUrlCache.set(resolvedPath, url);
          setDataUrl(url);
        } else {
          setError("empty result");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => { cancelled = true; };
  }, [resolvedPath, isUrl]);

  const handleCopy = useCallback(async () => {
    if (!dataUrl) return;
    try {
      await copyImageToClipboard(dataUrl);
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 1500);
    } catch (e) {
      console.warn("[ImageChip] copy failed:", e);
    }
  }, [dataUrl]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  if (error) {
    return (
      <span className={cn("inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-red-50 text-red-500 text-xs", className)}>
        图片加载失败: {error}
      </span>
    );
  }
  if (!dataUrl) {
    return (
      <span className={cn("inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-gray-100 text-gray-500 text-xs", className)}>
        图片加载中…
      </span>
    );
  }
  return (
    <>
      <span className={cn("inline-flex mr-1 mb-1 relative", className)}>
        <img
          src={dataUrl}
          alt=""
          className="max-w-[200px] max-h-[200px] w-auto h-auto rounded-lg object-cover bg-white border border-gray-200 cursor-pointer hover:brightness-95 transition-[filter]"
          onClick={() => setLightboxOpen(true)}
          onContextMenu={handleContextMenu}
        />
        {copyToast && (
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/75 text-white text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none">
            已复制
          </span>
        )}
      </span>
      {lightboxOpen && <ImageLightbox src={dataUrl} onClose={() => setLightboxOpen(false)} />}
      {ctxMenu && (
        <ImageContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onCopy={handleCopy}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

function VideoChipFromUrl({ url, className = "" }: { url: string; className?: string }) {
  const src = String(url || "").trim();
  if (!src) return null;
  return (
    <span className={cn("inline-flex mr-1 mb-1 block", className)}>
      <video
        src={src}
        controls
        playsInline
        className="max-w-[280px] max-h-[200px] rounded-lg border border-gray-200 bg-black"
      />
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

/** Sanitize schema: allow common markdown HTML + video (for rehype-raw). */
const markdownSanitizeSchema = {
  tagNames: [
    "a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "hr", "i", "img", "input", "li", "ol", "p",
    "pre", "s", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul", "video",
  ],
  protocols: {
    href: ["http", "https", "mailto"],
  },
  attributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title", "className"],
    video: ["src", "controls", "playsinline", "className"],
    input: ["type", "disabled", "checked"],
    code: ["className"],
    div: ["className"],
    span: ["className"],
    p: ["className"],
    pre: ["className"],
    ol: ["start", "className"],
    ul: ["className"],
    li: ["className"],
    table: ["className"],
    thead: ["className"],
    tbody: ["className"],
    tr: ["className"],
    th: ["className"],
    td: ["className"],
  },
};

/** Normalize line endings, collapse 3+ newlines, fix table lines, wrap local image paths. */
function normalizeMarkdownNewlines(text: string): string {
  const unified = text.replace(/\r\n?/g, "\n");
  const collapsed = unified.replace(/\n{3,}/g, "\n\n");
  const tables = collapsed.replace(/^(\s*)(\|.+\|)\s*$/gm, (_, spaces, line) => (spaces.length >= 2 ? line : spaces + line));
  // Wrap local file paths in Markdown image refs with a fake https marker
  // so rehype-sanitize always allows them. The img component decodes the marker back.
  // Matches: ![alt](C:/...) ![alt](D:\...) ![alt](file:///C:/...) ![alt](/Users/...)
  return tables.replace(
    /(!\[[^\]]*\]\()([^)]+)(\))/g,
    (match, before, url, after) => {
      const trimmed = url.trim();
      if (isHttpUrl(trimmed)) return match;
      return `${before}${encodeLocalImageMarker(trimmed)}${after}`;
    }
  );
}

const remarkPluginList = [remarkGfm] as const;
const rehypePluginList = [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]] as const;

function MessageContentMarkdown({
  content,
  className = "",
  onNavigateToSettings,
}: {
  content: string;
  className?: string;
  onNavigateToSettings?: () => void;
}) {
  const empty = !content || typeof content !== "string" || !content.trim();
  if (empty) return <span className={cn(className)} />;

  const normalizedContent = normalizeMarkdownNewlines(content);

  const mdComponents = React.useMemo(
    () => ({
      img: ({ src }: { src?: string; alt?: string }) => {
        if (!src) return null;
        return <ImageChipFromPath path={src} />;
      },
      video: ({ src }: { src?: string }) => {
        if (!src) return null;
        return <VideoChipFromUrl url={src} />;
      },
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
        if (href === "settings" && onNavigateToSettings) {
          return (
            <button
              type="button"
              className="text-[#07C160] underline cursor-pointer hover:opacity-80 bg-transparent border-0 p-0"
              onClick={(e) => {
                e.preventDefault();
                onNavigateToSettings();
              }}
            >
              {children}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#07C160] underline">
            {children}
          </a>
        );
      },
      p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>,
      h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-lg font-semibold mt-3 mb-1 first:mt-0">{children}</h1>,
      h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-base font-semibold mt-3 mb-1 first:mt-0">{children}</h2>,
      h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-[15px] font-semibold mt-2 mb-1 first:mt-0">{children}</h3>,
      hr: () => <hr className="my-2 border-gray-200" />,
      ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
      ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
      li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed whitespace-pre-wrap">{children}</li>,
      code: ({ className: codeClassName, children }: { className?: string; children?: React.ReactNode }) =>
        codeClassName ? (
          <code className={cn("rounded px-1 py-0.5 bg-gray-100 text-[13px]", codeClassName)}>{children}</code>
        ) : (
          <code className="rounded px-1 py-0.5 bg-gray-100 text-[13px] font-mono">{children}</code>
        ),
      pre: ({ children }: { children?: React.ReactNode }) => (
        <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-[13px] my-2 border border-gray-100 min-h-0">
          {children}
        </pre>
      ),
      strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
      table: ({ children }: { children?: React.ReactNode }) => (
        <div className="my-2 overflow-x-auto rounded-lg border border-gray-200 min-h-0">
          <table className="w-full border-collapse text-[13px]">{children}</table>
        </div>
      ),
      thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-50">{children}</thead>,
      tbody: ({ children }: { children?: React.ReactNode }) => <tbody className="bg-white">{children}</tbody>,
      tr: ({ children }: { children?: React.ReactNode }) => <tr className="border-b border-gray-100 last:border-b-0">{children}</tr>,
      th: ({ children }: { children?: React.ReactNode }) => (
        <th className="px-3 py-2 text-left font-semibold text-gray-700 border-r border-gray-100 last:border-r-0 whitespace-nowrap">
          {children}
        </th>
      ),
      td: ({ children }: { children?: React.ReactNode }) => (
        <td className="px-3 py-2 text-gray-800 border-r border-gray-100 last:border-r-0 align-top whitespace-pre-wrap">
          {children}
        </td>
      ),
    }),
    [onNavigateToSettings],
  );

  return (
    <div className={cn("message-markdown break-words text-[14px] leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPluginList as any}
        rehypePlugins={rehypePluginList as any}
        components={mdComponents}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
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
  /** Per-chat stream tracking — background bots persist to DB even when user switches away. */
  const chatStreamsRef = useRef<Map<string, ChatStreamState>>(new Map());

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
    const unsub = window.electron?.channel?.onNewMessage?.(() => {
      void reloadChats(selectedChatId || undefined);
    });
    return () => {
      unsub?.();
    };
  }, [selectedChatId]);

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
      const stream = chatStreamsRef.current.get(chatId);
      if (stream?.assistantMessageId) {
        setMessages(items.map((msg) =>
          msg.id === stream.assistantMessageId
            ? { ...msg, content: stream.streamedText || msg.content, ...(stream.toolCalls?.length ? { toolCalls: stream.toolCalls } : {}) }
            : msg
        ));
      } else {
        setMessages(items);
      }
      setIsLoadingMessages(false);
    }
    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [selectedChatId, chatList]);

  useEffect(() => {
    const unsub = onChatMessageAppended((payload) => {
      const chatId = payload?.chatId;
      if (chatId && String(chatId) === String(selectedChatId)) {
        const currentChat = chatList.find((c) => c.id === selectedChatId);
        if (currentChat) {
          fetchChatMessages(selectedChatId, currentChat.name, currentChat.avatar).then((items) => {
            setMessages(items);
          });
        }
      }
    });
    return () => unsub();
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
      const rawMessage = message || "Request failed.";
      let text = rawMessage;
      // Shown when the model API (e.g. OpenRouter) returns 401 / auth error during reply
      if (
        /401|missing\s+authentication|invalid\s+.*authorization|unauthorized/i.test(String(rawMessage).trim())
      ) {
        console.warn("[creez:chat] model API auth error (original):", rawMessage);
        text =
          "模型 API 未授权。请在 设置 → Model Config 中填写当前模型的 API Key 并保存后重试。若已填写仍报错，请检查 Key 是否对应当前 Provider（如 OpenRouter）且未过期。";
      }
      console.log("[creez:chat] reply_error", { message: text });
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
      if (errChatId) chatStreamsRef.current.delete(errChatId);
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
    const stream = chatStreamsRef.current.get(selectedChatId);
    if (stream) {
      activeAssistantMessageIdRef.current = stream.assistantMessageId;
      streamedTextRef.current = stream.streamedText;
      activeStreamChatIdRef.current = selectedChatId;
      activeStreamBotIdRef.current = stream.botId;
      activeToolCallsRef.current = stream.toolCalls;
      activeToolMessageIdRef.current = stream.toolMessageId;
      setIsStreaming(true);
    } else {
      setIsStreaming(false);
    }
  }, [selectedChatId]);

  useEffect(() => {
    if (!selectedChatId || !selectedModelId || chatList.length === 0) return;
    const currentChat = chatList.find((c) => c.id === selectedChatId);
    if (!currentChat?.contactId) return;
    if (agentReadyRef.current) return;
    if (initInFlightRef.current) return;
    void ensureAgentInitialized();
  }, [selectedChatId, selectedModelId, chatList]);

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

    const existingSignatures = new Set(pendingAttachments.map((a) => getFileSignature(a.file)));
    const newAttachments: PendingAttachment[] = [];
    for (const file of files) {
      const signature = getFileSignature(file);
      if (existingSignatures.has(signature)) continue;
      newAttachments.push(createAttachment(file));
      existingSignatures.add(signature);
    }
    if (newAttachments.length === 0) return;

    setPendingAttachments((prev) => [...prev, ...newAttachments]);

    for (const item of newAttachments) {
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
    const isForCurrentChat =
      eventChatId == null ||
      currentSelectedChatId == null ||
      String(eventChatId) === String(currentSelectedChatId) ||
      isForPendingInit;
    if (event.type !== "message_update") {
      chatLog("agent:event", {
        type: event.type,
        chatId: eventChatId ?? null,
        role: event.message?.role || "",
        toolName: event.toolName || event.message?.toolName || "",
        forCurrentChat: isForCurrentChat,
      });
    }
    switch (event.type) {
      case "agent_start":
      case "message_start":
        return;
      case "agent_ready": {
        if (!isForPendingInit) return;
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
      }
      case "message_update": {
        if (event.message?.role !== "assistant") return;
        const nextRaw = parseAssistantText(event.message?.content);
        if (!nextRaw) return;
        const streamKey = eventChatId || "";
        const stream = chatStreamsRef.current.get(streamKey);
        if (stream) {
          const prev = stream.streamedText || "";
          let next: string;
          if (nextRaw.startsWith(prev) && nextRaw.length >= prev.length) {
            next = nextRaw;
          } else if (prev.startsWith(nextRaw) && nextRaw.length <= prev.length) {
            next = prev;
          } else {
            const overlap = (() => {
              const maxOverlap = Math.min(prev.length, nextRaw.length);
              for (let n = maxOverlap; n > 0; n--) {
                if (prev.slice(-n) === nextRaw.slice(0, n)) return n;
              }
              return 0;
            })();
            next = prev + nextRaw.slice(overlap);
          }
          stream.streamedText = next;
        }
        if (!isForCurrentChat) return;
        const fullText = stream?.streamedText || nextRaw;
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
        const meStreamKey = eventChatId || "";
        const meStream = chatStreamsRef.current.get(meStreamKey);
        const fromEvent = parseAssistantText(event.message?.content);
        const accumulated = meStream?.streamedText ?? streamedTextRef.current ?? "";
        // Prefer accumulated text when longer (avoids overwriting with only the post–tool-call segment)
        const finalText =
          accumulated.length >= (fromEvent?.length ?? 0)
            ? accumulated
            : (fromEvent || accumulated);
        const meTc = isForCurrentChat ? activeToolCallsRef.current : meStream?.toolCalls;
        console.log("[creez:chat] reply_done", {
          chatId: eventChatId ?? null,
          contentLen: finalText.length,
          toolCallsCount: meTc?.length ?? 0,
          forCurrentChat: isForCurrentChat,
        });
        if (meStream) meStream.streamedText = finalText;
        const meMsgId = isForCurrentChat ? activeAssistantMessageIdRef.current : meStream?.assistantMessageId;
        if (meMsgId) {
          void updateChatMessage({
            id: meMsgId,
            content: finalText,
            status: "done",
            toolCalls: meTc?.length ? meTc : undefined,
            updatedAt: Math.floor(Date.now() / 1000),
          });
        }
        if (eventChatId) {
          const preview = finalText.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
          setChatList((prev) =>
            prev.map((c) => (c.id === eventChatId ? { ...c, lastMessage: preview, time: formatNowTime() } : c))
          );
        }
        if (isForCurrentChat) {
          streamedTextRef.current = finalText;
          const assistantId = activeAssistantMessageIdRef.current;
          if (assistantId) {
            setMessages((prevMessages) =>
              prevMessages.map((msg) => (msg.id === assistantId ? { ...msg, content: finalText } : msg))
            );
          }
        }
        return;
      }
      case "agent_end": {
        const aeStreamKey = eventChatId || "";
        const aeStream = chatStreamsRef.current.get(aeStreamKey);
        let endContent = isForCurrentChat ? (streamedTextRef.current || "") : (aeStream?.streamedText || "");
        const endAssistantId = isForCurrentChat ? activeAssistantMessageIdRef.current : aeStream?.assistantMessageId;
        const aeTc = isForCurrentChat ? activeToolCallsRef.current : aeStream?.toolCalls;
        console.log("[creez:chat] agent_end", {
          chatId: eventChatId ?? null,
          contentLen: endContent.length,
          toolCallsCount: aeTc?.length ?? 0,
          forCurrentChat: isForCurrentChat,
        });
        if (endAssistantId) {
          void updateChatMessage({
            id: endAssistantId,
            content: endContent,
            status: "done",
            toolCalls: aeTc?.length ? aeTc : undefined,
            updatedAt: Math.floor(Date.now() / 1000),
          });
        }
        if (eventChatId) {
          const preview = endContent.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
          setChatList((prev) =>
            prev.map((c) => (c.id === eventChatId ? { ...c, lastMessage: preview, time: formatNowTime() } : c))
          );
        }
        chatStreamsRef.current.delete(aeStreamKey);
        if (isForCurrentChat) {
          const assistantId = activeAssistantMessageIdRef.current;
          if (assistantId) {
            setMessages((prev) =>
              prev.map((msg) => (msg.id === assistantId ? { ...msg, content: endContent } : msg))
            );
          }
          activeAssistantMessageIdRef.current = null;
          activeToolMessageIdRef.current = null;
          activeToolCallsRef.current = [];
          streamedTextRef.current = "";
          activeStreamChatIdRef.current = null;
          activeStreamBotIdRef.current = null;
          setIsStreaming(false);
        }
        return;
      }
      default: {
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
        const params = (event.args && typeof event.args === "object" ? event.args : {}) as Record<string, unknown>;
        let tcStatus: "running" | "success" | "failure" = "running";
        let tcResult: string | undefined;
        if (event.result !== undefined || event.isError) {
          tcStatus = event.isError ? "failure" : "success";
          tcResult = typeof event.result === "string"
            ? event.result
            : event.result !== undefined
              ? JSON.stringify(event.result)
              : event.message?.errorMessage || "";
          if (tcStatus === "failure") tcResult = event.message?.errorMessage || tcResult;
        }
        const dfStreamKey = eventChatId || "";
        const dfStream = chatStreamsRef.current.get(dfStreamKey);
        if (dfStream) {
          const existingIdx = dfStream.toolCalls.findIndex((tc) => tc.id === id);
          const base = existingIdx >= 0 ? dfStream.toolCalls[existingIdx] : null;
          const merged: ToolCall = {
            id,
            toolName,
            parameters: Object.keys(params).length > 0 ? params : (base?.parameters ?? {}),
            status: tcStatus !== "running" ? tcStatus : (base?.status ?? "running"),
            result: tcResult ?? base?.result,
          };
          if (existingIdx >= 0) dfStream.toolCalls[existingIdx] = merged;
          else dfStream.toolCalls.push(merged);
        }
        if (!isForCurrentChat || !isStreamingRef.current) return;
        if (event.result !== undefined || event.isError) {
          upsertToolCall({ id, toolName, parameters: params, status: tcStatus, result: tcResult });
        } else if (event.args !== undefined || event.type === "tool_call" || event.type?.startsWith("tool_call")) {
          upsertToolCall({ id, toolName, parameters: params, status: "running" });
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
    const models = Array.isArray(config.models) ? config.models : [];
    const targetModel =
      models.find((item) => item.id === selectedModelId) || models.find((item) => item.active) || models[0];
    if (!targetModel?.id || !targetModel.model || !targetModel.provider) {
      console.log("[creez:flow] ensureAgentInitialized fail: no targetModel or missing id/model/provider", {
        contactId,
        modelCount: models.length,
        hasTargetModel: Boolean(targetModel),
        targetModelId: targetModel?.id,
      });
      chatLog("agent:init:skip", "no targetModel or missing id/model/provider");
      return false;
    }
    const apiKey = await fetchModelApiKey(targetModel.id, { contactId });
    if (!apiKey || String(apiKey).trim() === "") {
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
    chatStreamsRef.current.delete(streamingChatId);
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
        content: "当前未配置可用模型或 API Key。请打开 设置 → Model Config，添加模型并填写 API Key 后保存。",
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

    if (activeStreamChatIdRef.current === activeChat.id) {
      abortAgentPrompt(activeChat.id);
      chatStreamsRef.current.delete(activeChat.id);
    }
    streamedTextRef.current = "";
    activeToolMessageIdRef.current = null;
    activeToolCallsRef.current = [];
    const assistantId = `${Date.now()}-assistant-stream`;
    activeAssistantMessageIdRef.current = assistantId;
    activeStreamChatIdRef.current = activeChat.id;
    activeStreamBotIdRef.current = activeChat.contactId || null;
    chatStreamsRef.current.set(activeChat.id, {
      assistantMessageId: assistantId,
      streamedText: "",
      botId: activeChat.contactId || null,
      toolCalls: [],
      toolMessageId: null,
    });
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
    console.log("[creez:chat] send", {
      chatId: selectedChatId ?? null,
      textLen: contentWithPaths.length,
      imageCount: images.length,
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
                  <div className="flex justify-between items-center mb-0.5 gap-1">
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
              const isActiveStreamingReply =
                !isMe && isStreaming && msg.id === activeAssistantMessageIdRef.current;
              const showContent = isActiveStreamingReply
                ? (msg.content || "") + (msg.content?.trim() ? " " : "") + waitingDots
                : (msg.content || "");
              const hasContent = Boolean(msg.content?.trim());
              const showContentBubble = hasContent || isActiveStreamingReply;
              return (
                <div key={msg.id} className={cn("flex gap-3", isMe ? "flex-row-reverse" : "flex-row")}>
                  <div className="flex-shrink-0">
                    <img src={msg.avatar} alt={msg.sender} className="w-9 h-9 rounded-[4px] object-cover" />
                  </div>
                  <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                    {!isMe && (
                      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                        <span className="text-xs text-gray-500">{msg.name}</span>
                        {(msg as { channelType?: string | null }).channelType === "feishu" ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">来自飞书</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Creez</span>
                        )}
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
                        <MessageContentMarkdown content={showContent} onNavigateToSettings={onNavigateToSettings} />
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
              onPaste={(e) => {
                const clipboardData = e.clipboardData;
                if (!clipboardData) return;
                let textToInsert = "";
                const html = clipboardData.getData("text/html");
                if (html) {
                  const hrefMatch = html.match(/<a\s[^>]*\bhref=["']([^"']+)["']/i);
                  if (hrefMatch) textToInsert = hrefMatch[1];
                }
                if (!textToInsert) textToInsert = clipboardData.getData("text/plain") || "";
                if (textToInsert) {
                  e.preventDefault();
                  insertTextAtCaret(textToInsert);
                }
              }}
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
              {isStreaming ? "Stop" : "Send (S)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
