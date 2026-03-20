import { readLocalImageDataUrl } from "./settings";

export type ContactItem = {
  id: string;
  type: "bot" | "human" | "group";
  name: string;
  avatar: string;
  isDefault: boolean;
};

function avatarFallback(name: string) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "Contact")}&background=07C160&color=fff`;
}

export async function fetchContacts(type?: "bot" | "human" | "group"): Promise<ContactItem[]> {
  const api = window.electron?.contact;
  if (!api) return [];
  const result = await api.list(type ? { type } : {});
  if (!result.ok) return [];

  const mapped = await Promise.all(result.data.items.map(async (item) => {
    let avatar: string | null = null;
    if (item.avatarPath) {
      if (item.avatarPath.startsWith("data:") || item.avatarPath.startsWith("http://") || item.avatarPath.startsWith("https://")) {
        avatar = item.avatarPath;
      } else {
        avatar = await readLocalImageDataUrl(item.avatarPath);
      }
    }
    return {
      id: item.id,
      type: item.type,
      name: item.name,
      avatar: avatar || avatarFallback(item.name),
      isDefault: Boolean(item.isDefault),
    };
  }));
  return mapped;
}

export async function getOrCreateChatByContactId(contactId: string): Promise<string | null> {
  const api = window.electron?.chat;
  const id = String(contactId || "").trim();
  if (!api || typeof api.getOrCreateByContact !== "function" || !id) return null;
  const result = await api.getOrCreateByContact({ contactId: id });
  if (!result.ok || !result.data?.chatId) return null;
  return String(result.data.chatId);
}
