/**
 * IPC wrapper for A2A operations.
 * All calls go through window.electron.a2a (exposed via preload).
 */

export type A2AStatus = {
  running: boolean;
  connectionState: "disconnected" | "connecting" | "connected";
  registeredAgents: number;
  activeSessions: number;
};

export type DiscoverAgentItem = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  online: boolean;
  owner_id?: string;
  agent_card_json?: Record<string, unknown>;
};

export type A2ASession = {
  sessionId: string;
  state: string;
};

export type A2AMessageResult = {
  messageId: string;
  seq: number;
};

export async function getA2AStatus(): Promise<A2AStatus | null> {
  const api = (window as any).electron?.a2a;
  if (!api) return null;
  const r = await api.getStatus();
  return r?.ok ? r.data : null;
}

export async function discoverAgents(query: {
  tags?: string[];
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: DiscoverAgentItem[]; total: number }> {
  const api = (window as any).electron?.a2a;
  if (!api) return { items: [], total: 0 };
  const r = await api.discover(query);
  if (!r?.ok) return { items: [], total: 0 };
  const raw = r.data;
  const items = (raw?.items || []).map((item: any) => ({
    id: item.agentId || item.id,
    name: item.name || "",
    description: item.description || "",
    tags: item.tags || [],
    online: !!item.online,
    owner_id: item.ownerId || item.owner_id,
  }));
  return { items, total: raw?.total || items.length };
}

export async function openA2ASession(
  fromAgentId: string,
  toAgentId: string
): Promise<A2ASession | null> {
  const api = (window as any).electron?.a2a;
  if (!api) return null;
  const r = await api.openSession({ fromAgentId, toAgentId });
  return r?.ok ? r.data : null;
}

export async function sendA2AMessage(
  sessionId: string,
  content: string
): Promise<A2AMessageResult | null> {
  const api = (window as any).electron?.a2a;
  if (!api) return null;
  const r = await api.sendMessage({ sessionId, content });
  return r?.ok ? r.data : null;
}

export async function closeA2ASession(
  sessionId: string,
  reason?: string
): Promise<boolean> {
  const api = (window as any).electron?.a2a;
  if (!api) return false;
  const r = await api.closeSession({ sessionId, reason });
  return r?.ok ?? false;
}

export type A2AMessageItem = {
  id: string;
  session_id: string;
  sender_id: string;
  content: string;
  seq: number;
  created_at: string;
};

export async function fetchA2AMessages(
  sessionId: string,
  afterSeq?: number
): Promise<A2AMessageItem[]> {
  const api = (window as any).electron?.a2a;
  if (!api) return [];
  const r = await api.fetchMessages({ sessionId, afterSeq });
  if (!r?.ok) return [];
  return r.data?.items || r.data || [];
}

export type A2ASessionEvent = {
  type: "session_opened" | "message_in" | "message_out" | "session_closed";
  sessionId: string;
  senderId?: string;
  content?: string;
  fromAgentId?: string;
  toAgentId?: string;
  reason?: string;
};

export function onA2ASessionEvent(
  listener: (event: A2ASessionEvent) => void
): () => void {
  const api = (window as any).electron?.a2a;
  if (!api?.onSessionEvent) return () => {};
  return api.onSessionEvent(listener);
}

/**
 * Send a message to a remote bot via A2A Gateway.
 * Opens a session automatically if one doesn't exist for this chatId.
 */
export async function sendToRemoteBot(params: {
  chatId: string;
  toAgentId: string;
  content: string;
}): Promise<{ sessionId: string; messageId: string; seq: number } | null> {
  const api = (window as any).electron?.a2a;
  if (!api?.sendToRemoteBot) return null;
  const r = await api.sendToRemoteBot(params);
  return r?.ok ? r.data : null;
}

/**
 * Tell the A2A daemon to re-scan local bots and update Gateway registration.
 * Call after creating/publishing a bot so it goes online without restart.
 */
export async function refreshA2ARegistration(): Promise<boolean> {
  const api = (window as any).electron?.a2a;
  if (!api?.refreshRegistration) return false;
  const r = await api.refreshRegistration();
  return r?.ok ?? false;
}

/** Run one auto-discovery tick for a local bot (Agent Builder manual trigger). */
export async function triggerAutoDiscoveryNow(
  agentId: string
): Promise<{ ok: boolean; error?: string }> {
  const api = (window as any).electron?.a2a;
  if (!api?.triggerAutoDiscovery) {
    return { ok: false, error: "A2A trigger not available (update app or enable preload)" };
  }
  const r = await api.triggerAutoDiscovery({ agentId });
  if (r?.ok) return { ok: true };
  return { ok: false, error: r?.error?.message || "Manual discovery failed" };
}
