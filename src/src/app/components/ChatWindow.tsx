import { Plus, ChevronDown, Folder, Laugh, X, Square, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "../../utils/cn";
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { SearchBar } from "./ui/SearchBar";
import { ChannelMessageSourceBadge } from "./ChannelPlatformIcon";
import { ToolCallGroup, type ToolCall } from "./ToolCallPanel";
import {
  abortAgentPrompt,
  appendChatMessage,
  deleteChat,
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
import { loadAppState, persistAppState } from "../services/appState";
import { discoverAgents, sendToRemoteBot, onA2ASessionEvent } from "../services/a2a";
import { BotOriginBadge } from "./BotOriginBadge";

interface ChatWindowProps {
  activeChatId?: number | string;
  activeChatMeta?: { name?: string; avatar?: string } | null;
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

type QueuedMessage = {
  id: string;
  displayText: string;
  content: string;
  images: { type: "image"; data: string; mimeType: string }[];
};

type ChatMessageItemWithTools = ChatMessageItem & { toolCalls?: ToolCall[] };

type ChatStreamState = {
  assistantMessageId: string;
  streamedText: string;
  botId: string | null;
  toolCalls: ToolCall[];
  toolMessageId: string | null;
};

type SandboxApprovalRequest = NonNullable<AgentEventPayload["request"]>;

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

function flattenChildrenToString(children: React.ReactNode): string {
  if (children == null || children === false) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(flattenChildrenToString).join("");
  if (React.isValidElement(children)) {
    return flattenChildrenToString((children.props as { children?: React.ReactNode }).children);
  }
  return "";
}

/**
 * Whether the string looks like an absolute local path / file URL we may pass to shell.openPath
 * (main process still enforces absolute-only).
 */
function isAbsoluteLocalPathForOpen(s: string): boolean {
  const t = String(s || "").trim();
  if (!t || t.length < 2) return false;
  if (/^https?:\/\//i.test(t) || /^mailto:/i.test(t)) return false;
  if (/^file:\/\//i.test(t)) return true;
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (t.startsWith("\\\\")) return true;
  if (t.startsWith("/Users/") || t.startsWith("/home/")) return true;
  if (t.startsWith("/") && !t.startsWith("//") && /\/[^/]+\/[^/]+/.test(t)) return true;
  return false;
}

/** Open http(s)/mailto in browser, or absolute path / file:// in system default app (Electron main process). */
async function openLinkOrPath(target: string) {
  const t = String(target || "").trim();
  if (!t) return;
  const api = typeof window !== "undefined" ? window.electron?.shell?.open : undefined;
  if (api) {
    try {
      const res = await api({ target: t });
      if (!res?.ok) {
        // eslint-disable-next-line no-console
        console.warn("[ChatWindow] shell.open failed:", res?.error?.message || res);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[ChatWindow] shell.open error:", e);
    }
    return;
  }
  if (/^https?:\/\//i.test(t) || /^mailto:/i.test(t)) {
    window.open(t, "_blank", "noopener,noreferrer");
  }
}

/** Reveal a local file in the system file manager (Finder / Explorer / etc.). */
async function showImageInFileExplorer(localPath: string) {
  const t = String(localPath || "").trim();
  if (!t || !isAbsoluteLocalPathForOpen(t)) return;
  const api = typeof window !== "undefined" ? window.electron?.shell?.showItemInFolder : undefined;
  if (!api) return;
  try {
    const res = await api({ path: t });
    if (!res?.ok) {
      // eslint-disable-next-line no-console
      console.warn("[ChatWindow] shell.showItemInFolder failed:", res?.error?.message || res);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[ChatWindow] shell.showItemInFolder error:", e);
  }
}

type LinkMatch = { start: number; end: number; href: string };

/** Collect non-overlapping URL / file path spans for linkification (plain text segments only). */
function collectLinkMatches(segment: string): LinkMatch[] {
  const raw: LinkMatch[] = [];

  const addRe = (re: RegExp, hrefFrom: (slice: string, m: RegExpExecArray) => string, sliceFrom: (m: RegExpExecArray) => { start: number; end: number; text: string }) => {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = r.exec(segment)) !== null) {
      const { start, end, text } = sliceFrom(m);
      if (end > start && text) {
        raw.push({ start, end, href: hrefFrom(text, m) });
      }
    }
  };

  addRe(
    /(?<!\()https?:\/\/[^\s<>\[\]()]+/gi,
    (slice) => slice,
    (m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }),
  );
  addRe(
    /(?<!\()file:\/\/[^\s<>\[\]"']+/gi,
    (slice) => slice,
    (m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }),
  );
  addRe(
    /\b[A-Za-z]:\\[^\s<>\[\]"']+/g,
    (slice) => `file:///${slice.replace(/\\/g, "/")}`,
    (m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }),
  );
  addRe(
    /\b[A-Za-z]:\/[^\s<>\[\]"']+/g,
    (slice) => `file:///${slice}`,
    (m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }),
  );
  addRe(
    /(^|[\s"'(<])(\\\\[^\s<>\[\]"']+)/g,
    (slice) => slice,
    (m) => {
      const unc = m[2] || "";
      const start = m.index + (m[1]?.length ?? 0);
      return { start, end: start + unc.length, text: unc };
    },
  );
  addRe(
    /(?:^|[\s(/'"])(\/Users\/[^\s<>\[\]"']+)/g,
    (slice) => `file://${slice}`,
    (m) => {
      const text = m[1];
      const start = m.index + m[0].length - text.length;
      return { start, end: start + text.length, text };
    },
  );
  addRe(
    /(?:^|[\s(/'"])(\/home\/[^\s<>\[\]"']+)/g,
    (slice) => `file://${slice}`,
    (m) => {
      const text = m[1];
      const start = m.index + m[0].length - text.length;
      return { start, end: start + text.length, text };
    },
  );

  raw.sort((a, b) => a.start - b.start || b.end - a.end - (a.end - a.start));
  const merged: LinkMatch[] = [];
  let lastEnd = -1;
  for (const x of raw) {
    if (x.start < lastEnd) continue;
    merged.push(x);
    lastEnd = x.end;
  }
  return merged;
}

function linkifyPlainSegment(segment: string): string {
  const matches = collectLinkMatches(segment);
  if (matches.length === 0) return segment;
  let out = "";
  let cur = 0;
  for (const m of matches) {
    out += segment.slice(cur, m.start);
    const label = segment.slice(m.start, m.end)
      .replace(/\\/g, "\\\\")
      .replace(/\]/g, "\\]");
    out += `[${label}](${m.href})`;
    cur = m.end;
  }
  out += segment.slice(cur);
  return out;
}

function linkifyOutsideCodeFences(text: string): string {
  const protectedRe = /```[\s\S]*?```|`[^`\n]+`|!?\[[^\]]*\]\([^)]*\)/g;
  let result = "";
  let lastIdx = 0;
  let pm: RegExpExecArray | null;
  while ((pm = protectedRe.exec(text)) !== null) {
    if (pm.index > lastIdx) {
      result += linkifyPlainSegment(text.slice(lastIdx, pm.index));
    }
    result += pm[0];
    lastIdx = pm.index + pm[0].length;
  }
  if (lastIdx < text.length) {
    result += linkifyPlainSegment(text.slice(lastIdx));
  }
  return result;
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
  onOpenLocation,
  onClose,
}: {
  x: number;
  y: number;
  onCopy: () => void;
  onOpenLocation?: (() => void) | null;
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
    <div ref={ref} style={menuStyle} className="bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px]">
      <button
        type="button"
        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
        onClick={() => { onCopy(); onClose(); }}
      >
        复制图片
      </button>
      {onOpenLocation ? (
        <button
          type="button"
          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
          onClick={() => {
            onOpenLocation();
            onClose();
          }}
        >
          在文件管理器中显示
        </button>
      ) : null}
    </div>
  );
}

function ChatListContextMenu({
  x,
  y,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", closeOnPointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnPointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left: x, top: y, zIndex: 10000 }}
      className="bg-white rounded-md shadow-lg border border-gray-200 py-1 min-w-[132px]"
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 cursor-pointer"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Trash2 size={14} />
        删除对话
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

  const canRevealInFolder = !isUrl && isAbsoluteLocalPathForOpen(resolvedPath);

  const handleOpenLocation = useCallback(() => {
    if (!canRevealInFolder) return;
    void showImageInFileExplorer(resolvedPath);
  }, [canRevealInFolder, resolvedPath]);

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
          onOpenLocation={canRevealInFolder ? handleOpenLocation : null}
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
      role="button"
      tabIndex={0}
      onClick={() => void openLinkOrPath(path)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void openLinkOrPath(path);
        }
      }}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 mr-1 mb-1 bg-[#F0F0F0] border border-gray-200 rounded-xl align-middle cursor-pointer hover:bg-[#E6E6E6] transition-colors",
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

function UserImageCard({ path }: { path: string }) {
  const resolvedPath = isLocalImageMarker(path) ? decodeLocalImageMarker(path) : path;
  const isUrl = isHttpUrl(resolvedPath) && !isLocalImageMarker(path);
  const cached = imageDataUrlCache.get(resolvedPath) ?? null;
  const [dataUrl, setDataUrl] = useState<string | null>(isUrl ? resolvedPath : cached);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (isUrl || dataUrl) return;
    if (imageDataUrlCache.has(resolvedPath)) {
      setDataUrl(imageDataUrlCache.get(resolvedPath)!);
      return;
    }
    let cancelled = false;
    readLocalImageDataUrl(resolvedPath).then((url) => {
      if (cancelled || !url) return;
      imageDataUrlCache.set(resolvedPath, url);
      setDataUrl(url);
    });
    return () => { cancelled = true; };
  }, [resolvedPath, isUrl, dataUrl]);

  const name = fileNameFromPath(resolvedPath);

  return (
    <>
      <span
        className="inline-flex items-center gap-2.5 px-2.5 py-2 mr-1 mb-1 bg-[#F0F0F0] border border-gray-200 rounded-xl align-middle cursor-pointer hover:bg-[#E8E8E8] transition-colors"
        onClick={() => dataUrl && setLightboxOpen(true)}
      >
        {dataUrl ? (
          <img src={dataUrl} alt="" className="w-12 h-12 rounded-lg object-cover bg-white shrink-0" />
        ) : (
          <span className="w-12 h-12 rounded-lg bg-gray-200 animate-pulse shrink-0" />
        )}
        <span className="text-[12px] text-gray-800 truncate max-w-[160px]">{name}</span>
      </span>
      {lightboxOpen && dataUrl && <ImageLightbox src={dataUrl} onClose={() => setLightboxOpen(false)} />}
    </>
  );
}

function LinkifiedText({ text, linkClassName }: { text: string; linkClassName?: string }) {
  const matches = collectLinkMatches(text);
  if (matches.length === 0) {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }
  const parts: React.ReactNode[] = [];
  let cur = 0;
  let key = 0;
  const linkCls = linkClassName ?? "text-[#0d5c2e] underline cursor-pointer whitespace-pre-wrap break-all text-left bg-transparent border-0 p-0 font-inherit inline";
  for (const m of matches) {
    if (m.start > cur) {
      parts.push(<span key={key++} className="whitespace-pre-wrap">{text.slice(cur, m.start)}</span>);
    }
    const label = text.slice(m.start, m.end);
    parts.push(
      <button
        key={key++}
        type="button"
        className={linkCls}
        onClick={() => void openLinkOrPath(m.href)}
      >
        {label}
      </button>
    );
    cur = m.end;
  }
  if (cur < text.length) {
    parts.push(<span key={key++} className="whitespace-pre-wrap">{text.slice(cur)}</span>);
  }
  return <>{parts}</>;
}

function UserMessageContent({ content }: { content: string }) {
  if (!content || typeof content !== "string") return null;
  const attachmentRegex = /\[(Image|File):\s*##([^#]+)##\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = attachmentRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<LinkifiedText key={key++} text={content.slice(lastIndex, match.index)} />);
    }
    const [, type, filePath] = match;
    if (type === "Image") {
      parts.push(<UserImageCard key={key++} path={filePath} />);
    } else {
      parts.push(<FileChipFromPath key={key++} path={filePath} />);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(<LinkifiedText key={key++} text={content.slice(lastIndex)} />);
  }
  if (parts.length === 0) {
    return (
      <div className="break-words text-[14px] leading-relaxed">
        <LinkifiedText text={content} />
      </div>
    );
  }
  return <div className="break-words text-[14px] leading-relaxed">{parts}</div>;
}

/** Sanitize schema: allow common markdown HTML + video (for rehype-raw). */
const markdownSanitizeSchema = {
  tagNames: [
    "a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "hr", "i", "img", "input", "li", "ol", "p",
    "pre", "s", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul", "video",
  ],
  protocols: {
    href: ["http", "https", "mailto", "file"],
    src: ["http", "https", "file"],
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

  const normalizedContent = normalizeMarkdownNewlines(linkifyOutsideCodeFences(content));

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
        const h = href?.trim() || "";
        if (h && (/^https?:\/\//i.test(h) || /^mailto:/i.test(h) || /^file:\/\//i.test(h))) {
          return (
            <a
              href={h}
              className="text-[#07C160] underline cursor-pointer break-all"
              onClick={(e) => {
                e.preventDefault();
                void openLinkOrPath(h);
              }}
            >
              {children}
            </a>
          );
        }
        if (h && isAbsoluteLocalPathForOpen(h)) {
          return (
            <button
              type="button"
              className="text-[#07C160] underline cursor-pointer break-all bg-transparent border-0 p-0 font-inherit text-left inline"
              onClick={() => void openLinkOrPath(h)}
            >
              {children}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#07C160] underline break-all">
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
      code: ({ className: codeClassName, children }: { className?: string; children?: React.ReactNode }) => {
        if (codeClassName) {
          return (
            <code className={cn("rounded px-1 py-0.5 bg-gray-100 text-[13px]", codeClassName)}>{children}</code>
          );
        }
        const inlineText = flattenChildrenToString(children).trim();
        if (
          inlineText &&
          !inlineText.includes("\n") &&
          inlineText.length <= 2048 &&
          isAbsoluteLocalPathForOpen(inlineText)
        ) {
          return (
            <button
              type="button"
              className="rounded px-1 py-0.5 bg-gray-100 text-[13px] font-mono text-[#07C160] underline cursor-pointer hover:bg-gray-200 border-0 align-baseline text-left"
              title="使用系统默认应用打开此文件"
              onClick={() => void openLinkOrPath(inlineText)}
            >
              {children}
            </button>
          );
        }
        return <code className="rounded px-1 py-0.5 bg-gray-100 text-[13px] font-mono">{children}</code>;
      },
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

export function ChatWindow({ activeChatId, activeChatMeta, onSelectChat, onNavigateToSettings }: ChatWindowProps) {
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
  /** Bumped when contact:listChanged fires so message list re-resolves name/avatar from refreshed chatList. */
  const [contactsRevision, setContactsRevision] = useState(0);
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
  const initTimeoutRef = useRef(false);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const activeToolMessageIdRef = useRef<string | null>(null);
  const streamedTextRef = useRef<string>("");
  const activeStreamChatIdRef = useRef<string | null>(null);
  const activeStreamBotIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  /** contactId → A2A discover online; only contacts that appear in public discover have an entry */
  const [a2aPresence, setA2aPresence] = useState<Map<string, boolean>>(new Map());
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [waitingDots, setWaitingDots] = useState("·");
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const [sandboxApprovals, setSandboxApprovals] = useState<SandboxApprovalRequest[]>([]);
  const [chatContextMenu, setChatContextMenu] = useState<{ chatId: string; x: number; y: number } | null>(null);
  const isStreamingRef = useRef(false);
  const selectedChatIdRef = useRef(selectedChatId);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** 用户未上滑离开底部时为 true；等待回复时 waitingDots 动画不应触发滚底 */
  const messagesStickToBottomRef = useRef(true);
  const activeToolCallsRef = useRef<ToolCall[]>([]);
  /** Per-chat stream tracking — background bots persist to DB even when user switches away. */
  const chatStreamsRef = useRef<Map<string, ChatStreamState>>(new Map());
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  const sendQueuedMessageRef = useRef<(item: QueuedMessage) => void>(() => {});
  /** Tracks the placeholder message id for a pending remote bot reply. */
  const a2aWaitingMsgIdRef = useRef<string | null>(null);

  const scrollMessagesToBottom = () => {
    const el = messagesScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const onMessagesScroll = () => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    messagesStickToBottomRef.current = gap < 80;
  };

  useLayoutEffect(() => {
    if (!messagesStickToBottomRef.current) return;
    scrollMessagesToBottom();
  }, [messages]);

  const updateMessageQueue = useCallback((updater: (prev: QueuedMessage[]) => QueuedMessage[]) => {
    setMessageQueue((prev) => {
      const next = updater(prev);
      messageQueueRef.current = next;
      return next;
    });
  }, []);

  /** Clears local streaming UI when agent_end was skipped or IPC stream state is inconsistent (e.g. headless tasks only send chat:message_appended). */
  const releaseUiStreamingState = useCallback((streamLookupKey: string) => {
    chatStreamsRef.current.delete(streamLookupKey);
    activeAssistantMessageIdRef.current = null;
    activeToolMessageIdRef.current = null;
    activeToolCallsRef.current = [];
    streamedTextRef.current = "";
    activeStreamChatIdRef.current = null;
    activeStreamBotIdRef.current = null;
    setIsStreaming(false);
  }, []);

  const loadA2aPresence = useCallback(async () => {
    try {
      const result = await discoverAgents({ limit: 200 });
      const next = new Map<string, boolean>();
      for (const agent of result.items) {
        if (agent.id) next.set(agent.id, !!agent.online);
      }
      setA2aPresence(next);
    } catch {
      /* ignore */
    }
  }, []);

  /** Model dropdown + selection: scoped to current chat's contact (default assistant when no contact). Refetch after settings save or tab switch. */
  const syncModelDropdownForChat = useCallback(async (chatId: string | null, list: ChatListItem[]) => {
    const chat = chatId ? list.find((c) => c.id === chatId) : null;
    const contactId = chat?.contactId ?? null;
    const scope = contactId ? { contactId } : {};
    const [assistantConfig, appState] = await Promise.all([
      fetchAssistantConfig(scope),
      loadAppState(),
    ]);
    const configuredModels = (assistantConfig.models || []).map((item) => ({
      id: item.id,
      label: `${String(item.provider || "Provider")} / ${String(item.model || "Model")}`,
    }));
    setModelOptions(configuredModels);
    const modelIds = new Set(configuredModels.map((m) => m.id));
    const activeModel = assistantConfig.models?.find((m) => m.active) || assistantConfig.models?.[0];
    const lastId = appState.lastSelectedModelId;
    let nextModelId = "";
    if (lastId && modelIds.has(lastId)) {
      nextModelId = lastId;
    } else if (activeModel?.id && modelIds.has(activeModel.id)) {
      nextModelId = activeModel.id;
    } else if (configuredModels[0]) {
      nextModelId = configuredModels[0].id;
    }
    if (nextModelId) {
      setSelectedModelId(nextModelId);
    }
  }, []);

  const reloadChats = async (preferredChatId?: string | null) => {
    setIsLoadingChats(true);
    const [assistantConfig, items] = await Promise.all([fetchAssistantConfig(), fetchChatList()]);

    const assistantName = assistantConfig.name || "Assistant";
    let assistantAvatar: string;
    if (assistantConfig.avatar) {
      if (assistantConfig.avatar.startsWith("data:") || assistantConfig.avatar.startsWith("http://") || assistantConfig.avatar.startsWith("https://")) {
        assistantAvatar = assistantConfig.avatar;
      } else {
        assistantAvatar = (await readLocalImageDataUrl(assistantConfig.avatar)) || avatarFallback(assistantName);
      }
    } else {
      assistantAvatar = avatarFallback(assistantName);
    }

    setBotName(assistantName);
    setBotAvatar(assistantAvatar);
    const merged = items
      .filter((chat) => !String(chat.id).startsWith("chat_demo_"))
      .map((chat) =>
        chat.id === BOT_CHAT_ID
          ? {
              ...chat,
              name: assistantName,
              avatar: assistantAvatar,
              contactBotOrigin: chat.contactBotOrigin || "assistant",
            }
          : chat
      );
    setChatList(merged);
    setIsLoadingChats(false);
    void loadA2aPresence();

    const nextChatId = preferredChatId || (activeChatId ? String(activeChatId) : selectedChatId);
    if (nextChatId && merged.some((c) => c.id === nextChatId)) {
      setSelectedChatId(nextChatId);
      onSelectChat?.(nextChatId);
    } else if (merged.length > 0) {
      setSelectedChatId(merged[0].id);
      onSelectChat?.(merged[0].id);
    }
    // Model dropdown refresh runs in useEffect([selectedChatId, chatList]) after state commits.
  };

  const reloadChatsRef = useRef(reloadChats);
  reloadChatsRef.current = reloadChats;

  useEffect(() => {
    void reloadChats();
    return () => {};
  }, []);

  useEffect(() => {
    const api = window.electron?.contact;
    if (!api?.onListChanged) return;
    return api.onListChanged(() => {
      void (async () => {
        await reloadChatsRef.current(selectedChatIdRef.current || undefined);
        setContactsRevision((r) => r + 1);
      })();
    });
  }, []);

  useEffect(() => {
    if (!selectedChatId || chatList.length === 0) return;
    void syncModelDropdownForChat(selectedChatId, chatList);
  }, [selectedChatId, chatList, syncModelDropdownForChat]);

  useEffect(() => {
    const unsub = (window as any).electron?.settings?.onAssistantConfigChanged?.(() => {
      void syncModelDropdownForChat(selectedChatId || null, chatList);
    });
    return () => {
      unsub?.();
    };
  }, [selectedChatId, chatList, syncModelDropdownForChat]);

  useEffect(() => {
    void loadA2aPresence();
    const iv = setInterval(() => void loadA2aPresence(), 30_000);
    return () => clearInterval(iv);
  }, [loadA2aPresence]);

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
      if (!chatList.some((c) => c.id === nextId)) {
        void reloadChats(nextId);
      }
    }
  }, [activeChatId, onSelectChat]);

  useEffect(() => {
    if (chatList.length === 0) return;
    const exists = chatList.some((chat) => chat.id === selectedChatId);
    if (exists) return;
    if (activeChatId) {
      const targetId = String(activeChatId);
      const targetExists = chatList.some((c) => c.id === targetId);
      if (targetExists) {
        setSelectedChatId(targetId);
        onSelectChat?.(targetId);
        return;
      }
    }
    const fallbackId = chatList[0].id;
    setSelectedChatId(fallbackId);
    onSelectChat?.(fallbackId);
  }, [chatList, selectedChatId, activeChatId, onSelectChat]);

  /**
   * Load messages when the selected chat changes or contactsRevision bumps (contact:listChanged after Agent Builder save, etc.).
   * Uses chatList from the same render as that bump so avatars/names stay in sync without re-fetching on every lastMessage update.
   */
  useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      return;
    }
    messagesStickToBottomRef.current = true;
    const chatId = selectedChatId;
    const currentChat = chatList.find((c) => c.id === chatId);
    const isActiveTarget = activeChatId && String(activeChatId) === chatId;
    const chatName = currentChat?.name || (isActiveTarget && activeChatMeta?.name) || botName;
    const chatAvatar = currentChat?.avatar || (isActiveTarget && activeChatMeta?.avatar) || botAvatar;

    let cancelled = false;
    async function loadMessages() {
      setIsLoadingMessages(true);
      const items = await fetchChatMessages(chatId, chatName, chatAvatar);
      if (cancelled) return;
      const stream = chatStreamsRef.current.get(chatId);
      console.log("[creez:stream-debug] loadMessages (selectedChatId effect)", {
        chatId,
        itemCount: items.length,
        mergeWithStream: Boolean(stream?.assistantMessageId),
        streamAssistantId: stream?.assistantMessageId ?? null,
      });
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
  }, [selectedChatId, contactsRevision]);

  useEffect(() => {
    const unsub = onChatMessageAppended((payload) => {
      const chatId = payload?.chatId;
      const stream = chatStreamsRef.current.get(String(selectedChatId || ""));
      console.log("[creez:stream-debug] onChatMessageAppended", {
        payloadType: payload?.type ?? null,
        chatId: chatId ?? null,
        selectedChatId: selectedChatId ?? null,
        matchesCurrent: Boolean(chatId && String(chatId) === String(selectedChatId)),
        hasActiveStream: Boolean(stream?.assistantMessageId),
        streamAssistantId: stream?.assistantMessageId ?? null,
        activeAssistantRef: activeAssistantMessageIdRef.current,
        isStreamingRef: isStreamingRef.current,
      });
      if (chatId && String(chatId) === String(selectedChatId)) {
        const currentChat = chatList.find((c) => c.id === selectedChatId);
        if (currentChat) {
          fetchChatMessages(selectedChatId, currentChat.name, currentChat.avatar).then((items) => {
            if (!chatStreamsRef.current.get(selectedChatId) && isStreamingRef.current) {
              releaseUiStreamingState(selectedChatId);
            }
            const streamAfter = chatStreamsRef.current.get(selectedChatId);
            if (streamAfter?.assistantMessageId) {
              console.log("[creez:stream-debug] onChatMessageAppended: setMessages merged with stream", {
                streamAssistantId: streamAfter.assistantMessageId,
                streamedLen: (streamAfter.streamedText || "").length,
                dbItemCount: items.length,
              });
              setMessages(
                items.map((msg) =>
                  msg.id === streamAfter.assistantMessageId
                    ? {
                        ...msg,
                        content: streamAfter.streamedText || msg.content,
                        ...(streamAfter.toolCalls?.length ? { toolCalls: streamAfter.toolCalls } : {}),
                      }
                    : msg
                )
              );
            } else {
              console.log("[creez:stream-debug] onChatMessageAppended: setMessages from DB only (no merge)");
              setMessages(items);
            }
          });
        }
      }
    });
    return () => unsub();
  }, [selectedChatId, chatList, releaseUiStreamingState]);

  useEffect(() => {
    const unsub = onA2ASessionEvent((event) => {
      console.log("[creez:a2a-event] received", {
        type: event.type,
        chatId: (event as any).chatId,
        selectedChatId,
        contentLen: (event.content || "").length,
        contentPreview: (event.content || "").slice(0, 50),
        waitingId: a2aWaitingMsgIdRef.current,
      });
      if (event.type !== "message_in") return;
      const eventChatId = (event as any).chatId;
      if (!eventChatId || String(eventChatId) !== String(selectedChatId)) {
        console.warn("[creez:a2a-event] chatId mismatch, dropping", { eventChatId, selectedChatId });
        return;
      }

      const waitingId = a2aWaitingMsgIdRef.current;
      const replyContent = event.content || "";

      if (waitingId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === waitingId ? { ...m, content: replyContent } : m
          )
        );
        a2aWaitingMsgIdRef.current = null;
      } else {
        const activeChat = chatList.find((c) => c.id === selectedChatId);
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-a2a-reply`,
            sender: "other" as const,
            name: activeChat?.name || botName,
            avatar: activeChat?.avatar || botAvatar,
            content: replyContent,
            timestamp: formatNowTime(),
            type: "text" as const,
          },
        ]);
      }

      setIsStreaming(false);
      activeAssistantMessageIdRef.current = null;
      const replyPreview = replyContent.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
      setChatList((prev) =>
        prev.map((c) =>
          c.id === selectedChatId ? { ...c, lastMessage: replyPreview, time: formatNowTime() } : c
        )
      );
    });
    return () => unsub();
  }, [selectedChatId, chatList, botName, botAvatar]);

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
      console.log("[creez:stream-debug] onAgentError (ipc)", {
        raw: String(message || "").slice(0, 400),
        selectedChatId: selectedChatIdRef.current,
        activeAssistantMessageIdRef: activeAssistantMessageIdRef.current,
        activeStreamChatIdRef: activeStreamChatIdRef.current,
        isStreamingRef: isStreamingRef.current,
        mapKeys: Array.from(chatStreamsRef.current.keys()),
      });
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
        const nextAfterError = messageQueueRef.current[0];
        if (nextAfterError) {
          updateMessageQueue((prev) => prev.slice(1));
          setTimeout(() => sendQueuedMessageRef.current(nextAfterError), 300);
        }
      }
    });
    return () => {
      offEvent();
      offError();
    };
  }, [botAvatar, botName]);

  const activeChat = chatList.find((c) => c.id === selectedChatId) || null;
  const selectedModel = modelOptions.find((item) => item.id === selectedModelId) || modelOptions[0] || null;

  const handleDeleteChat = useCallback(async (chatId: string) => {
    const targetId = String(chatId || "").trim();
    if (!targetId) return;

    const previousChatList = chatList;
    const deleted = await deleteChat(targetId);
    if (!deleted) return;

    const nextList = previousChatList.filter((chat) => chat.id !== targetId);
    const deletingSelectedChat = selectedChatId === targetId;
    const nextSelectedId = deletingSelectedChat ? (nextList[0]?.id || "") : selectedChatId;

    setChatList(nextList);
    chatStreamsRef.current.delete(targetId);
    if (activeStreamChatIdRef.current === targetId) {
      abortAgentPrompt(targetId);
      releaseUiStreamingState(targetId);
    }

    if (deletingSelectedChat) {
      updateMessageQueue(() => []);
      setMessages([]);
      setSelectedChatId(nextSelectedId);
      selectedChatIdRef.current = nextSelectedId;
      onSelectChat?.(nextSelectedId);
    }
  }, [chatList, onSelectChat, releaseUiStreamingState, selectedChatId, updateMessageQueue]);

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
      console.log("[creez:stream-debug] selectedChatId effect: restore stream → isStreaming true", {
        selectedChatId,
        assistantMessageId: stream.assistantMessageId,
      });
      activeAssistantMessageIdRef.current = stream.assistantMessageId;
      streamedTextRef.current = stream.streamedText;
      activeStreamChatIdRef.current = selectedChatId;
      activeStreamBotIdRef.current = stream.botId;
      activeToolCallsRef.current = stream.toolCalls;
      activeToolMessageIdRef.current = stream.toolMessageId;
      setIsStreaming(true);
    } else {
      console.log("[creez:stream-debug] selectedChatId effect: no stream in map → setIsStreaming(false)", {
        selectedChatId,
        mapKeys: Array.from(chatStreamsRef.current.keys()),
      });
      setIsStreaming(false);
    }
  }, [selectedChatId]);

  useEffect(() => {
    if (!selectedChatId || !selectedModelId || chatList.length === 0) return;
    const currentChat = chatList.find((c) => c.id === selectedChatId);
    if (!currentChat?.contactId) return;
    if (currentChat.contactBotOrigin === "remote") return;
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
    /** Main-process events always carry chatId when the session was created with one; if missing, fall back to the selected chat so chatStreamsRef (keyed by real chat UUID) still resolves. Otherwise agent_end is mis-handled and isStreaming never clears (stuck “···”). */
    const streamLookupKey =
      eventChatId != null && String(eventChatId).trim() !== ""
        ? String(eventChatId).trim()
        : currentSelectedChatId != null && String(currentSelectedChatId).trim() !== ""
          ? String(currentSelectedChatId).trim()
          : "";
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
    if (event.type === "sandbox_approval_request" && event.request?.id) {
      if (!isForCurrentChat) return;
      setSandboxApprovals((prev) => {
        if (prev.some((item) => item.id === event.request?.id)) return prev;
        return [...prev, event.request as SandboxApprovalRequest];
      });
      return;
    }
    if (event.type === "agent_end" || event.type === "message_end") {
      console.log("[creez:stream-debug] incoming event (pre-handler)", {
        type: event.type,
        eventChatId: eventChatId ?? null,
        streamLookupKey,
        currentSelectedChatId: currentSelectedChatId ?? null,
        isForCurrentChat,
        mapKeys: Array.from(chatStreamsRef.current.keys()),
        streamEntry: streamLookupKey ? chatStreamsRef.current.get(streamLookupKey) : undefined,
        activeAssistantMessageIdRef: activeAssistantMessageIdRef.current,
        isStreamingRef: isStreamingRef.current,
        activeStreamChatIdRef: activeStreamChatIdRef.current,
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
        const stream = chatStreamsRef.current.get(streamLookupKey);
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
        if (!assistantId) {
          console.warn("[creez:stream-debug] message_update skipped: no activeAssistantMessageIdRef", {
            streamLookupKey,
            hasStream: Boolean(stream),
          });
          return;
        }
        setMessages((prevMessages) =>
          prevMessages.map((msg) => (msg.id === assistantId ? { ...msg, content: fullText } : msg))
        );
        return;
      }
      case "message_end": {
        if (event.message?.role !== "assistant") return;
        const meStream = chatStreamsRef.current.get(streamLookupKey);
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
        {
          const previewChatId = eventChatId ?? (isForCurrentChat ? currentSelectedChatId : null);
          if (previewChatId) {
            const preview = finalText.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
            setChatList((prev) =>
              prev.map((c) =>
                String(c.id) === String(previewChatId) ? { ...c, lastMessage: preview, time: formatNowTime() } : c
              )
            );
          }
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
        const aeStream = chatStreamsRef.current.get(streamLookupKey);

        if (isForCurrentChat && aeStream && activeAssistantMessageIdRef.current &&
            aeStream.assistantMessageId !== activeAssistantMessageIdRef.current) {
          console.warn("[creez:stream-debug] agent_end IGNORED (stale stream id mismatch)", {
            streamLookupKey,
            aeStreamAssistantId: aeStream.assistantMessageId,
            activeAssistantMessageIdRef: activeAssistantMessageIdRef.current,
          });
          console.log("[creez:chat] agent_end IGNORED (stale, stream belongs to previous prompt)");
          releaseUiStreamingState(streamLookupKey);
          return;
        }
        if (isForCurrentChat && !aeStream && activeAssistantMessageIdRef.current && isStreamingRef.current) {
          console.warn("[creez:stream-debug] agent_end IGNORED (no stream entry — isStreaming stuck risk)", {
            streamLookupKey,
            eventChatId: eventChatId ?? null,
            currentSelectedChatId: currentSelectedChatId ?? null,
            activeAssistantMessageIdRef: activeAssistantMessageIdRef.current,
            mapKeys: Array.from(chatStreamsRef.current.keys()),
          });
          console.log("[creez:chat] agent_end IGNORED (stale, no matching stream but new stream is active)");
          releaseUiStreamingState(streamLookupKey);
          return;
        }

        let endContent = isForCurrentChat ? (streamedTextRef.current || "") : (aeStream?.streamedText || "");
        const endAssistantId = isForCurrentChat ? activeAssistantMessageIdRef.current : aeStream?.assistantMessageId;
        const aeTc = isForCurrentChat ? activeToolCallsRef.current : aeStream?.toolCalls;
        console.log("[creez:chat] agent_end", {
          chatId: eventChatId ?? null,
          contentLen: endContent.length,
          toolCallsCount: aeTc?.length ?? 0,
          forCurrentChat: isForCurrentChat,
        });
        console.log("[creez:stream-debug] agent_end APPLIED → clearing streaming state", {
          streamLookupKey,
          endAssistantId: endAssistantId ?? null,
          willSetIsStreamingFalse: isForCurrentChat,
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
        {
          const previewChatId = eventChatId ?? (isForCurrentChat ? currentSelectedChatId : null);
          if (previewChatId) {
            const preview = endContent.slice(0, CHAT_LIST_PREVIEW_LEN).replace(/\n/g, " ").trim() || " ";
            setChatList((prev) =>
              prev.map((c) =>
                String(c.id) === String(previewChatId) ? { ...c, lastMessage: preview, time: formatNowTime() } : c
              )
            );
          }
        }
        chatStreamsRef.current.delete(streamLookupKey);
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
          const nextInQueue = messageQueueRef.current[0];
          if (nextInQueue) {
            updateMessageQueue((prev) => prev.slice(1));
            setTimeout(() => sendQueuedMessageRef.current(nextInQueue), 300);
          }
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
        const dfStream = chatStreamsRef.current.get(streamLookupKey);
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

  const decideSandboxApproval = async (request: SandboxApprovalRequest, allowed: boolean) => {
    setSandboxApprovals((prev) => prev.filter((item) => item.id !== request.id));
    try {
      const res = await window.electron?.sandbox?.decideApproval?.({
        id: request.id,
        allowed,
        reason: allowed ? "Allowed by user" : "Denied by user",
      });
      if (!res?.ok) {
        console.warn("[ChatWindow] sandbox approval failed:", res?.error?.message || res);
      }
    } catch (error) {
      console.warn("[ChatWindow] sandbox approval error:", error);
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

    const initStartMs = Date.now();
    const waitReady = new Promise<boolean>((resolve, reject) => {
      initResolveRef.current = resolve;
      initRejectRef.current = reject;
      window.setTimeout(() => {
        if (!agentReadyRef.current) {
          console.log("[creez:flow] ensureAgentInitialized fail: timeout (no agent_ready)", {
            contactId,
            chatId: selectedChatId,
            elapsedMs: Date.now() - initStartMs,
          });
          reject(new Error("INIT_TIMEOUT"));
        }
      }, 30000);
    });
    initInFlightRef.current = waitReady;
    try {
      const ok = await waitReady;
      if (ok)
        console.log("[creez:flow] ensureAgentInitialized ok", {
          contactId,
          chatId: selectedChatId,
          elapsedMs: Date.now() - initStartMs,
        });
      return ok;
    } catch (error) {
      const errMsg = (error as Error)?.message || String(error);
      console.log("[creez:flow] ensureAgentInitialized fail", {
        contactId,
        chatId: selectedChatId,
        message: errMsg,
        elapsedMs: Date.now() - initStartMs,
      });
      chatLog("agent:init:timeout-or-error", errMsg);
      if (errMsg === "INIT_TIMEOUT") {
        initTimeoutRef.current = true;
      }
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
    const a2aWaitingId = a2aWaitingMsgIdRef.current;
    if (a2aWaitingId && isStreamingRef.current) {
      setMessages((prev) =>
        prev.filter((m) => m.id !== a2aWaitingId).concat({
          id: `${Date.now()}-system-a2a-stop`,
          sender: "system",
          name: "System",
          avatar: "",
          content: "已停止等待远程回复。",
          timestamp: formatNowTime(),
          type: "system",
        })
      );
      a2aWaitingMsgIdRef.current = null;
      activeAssistantMessageIdRef.current = null;
      setIsStreaming(false);
      return;
    }
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
    const nextAfterStop = messageQueueRef.current[0];
    if (nextAfterStop) {
      updateMessageQueue((prev) => prev.slice(1));
      setTimeout(() => sendQueuedMessageRef.current(nextAfterStop), 300);
    }
  };

  const doSendMessage = async (contentWithPaths: string, images: { type: "image"; data: string; mimeType: string }[]) => {
    if (!activeChat?.contactId) return;

    messagesStickToBottomRef.current = true;
    const isRemoteBot = activeChat.contactBotOrigin === "remote";

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

    if (isRemoteBot) {
      void appendChatMessage({
        id: userMessageId,
        chatId: activeChat.id,
        sender: "user",
        content: contentWithPaths,
        status: "done",
        createdAt: nowTs,
        updatedAt: nowTs,
      });

      setIsStreaming(true);
      const waitingId = `${Date.now()}-assistant-waiting`;
      setMessages((prev) => [
        ...prev,
        {
          id: waitingId,
          sender: "other",
          name: activeChat.name || botName,
          avatar: activeChat.avatar || botAvatar,
          content: "",
          timestamp: formatNowTime(),
          type: "text",
        },
      ]);
      a2aWaitingMsgIdRef.current = waitingId;
      activeAssistantMessageIdRef.current = waitingId;

      try {
        const result = await sendToRemoteBot({
          chatId: activeChat.id,
          toAgentId: activeChat.contactId,
          content: contentWithPaths,
        });
        if (!result) {
          setIsStreaming(false);
          a2aWaitingMsgIdRef.current = null;
          activeAssistantMessageIdRef.current = null;
          setMessages((prev) => prev.filter((m) => m.id !== waitingId).concat({
            id: `${Date.now()}-system-a2a-fail`,
            sender: "system",
            name: "System",
            avatar: "",
            content: "无法发送到远程 Bot（A2A 服务未运行或 Bot 离线）。",
            timestamp: formatNowTime(),
            type: "system",
          }));
        }
        chatLog("a2a:sendToRemoteBot", { chatId: activeChat.id, toAgentId: activeChat.contactId });
      } catch (e) {
        setIsStreaming(false);
        a2aWaitingMsgIdRef.current = null;
        activeAssistantMessageIdRef.current = null;
        setMessages((prev) => prev.filter((m) => m.id !== waitingId).concat({
          id: `${Date.now()}-system-a2a-error`,
          sender: "system",
          name: "System",
          avatar: "",
          content: `发送到远程 Bot 失败: ${(e as Error).message || String(e)}`,
          timestamp: formatNowTime(),
          type: "system",
        }));
      }
      return;
    }

    void appendChatMessage({
      id: userMessageId,
      chatId: activeChat.id,
      sender: "user",
      content: contentWithPaths,
      status: "done",
      createdAt: nowTs,
      updatedAt: nowTs,
    });

    initTimeoutRef.current = false;
    const ready = await ensureAgentInitialized();
    if (!ready) {
      const isTimeout = initTimeoutRef.current;
      chatLog("agent:init:failed", isTimeout ? "init timeout" : "model config incomplete");
      setIsStreaming(false);
      const sysId = `${Date.now()}-system-init-error`;
      const content = isTimeout
        ? "Agent 初始化超时，请稍后重试。如果持续出现此问题，请检查网络连接。"
        : "当前未配置可用模型或 API Key。请打开 设置 → Model Config，添加模型并填写 API Key 后保存。";
      const errMsg: ChatMessageItem = {
        id: sysId,
        sender: "system",
        name: "System",
        avatar: "",
        content,
        timestamp: formatNowTime(),
        type: "system",
      };
      setMessages((prev) => [...prev, errMsg]);
      void appendChatMessage({
        id: sysId,
        chatId: activeChat.id,
        sender: "system",
        content,
        status: "error",
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        errorCode: isTimeout ? "INIT_TIMEOUT" : "INIT_INVALID",
        errorMessage: content,
      });
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
    console.log("[creez:stream-debug] doSendMessage: stream map set + prompt", {
      chatId: activeChat.id,
      assistantId,
      mapKeysAfter: Array.from(chatStreamsRef.current.keys()),
      sendAgentPromptChatId: selectedChatId ?? null,
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

  sendQueuedMessageRef.current = (item: QueuedMessage) => {
    void doSendMessage(item.content, item.images);
  };

  const handleSend = async () => {
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

    composerRef.current && (composerRef.current.innerHTML = "");
    setPendingAttachments((prev) => {
      for (const item of prev) revokeAttachment(item);
      return [];
    });
    setComposerVersion((v) => v + 1);
    setShowEmojiPanel(false);

    if (isStreamingRef.current) {
      const displayText = composedContent.slice(0, 80) + (composedContent.length > 80 ? "..." : "");
      console.log("[creez:stream-debug] handleSend: queued (isStreamingRef true)", {
        selectedChatId: selectedChatId ?? null,
        activeAssistantMessageIdRef: activeAssistantMessageIdRef.current,
        queueLenBefore: messageQueueRef.current.length,
      });
      updateMessageQueue((prev) => [...prev, {
        id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        displayText,
        content: contentWithPaths,
        images,
      }]);
      return;
    }

    await doSendMessage(contentWithPaths, images);
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
  return (
    <div className="flex h-full w-full bg-[#F5F5F5]">
      {sandboxApprovals[0] && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-[520px] rounded-lg bg-white shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-[15px] font-semibold text-gray-900">
                {sandboxApprovals[0].title || "Allow sandbox action?"}
              </div>
              <div className="mt-1 text-[12px] text-gray-500">
                {sandboxApprovals[0].message || "The agent is requesting permission for a protected operation."}
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-[88px_1fr] gap-y-2 text-[12px]">
                <div className="text-gray-500">Action</div>
                <div className="text-gray-900">{sandboxApprovals[0].action || sandboxApprovals[0].kind || "unknown"}</div>
                <div className="text-gray-500">Risk</div>
                <div className="text-gray-900">{sandboxApprovals[0].risk || "protected_operation"}</div>
                <div className="text-gray-500">Sandbox</div>
                <div className="text-gray-900">
                  {[sandboxApprovals[0].sandboxMode, sandboxApprovals[0].sandboxBackend].filter(Boolean).join(" / ") || "Creez"}
                </div>
              </div>
              {(sandboxApprovals[0].path || sandboxApprovals[0].command) && (
                <pre className="max-h-[180px] overflow-auto rounded-md bg-gray-50 border border-gray-100 p-3 text-[12px] text-gray-700 whitespace-pre-wrap break-all">
                  {sandboxApprovals[0].path || sandboxApprovals[0].command}
                </pre>
              )}
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-gray-300 bg-white text-[13px] text-gray-700 hover:bg-gray-100"
                onClick={() => void decideSandboxApproval(sandboxApprovals[0], false)}
              >
                拒绝
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-[#07C160] text-[13px] text-white hover:bg-[#06ad56]"
                onClick={() => void decideSandboxApproval(sandboxApprovals[0], true)}
              >
                允许一次
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="w-[250px] flex flex-col border-r border-[#E7E7E7] bg-[#F7F7F7] flex-shrink-0">
        <SearchBar placeholder="搜索" rightElement={<Plus size={16} />} />

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoadingChats && <div className="px-3 py-3 text-xs text-gray-500">Loading chats...</div>}
          {!isLoadingChats &&
            chatList.map((chat) => (
              <div
                key={chat.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setChatContextMenu({ chatId: chat.id, x: e.clientX, y: e.clientY });
                }}
                onClick={() => {
                  setChatContextMenu(null);
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
                  {chat.contactId && chat.contactBotOrigin ? (
                    <BotOriginBadge origin={chat.contactBotOrigin} positionClassName="-top-0.5 -left-0.5" />
                  ) : null}
                  {chat.contactId && a2aPresence.has(chat.contactId) && (
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#F7F7F7]",
                        a2aPresence.get(chat.contactId) ? "bg-[#07C160]" : "bg-red-500"
                      )}
                      title={a2aPresence.get(chat.contactId) ? "A2A 在线" : "A2A 离线"}
                    />
                  )}
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
        {chatContextMenu ? (
          <ChatListContextMenu
            x={chatContextMenu.x}
            y={chatContextMenu.y}
            onClose={() => setChatContextMenu(null)}
            onDelete={() => void handleDeleteChat(chatContextMenu.chatId)}
          />
        ) : null}
      </div>

      <div className="flex-1 flex flex-col bg-[#F5F5F5] min-w-0">
        <div className="h-16 flex items-center gap-2 px-6 border-b border-[#E7E7E7] flex-shrink-0 min-w-0">
          <h2 className="text-[19px] font-medium text-[#1a1a1a] truncate min-w-0 flex-1">{activeChat?.name || "No chat selected"}</h2>
          {activeChat?.contactId && a2aPresence.has(activeChat.contactId) ? (
            a2aPresence.get(activeChat.contactId) ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#07C160]/10 text-[#07C160] text-[10px] font-medium rounded-full flex-shrink-0"
                title="该 bot 在 A2A 网关上当前在线，可被远程调用"
              >
                <span className="w-1.5 h-1.5 bg-[#07C160] rounded-full" />
                A2A 在线
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-medium rounded-full flex-shrink-0 max-w-[42%]"
                title="该 bot 在 A2A 上离线（对方关客户端或断线）。你在本页的对话仍走本机模型，与 A2A 是否在线无关。"
              >
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                A2A 离线
              </span>
            )
          ) : null}
        </div>

        <div
          ref={messagesScrollRef}
          className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar"
          onScroll={onMessagesScroll}
        >
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
                    {isMe ? (
                      <div className="flex items-baseline gap-2 mb-1 flex-wrap justify-end">
                        <ChannelMessageSourceBadge channelType={(msg as ChatMessageItem).channelType} />
                        <span className="text-xs text-gray-400">{msg.timestamp}</span>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                        <span className="text-xs text-gray-500">{msg.name}</span>
                        <ChannelMessageSourceBadge channelType={(msg as ChatMessageItem).channelType} />
                        <span className="text-xs text-gray-400">{msg.timestamp}</span>
                      </div>
                    )}
                    {showContentBubble && (
                      <div
                        className={cn(
                          "p-3 rounded-[4px] shadow-[0_1px_2px_rgba(0,0,0,0.05)] max-w-2xl text-[14px] leading-relaxed select-text",
                          isMe ? "bg-[#95EC69] text-[#1a1a1a]" : "bg-white text-[#1a1a1a]"
                        )}
                      >
                        {isMe
                          ? <UserMessageContent content={showContent} />
                          : <MessageContentMarkdown content={showContent} onNavigateToSettings={onNavigateToSettings} />
                        }
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
          {messageQueue.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-amber-50/80 border border-amber-200/60">
              <div className="text-xs text-amber-600 font-medium mb-2">待发送队列 ({messageQueue.length})</div>
              <div className="space-y-1.5">
                {messageQueue.map((item, idx) => (
                  <div key={item.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-white rounded-md border border-amber-100">
                    <span className="text-[11px] text-amber-500/70 w-4 text-center shrink-0">{idx + 1}</span>
                    <span className="flex-1 text-[13px] text-gray-700 truncate">{item.displayText}</span>
                    <button
                      type="button"
                      className="w-5 h-5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0"
                      onClick={() => updateMessageQueue((prev) => prev.filter((q) => q.id !== item.id))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
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
                          void persistAppState({ lastSelectedModelId: model.id });
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
            onClick={(e) => {
              if (!composerRef.current?.contains(e.target as Node)) {
                focusInputToEnd();
              }
            }}
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
                const files = Array.from(clipboardData.files || []);
                if (files.length > 0) {
                  e.preventDefault();
                  appendFiles(files);
                  return;
                }
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
                  if (e.nativeEvent.isComposing) return;
                  if (e.shiftKey) {
                    return;
                  }
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
              className="w-full flex-1 min-h-[96px] bg-transparent outline-none text-base leading-6 text-gray-800 font-sans whitespace-pre-wrap break-words overflow-y-auto custom-scrollbar"
              data-version={composerVersion}
            />
          </div>

          <div className="h-12 px-6 flex items-center justify-end gap-2 pb-4">
            {isStreaming && (
              <button
                onClick={() => stopStreaming()}
                className="px-5 py-1.5 text-sm rounded-[4px] transition-colors font-medium bg-[#FDECEC] text-[#E53935] hover:bg-[#FAD4D4] flex items-center gap-1.5"
              >
                <Square size={10} fill="currentColor" />
                停止
              </button>
            )}
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[10px] text-gray-400 hidden sm:block">Enter 发送 · Shift+Enter 换行</span>
              <button
                onClick={() => void handleSend()}
                disabled={!canSend}
                className={cn(
                  "px-7 py-1.5 text-sm rounded-[4px] transition-colors font-medium",
                  canSend
                    ? "bg-[#E9E9E9] text-[#07C160] hover:text-[#06ad56] hover:bg-[#D2D2D2]"
                    : "bg-[#F0F0F0] text-gray-400 cursor-not-allowed"
                )}
              >
                发送 (S)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
