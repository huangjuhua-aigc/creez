export type AssistantModel = {
  id: string;
  provider: string;
  model: string;
  apiBase?: string;
  apiKey?: string;
  apiKeyMasked?: string;
  active?: boolean;
};

export type AssistantConfig = {
  name: string;
  avatar: string | null;
  systemPrompt: string;
  skills: Record<string, boolean>;
  models: AssistantModel[];
};

type ConfigScope = {
  contactId?: string | null;
  assistantConfigId?: number | null;
};

const DEFAULT_CONFIG: AssistantConfig = {
  name: "Assistant",
  avatar: null,
  systemPrompt: "You are a helpful, professional AI assistant.",
  skills: {
    webSearch: true,
    codeRunner: true,
    imageGeneration: false,
    fileAnalysis: true,
  },
  models: [],
};

export async function fetchAssistantConfig(scope: ConfigScope = {}): Promise<AssistantConfig> {
  const api = window.electron?.settings;
  if (!api) return DEFAULT_CONFIG;
  const result = await api.getAssistantConfig(scope);
  if (!result.ok) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...result.data,
    skills: { ...DEFAULT_CONFIG.skills, ...(result.data.skills || {}) },
    models: Array.isArray(result.data.models) ? result.data.models : [],
  };
}

export async function persistAssistantConfig(config: Partial<AssistantConfig>, scope: ConfigScope = {}): Promise<boolean> {
  const api = window.electron?.settings;
  if (!api) return false;
  const result = await api.saveAssistantConfig({ ...scope, ...config });
  return Boolean(result.ok);
}

export async function fetchModelApiKey(modelId: string, scope: ConfigScope = {}): Promise<string> {
  const api = window.electron?.settings;
  if (!api || typeof api.getModelApiKey !== "function") return "";
  const result = await api.getModelApiKey({ modelId, ...scope });
  if (!result.ok) return "";
  return result.data.apiKey || "";
}

export async function uploadAssistantAvatar(dataUrl: string, fileName?: string, scope: ConfigScope = {}): Promise<string | null> {
  const api = window.electron?.settings;
  if (!api) return null;
  const result = await api.uploadAvatar({ dataUrl, fileName, ...scope });
  if (!result.ok) return null;
  return result.data.avatarPath;
}

export async function selectWorkplaceDirectory(): Promise<string | null> {
  const api = window.electron?.settings;
  if (!api) return null;
  const result = await api.selectWorkplaceDirectory();
  if (!result.ok) return null;
  return result.data.path || null;
}

export async function listAvailableSkills(): Promise<Array<{ id: string; name: string; description: string; enabled: boolean }>> {
  const api = window.electron?.settings;
  if (!api) return [];
  const result = await api.listAvailableSkills();
  if (!result.ok) return [];
  return result.data.items || [];
}

export async function getSkillEnv(skillId: string): Promise<Record<string, string>> {
  const api = window.electron?.settings;
  if (!api || typeof api.getSkillEnv !== "function") return {};
  const result = await api.getSkillEnv({ skillId });
  if (!result.ok) return {};
  return result.data?.env ?? {};
}

export async function saveSkillEnv(skillId: string, env: Record<string, string>): Promise<boolean> {
  const api = window.electron?.settings;
  if (!api || typeof api.saveSkillEnv !== "function") return false;
  const result = await api.saveSkillEnv({ skillId, env });
  return Boolean(result?.ok);
}

export async function readLocalImageDataUrl(path: string): Promise<string | null> {
  const api = window.electron?.settings;
  if (!path) return null;
  const toFileUrl = (p: string) => {
    const normalized = p.replace(/\\/g, "/");
    return encodeURI(normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`);
  };
  // Prefer IPC data URL because it is renderer-safe across dev/prod origin differences.
  if (api && typeof api.readImageDataUrl === "function") {
    try {
      const result = await api.readImageDataUrl({ path });
      if (result.ok && result.data?.dataUrl) return result.data.dataUrl;
    } catch {
      // Fallback below
    }
  }
  // Fallback for stale process/hot-reload mismatch.
  return toFileUrl(path);
}

export async function readMemory(path?: string): Promise<{ content: string; path: string }> {
  const api = window.electron?.memory;
  if (!api) return { content: "", path: "" };
  const result = await api.read({ path });
  if (!result.ok) return { content: "", path: "" };
  return result.data;
}

export async function writeMemory(content: string, path?: string): Promise<boolean> {
  const api = window.electron?.memory;
  if (!api) return false;
  const result = await api.write({ content, path });
  return Boolean(result.ok);
}
