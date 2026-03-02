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
    const avatar = item.avatarPath ? await readLocalImageDataUrl(item.avatarPath) : null;
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
