export type AppState = {
  lastTab: string;
  lastChatId: string | null;
  workspaceRoot: string | null;
  isLoggedIn: boolean;
};

type IpcOk<T> = { ok: true; data: T };
type IpcErr = { ok: false; error: { code: string; message: string; details?: unknown } };
type IpcResult<T> = IpcOk<T> | IpcErr;

const FALLBACK_STATE: AppState = {
  lastTab: "contacts",
  lastChatId: null,
  workspaceRoot: null,
  isLoggedIn: false,
};

function getElectronApi() {
  return window.electron?.app;
}

export async function loadAppState(): Promise<AppState> {
  const api = getElectronApi();
  if (!api) return FALLBACK_STATE;

  const result = (await api.getState()) as IpcResult<AppState>;
  if (!result?.ok) return FALLBACK_STATE;
  return {
    ...FALLBACK_STATE,
    ...result.data,
  };
}

export async function persistAppState(patch: Partial<AppState>): Promise<void> {
  const api = getElectronApi();
  if (!api) return;

  const result = (await api.setState(patch)) as IpcResult<{ updated: boolean; state: AppState }>;
  if (!result?.ok) {
    // Keep renderer resilient in dev/web mode; persistence failure should not break UI usage.
    console.warn("[creezv2] Failed to persist app state:", result?.error?.message || "unknown");
  }
}
