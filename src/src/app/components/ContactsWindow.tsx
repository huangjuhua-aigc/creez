import { User, UserPlus, MessageSquare, Search, Bot, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchContacts, getOrCreateChatByContactId, type ContactItem } from '../services/contact';
import { BotOriginBadge } from './BotOriginBadge';
import { discoverAgents } from '../services/a2a';
import { toast } from 'sonner';

type SearchResult = {
  id: string;
  name: string;
  avatar_url: string | null;
  description: string;
};

type SuggestedBot = {
  id: string;
  name: string;
  avatar_url: string | null;
  description: string;
};

interface ContactsWindowProps {
  onStartChat?: (chatId: string, meta?: { name?: string; avatar?: string }) => void;
}

const BOT_CONTACT_ID = '11111111-1111-1111-1111-111111111111';

const CONTACT_SECTION_HEADER = "px-3 py-1 text-[11px] text-gray-400 mb-1";

function partitionBotContacts(items: ContactItem[]) {
  const defaultAssistant: ContactItem[] = [];
  const myBots: ContactItem[] = [];
  const othersBots: ContactItem[] = [];
  for (const c of items) {
    if (c.type !== "bot") continue;
    if (c.isDefault || c.botOrigin === "assistant") {
      defaultAssistant.push(c);
    } else if (c.botOrigin === "remote") {
      othersBots.push(c);
    } else {
      // author, template, or legacy empty origin — treat as yours
      myBots.push(c);
    }
  }
  return { defaultAssistant, myBots, othersBots };
}

export function ContactsWindow({ onStartChat }: ContactsWindowProps) {
  const [selectedId, setSelectedId] = useState<string>(BOT_CONTACT_ID);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [selectedBotDeleted, setSelectedBotDeleted] = useState(false);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [suggestedBots, setSuggestedBots] = useState<SuggestedBot[]>([]);
  const [addingSuggestId, setAddingSuggestId] = useState<string | null>(null);
  /** agentId → online (from A2A discover); only bots that appear in discover (public + active) have an entry */
  const [a2aPresence, setA2aPresence] = useState<Map<string, boolean>>(new Map());
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const loadContacts = useCallback(async () => {
    const items = await fetchContacts("bot");
    setContacts(items);
    return items;
  }, []);

  const loadOnlineStatus = useCallback(async () => {
    try {
      const result = await discoverAgents({ limit: 200 });
      const next = new Map<string, boolean>();
      for (const agent of result.items) {
        if (agent.id) next.set(agent.id, !!agent.online);
      }
      setA2aPresence(next);
    } catch {}
  }, []);

  const loadSuggestedBots = useCallback(async () => {
    const api = window.electron?.agentBuilder;
    if (!api?.recent) return;
    const result = await api.recent();
    if (result.ok) setSuggestedBots(result.data.items);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function hydrateContacts() {
      const items = await loadContacts();
      if (cancelled) return;
      if (items.length > 0 && !items.some((item) => item.id === selectedId)) {
        setSelectedId(items[0].id);
      }
    }
    hydrateContacts();
    loadSuggestedBots();
    loadOnlineStatus();
    const iv = setInterval(loadOnlineStatus, 30_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    const api = window.electron?.contact;
    if (!api?.onListChanged) return;
    return api.onListChanged(() => {
      void loadContacts();
      void loadSuggestedBots();
      void loadOnlineStatus();
    });
  }, [loadContacts, loadSuggestedBots, loadOnlineStatus]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      const api = window.electron?.agentBuilder;
      if (!api) return;
      setIsSearching(true);
      const result = await api.search({ q: value.trim() });
      setIsSearching(false);
      if (result.ok) {
        setSearchResults(result.data.items);
        setShowSearchDropdown(true);
      }
    }, 300);
  };

  const handleAddAgent = async (agent: SearchResult | SuggestedBot) => {
    const api = window.electron?.contact;
    if (!api) return;
    const result = await api.addRemoteAgent({
      agentId: agent.id,
      name: agent.name,
      avatarUrl: agent.avatar_url,
    });
    if (result.ok) {
      if (result.data.alreadyExists) {
        toast.info("This agent is already in your contacts.");
      }
      setShowSearchDropdown(false);
      setSearchQuery('');
      setSearchResults([]);
      await loadContacts();
      setSelectedId(agent.id);
    }
  };

  const handleDeleteContact = async () => {
    if (!selectedContact || selectedContact.isDefault) return;
    const api = window.electron?.contact;
    if (!api?.delete) return;
    const result = await api.delete({ contactId: selectedContact.id });
    if (result.ok) {
      const items = await loadContacts();
      await loadSuggestedBots();
      setSelectedId(items.length > 0 ? items[0].id : BOT_CONTACT_ID);
    } else {
      toast.error(result.error?.message || "Failed to delete contact.");
    }
  };

  const handleAddSuggestedBot = async (bot: SuggestedBot) => {
    if (addingSuggestId) return;
    setAddingSuggestId(bot.id);
    try {
      await handleAddAgent(bot);
    } finally {
      setAddingSuggestId(null);
    }
  };

  const selectedContact = contacts.find((c) => c.id === selectedId) || null;

  const botContactSections = useMemo(() => partitionBotContacts(contacts), [contacts]);

  useEffect(() => {
    let cancelled = false;
    async function validateSelectedBot() {
      if (!selectedContact || selectedContact.type !== "bot" || selectedContact.isDefault) {
        if (!cancelled) setSelectedBotDeleted(false);
        return;
      }
      const api = window.electron?.agentBuilder;
      if (!api || typeof api.get !== "function") {
        if (!cancelled) setSelectedBotDeleted(false);
        return;
      }
      const result = await api.get({ id: selectedContact.id });
      if (cancelled) return;
      if (!result.ok && /not found|not owned/i.test(String(result.error?.message || ""))) {
        setSelectedBotDeleted(true);
        return;
      }
      setSelectedBotDeleted(false);
    }
    validateSelectedBot();
    return () => {
      cancelled = true;
    };
  }, [selectedContact]);

  const handleStartChat = async () => {
    if (!selectedContact || selectedBotDeleted || isStartingChat) return;
    setIsStartingChat(true);
    try {
      const chatId = await getOrCreateChatByContactId(selectedContact.id);
      if (!chatId) return;
      onStartChat?.(chatId, { name: selectedContact.name, avatar: selectedContact.avatar });
    } finally {
      setIsStartingChat(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-[#F5F5F5]">
      <div className="w-[250px] flex flex-col border-r border-[#E7E7E7] bg-[#F7F7F7] flex-shrink-0">
        {/* Search with dropdown */}
        <div ref={searchContainerRef} className="relative">
          <div className="h-16 flex items-center px-3 gap-2 bg-[#F7F7F7] pt-4 pb-2">
            <div className="flex-1 bg-[#E2E2E2] flex items-center px-2 py-1 rounded-[4px] group focus-within:bg-white focus-within:ring-1 focus-within:ring-[#07C160] transition-all">
              <Search size={14} className="text-gray-500 mr-2 group-focus-within:text-gray-700" />
              <input
                type="text"
                placeholder="搜索 Agent..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowSearchDropdown(true)}
                className="bg-transparent border-none outline-none text-xs w-full placeholder-gray-500 text-gray-800"
              />
            </div>
          </div>

          {showSearchDropdown && (
            <div className="absolute left-3 right-3 top-[56px] z-50 bg-white border border-gray-200 rounded-lg shadow-lg max-h-[280px] overflow-y-auto">
              {isSearching && (
                <div className="p-3 text-center text-xs text-gray-400">搜索中...</div>
              )}
              {!isSearching && searchResults.length === 0 && (
                <div className="p-3 text-center text-xs text-gray-400">未找到 Agent</div>
              )}
              {searchResults.map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => handleAddAgent(agent)}
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#F5F5F5] border-b border-gray-50 last:border-0"
                >
                  <div className="w-8 h-8 rounded-full bg-[#07C160] flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                    <Bot size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-gray-800 truncate">{agent.name}</div>
                    {agent.description && (
                      <div className="text-[11px] text-gray-400 truncate">{agent.description}</div>
                    )}
                  </div>
                  <span className="text-[11px] text-[#07C160] flex-shrink-0">添加</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {(
            [
              { key: "default", title: "Default assistant", items: botContactSections.defaultAssistant },
              { key: "mine", title: "My bots", items: botContactSections.myBots },
              { key: "others", title: "Others' bots", items: botContactSections.othersBots },
            ] as const
          )
            .filter((s) => s.items.length > 0)
            .map(({ key, title, items }, sectionIndex) => (
              <Fragment key={key}>
                <div
                  className={cn(
                    CONTACT_SECTION_HEADER,
                    sectionIndex === 0 ? "mt-2" : "mt-4"
                  )}
                >
                  {title}
                </div>
                {items.map((contact) => {
                  const inDiscover = a2aPresence.has(contact.id);
                  const isOnline = a2aPresence.get(contact.id) === true;
                  return (
                    <div
                      key={contact.id}
                      onClick={() => setSelectedId(contact.id)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 cursor-pointer",
                        selectedId === contact.id ? "bg-[#C6C6C6]" : "hover:bg-[#D9D9D9]"
                      )}
                    >
                      <div className="relative flex-shrink-0">
                        <img src={contact.avatar} alt="" className="w-9 h-9 rounded-[4px] object-cover" />
                        {contact.type === "bot" && contact.botOrigin ? (
                          <BotOriginBadge origin={contact.botOrigin} positionClassName="-top-0.5 -right-0.5" />
                        ) : null}
                        {inDiscover && (
                          <span
                            className={cn(
                              "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#F7F7F7]",
                              isOnline ? "bg-[#07C160]" : "bg-red-500"
                            )}
                            title={isOnline ? "Online (A2A)" : "Offline (A2A)"}
                          />
                        )}
                      </div>
                      <span className="text-[13px] text-black truncate">{contact.name}</span>
                    </div>
                  );
                })}
              </Fragment>
            ))}

          {suggestedBots.length > 0 && (() => {
            const contactIds = new Set(contacts.map((c) => c.id));
            const filtered = suggestedBots.filter((b) => !contactIds.has(b.id));
            if (filtered.length === 0) return null;
            return (
              <>
                <div className="px-3 py-1 text-[11px] text-gray-400 mt-4 mb-1">Suggested Bots</div>
                {filtered.map((bot) => (
                  <div
                    key={bot.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-[#D9D9D9] group"
                  >
                    {bot.avatar_url ? (
                      <img src={bot.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#07C160] flex items-center justify-center text-white flex-shrink-0">
                        <Bot size={14} />
                      </div>
                    )}
                    <span className="flex-1 text-[13px] text-black truncate">{bot.name}</span>
                    <button
                      onClick={() => void handleAddSuggestedBot(bot)}
                      disabled={addingSuggestId === bot.id}
                      className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-[#07C160] hover:bg-white transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center bg-[#F5F5F5] min-w-0">
        {selectedContact ? (
          <div className="w-[380px] pb-20">
            <div className="flex gap-6 mb-10 pb-8 relative">
              <img
                src={selectedContact.avatar}
                alt={selectedContact.name}
                className="w-[70px] h-[70px] rounded-[6px] object-cover bg-white"
              />
              <div className="flex-1 pt-0.5">
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-[18px] font-medium text-black">{selectedContact.name}</h2>
                  <User size={14} className="text-blue-500 fill-blue-500" />
                  {a2aPresence.has(selectedContact.id) && (
                    a2aPresence.get(selectedContact.id) ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#07C160]/10 text-[#07C160] text-[10px] font-medium rounded-full">
                        <span className="w-1.5 h-1.5 bg-[#07C160] rounded-full" />
                        Online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-50 text-red-600 text-[10px] font-medium rounded-full">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                        Offline
                      </span>
                    )
                  )}
                </div>
                <div className="text-[12px] text-gray-500 space-y-1">
                  <p>ID: {selectedContact.id}</p>
                  <p>Type: {selectedContact.type}</p>
                </div>
              </div>
            </div>

            {selectedBotDeleted ? (
              <div className="border-t border-gray-200 pt-8 space-y-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  This bot has been deleted by the author.
                </div>
                {!selectedContact.isDefault && (
                  <div className="flex justify-center">
                    <button
                      onClick={() => void handleDeleteContact()}
                      className="flex flex-col items-center gap-2 text-gray-400 hover:text-red-500 group"
                    >
                      <Trash2 size={20} strokeWidth={1.5} />
                      <span className="text-[13px]">Delete contact</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex justify-center gap-12 border-t border-gray-200 pt-10">
                <button
                  onClick={() => void handleStartChat()}
                  disabled={isStartingChat}
                  className="flex flex-col items-center gap-2 text-[#576B95] hover:text-[#4a5a80] group"
                >
                  <MessageSquare size={24} strokeWidth={1.5} />
                  <span className="text-[13px]">Send message</span>
                </button>
                {!selectedContact.isDefault && (
                  <button
                    onClick={() => void handleDeleteContact()}
                    className="flex flex-col items-center gap-2 text-gray-400 hover:text-red-500 group"
                  >
                    <Trash2 size={20} strokeWidth={1.5} />
                    <span className="text-[13px]">Delete contact</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-gray-400 text-sm">Select a contact</div>
        )}
      </div>
    </div>
  );
}
