import { User, UserPlus, MessageSquare } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useEffect, useState } from 'react';
import { SearchBar } from './ui/SearchBar';
import { fetchContacts, type ContactItem } from '../services/contact';

interface ContactsWindowProps {
  onStartChat?: (contactId: number | string) => void;
}

const BOT_CONTACT_ID = '11111111-1111-1111-1111-111111111111';
const BOT_CHAT_ID = '1f2e3d4c-5b6a-47d8-9c01-23456789abcd';

export function ContactsWindow({ onStartChat }: ContactsWindowProps) {
  const [selectedId, setSelectedId] = useState<string>(BOT_CONTACT_ID);
  const [contacts, setContacts] = useState<ContactItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function hydrateContacts() {
      const items = await fetchContacts("bot");
      if (cancelled) return;
      setContacts(items);
      if (items.length > 0 && !items.some((item) => item.id === selectedId)) {
        setSelectedId(items[0].id);
      }
    }
    hydrateContacts();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedContact = contacts.find((c) => c.id === selectedId) || null;

  return (
    <div className="flex h-full w-full bg-[#F5F5F5]">
      <div className="w-[250px] flex flex-col border-r border-[#E7E7E7] bg-[#F7F7F7] flex-shrink-0">
        <SearchBar placeholder="搜索" rightElement={<UserPlus size={16} />} />

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

            <div className="flex justify-center gap-12 border-t border-gray-200 pt-10">
              <button
                onClick={() => onStartChat && onStartChat(selectedContact.type === "bot" ? BOT_CHAT_ID : selectedContact.id)}
                className="flex flex-col items-center gap-2 text-[#576B95] hover:text-[#4a5a80] group"
              >
                <MessageSquare size={24} strokeWidth={1.5} />
                <span className="text-[13px]">发消息</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">Select a contact</div>
        )}
      </div>
    </div>
  );
}
