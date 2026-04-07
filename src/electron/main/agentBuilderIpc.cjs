const { BrowserWindow } = require("electron");
const { CHANNELS } = require("./channels.cjs");
const { randomUUID } = require("node:crypto");
const { resolveCreezBackendBase } = require("./creezBackendBase.cjs");
const { isCreezVerboseDebug } = require("./creezDebug.cjs");
const { ensureBotWorkplace } = require("./creezPaths.cjs");

function vlog(...args) {
  if (isCreezVerboseDebug()) console.log(...args);
}

function ok(data) {
  return { ok: true, data };
}

function err(code, message) {
  return { ok: false, error: { code, message } };
}

function broadcastContactListChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.CONTACT_LIST_CHANGED, {});
    } catch { /* ignore */ }
  }
}

async function gatewayFetch(path, options = {}) {
  const baseUrl = resolveCreezBackendBase().replace(/\/+$/, "");
  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

/** Always print one line so Save changes (async PUT) and Publish are visible in the Electron main-process terminal. */
function logGatewayPutForKnowledge(agentId, result) {
  const payload = {
    agentId,
    knowledgeChars: result.knowledgeChars,
    putOk: result.ok,
    httpStatus: result.status ?? null,
    gatewayError:
      result.body?.error?.message
      || result.error
      || (result.skipped ? result.reason : null)
      || null,
    hint: result.ok
      ? "Server will async syncKnowledge→Qdrant; watch gateway for [creez-backend agents] update:knowledge:out"
      : null,
  };
  if (result.ok) console.log("[creez][AgentBuilder] gateway PUT /agents/:id (knowledge payload in body)", payload);
  else console.warn("[creez][AgentBuilder] gateway PUT /agents/:id FAILED", payload);
}

/**
 * Push local agent data to the gateway (PUT /agents/:id).
 * Triggers server-side Supabase update + async syncKnowledge → Qdrant when knowledge is present.
 *
 * @returns {Promise<{ ok: boolean, status?: number, body?: any, error?: string, knowledgeChars: number, skipped?: boolean, reason?: string }>}
 */
async function pushToGateway(agentId, localConfig, deviceId) {
  const knowledgeChars = String(localConfig?.knowledge || "").length;
  if (!agentId || !deviceId) {
    const r = { ok: false, skipped: true, reason: "missing agentId or deviceId", knowledgeChars };
    logGatewayPutForKnowledge(String(agentId || "(missing-id)"), r);
    return r;
  }
  const payload = {
    name: localConfig.name,
    avatar_url: localConfig.avatar || null,
    system_prompt: localConfig.systemPrompt || "",
    greeting_message: localConfig.greetingMessage || "",
    knowledge: localConfig.knowledge || "",
    agent_card_json: localConfig.agentCardJson || null,
    a2a_strategy_json: localConfig.a2aStrategyJson || null,
    visibility: localConfig.visibility || "public",
    creator_device_id: deviceId,
  };
  try {
    const { status, body } = await gatewayFetch(`/agents/${encodeURIComponent(agentId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const httpOk = status >= 200 && status < 300;
    const businessOk = Boolean(body?.ok);
    if (httpOk && businessOk) {
      vlog("[agentBuilderIpc] pushToGateway: synced", agentId, { knowledgeChars });
      const r = { ok: true, status, body, knowledgeChars };
      logGatewayPutForKnowledge(agentId, r);
      return r;
    }
    const r = { ok: false, status, body, knowledgeChars };
    logGatewayPutForKnowledge(agentId, r);
    return r;
  } catch (e) {
    const r = { ok: false, error: e?.message || String(e), knowledgeChars };
    logGatewayPutForKnowledge(agentId, r);
    return r;
  }
}

function configToAgentDetail(config) {
  return {
    id: config.id,
    name: config.name,
    avatar_url: config.avatar || null,
    system_prompt: config.systemPrompt || "",
    greeting_message: config.greetingMessage || "",
    knowledge: config.knowledge || "",
    skills_json: config.skills || {},
    status: config.status || "draft",
    agent_card_json: config.agentCardJson || null,
    a2a_strategy_json: config.a2aStrategyJson || null,
    visibility: config.visibility || "public",
    updated_at: config.updatedAt
      ? new Date(config.updatedAt * 1000).toISOString()
      : new Date().toISOString(),
  };
}

function registerAgentBuilderIpc(ipcMain, deps = {}) {
  const { appStateStore, contactRepository, assistantConfigRepository } = deps;
  let _creezHome = "";

  async function getDeviceId() {
    if (!appStateStore) return randomUUID();
    const state = await appStateStore.getState();
    if (state?.deviceId) return state.deviceId;
    const id = randomUUID();
    await appStateStore.setState({ deviceId: id });
    return id;
  }

  function getCreezHome() {
    if (_creezHome) return _creezHome;
    try {
      const { resolveCreezHome } = require("./creezPaths.cjs");
      _creezHome = resolveCreezHome();
    } catch {
      _creezHome = "";
    }
    return _creezHome;
  }

  ipcMain.handle(CHANNELS.APP_GET_DEVICE_ID, async () => {
    try {
      const id = await getDeviceId();
      return ok({ deviceId: id });
    } catch (e) {
      return err("INTERNAL_ERROR", e?.message || String(e));
    }
  });

  // ── LIST: pure local ──
  ipcMain.handle(CHANNELS.AGENT_BUILDER_LIST, async () => {
    if (!contactRepository || !assistantConfigRepository) return ok({ items: [] });
    try {
      const { items = [] } = contactRepository.list({ type: "bot" }) || {};
      const result = items
        .filter((c) => {
          if (!c || c.type !== "bot" || c.isDefault) return false;
          const origin = c.botOrigin || c.bot_origin || "";
          return origin === "author";
        })
        .map((c) => {
          const config = assistantConfigRepository.getRawConfigById(c.id);
          return {
            id: c.id,
            name: c.name || config?.name || "Agent",
            avatar_url: c.avatarPath || config?.avatar || null,
            status: config?.status || "draft",
            updated_at: c.updatedAt
              ? new Date(c.updatedAt * 1000).toISOString()
              : new Date().toISOString(),
          };
        })
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
      return ok({ items: result });
    } catch (e) {
      return err("DB_ERROR", e?.message || String(e));
    }
  });

  // ── GET: pure local ──
  ipcMain.handle(CHANNELS.AGENT_BUILDER_GET, async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    if (!id) return err("VALIDATION_ERROR", "id is required.");
    if (!assistantConfigRepository) return err("INTERNAL_ERROR", "config repository not ready");
    const raw = assistantConfigRepository.getRawConfigById(id);
    if (!raw) return err("NOT_FOUND", "Agent not found locally.");
    return ok(configToAgentDetail(raw));
  });

  // ── CREATE: local first, async push gateway ──
  ipcMain.handle(CHANNELS.AGENT_BUILDER_CREATE, async (_event, payload) => {
    if (!contactRepository || !assistantConfigRepository) {
      return err("INTERNAL_ERROR", "repositories not ready");
    }
    try {
      const agentId = randomUUID();
      const name = String(payload?.name || "Agent").trim() || "Agent";

      contactRepository.ensureAuthorCreatedAgent({
        id: agentId,
        name,
        avatar_url: payload.avatar_url || null,
        greeting_message: payload.greeting_message || "",
        system_prompt: payload.system_prompt || "",
        skills_json: payload.skills_json || { knowledge_search: true, vc_lead_capture: true },
      });

      assistantConfigRepository.saveConfigById(agentId, {
        name,
        avatar: payload.avatar_url || null,
        systemPrompt: payload.system_prompt || "",
        greetingMessage: payload.greeting_message || "",
        knowledge: payload.knowledge || "",
        skills: payload.skills_json || { knowledge_search: true, vc_lead_capture: true },
        agentCardJson: payload.agent_card_json || null,
        a2aStrategyJson: payload.a2a_strategy_json || null,
        visibility: payload.visibility || "public",
        status: "draft",
      });

      const creezHome = getCreezHome();
      if (creezHome) {
        try { ensureBotWorkplace(creezHome, agentId); } catch { /* non-fatal */ }
      }

      broadcastContactListChanged();

      const config = assistantConfigRepository.getRawConfigById(agentId);
      const detail = configToAgentDetail(config || { id: agentId, name });

      void (async () => {
        try {
          const deviceId = await getDeviceId();
          const { body } = await gatewayFetch("/agents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, id: agentId, creator_device_id: deviceId }),
          });
          if (!body?.ok) {
            console.warn("[agentBuilderIpc] CREATE gateway push failed:", body?.error);
          }
        } catch (e) {
          console.warn("[agentBuilderIpc] CREATE gateway push error:", e?.message);
        }
      })();

      return ok(detail);
    } catch (e) {
      return err("DB_ERROR", e?.message || String(e));
    }
  });

  // ── UPDATE: local first, async push gateway ──
  ipcMain.handle(CHANNELS.AGENT_BUILDER_UPDATE, async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    if (!id) return err("VALIDATION_ERROR", "id is required.");
    if (!assistantConfigRepository) return err("INTERNAL_ERROR", "config repository not ready");
    try {
      assistantConfigRepository.saveConfigById(id, {
        name: payload.name,
        avatar: payload.avatar_url,
        systemPrompt: payload.system_prompt,
        greetingMessage: payload.greeting_message,
        knowledge: payload.knowledge,
        skills: payload.skills_json,
        agentCardJson: payload.agent_card_json,
        a2aStrategyJson: payload.a2a_strategy_json,
        visibility: payload.visibility,
      });

      if (contactRepository) {
        try {
          contactRepository.updateBotMeta(id, {
            name: payload.name,
            avatar_path: payload.avatar_url,
          });
        } catch { /* non-fatal */ }
      }

      const config = assistantConfigRepository.getRawConfigById(id);
      const detail = configToAgentDetail(config || { id });

      void (async () => {
        try {
          const deviceId = await getDeviceId();
          if (config) await pushToGateway(id, config, deviceId);
        } catch (e) {
          console.warn("[agentBuilderIpc] UPDATE gateway push error:", e?.message);
        }
      })();

      broadcastContactListChanged();

      return ok(detail);
    } catch (e) {
      return err("DB_ERROR", e?.message || String(e));
    }
  });

  // ── PUBLISH: sync to gateway (needs network), then update local status ──
  ipcMain.handle(CHANNELS.AGENT_BUILDER_PUBLISH, async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    if (!id) return err("VALIDATION_ERROR", "id is required.");
    if (!assistantConfigRepository) return err("INTERNAL_ERROR", "config repository not ready");
    try {
      const deviceId = await getDeviceId();
      const config = assistantConfigRepository.getRawConfigById(id);
      if (!config) return err("NOT_FOUND", "Agent not found locally.");

      const pushResult = await pushToGateway(id, config, deviceId);
      if (!pushResult.ok) {
        const msg = pushResult.skipped
          ? "Cannot sync to gateway (missing device id)."
          : (pushResult.body?.error?.message
            || pushResult.error
            || `Gateway PUT failed (HTTP ${pushResult.status ?? "?"}). Fix this before publishing — knowledge will not reach Qdrant until PUT succeeds.`);
        return err("BACKEND_ERROR", msg);
      }

      const { body } = await gatewayFetch(`/agents/${encodeURIComponent(id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator_device_id: deviceId }),
      });
      if (!body?.ok) {
        return err("BACKEND_ERROR", body?.error?.message || "Publish failed — check network.");
      }

      assistantConfigRepository.saveConfigById(id, { status: "published" });

      broadcastContactListChanged();

      const updated = assistantConfigRepository.getRawConfigById(id);
      return ok(configToAgentDetail(updated || { id, status: "published" }));
    } catch (e) {
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  // ── DELETE: local first, async notify gateway ──
  ipcMain.handle(CHANNELS.AGENT_BUILDER_DELETE, async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    if (!id) return err("VALIDATION_ERROR", "id is required.");
    try {
      if (contactRepository) {
        try { contactRepository.deleteContact(id); } catch { /* may not exist */ }
      }
      if (assistantConfigRepository) {
        try { assistantConfigRepository.deleteById(id); } catch { /* may not exist */ }
      }
      broadcastContactListChanged();

      void (async () => {
        try {
          const deviceId = await getDeviceId();
          await gatewayFetch(`/agents/${encodeURIComponent(id)}?device_id=${encodeURIComponent(deviceId)}`, {
            method: "DELETE",
          });
        } catch (e) {
          console.warn("[agentBuilderIpc] DELETE gateway notify error:", e?.message);
        }
      })();

      return ok({});
    } catch (e) {
      return err("DB_ERROR", e?.message || String(e));
    }
  });

  // ── SEARCH / RECENT: gateway-only (other users' bots) ──
  ipcMain.handle(CHANNELS.AGENT_BUILDER_SEARCH, async (_event, payload) => {
    const q = String(payload?.q || "").trim();
    if (!q) return ok({ items: [] });
    try {
      const { body } = await gatewayFetch(`/agents/search?q=${encodeURIComponent(q)}`);
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || "Search failed");
      return ok(body.data);
    } catch (e) {
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_RECENT, async () => {
    try {
      const { body } = await gatewayFetch("/agents/recent?limit=5");
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || "Failed");
      return ok(body.data);
    } catch (e) {
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });
}

module.exports = { registerAgentBuilderIpc };
