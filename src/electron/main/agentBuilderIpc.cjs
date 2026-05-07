const { BrowserWindow } = require("electron");
const { CHANNELS } = require("./channels.cjs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { resolveCreezBackendBase } = require("./creezBackendBase.cjs");
const { isCreezVerboseDebug } = require("./creezDebug.cjs");
const { ensureBotDir, resolveCreezHome } = require("./creezPaths.cjs");
const { ensureDeviceId } = require("./creezDeviceId.cjs");
const {
  resolveOpenClawConfigPath,
  resolveOpenClawSource,
  readOpenClawHomeConfig,
  readConfigWithIncludes,
  pickOpenClawAgent,
  buildSystemPrompt,
  collectSkillRefs,
  extractMemory,
  copySkillRefs,
  generateNameAndGreeting,
} = require("./openClawImport.cjs");
const { normalizeOpenClawWithPi } = require("./openClawPiNormalizer.cjs");

function vlog(...args) {
  if (isCreezVerboseDebug()) console.log(...args);
}

const openClawImportTasks = new Map();

/** Agent search/recent gateway calls: set CREEZ_DEBUG_AGENT_SEARCH=1 or CREEZ_DEBUG_VERBOSE=1 */
function isAgentSearchDebug() {
  const v = process.env.CREEZ_DEBUG_AGENT_SEARCH;
  return v === "1" || String(v).toLowerCase() === "true" || isCreezVerboseDebug();
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
    return { status: res.status, body, url };
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
    qrcode_data_uri: config.qrcodeDataUri || null,
    updated_at: config.updatedAt
      ? new Date(config.updatedAt * 1000).toISOString()
      : new Date().toISOString(),
  };
}

/** Map A2A discover row → contact search row (renderer expects id / avatar_url snake_case). */
function mapDiscoverRowToSearchItem(it) {
  const id = String(it?.agentId || it?.id || "").trim();
  if (!id) return null;
  const av =
    (typeof it.avatarUrl === "string" && it.avatarUrl.trim()) ||
    (typeof it.avatar_url === "string" && it.avatar_url.trim()) ||
    null;
  return {
    id,
    name: it.name || "Unnamed",
    avatar_url: av,
    description: typeof it.description === "string" ? it.description : "",
  };
}

function registerAgentBuilderIpc(ipcMain, deps = {}) {
  const { appStateStore, contactRepository, assistantConfigRepository, getA2aOrchestrator } = deps;
  let _creezHome = "";

  async function getDeviceId() {
    const home = getCreezHome();
    if (home && appStateStore) {
      return ensureDeviceId(home, appStateStore);
    }
    if (home) return ensureDeviceId(home, null);
    return randomUUID();
  }

  function getCreezHome() {
    if (_creezHome) return _creezHome;
    try {
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

  // ── GET: local assistant config, or gateway row for remote contacts (discover / 他人 bot 无本地 config 行) ──
  ipcMain.handle(CHANNELS.AGENT_BUILDER_GET, async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    if (!id) return err("VALIDATION_ERROR", "id is required.");
    if (!assistantConfigRepository) return err("INTERNAL_ERROR", "config repository not ready");
    const raw = assistantConfigRepository.getRawConfigById(id);
    if (raw) return ok(configToAgentDetail(raw));

    const c = contactRepository?.getById?.(id);
    const isRemoteContact =
      c &&
      c.type === "bot" &&
      !c.isDefault &&
      (c.botOrigin === "remote" ||
        (c.remoteAgentId && String(c.remoteAgentId).trim() === id));
    if (!isRemoteContact) {
      return err("NOT_FOUND", "Agent not found locally.");
    }

    try {
      const { checkRemoteAgentById } = await import(
        pathToFileURL(path.join(__dirname, "remoteAgentConfig.mjs")).href,
      );
      const checked = await checkRemoteAgentById(id);
      if (!checked.exists || !checked.config) {
        const msg =
          checked.reason === "not_found"
            ? "Agent not found."
            : "Agent temporarily unavailable.";
        return err("NOT_FOUND", msg);
      }
      const cfg = checked.config;
      return ok(
        configToAgentDetail({
          id: cfg.id,
          name: cfg.name,
          avatar: cfg.avatar,
          systemPrompt: cfg.systemPrompt,
          greetingMessage: cfg.greetingMessage,
          knowledge: "",
          skills: cfg.skills || {},
          agentCardJson: null,
          a2aStrategyJson: null,
          visibility: "public",
          status: "published",
        }),
      );
    } catch (e) {
      return err("NETWORK_ERROR", e?.message || String(e));
    }
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
        try { ensureBotDir(creezHome, agentId); } catch { /* non-fatal */ }
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

  // ── SEARCH: same as mini-app GET /a2a/agents/discover (public + a2a active; q = semantic or name/prompt ILIKE)
  // ── RECENT: still GET /agents/recent (published list)
  const DISCOVER_SEARCH_LIMIT = 40;

  ipcMain.handle(CHANNELS.AGENT_BUILDER_SEARCH, async (_event, payload) => {
    const q = String(payload?.q || "").trim();
    if (!q) return ok({ items: [] });
    const dbg = isAgentSearchDebug();
    const backendBase = resolveCreezBackendBase();
    if (dbg) {
      console.log("[creez][AgentBuilder] search:request", {
        backendBase,
        q,
        path: "/a2a/agents/discover",
        hint: "Same as WeChat mini-app discover: visibility=public, a2a_status=active; excludes own ownerId; q matches name/system_prompt (or vector when configured).",
      });
    }
    try {
      let data;
      const orch = typeof getA2aOrchestrator === "function" ? getA2aOrchestrator() : null;
      if (orch && typeof orch.discoverAgents === "function") {
        data = await orch.discoverAgents({
          q,
          limit: DISCOVER_SEARCH_LIMIT,
          offset: 0,
        });
      } else {
        const ownerId = await getDeviceId();
        const baseUrl = backendBase.replace(/\/+$/, "");
        const p = new URLSearchParams();
        p.set("ownerId", ownerId);
        p.set("q", q);
        p.set("limit", String(DISCOVER_SEARCH_LIMIT));
        p.set("offset", "0");
        const url = `${baseUrl}/a2a/agents/discover?${p.toString()}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(url, { signal: controller.signal });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body?.ok) {
            const msg = body?.error?.message || `HTTP ${res.status}`;
            const ex = new Error(msg);
            ex.status = res.status;
            throw ex;
          }
          data = body.data || { items: [], total: 0 };
        } finally {
          clearTimeout(timeout);
        }
        if (dbg) {
          console.log("[creez][AgentBuilder] search:fetch_fallback", {
            url: `${baseUrl}/a2a/agents/discover?...`,
            reason: "A2A orchestrator not ready yet",
          });
        }
      }

      const rawItems = Array.isArray(data?.items) ? data.items : [];
      const items = rawItems.map(mapDiscoverRowToSearchItem).filter(Boolean);
      if (dbg) {
        console.log("[creez][AgentBuilder] search:response", {
          source: orch ? "orchestrator.discoverAgents" : "fetch /a2a/agents/discover",
          itemCount: items.length,
          total: data?.total,
          firstNames: items.slice(0, 3).map((it) => it?.name || it?.id).filter(Boolean),
        });
      }
      return ok({ items, total: typeof data?.total === "number" ? data.total : items.length });
    } catch (e) {
      if (dbg) {
        console.warn("[creez][AgentBuilder] search:error", {
          backendBase,
          q,
          message: e?.message || String(e),
          name: e?.name,
        });
      }
      const isAbort = e?.name === "AbortError";
      return err(isAbort ? "NETWORK_ERROR" : "BACKEND_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_GET_QRCODE, async (_event, payload) => {
    const agentId = String(payload?.agentId || "").trim();
    if (!agentId) return err("VALIDATION_ERROR", "agentId is required.");
    if (!assistantConfigRepository) return err("INTERNAL_ERROR", "config repository not ready");
    const raw = assistantConfigRepository.getRawConfigById(agentId);
    return ok({ image: raw?.qrcodeDataUri || null });
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_GENERATE_QRCODE, async (_event, payload) => {
    const agentId = String(payload?.agentId || "").trim();
    if (!agentId) return err("VALIDATION_ERROR", "agentId is required.");
    if (!assistantConfigRepository) return err("INTERNAL_ERROR", "config repository not ready");

    const raw = assistantConfigRepository.getRawConfigById(agentId);
    if (raw?.qrcodeDataUri) {
      return err("ALREADY_EXISTS", "QR code already generated for this agent.");
    }

    try {
      const baseUrl = resolveCreezBackendBase().replace(/\/+$/, "");
      const body = {
        agentId,
        avatarUrl: payload?.avatarUrl || null,
        page: payload?.page || "",
        envVersion: payload?.envVersion || "release",
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let image;
      try {
        const res = await fetch(`${baseUrl}/wechat/qrcode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          return err("BACKEND_ERROR", json?.error?.message || `HTTP ${res.status}`);
        }
        image = json.data.image;
      } finally {
        clearTimeout(timeout);
      }

      if (image) {
        assistantConfigRepository.saveConfigById(agentId, { qrcodeDataUri: image });
      }

      return ok({ image });
    } catch (e) {
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_RECENT, async () => {
    const dbg = isAgentSearchDebug();
    const backendBase = resolveCreezBackendBase();
    if (dbg) console.log("[creez][AgentBuilder] recent:request", { backendBase });
    try {
      const { status, body, url } = await gatewayFetch("/agents/recent?limit=5");
      const items = Array.isArray(body?.data?.items) ? body.data.items : [];
      if (dbg) {
        console.log("[creez][AgentBuilder] recent:response", {
          url,
          httpStatus: status,
          gatewayOk: Boolean(body?.ok),
          itemCount: items.length,
          rawBodyPreview: body == null ? "(non-JSON or empty)" : JSON.stringify(body).slice(0, 600),
        });
      }
      if (!body?.ok) return err("BACKEND_ERROR", body?.error?.message || "Failed");
      return ok(body.data);
    } catch (e) {
      if (dbg) {
        console.warn("[creez][AgentBuilder] recent:network_error", {
          backendBase,
          message: e?.message || String(e),
        });
      }
      return err("NETWORK_ERROR", e?.message || String(e));
    }
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_CANCEL_OPENCLAW_IMPORT, async (_event, payload = {}) => {
    const importId = String(payload?.importId || "").trim();
    const task = importId ? openClawImportTasks.get(importId) : null;
    if (!task) return ok({ cancelled: false });
    console.log(`[OpenClawImport:${importId}] cancel requested`);
    task.controller.abort();
    return ok({ cancelled: true });
  });

  ipcMain.handle(CHANNELS.AGENT_BUILDER_IMPORT_OPENCLAW, async (event, payload = {}) => {
    if (!contactRepository || !assistantConfigRepository) {
      return err("INTERNAL_ERROR", "repositories not ready");
    }
    const importId = String(payload?.importId || randomUUID()).trim();
    const controller = new AbortController();
    const signal = controller.signal;
    openClawImportTasks.set(importId, { controller });
    const steps = [];
    const status = (message) => {
      const text = String(message || "").trim();
      if (!text) return;
      const item = { message: text, at: new Date().toISOString() };
      steps.push(item);
      console.log(`[OpenClawImport:${importId}] ${text}`);
      try {
        event.sender.send(CHANNELS.AGENT_BUILDER_OPENCLAW_IMPORT_PROGRESS, {
          importId,
          ...item,
        });
      } catch { /* renderer may be gone */ }
    };
    const assertNotCancelled = () => {
      if (signal.aborted) {
        const e = new Error("OpenClaw import cancelled.");
        e.code = "CANCELLED";
        throw e;
      }
    };

    try {
      status("Starting OpenClaw import.");
      assertNotCancelled();
      const source = payload?.configPath
        ? { type: "config", configPath: path.resolve(String(payload.configPath)) }
        : await resolveOpenClawSource(status);
      assertNotCancelled();
      const fsSync = require("node:fs");
      if (source.type === "missing" || (source.type === "config" && !fsSync.existsSync(source.configPath))) {
        status("OpenClaw config file was not found.");
        return err(
          "OPENCLAW_NOT_FOUND",
          `No OpenClaw data found. Install/run OpenClaw first, or set OPENCLAW_HOME/OPENCLAW_CONFIG_PATH. Checked: ${source.configPath || source.home || ""}`,
          { steps, configPath: source.configPath || "", openClawHome: source.home || "" },
        );
      }
      let config;
      let configDir;
      let configPath = "";
      if (source.type === "home") {
        status("Reading OpenClaw data directory.");
        config = await readOpenClawHomeConfig(source.home, status, signal);
        configDir = source.home;
      } else {
        configPath = source.configPath;
        status(`OpenClaw config file found: ${configPath}`);
        status("Reading OpenClaw JSON5 config.");
        config = await readConfigWithIncludes(configPath, status, new Set(), signal);
        configDir = path.dirname(path.resolve(configPath));
      }
      const { defaults, agent, agentCount } = pickOpenClawAgent(config);
      if (agentCount > 1) {
        status(`Found ${agentCount} OpenClaw agents; importing the default/first one for this run.`);
      }

      status("Extracting persona prompt.");
      assertNotCancelled();
      const systemPrompt = buildSystemPrompt(defaults, agent);
      if (!systemPrompt) {
        return err("VALIDATION_ERROR", "No OpenClaw persona/system prompt was found.", { steps, configPath });
      }

      status("Extracting memory.");
      assertNotCancelled();
      const memory = await extractMemory(config, defaults, agent, configDir);
      const defaultContactId = contactRepository.getDefaultAssistantConfigId();
      const defaultConfig = assistantConfigRepository.getRawConfigById(defaultContactId);

      assertNotCancelled();
      const agentId = randomUUID();
      const skillRefs = collectSkillRefs(defaults, agent, configDir);
      const skillFlags = {};
      for (const ref of skillRefs) {
        const key = String(ref.raw || ref.path || "").split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "");
        if (key) skillFlags[key] = true;
      }

      let piDraft = null;
      try {
        piDraft = await normalizeOpenClawWithPi({
          openClawConfig: config,
          pickedAgent: { defaults, agent },
          extractedSystemPrompt: systemPrompt,
          extractedMemory: memory,
          skillRefs,
          defaultConfig,
          creezHome: getCreezHome() || resolveCreezHome(),
          botId: agentId,
          status,
          signal,
        });
      } catch (e) {
        if (e?.code === "CANCELLED") throw e;
        status(`Pi normalization failed; falling back to rule-based migration: ${e?.message || String(e)}`);
      }

      let generated = { name: "", greetingMessage: "", generated: false };
      if (!piDraft) {
        generated = await generateNameAndGreeting({
          agent,
          systemPrompt,
          memory,
          defaultConfig,
          status,
          signal,
        });
      }
      const name = piDraft?.name || generated.name || "OpenClaw Agent";
      const greetingMessage = piDraft?.greeting_message || generated.greetingMessage || "";
      const finalSystemPrompt = piDraft?.system_prompt || systemPrompt;
      const finalKnowledge = piDraft?.knowledge || memory || "";

      status("Creating local Creez draft bot.");
      assertNotCancelled();
      contactRepository.ensureAuthorCreatedAgent({
        id: agentId,
        name,
        avatar_url: agent.avatar || agent.avatarUrl || agent.avatar_url || null,
        greeting_message: greetingMessage,
        system_prompt: finalSystemPrompt,
        skills_json: skillFlags,
      });

      const creezHome = getCreezHome() || resolveCreezHome();
      const botDir = ensureBotDir(creezHome, agentId);
      const memoryPath = path.join(botDir, "data", "memory.md");
      if (finalKnowledge) {
        status("Writing migrated memory markdown.");
        assertNotCancelled();
        const fs = require("node:fs/promises");
        await fs.mkdir(path.dirname(memoryPath), { recursive: true });
        await fs.writeFile(memoryPath, finalKnowledge, "utf8");
      } else {
        status("No OpenClaw memory found.");
      }

      let skillsResult = piDraft?.skillCopyResult || null;
      if (skillsResult) {
        status("OpenClaw skills were copied by Pi agent tool.");
      } else {
        status("Copying OpenClaw skills into the new bot skill directory.");
        skillsResult = await copySkillRefs(skillRefs, path.join(botDir, "skills"), status, signal);
      }
      const promptWithMemoryHint = finalKnowledge
        ? `${finalSystemPrompt}\n\n## Migrated Memory\nOpenClaw memory was imported to: ${memoryPath}`
        : finalSystemPrompt;

      assertNotCancelled();
      assistantConfigRepository.saveConfigById(agentId, {
        name,
        avatar: agent.avatar || agent.avatarUrl || agent.avatar_url || null,
        systemPrompt: promptWithMemoryHint,
        greetingMessage,
        knowledge: finalKnowledge,
        skills: skillFlags,
        agentCardJson: null,
        visibility: "public",
        status: "draft",
      });

      broadcastContactListChanged();
      status("OpenClaw import complete. Review the draft, then save and publish when ready.");
      const detail = configToAgentDetail(assistantConfigRepository.getRawConfigById(agentId));
      return ok({
        importId,
        agent: detail,
        steps,
        summary: {
          configPath: configPath || null,
          openClawHome: source.home || null,
          memoryPath: finalKnowledge ? memoryPath : null,
          copiedSkills: skillsResult.copied.length,
          skippedSkills: skillsResult.skipped.length,
          generatedNameOrGreeting: Boolean(generated.generated || piDraft),
          normalizedBy: piDraft ? "pi-agent" : "rules",
        },
      });
    } catch (e) {
      status(`Import failed: ${e?.message || String(e)}`);
      const code = e?.code === "CANCELLED" ? "CANCELLED" : "OPENCLAW_IMPORT_ERROR";
      return err(code, e?.message || String(e), { steps, importId });
    } finally {
      openClawImportTasks.delete(importId);
    }
  });
}

module.exports = { registerAgentBuilderIpc };
