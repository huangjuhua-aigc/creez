import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Wifi, WifiOff, Globe, MessageSquare, Bot, Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";
import {
  getA2AStatus,
  discoverAgents,
  openA2ASession,
  type A2AStatus,
  type DiscoverAgentItem,
} from "../services/a2a";

interface A2AHubProps {
  onStartA2AChat?: (sessionId: string, agentName: string) => void;
}

export function A2AHub({ onStartA2AChat }: A2AHubProps) {
  const [status, setStatus] = useState<A2AStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [agents, setAgents] = useState<DiscoverAgentItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [localBotId, setLocalBotId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getA2AStatus().then(setStatus);
    const iv = setInterval(() => {
      getA2AStatus().then(setStatus);
    }, 10_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    async function loadDefaultBot() {
      const api = (window as any).electron?.contact;
      if (!api) return;
      const r = await api.getDefaultBotId();
      if (r?.ok && r.data?.id) setLocalBotId(r.data.id);
    }
    loadDefaultBot();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    setIsSearching(true);
    const result = await discoverAgents({
      q: q.trim() || undefined,
      limit: 30,
    });
    setAgents(result.items);
    setIsSearching(false);
  }, []);

  useEffect(() => {
    doSearch("");
  }, [doSearch]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(value), 350);
  };

  const handleStartChat = async (agent: DiscoverAgentItem) => {
    if (connectingId) return;
    const fromId = localBotId || "local-user";
    setConnectingId(agent.id);
    try {
      const session = await openA2ASession(fromId, agent.id);
      if (session) {
        onStartA2AChat?.(session.sessionId, agent.name);
      }
    } finally {
      setConnectingId(null);
    }
  };

  const connected = status?.connectionState === "connected";
  const selected = agents.find((a) => a.id === selectedId) || null;

  return (
    <div className="flex h-full w-full bg-[#F5F5F5]">
      {/* Left column: status + search + agent list */}
      <div className="w-[280px] flex flex-col border-r border-[#E7E7E7] bg-[#F7F7F7] flex-shrink-0">
        {/* Connection status bar */}
        <div className="h-10 flex items-center px-3 gap-2 border-b border-[#E7E7E7]">
          {connected ? (
            <Wifi size={14} className="text-[#07C160]" />
          ) : (
            <WifiOff size={14} className="text-red-400" />
          )}
          <span className={cn("text-[11px]", connected ? "text-[#07C160]" : "text-red-400")}>
            {connected ? "已连接" : status?.connectionState === "connecting" ? "连接中..." : "未连接"}
          </span>
          {status && (
            <span className="text-[11px] text-gray-400 ml-auto">
              {status.registeredAgents} bot · {status.activeSessions} 会话
            </span>
          )}
        </div>

        {/* Search */}
        <div className="h-14 flex items-center px-3 pt-2">
          <div className="flex-1 bg-[#E2E2E2] flex items-center px-2 py-1.5 rounded-[4px] group focus-within:bg-white focus-within:ring-1 focus-within:ring-[#07C160] transition-all">
            <Search size={14} className="text-gray-500 mr-2" />
            <input
              type="text"
              placeholder="搜索 A2A Agent..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="bg-transparent border-none outline-none text-xs w-full placeholder-gray-500 text-gray-800"
            />
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isSearching && (
            <div className="py-6 flex justify-center">
              <Loader2 size={18} className="animate-spin text-gray-400" />
            </div>
          )}
          {!isSearching && agents.length === 0 && (
            <div className="py-10 text-center text-xs text-gray-400">
              {searchQuery ? "未找到匹配的 Agent" : "暂无公开 Agent"}
            </div>
          )}
          {agents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => setSelectedId(agent.id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-[#F0F0F0]",
                selectedId === agent.id ? "bg-[#C6C6C6]" : "hover:bg-[#E5E5E5]"
              )}
            >
              <div className="w-9 h-9 rounded-[4px] bg-[#07C160] flex items-center justify-center text-white flex-shrink-0">
                <Bot size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-black truncate">{agent.name}</div>
                {agent.description && (
                  <div className="text-[11px] text-gray-400 truncate">{agent.description}</div>
                )}
              </div>
              <div
                className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  agent.online ? "bg-[#07C160]" : "bg-gray-300"
                )}
                title={agent.online ? "在线" : "离线"}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Right: agent detail + start chat */}
      <div className="flex-1 flex flex-col items-center justify-center bg-[#F5F5F5] min-w-0">
        {selected ? (
          <div className="w-[380px] pb-20">
            <div className="flex gap-6 mb-8 pb-8">
              <div className="w-[70px] h-[70px] rounded-[6px] bg-[#07C160] flex items-center justify-center text-white flex-shrink-0">
                <Bot size={30} />
              </div>
              <div className="flex-1 pt-0.5">
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-[18px] font-medium text-black">{selected.name}</h2>
                  <div
                    className={cn(
                      "w-2.5 h-2.5 rounded-full",
                      selected.online ? "bg-[#07C160]" : "bg-gray-300"
                    )}
                  />
                </div>
                <div className="text-[12px] text-gray-500 space-y-1">
                  {selected.description && <p>{selected.description}</p>}
                  <p className="text-[11px] text-gray-400">ID: {selected.id}</p>
                  {selected.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selected.tags.map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 bg-gray-100 text-[10px] text-gray-500 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-center gap-12 border-t border-gray-200 pt-10">
              <button
                onClick={() => void handleStartChat(selected)}
                disabled={!!connectingId || !selected.online}
                className={cn(
                  "flex flex-col items-center gap-2 group",
                  selected.online
                    ? "text-[#576B95] hover:text-[#4a5a80]"
                    : "text-gray-300 cursor-not-allowed"
                )}
              >
                {connectingId === selected.id ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : (
                  <MessageSquare size={24} strokeWidth={1.5} />
                )}
                <span className="text-[13px]">
                  {!selected.online ? "离线" : connectingId === selected.id ? "连接中..." : "发起对话"}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <Globe size={40} strokeWidth={1} />
            <p className="text-sm">选择一个 Agent 开始对话</p>
          </div>
        )}
      </div>
    </div>
  );
}
