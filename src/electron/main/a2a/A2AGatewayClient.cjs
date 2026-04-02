/**
 * HTTP + SSE client for the A2A Gateway.
 * Upper-layer modules should never call fetch / http directly — use this client.
 */

const http = require("node:http");
const https = require("node:https");

const TAG = "[A2A:client]";
const HEARTBEAT_INTERVAL_MS = 30_000;
const SSE_RECONNECT_BASE_MS = 1000;
const SSE_RECONNECT_MAX_MS = 30_000;

class A2AGatewayClient {
  /**
   * @param {{ gatewayUrl: string, ownerId: string }} opts
   */
  constructor({ gatewayUrl, ownerId }) {
    this.gatewayUrl = (gatewayUrl || "").replace(/\/+$/, "");
    this.ownerId = ownerId || "";

    this._sseReq = null;
    this._sseState = "disconnected";
    this._heartbeatTimer = null;
    this._heartbeatAgentIds = [];
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    /** Bumped on each connect attempt so stale response handlers ignore end/error after we replace the socket. */
    this._sseGeneration = 0;
    this._onEvent = null;
    this._destroyed = false;
    /** @type {{ onConnected?: () => void, onHttpError?: (status: number) => void, onRequestError?: (message: string) => void }} */
    this._sseHooks = {};
  }

  /**
   * Optional hooks so the main process can log SSE lifecycle (e.g. startup.log).
   * onConnected runs when GET /a2a/events returns 200 (including after reconnect).
   */
  setSseHooks(hooks = {}) {
    this._sseHooks = hooks && typeof hooks === "object" ? hooks : {};
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────

  async _fetch(method, urlPath, body) {
    const url = `${this.gatewayUrl}${urlPath}`;
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body && method !== "GET") {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.code = json?.error?.code || "GATEWAY_ERROR";
      err.status = res.status;
      throw err;
    }
    return json.data;
  }

  // ─── HTTP methods (mirror Gateway routes) ─────────────────────────────────

  async register({ agents, version }) {
    return this._fetch("POST", "/a2a/agents/register", {
      ownerId: this.ownerId,
      version: version || "1.0",
      agents,
    });
  }

  async heartbeat(agentIds, status = "online", capacity = {}) {
    return this._fetch("POST", "/a2a/agents/heartbeat", {
      ownerId: this.ownerId,
      agentIds: Array.isArray(agentIds) ? agentIds : [],
      status,
      capacity,
    });
  }

  async discover(query = {}) {
    const p = new URLSearchParams();
    p.set("ownerId", this.ownerId);
    if (query.tags?.length) p.set("tags", query.tags.join(","));
    if (query.q) p.set("q", query.q);
    if (query.limit) p.set("limit", String(query.limit));
    if (query.offset) p.set("offset", String(query.offset));
    const path = `/a2a/agents/discover?${p.toString()}`;
    console.log(TAG, `[discover] GET ${path} — filters: visibility=public, a2a_status=active; q uses vector semantic search when available`);
    const data = await this._fetch("GET", path);
    const n = Array.isArray(data?.items) ? data.items.length : 0;
    const total = data?.total != null ? data.total : n;
    console.log(TAG, `[discover] response: ${n} item(s) in page, total=${total}`);
    return data;
  }

  /**
   * Public agent row + agent_card_json for prompt enrichment (A2A peer).
   * @param {string} agentId
   * @returns {Promise<{ agentId: string, name: string, agentCard: object }>}
   */
  async fetchPublicAgentCard(agentId) {
    const p = new URLSearchParams();
    p.set("ownerId", this.ownerId);
    p.set("agentId", String(agentId || "").trim());
    return this._fetch("GET", `/a2a/agents/card?${p.toString()}`);
  }

  async openSession(req) {
    return this._fetch("POST", "/a2a/sessions/open", req);
  }

  async closeSession(sessionId, reason = "completed") {
    return this._fetch("POST", "/a2a/sessions/close", { sessionId, reason });
  }

  async sendMessage(req) {
    return this._fetch("POST", "/a2a/messages/send", req);
  }

  /**
   * Fetch the owner's agents from the backend (includes a2a_strategy_json).
   * Used by the orchestrator to sync strategy data on startup.
   */
  async fetchOwnerAgents() {
    const p = new URLSearchParams();
    p.set("device_id", this.ownerId);
    return this._fetch("GET", `/agents/mine?${p.toString()}`);
  }

  async fetchMessages(sessionId, afterSeq) {
    const p = new URLSearchParams();
    p.set("sessionId", sessionId);
    p.set("ownerId", this.ownerId);
    if (afterSeq != null) p.set("afterSeq", String(afterSeq));
    return this._fetch("GET", `/a2a/messages?${p.toString()}`);
  }

  // ─── SSE ──────────────────────────────────────────────────────────────────

  get connectionState() {
    return this._sseState;
  }

  connectSSE(onEvent) {
    if (this._destroyed) return;
    this._onEvent = onEvent;
    this._doConnect();
  }

  /** @private */
  _abortInFlightSse() {
    if (this._sseReq) {
      try {
        this._sseReq.removeAllListeners("error");
        this._sseReq.destroy();
      } catch (_) {}
      this._sseReq = null;
    }
  }

  /** @private */
  _doConnect() {
    if (this._destroyed) return;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    const gen = ++this._sseGeneration;
    this._abortInFlightSse();

    this._sseState = "connecting";

    const sseUrl = new URL(`${this.gatewayUrl}/a2a/events`);
    sseUrl.searchParams.set("ownerId", this.ownerId);

    const mod = sseUrl.protocol === "https:" ? https : http;

    const req = mod.get(
      sseUrl.toString(),
      { headers: { Accept: "text/event-stream" } },
      (res) => {
        if (gen !== this._sseGeneration) {
          try {
            res.destroy();
          } catch (_) {}
          return;
        }

        if (res.statusCode !== 200) {
          console.warn(TAG, `SSE connect failed: HTTP ${res.statusCode}`);
          try {
            this._sseHooks.onHttpError?.(res.statusCode);
          } catch (_) {}
          res.resume();
          this._scheduleReconnect();
          return;
        }

        this._sseState = "connected";
        this._reconnectAttempt = 0;
        console.log(TAG, "SSE connected");
        try {
          this._sseHooks.onConnected?.();
        } catch (_) {}

        let buffer = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (gen !== this._sseGeneration) return;
          buffer += chunk;
          const parts = buffer.split("\n\n");
          buffer = parts.pop();
          for (const raw of parts) {
            if (!raw.trim()) continue;
            this._parseSSEBlock(raw);
          }
        });

        res.on("end", () => {
          if (gen !== this._sseGeneration) return;
          console.log(TAG, "SSE connection ended");
          this._sseState = "disconnected";
          this._scheduleReconnect();
        });

        res.on("error", (err) => {
          if (gen !== this._sseGeneration) return;
          console.warn(TAG, "SSE stream error:", err.message);
          this._sseState = "disconnected";
          this._scheduleReconnect();
        });
      },
    );

    req.on("error", (err) => {
      if (gen !== this._sseGeneration) return;
      const msg = err?.message || String(err);
      console.warn(TAG, "SSE request error:", msg);
      try {
        this._sseHooks.onRequestError?.(msg);
      } catch (_) {}
      this._sseState = "disconnected";
      this._scheduleReconnect();
    });

    this._sseReq = req;
  }

  /** @private */
  _parseSSEBlock(raw) {
    const lines = raw.split("\n");
    let eventType = "";
    let dataStr = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        dataStr += (dataStr ? "\n" : "") + line.slice(6);
      } else if (line.startsWith(":")) {
        // keepalive comment — ignore
      }
    }
    if (!dataStr) return;

    try {
      const parsed = JSON.parse(dataStr);
      const event = { type: eventType || parsed.type || "unknown", ...parsed };
      if (this._onEvent) this._onEvent(event);
    } catch (e) {
      console.warn(TAG, "SSE parse error:", e.message);
    }
  }

  /** @private */
  _scheduleReconnect() {
    if (this._destroyed) return;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnectAttempt++;
    const delay = Math.min(
      SSE_RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt - 1),
      SSE_RECONNECT_MAX_MS,
    );
    console.log(TAG, `reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._doConnect();
    }, delay);
  }

  disconnectSSE() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._sseGeneration++;
    this._abortInFlightSse();
    this._sseState = "disconnected";
    this._onEvent = null;
  }

  // ─── Heartbeat timer ─────────────────────────────────────────────────────

  startHeartbeat(agentIds) {
    this.stopHeartbeat();
    this._heartbeatAgentIds = agentIds || [];
    if (this._heartbeatAgentIds.length === 0) return;

    this._heartbeatTimer = setInterval(async () => {
      try {
        await this.heartbeat(this._heartbeatAgentIds);
      } catch (e) {
        console.warn(TAG, "heartbeat failed:", e.message);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  destroy() {
    this._destroyed = true;
    this._sseGeneration++;
    this._sseHooks = {};
    this.stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._abortInFlightSse();
    this._sseState = "disconnected";
    this._onEvent = null;
  }
}

module.exports = { A2AGatewayClient };
