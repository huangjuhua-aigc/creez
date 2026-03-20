import { User, UserPlus, MessageSquare, Search, Bot } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchContacts, getOrCreateChatByContactId, type ContactItem } from '../services/contact';

type SearchResult = {
  id: string;
  name: string;
  avatar_url: string | null;
  description: string;
};

interface ContactsWindowProps {
  onStartChat?: (contactId: number | string) => void;
}

const BOT_CONTACT_ID = '11111111-1111-1111-1111-111111111111';

export function ContactsWindow({ onStartChat }: ContactsWindowProps) {
  const [selectedId, setSelectedId] = useState<string>(BOT_CONTACT_ID);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [selectedBotDeleted, setSelectedBotDeleted] = useState(false);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const loadContacts = useCallback(async () => {
    const items = await fetchContacts("bot");
    setContacts(items);
    return items;
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
    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleAddAgent = async (agent: SearchResult) => {
    const api = window.electron?.contact;
    if (!api) return;
    const result = await api.addRemoteAgent({
      agentId: agent.id,
      name: agent.name,
      avatarUrl: agent.avatar_url,
    });
    if (result.ok) {
      setShowSearchDropdown(false);
      setSearchQuery('');
      setSearchResults([]);
      await loadContacts();
      setSelectedId(agent.id);
    }
  };

  const selectedContact = contacts.find((c) => c.id === selectedId) || null;

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
      onStartChat?.(chatId);
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
          <div className="px-3 py-1 text-[11px] text-gray-400 mt-2">Contacts</div>
          {contacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => setSelectedId(contact.id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 cursor-pointer",
                selectedId === contact.id ? "bg-[#C6C6C6]" : "hover:bg-[#D9D9D9]"
              )}
            >
              <img src={contact.avatar} alt="" className="w-9 h-9 rounded-[4px] object-cover" />
              <span className="text-[13px] text-black truncate">{contact.name}</span>
            </div>
          ))}
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
                </div>
                <div className="text-[12px] text-gray-500 space-y-1">
                  <p>ID: {selectedContact.id}</p>
                  <p>Type: {selectedContact.type}</p>
                </div>
              </div>
            </div>

            {selectedBotDeleted ? (
              <div className="border-t border-gray-200 pt-8">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  This bot has been deleted by the author.
                </div>
              </div>
            ) : (
              <div className="flex justify-center gap-12 border-t border-gray-200 pt-10">
                <button
                  onClick={() => void handleStartChat()}
                  disabled={isStartingChat}
                  className="flex flex-col items-center gap-2 text-[#576B95] hover:text-[#4a5a80] group"
                >
                  <MessageSquare size={24} strokeWidth={1.5} />
                  <span className="text-[13px]">发消息</span>
                </button>
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
