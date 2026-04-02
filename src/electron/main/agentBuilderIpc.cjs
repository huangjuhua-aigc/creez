const { BrowserWindow } = require("electron");
const { CHANNELS } = require("./channels.cjs");
const { randomUUID } = require("node:crypto");

function broadcastContactListChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.CONTACT_LIST_CHANGED, {});
    } catch {
      /* ignore */
    }
  }
}

const { resolveCreezBackendBase } = require("./creezBackendBase.cjs");

function ok(data) {
  return { ok: true, data };
}

function err(code, message) {
  return { ok: false, error: { code, message } };
}

async function backendFetch(path, options = {}) {
  const baseUrl = resolveCreezBackendBase().replace(/\/+$/, "");
  const url = `${baseUrl}${path}`;
  console.log("[agentBuilderIpc] request", {
    method: options.method || "GET",
    url,
    hasBody: Boolean(options.body),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const body = await res.json().catch(() => null);
    console.log("[agentBuilderIpc] response", {
      method: options.method || "GET",
      url,
      status: res.status,
      ok: body?.ok,
    });
    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function registerAgentBuilderIpc(ipcMain, deps = {}) {
  const { appStateStore, contactRepository, assistantConfigRepository } = deps;

  async function getDeviceId() {
    if (!appStateStore) return randomUUID();
    const state = await appStateStore.getState();
    if (state?.deviceId) return state.deviceId;
    const id = randomUUID();
    await appStateStore.setState({ deviceId: id });
    return id;
  }

  ipcMain.handle(CHANNELS.APP_GET_DEVICE_ID, async () => {
    try {
      const id = await getDeviceId();
      console.log("[agentBuilderIpc] APP_GET_DEVICE_ID:out", { deviceId: id });
      return ok({ deviceId: id });
    } catch (e) {
      console.error("[agentBuilderIpc] APP_GET_DEVICE_ID:error", e?.message || String(e));
      return err("INTERNAL_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_LIST, async () => {
    try {
      const deviceId = await getDeviceId();
      console.log("[agentBuilderIpc] AGENT_BUILDER_LIST:in", { deviceId });
      const { status, body } = await backendFetch(`/agents/mine?device_id=${encodeURIComponent(deviceId)}`);
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || `HTTP ${status}`);
      console.log("[agentBuilderIpc] AGENT_BUILDER_LIST:out", { count: body?.data?.items?.length || 0 });
      return ok(body.data);
    } catch (e) {
      console.error("[agentBuilderIpc] AGENT_BUILDER_LIST:error", e?.message || String(e));
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_GET, async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    if (!id) return err("VALIDATION_ERROR", "id is required.");
    try {
      console.log("[agentBuilderIpc] AGENT_BUILDER_GET:in", { id });
      const { status, body } = await backendFetch(`/agents/${encodeURIComponent(id)}`);
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || `HTTP ${status}`);
      console.log("[agentBuilderIpc] AGENT_BUILDER_GET:out", { id: body?.data?.id });
      return ok(body.data);
    } catch (e) {
      console.warn("[agentBuilderIpc] AGENT_BUILDER_GET:warn", e?.message || String(e));
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_CREATE, async (_event, payload) => {
    try {
      const deviceId = await getDeviceId();
      console.log("[agentBuilderIpc] AGENT_BUILDER_CREATE:in", { deviceId, name: payload?.name });
      const { status, body } = await backendFetch("/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, creator_device_id: deviceId }),
      });
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || `HTTP ${status}`);
      const data = body.data;
      console.log("[agentBuilderIpc] AGENT_BUILDER_CREATE:out", { id: data?.id });
      if (contactRepository && data?.id) {
        try {
          const merged = {
            ...data,
            name: data.name ?? payload?.name,
            system_prompt: data.system_prompt ?? payload?.system_prompt,
            greeting_message: data.greeting_message ?? payload?.greeting_message,
            skills_json: data.skills_json ?? payload?.skills_json,
            avatar_url: data.avatar_url ?? payload?.avatar_url,
          };
          contactRepository.ensureAuthorCreatedAgent(merged);
          broadcastContactListChanged();
        } catch (e) {
          console.warn("[agentBuilderIpc] ensureAuthorCreatedAgent:warn", e?.message || String(e));
        }
      }
      if (assistantConfigRepository && data?.id) {
        try {
          assistantConfigRepository.saveConfigById(data.id, {
            name: payload.name,
            systemPrompt: payload.system_prompt,
            avatar: payload.avatar_url,
            a2a_strategy_json: payload.a2a_strategy_json || undefined,
          });
        } catch (e) {
          console.warn("[agentBuilderIpc] sync local config on create:", e?.message || String(e));
        }
      }
      return ok(data);
    } catch (e) {
      console.error("[agentBuilderIpc] AGENT_BUILDER_CREATE:error", e?.message || String(e));
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_UPDATE, async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    if (!id) return err("VALIDATION_ERROR", "id is required.");
    try {
      const deviceId = await getDeviceId();
      console.log("[agentBuilderIpc] AGENT_BUILDER_UPDATE:in", { id, deviceId, name: payload?.name });
      const { status, body } = await backendFetch(`/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, creator_device_id: deviceId }),
      });
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || `HTTP ${status}`);
      console.log("[agentBuilderIpc] AGENT_BUILDER_UPDATE:out", { id: body?.data?.id });

      if (assistantConfigRepository) {
        try {
          assistantConfigRepository.saveConfigById(id, {
            name: payload.name,
            systemPrompt: payload.system_prompt,
            avatar: payload.avatar_url,
            a2a_strategy_json: payload.a2a_strategy_json || undefined,
          });
        } catch (e) {
          console.warn("[agentBuilderIpc] sync local assistant_config failed:", e?.message || String(e));
        }
      }
      if (contactRepository) {
        try {
          contactRepository.updateBotMeta(id, {
            name: payload.name,
            avatar_path: payload.avatar_url,
          });
        } catch (e) {
          console.warn("[agentBuilderIpc] sync local contact failed:", e?.message || String(e));
        }
      }

      return ok(body.data);
    } catch (e) {
      console.error("[agentBuilderIpc] AGENT_BUILDER_UPDATE:error", e?.message || String(e));
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_PUBLISH, async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    if (!id) return err("VALIDATION_ERROR", "id is required.");
    try {
      const deviceId = await getDeviceId();
      console.log("[agentBuilderIpc] AGENT_BUILDER_PUBLISH:in", { id, deviceId });
      const { status, body } = await backendFetch(`/agents/${encodeURIComponent(id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator_device_id: deviceId }),
      });
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || `HTTP ${status}`);
      console.log("[agentBuilderIpc] AGENT_BUILDER_PUBLISH:out", { id: body?.data?.id, status: body?.data?.status });
      return ok(body.data);
    } catch (e) {
      console.error("[agentBuilderIpc] AGENT_BUILDER_PUBLISH:error", e?.message || String(e));
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_DELETE, async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    if (!id) return err("VALIDATION_ERROR", "id is required.");
    try {
      const deviceId = await getDeviceId();
      console.log("[agentBuilderIpc] AGENT_BUILDER_DELETE:in", { id, deviceId });
      const { status, body } = await backendFetch(`/agents/${encodeURIComponent(id)}?device_id=${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
      });
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || `HTTP ${status}`);
      console.log("[agentBuilderIpc] AGENT_BUILDER_DELETE:out", { id });
      return ok({});
    } catch (e) {
      console.error("[agentBuilderIpc] AGENT_BUILDER_DELETE:error", e?.message || String(e));
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_SEARCH, async (_event, payload) => {
    const q = String(payload?.q || "").trim();
    if (!q) return ok({ items: [] });
    try {
      console.log("[agentBuilderIpc] AGENT_BUILDER_SEARCH:in", { q });
      const { status, body } = await backendFetch(`/agents/search?q=${encodeURIComponent(q)}`);
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || `HTTP ${status}`);
      console.log("[agentBuilderIpc] AGENT_BUILDER_SEARCH:out", { q, count: body?.data?.items?.length || 0 });
      return ok(body.data);
    } catch (e) {
      console.error("[agentBuilderIpc] AGENT_BUILDER_SEARCH:error", e?.message || String(e));
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_RECENT, async () => {
    try {
      const { status, body } = await backendFetch("/agents/recent?limit=5");
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || `HTTP ${status}`);
      return ok(body.data);
    } catch (e) {
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });
}

module.exports = { registerAgentBuilderIpc };

