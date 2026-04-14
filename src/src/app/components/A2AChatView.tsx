import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Send, X, Loader2, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../utils/cn";
import {
  sendA2AMessage,
  fetchA2AMessages,
  closeA2ASession,
  onA2ASessionEvent,
  type A2AMessageItem,
  type A2ASessionEvent,
} from "../services/a2a";

type ChatMessage = {
  id: string;
  sender: "me" | "other";
  content: string;
  timestamp: string;
};

interface A2AChatViewProps {
  sessionId: string;
  agentName: string;
  localAgentId?: string;
  onBack?: () => void;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function apiMessageToChat(msg: A2AMessageItem, localAgentId?: string): ChatMessage {
  return {
    id: msg.id || `${msg.seq}`,
    sender: msg.sender_id === localAgentId ? "me" : "other",
    content: msg.content,
    timestamp: formatTime(msg.created_at),
  };
}

export function A2AChatView({ sessionId, agentName, localAgentId, onBack }: A2AChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [closing, setClosing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);

  const scrollToBottomIfStuck = useCallback(() => {
    if (!stickToBottomRef.current) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const onMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = gap < 64;
  }, []);

  useEffect(() => {
    let cancelled = false;
    stickToBottomRef.current = true;
    async function load() {
      const items = await fetchA2AMessages(sessionId);
      if (cancelled) return;
      setMessages(items.map((m) => apiMessageToChat(m, localAgentId)));
    }
    load();
    return () => { cancelled = true; };
  }, [sessionId, localAgentId]);

  useEffect(() => {
    const unsub = onA2ASessionEvent((event: A2ASessionEvent) => {
      if (event.sessionId !== sessionId) return;

      if (event.type === "message_in") {
        setMessages((prev) => {
          const exists = prev.some(
            (m) => m.content === event.content && m.sender === "other" && m.timestamp === nowTime()
          );
          if (exists) return prev;
          return [
            ...prev,
            {
              id: `in-${Date.now()}`,
              sender: "other",
              content: event.content || "",
              timestamp: nowTime(),
            },
          ];
        });
      } else if (event.type === "message_out" && event.senderId !== localAgentId) {
        setMessages((prev) => [
          ...prev,
          {
            id: `out-${Date.now()}`,
            sender: "other",
            content: event.content || "",
            timestamp: nowTime(),
          },
        ]);
      } else if (event.type === "session_closed") {
        setSessionClosed(true);
      }
    });
    return unsub;
  }, [sessionId, localAgentId]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending || sessionClosed) return;

    const userMsg: ChatMessage = {
      id: `me-${Date.now()}`,
      sender: "me",
      content: text,
      timestamp: nowTime(),
    };
    stickToBottomRef.current = true;
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");

    setSending(true);
    try {
      await sendA2AMessage(sessionId, text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await closeA2ASession(sessionId, "user_closed");
      setSessionClosed(true);
    } finally {
      setClosing(false);
    }
  };

  useLayoutEffect(() => {
    scrollToBottomIfStuck();
  }, [messages, scrollToBottomIfStuck]);

  return (
    <div className="flex flex-col h-full bg-[#F5F5F5]">
      {/* Header */}
      <div className="h-14 flex items-center gap-3 px-4 bg-[#EDEDED] border-b border-[#DCDCDC] flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded hover:bg-[#D6D6D6] transition-colors"
        >
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <div className="w-8 h-8 rounded-[4px] bg-[#07C160] flex items-center justify-center text-white flex-shrink-0">
          <Bot size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium text-black truncate">{agentName}</div>
          <div className="text-[11px] text-gray-400">
            {sessionClosed ? "会话已结束" : "A2A 会话中"}
          </div>
        </div>
        {!sessionClosed && (
          <button
            onClick={() => void handleClose()}
            disabled={closing}
            className="p-1.5 rounded hover:bg-[#D6D6D6] transition-colors text-gray-400 hover:text-red-500"
            title="结束会话"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
        onScroll={onMessagesScroll}
      >
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            发送消息开始对话
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender === "me";
          return (
            <div key={msg.id} className={cn("flex gap-3", isMe ? "flex-row-reverse" : "flex-row")}>
              <div className="flex-shrink-0">
                {isMe ? (
                  <div className="w-9 h-9 rounded-[4px] bg-gray-800 flex items-center justify-center text-white text-xs font-medium">
                    Me
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-[4px] bg-[#07C160] flex items-center justify-center text-white">
                    <Bot size={14} />
                  </div>
                )}
              </div>
              <div className={cn("flex flex-col max-w-2xl", isMe ? "items-end" : "items-start")}>
                <div className="text-[11px] text-gray-400 mb-1">{msg.timestamp}</div>
                <div
                  className={cn(
                    "p-3 rounded-[4px] shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-[14px] leading-relaxed select-text",
                    isMe ? "bg-[#95EC69] text-[#1a1a1a]" : "bg-white text-[#1a1a1a]"
                  )}
                >
                  {isMe ? (
                    <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="flex justify-center">
            <Loader2 size={16} className="animate-spin text-gray-400" />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 bg-[#F5F5F5] border-t border-[#DCDCDC] p-3">
        {sessionClosed ? (
          <div className="text-center text-sm text-gray-400 py-3">会话已结束</div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 flex items-end gap-2 p-2">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              rows={1}
              className="flex-1 resize-none outline-none text-[14px] text-gray-800 placeholder-gray-400 max-h-32 min-h-[36px] py-1 px-2"
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 128) + "px";
              }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!inputText.trim() || sending}
              className={cn(
                "p-2 rounded-md transition-colors flex-shrink-0",
                inputText.trim()
                  ? "bg-[#07C160] text-white hover:bg-[#06ad56]"
                  : "bg-gray-100 text-gray-300"
              )}
            >
              <Send size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
