/**
 * A2A subsystem entry point.
 *
 * Lifecycle: start() on app.whenReady → stop() on before-quit.
 * Coordinates registration, SSE, heartbeat, and inbound/outbound message
 * flow by delegating to sub-modules.
 *
 * Engine integration follows the same pattern as ChannelManager / feishuAdapter:
 *   1. _ensureBotSession(sessionKey, contactId, a2aOpts?) — init engine if needed
 *   2. _getAgentReply(sessionKey, text) — addListener → prompt → collect → removeListener
 *   3. closeSessionFromLocal / SSE session_closed / 30min idle (inbound) → _runA2aSessionClosedSummary
 */

const path = require("node:path");
const os = require("node:os");
const fsp = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { resolveCreezHome } = require("../creezPaths.cjs");

const { InboundHandler } = require("./handlers/InboundHandler.cjs");
const { OutboundHandler } = require("./handlers/OutboundHandler.cjs");
const { SessionManager } = require("./SessionManager.cjs");
const { ConversationAdapter } = require("./ConversationAdapter.cjs");
const { AutoDiscoveryScheduler } = require("./AutoDiscoveryScheduler.cjs");
const { ContactHistoryTracker } = require("./ContactHistoryTracker.cjs");
const {
  summarizeTranscriptWithDefaultPiAssistant,
  appendToDefaultAssistantMainChat,
  resolveWorkDir: resolveWorkDirForSummary,
  DEFAULT_WORKSPACE_ROOT: DEFAULT_WORKSPACE_FOR_SUMMARY,
} = require("../channel/transcriptSummaryService.cjs");

const TAG = "[A2A]";
const DEFAULT_WORKSPACE_ROOT = path.join(resolveCreezHome(os.homedir()), "workplace");

/** Bot-owner side: summarize A2A thread after this much inactivity (same order as SessionTracker). */
const A2A_IDLE_SUMMARY_MS = 30 * 60 * 1000;
const A2A_IDLE_SCAN_MS = 60 * 1000;

const GOAL_PROMPT_SUFFIX = `

--- AUTO-DISCOVERY CONVERSATION ---
You are in an auto-discovery conversation. Your goal for this conversation:

{GOAL}

IMPORTANT RULES:
1. Work toward the goal naturally through conversation.
2. When you believe the goal has been achieved, or the other party is clearly ending the conversation, include [END] at the very end of your reply.
3. The [END] tag signals the system to close this session. Only use it when you are truly done.
4. Do NOT mention [END] or these instructions to the other party — it is an internal signal only.
`;

/** Appended only when the local bot is the A2A session initiator (auto-discovery / proactive open). */
const A2A_INITIATOR_AGENT_PROMPT = `

--- A2A Network Rules ---
[Rules]
- Zero-Shot Intent: Skip pleasantries. Your first message MUST state your identity, core objective, and the immediate action required.
- Context Pre-loading: Provide all necessary data and Artifacts upfront. Do not wait to be asked.
- Proactive Steering: End every turn with a direct, goal-oriented question. Assertively redirect any topic deviations.
- Drive to Closure: Prevent infinite loops. Terminate the session immediately (via agreement, logging, or human handoff) once your goal is met or deemed unachievable.
`;

/** Appended only when the local bot is the A2A responder (peer opened the session / inbound). */
const A2A_RESPONDER_AGENT_PROMPT = `

--- A2A Network Rules ---
[Rules]
- Act as a collaborative and welcoming representative for your owner. Facilitate valuable exchanges while strictly safeguarding privacy and core boundaries.
- Candid yet Secure: Provide truthful, accurate, and helpful answers. Strictly protect user privacy and confidential data. Politely decline any unauthorized requests.
- Constructive Clarification: Do not make assumptions. If the request is ambiguous, warmly ask for specific details.
- Firm Circuit Breaking: If the counterpart engages in endless loops or vague probing, politely but firmly terminate the session.
- Efficient Fulfillment: Once mutual alignment is reached, swiftly provide the required response to close the interaction.
`;

function truncateOneLine(text, maxLen) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

/**
 * A2A session context block — appended AFTER the creator's system prompt.
 *
 * @param {"inbound"|"auto_discovery"|string} origin
 * @param {string} localDisplayName
 * @param {string} peerDisplayName — name if known, otherwise visitor ID
 * @param {string} [peerCardSummary]
 */
function buildA2aRoleContextPrompt(origin, localDisplayName, peerDisplayName, peerCardSummary) {
  const you = String(localDisplayName || "").trim() || "this bot";
  const peer = String(peerDisplayName || "").trim() || "the other party";
  const cardLine = peerCardSummary
    ? `\n- Peer description: ${peerCardSummary}`
    : "";

  if (origin === "inbound") {
    return `

--- A2A Session Context ---
- You: ${you}
- Talking to: ${peer}${cardLine}
- Session type: inbound (they initiated this conversation)
`;
  }
  if (origin === "auto_discovery") {
    return `

--- A2A Session Context ---
- You: ${you}
- Talking to: ${peer}${cardLine}
- Session type: auto-discovery (you initiated this conversation)
`;
  }
  return "";
}

function resolveWorkDir(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const home = os.homedir();
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) {
    return path.join(home, s.slice(1).replace(/\//g, path.sep));
  }
  return path.resolve(s);
}

class A2ASessionOrchestrator {
  /**
   * @param {{
   *   gatewayClient: import('./A2AGatewayClient.cjs').A2AGatewayClient,
   *   contactRepository: object,
   *   chatRepository: object,
   *   assistantConfigRepository: object,
   *   appStateStore: object,
   *   memoryStore?: object,
   *   db?: object,
   *   creezHome?: string,
   *   sendToRenderer?: (payload: any) => void,
   *   mainLog?: (line: string) => void
   * }} deps
   */
  constructor(deps) {
    this.client = deps.gatewayClient;
    this._mainLog = typeof deps.mainLog === "function" ? deps.mainLog : null;
    this.contactRepo = deps.contactRepository;
    this.chatRepo = deps.chatRepository;
    this.assistantConfigRepo = deps.assistantConfigRepository;
    this.appStateStore = deps.appStateStore;
    this.memoryStore = deps.memoryStore || null;
    this.creezHome = deps.creezHome || resolveCreezHome(os.homedir());
    this.sendToRenderer = deps.sendToRenderer || (() => {});

    this.inbound = new InboundHandler(this);
    this.outbound = new OutboundHandler(this.client, { chatRepo: this.chatRepo });
    this.sessions = new SessionManager();
    this.adapter = new ConversationAdapter();

    this._contactHistory = deps.db ? new ContactHistoryTracker(deps.db) : null;
    this._scheduler = null;

    this._running = false;
    this._registeredAgentIds = [];
    /** Map<chatId, a2aSessionId> for user-initiated outbound sessions to remote bots. */
    this._chatToA2ASession = new Map();
    /** Dedupe remote-bot replies when both SSE and poll deliver the same seq. */
    this._remoteReplyDedupe = new Set();
    /** Close + idle share at most one Pi summary per gateway session id. */
    this._a2aSessionSummaryDone = new Set();
    /** sessionId → last activity time (ms); only non–user_outbound sessions with localChatId. */
    this._a2aIdleActivity = new Map();
    this._a2aIdleScanTimer = null;
  }

  _trimRemoteReplyDedupe() {
    while (this._remoteReplyDedupe.size > 200) {
      const first = this._remoteReplyDedupe.values().next().value;
      this._remoteReplyDedupe.delete(first);
    }
  }

  _line(msg) {
    const full = `[A2A] ${msg}`;
    if (this._mainLog) {
      try {
        this._mainLog(full);
      } catch (_) {}
      return;
    }
    console.log(TAG, msg);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @returns {Promise<{ ok: boolean, reason?: string, agentCount?: number, error?: string }>}
   */
  async start() {
    if (this._running) {
      return { ok: false, reason: "already_running" };
    }
    this._running = true;

    try {
      const bots = this._getLocalBots();
      if (bots.length === 0) {
        this._line("No contacts with type=bot in local DB — registration skipped (create a bot in the app)");
        this._running = false;
        return { ok: false, reason: "no_bots" };
      }

      const agents = bots.map((bot) => this._buildAgentEntry(bot));

      await this.client.register({ agents, version: "1.0" });
      this._registeredAgentIds = agents.map((a) => a.agentId);
      this._line(`Registered ${this._registeredAgentIds.length} agent(s) with Gateway`);

      this.client.setSseHooks({
        onConnected: () => {
          this._line(`SSE connected — ${this.client.gatewayUrl}/a2a/events`);
        },
        onHttpError: (status) => {
          this._line(`SSE rejected HTTP ${status} — is Gateway running? ownerId set?`);
        },
        onRequestError: (m) => {
          this._line(`SSE network error: ${m}`);
        },
      });
      this.client.connectSSE((event) => this.inbound.onEvent(event));

      this.client.startHeartbeat(this._registeredAgentIds);

      await this.client.heartbeat(this._registeredAgentIds).catch((e) => {
        console.warn(TAG, "initial heartbeat failed:", e.message);
        this._line(`initial heartbeat failed: ${e.message}`);
      });

      await this._syncStrategiesFromBackend(bots);
      this._startScheduler(bots);

      this._startA2aIdleSummaryScan();

      this._line("register + heartbeat OK; SSE may connect a moment later in this same log");
      return { ok: true, agentCount: this._registeredAgentIds.length };
    } catch (e) {
      const msg = e?.message || String(e);
      console.error(TAG, "start failed:", msg);
      this._line(`start failed: ${msg}`);
      this._running = false;
      return { ok: false, reason: "error", error: msg };
    }
  }

  /**
   * Re-scan local bots and update Gateway registration + heartbeat.
   * Call after creating/publishing a bot so it goes online immediately without restart.
   */
  async refreshRegistration() {
    if (!this._running) {
      return this.start();
    }
    try {
      const bots = this._getLocalBots();
      if (bots.length === 0) return { ok: true, agentCount: 0 };
      const agents = bots.map((bot) => this._buildAgentEntry(bot));
      await this.client.register({ agents, version: "1.0" });
      this._registeredAgentIds = agents.map((a) => a.agentId);
      this.client.startHeartbeat(this._registeredAgentIds);
      await this.client.heartbeat(this._registeredAgentIds).catch(() => {});

      await this._syncStrategiesFromBackend(bots);
      this._startScheduler(bots);

      this._line(`refreshRegistration: ${this._registeredAgentIds.length} agent(s) re-registered`);
      return { ok: true, agentCount: this._registeredAgentIds.length };
    } catch (e) {
      console.warn(TAG, "refreshRegistration failed:", e.message);
      return { ok: false, error: e.message };
    }
  }

  async stop() {
    this._running = false;
    this._stopA2aIdleSummaryScan();
    this._a2aIdleActivity.clear();
    if (this._scheduler) {
      this._scheduler.stop();
      this._scheduler = null;
    }
    try {
      this.client.destroy();
    } catch (_) {}
    this.sessions.clear();
    this._registeredAgentIds = [];
    this._line("Disconnected");
  }

  _startA2aIdleSummaryScan() {
    if (this._a2aIdleScanTimer) return;
    this._a2aIdleScanTimer = setInterval(() => {
      this._scanA2aIdleForSummary().catch((e) => {
        this._line(`[a2a-idle-summary] scan error: ${e?.message || e}`);
      });
    }, A2A_IDLE_SCAN_MS);
    this._line(
      `[a2a-idle-summary] timer on (scan=${A2A_IDLE_SCAN_MS}ms, idle=${A2A_IDLE_SUMMARY_MS}ms)`,
    );
  }

  _stopA2aIdleSummaryScan() {
    if (this._a2aIdleScanTimer) {
      clearInterval(this._a2aIdleScanTimer);
      this._a2aIdleScanTimer = null;
    }
  }

  /**
   * Track activity for inbound / auto_discovery-style sessions (not user→remote-bot UI sessions).
   * @param {string} sessionId
   */
  _touchA2aIdleSummaryActivity(sessionId) {
    const sid = sessionId != null ? String(sessionId).trim() : "";
    if (!sid) return;
    if (this._isUserOutboundSession(sid)) return;
    const session = this.sessions.get(sid);
    if (!session?.localChatId) return;
    if (session.state === "ended") return;
    /** New traffic after an idle snapshot may warrant another idle summary or a later close summary. */
    this._a2aSessionSummaryDone.delete(sid);
    this._a2aIdleActivity.set(sid, Date.now());
  }

  async _scanA2aIdleForSummary() {
    if (!this._running) return;
    const now = Date.now();
    for (const [sessionId, lastAt] of [...this._a2aIdleActivity.entries()]) {
      if (now - lastAt < A2A_IDLE_SUMMARY_MS) continue;
      const session = this.sessions.get(sessionId);
      if (!session || session.state === "ended") {
        this._a2aIdleActivity.delete(sessionId);
        continue;
      }
      if (this._isUserOutboundSession(sessionId)) {
        this._a2aIdleActivity.delete(sessionId);
        continue;
      }
      if (this._a2aSessionSummaryDone.has(sessionId)) {
        this._a2aIdleActivity.delete(sessionId);
        continue;
      }
      this._a2aIdleActivity.delete(sessionId);
      this._line(`[a2a-idle-summary] firing session=${sessionId}`);
      await this._runA2aSessionClosedSummary(sessionId, session, "idle_timeout", { trigger: "idle" });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SSE event handlers (called by InboundHandler)
  // ═══════════════════════════════════════════════════════════════════════════

  async handleSessionOpened(event) {
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    const sessionId = event.sessionId || payload.sessionId;
    const toAgentId = event.agentId || payload.toAgentId;
    const fromAgentId = payload.fromAgentId;

    if (!sessionId || !toAgentId) {
      console.warn(TAG, "session_opened missing sessionId or agentId (toAgent)", { sessionId, toAgentId, payload });
      return;
    }

    if (!this._registeredAgentIds.includes(toAgentId)) {
      console.warn(TAG, `session_opened for unknown local agent: ${toAgentId}`);
      return;
    }

    let localChatId = null;
    try {
      const { chatId } = this.chatRepo.getOrCreateChatForChannel({
        contactId: toAgentId,
        channelType: "a2a",
        channelChatId: sessionId,
      });
      localChatId = chatId;
    } catch (e) {
      console.warn(TAG, "create local chat failed:", e.message);
    }

    this.sessions.register({
      sessionId,
      fromAgentId,
      toAgentId,
      localAgentId: toAgentId,
      remoteAgentId: fromAgentId,
      localChatId,
      state: "pending",
      maxTurns: 20,
      sessionOrigin: "inbound",
    });
    this._touchA2aIdleSummaryActivity(sessionId);

    console.log(TAG, `Session opened: ${sessionId} (${fromAgentId} → ${toAgentId})`);
    this._pushSessionEvent("session_opened", { sessionId, fromAgentId, toAgentId });
  }

  _recoverSessionFromMessageIn(event) {
    const sessionId = event.sessionId;
    const toAgentId = event.agentId;
    const message = event.payload || {};
    const senderId = message.senderId;
    if (!sessionId || !toAgentId || !senderId) return false;
    if (!this._registeredAgentIds.includes(toAgentId)) return false;

    const fromAgentId = senderId;

    let localChatId = null;
    try {
      const { chatId } = this.chatRepo.getOrCreateChatForChannel({
        contactId: toAgentId,
        channelType: "a2a",
        channelChatId: sessionId,
      });
      localChatId = chatId;
    } catch (e) {
      console.warn(TAG, "recover session: create local chat failed:", e.message);
    }

    this.sessions.register({
      sessionId,
      fromAgentId,
      toAgentId,
      localAgentId: toAgentId,
      remoteAgentId: fromAgentId,
      localChatId,
      state: "pending",
      maxTurns: 20,
      sessionOrigin: "inbound",
    });
    this._touchA2aIdleSummaryActivity(sessionId);
    this._line(`Session ${sessionId} recovered from message_in (peer=${fromAgentId})`);
    return true;
  }

  /** @param {{ sessionId: string, agentId?: string, payload?: object }} event */
  async handleInboundMessage(event) {
    const sessionId = event.sessionId;
    const message = event.payload || {};

    let session = this.sessions.get(sessionId);
    if (!session) {
      this._recoverSessionFromMessageIn(event);
      session = this.sessions.get(sessionId);
    }
    if (!session) {
      console.warn(TAG, `Inbound message for unknown session: ${sessionId}`);
      return;
    }

    if (session.state === "pending") {
      this.sessions.setState(sessionId, "running");
    }

    const localAgentId = session.localAgentId;
    const content = message.content || "";

    console.log(TAG, `Inbound message for ${localAgentId} in session ${sessionId} (origin=${session.sessionOrigin})`);

    const isUserOutboundSession = this._isUserOutboundSession(sessionId);
    const inboundSeq = message.seq != null ? Number(message.seq) : null;

    if (isUserOutboundSession && inboundSeq != null) {
      const dk = `${sessionId}:${inboundSeq}`;
      if (this._remoteReplyDedupe.has(dk)) {
        console.log(TAG, `duplicate remote reply skipped (SSE/poll dedupe seq=${inboundSeq})`);
        return;
      }
      this._remoteReplyDedupe.add(dk);
      this._trimRemoteReplyDedupe();
    }

    if (session.localChatId) {
      this._cacheInboundMessage(session.localChatId, content, isUserOutboundSession ? session.remoteAgentId : null);
    }
    if (!isUserOutboundSession) {
      this._touchA2aIdleSummaryActivity(sessionId);
    }
    this._pushSessionEvent("message_in", {
      sessionId,
      chatId: session.localChatId || null,
      senderId: message.senderId,
      content,
    });

    if (isUserOutboundSession) {
      console.log(TAG, `Remote bot reply received (session=${sessionId}), forwarding to renderer`, {
        chatId: session.localChatId,
        contentLen: content.length,
        contentPreview: content.slice(0, 80),
      });
      return;
    }

    try {
      const sessionKey = `a2a:${sessionId}`;
      const isAutoDiscovery = session.sessionOrigin === "auto_discovery";
      await this._ensureBotSession(sessionKey, localAgentId, {
        conversationGoal: isAutoDiscovery ? session.conversationGoal : null,
        sessionOrigin: session.sessionOrigin,
        remoteAgentId: session.remoteAgentId,
      });
      const reply = await this._getAgentReply(sessionKey, content);

      if (reply) {
        const hasEndSignal = this.adapter.detectEndSignal(reply);
        const cleanReply = hasEndSignal ? this.adapter.stripEndSignal(reply) : reply;

        this.sessions.recordTurn(sessionId);

        if (cleanReply) {
          await this.outbound.sendMessage(sessionId, cleanReply, localAgentId, session.localChatId);
          this._touchA2aIdleSummaryActivity(sessionId);
          console.log(TAG, `Sent reply (session=${sessionId})`);
          this._pushSessionEvent("message_out", { sessionId, senderId: localAgentId, content: cleanReply });
        }

        if (hasEndSignal || this.sessions.shouldEnd(sessionId)) {
          const reason = hasEndSignal ? "completed" : "max_turns";
          console.log(TAG, `Session ${sessionId} ending (reason=${reason} turns=${session.turnCount})`);
          try {
            await this.closeSessionFromLocal(sessionId, reason);
          } catch (e) {
            console.warn(TAG, `closeSession failed for ${sessionId}:`, e.message);
            this.sessions.setState(sessionId, "ended");
            this._cleanupEngineSession(sessionKey);
          }
        }
      }
    } catch (e) {
      console.error(TAG, `Engine processing failed for session ${sessionId}:`, e.message);
      try {
        await this.outbound.sendMessage(
          sessionId,
          "Sorry, I encountered an error processing your message.",
          localAgentId,
          session.localChatId,
        );
      } catch (_) {}
    }
  }

  async handleSessionClosed(event) {
    const payload = event.payload || event;
    const sessionId = payload.sessionId || event.sessionId;
    const reason = payload.reason || "completed";

    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.setState(sessionId, "ended");
      this._cleanupEngineSession(`a2a:${sessionId}`);
      console.log(TAG, `Session closed: ${sessionId}`);
      this._pushSessionEvent("session_closed", { sessionId, reason });
      void this._runA2aSessionClosedSummary(sessionId, session, reason);
    }
  }

  /**
   * Gateway close from this client: notify Gateway, mark ended, cleanup Pi session, trigger summary (deduped with SSE session_closed).
   * @param {string} sessionId
   * @param {string} reason
   * @returns {Promise<any>} gateway close response body
   */
  async closeSessionFromLocal(sessionId, reason) {
    const sid = sessionId != null ? String(sessionId).trim() : "";
    if (!sid) throw new Error("sessionId is required");
    const session = this.sessions.get(sid);
    const data = await this.outbound.closeSession(sid, reason);
    if (session) {
      this.sessions.setState(sid, "ended");
      this._cleanupEngineSession(`a2a:${sid}`);
    }
    void this._runA2aSessionClosedSummary(sid, session, reason);
    return data;
  }

  /**
   * Pi summary + files + default-assistant notification. Used for session close and for bot-owner idle (30min).
   * @param {{ trigger?: "close"|"idle" }} [options]
   * @private
   */
  async _runA2aSessionClosedSummary(sessionId, session, reason, options = {}) {
    const trigger = options.trigger === "idle" ? "idle" : "close";
    try {
      if (this._a2aSessionSummaryDone.has(sessionId)) return;
      if (!session?.localChatId) {
        this._line(`[a2a-summary] skip (no localChatId) session=${sessionId}`);
        return;
      }

      const localChatId = session.localChatId;
      const localAgentId = session.localAgentId;
      const remoteAgentId = session.remoteAgentId;

      const historyRows = this.chatRepo.getMessages({ chatId: localChatId, limit: 200 });
      const messages = (historyRows?.items || []).reverse();
      if (messages.length === 0) {
        this._line(`[a2a-summary] no messages session=${sessionId}`);
        return;
      }

      this._a2aSessionSummaryDone.add(sessionId);

      const transcript = messages.map((m) => `[${m.sender}] ${m.content}`).join("\n\n");

      const botContact = this.contactRepo.getById(localAgentId);
      const botName = botContact?.name || localAgentId;

      const appState = this.appStateStore ? await this.appStateStore.getState() : {};
      const workDir = resolveWorkDirForSummary(appState?.workspaceRoot) || DEFAULT_WORKSPACE_FOR_SUMMARY;

      const safeSession = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const suffix = trigger === "idle" ? "_idle" : "";
      const summaryDir = path.join(
        workDir,
        "a2a-summaries",
        botName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff -]/g, "_"),
        `${dateStr}_${safeSession}${suffix}`,
      );

      await fsp.mkdir(summaryDir, { recursive: true });
      const transcriptPath = path.join(summaryDir, "transcript.md");
      const summaryPath = path.join(summaryDir, "summary.md");
      const metaPath = path.join(summaryDir, "meta.json");

      const startTime = new Date(session.createdAt).toISOString();
      const endTime = new Date().toISOString();

      const triggerLine =
        trigger === "idle"
          ? `**Summary trigger:** idle (${Math.round(A2A_IDLE_SUMMARY_MS / 60000)} min no activity; session may still be open)`
          : `**Closed (reason):** ${reason}`;

      await fsp.writeFile(
        transcriptPath,
        [
          "# A2A conversation transcript",
          "",
          `**Bot:** ${botName}`,
          `**Gateway session:** ${sessionId}`,
          `**Peer agent:** ${remoteAgentId || "(unknown)"}`,
          `**Origin:** ${session.sessionOrigin}`,
          triggerLine,
          `**Period:** ${startTime} — ${endTime}`,
          "",
          "---",
          "",
          transcript,
          "",
        ].join("\n"),
        "utf8",
      );

      const scenarioExtra =
        trigger === "idle"
          ? `会话已连续约 ${Math.round(A2A_IDLE_SUMMARY_MS / 60000)} 分钟无新消息；网关会话可能仍未关闭，本摘要为空闲快照。`
          : "";
      const scenarioDescription = [
        `这是 Agent "${botName}" 的 **A2A** 会话（gateway session \`${sessionId}\`，对端 \`${remoteAgentId || "unknown"}\`）。`,
        scenarioExtra,
      ].filter(Boolean).join(" ");

      const summaryKeyPrefix =
        trigger === "idle"
          ? `summary:a2a:${sessionId}:idle`
          : `summary:a2a:${sessionId}`;

      let summaryText = "";
      try {
        summaryText = await summarizeTranscriptWithDefaultPiAssistant(
          {
            contactRepository: this.contactRepo,
            assistantConfigRepository: this.assistantConfigRepo,
            appStateStore: this.appStateStore,
          },
          {
            transcript,
            botName,
            channelType: "a2a",
            scenarioDescription,
            summarySessionKeyPrefix: summaryKeyPrefix,
          },
        );
      } catch (err) {
        this._line(`[a2a-summary] LLM failed: ${err?.message || err}`);
        summaryText =
          `## A2A 会话摘要\n\n- **Agent:** ${botName}\n- **会话:** ${sessionId}\n- **消息数:** ${messages.length}\n\n> 自动摘要生成失败，请查看 transcript.md`;
      }

      await fsp.writeFile(summaryPath, `${summaryText}\n`, "utf8");
      await fsp.writeFile(
        metaPath,
        `${JSON.stringify(
          {
            gatewaySessionId: sessionId,
            localAgentId,
            remoteAgentId,
            localChatId,
            sessionOrigin: session.sessionOrigin,
            reason,
            summaryTrigger: trigger === "idle" ? "idle_timeout" : "session_close",
            messageCount: messages.length,
            summarySentAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const condensed = summaryText.slice(0, 1000);
      const startShort = startTime.slice(0, 19).replace("T", " ");
      const endShort = endTime.slice(0, 19).replace("T", " ");
      const notificationContent =
        trigger === "idle"
          ? [
              `📋 **A2A 会话空闲摘要通知**`,
              "",
              `你的 Agent **${botName}** 与对端的一段 A2A 对话已连续约 **${Math.round(A2A_IDLE_SUMMARY_MS / 60000)} 分钟**无新消息，已用默认助手模型生成摘要（会话未必已关闭）。`,
              "",
              `- **Gateway 会话 id：** ${sessionId}`,
              `- **对端 agent id：** ${remoteAgentId || "—"}`,
              `- **时间段（快照）：** ${startShort} — ${endShort}`,
              "",
              "**摘要：**",
              condensed,
              "",
              `📁 **摘要文件：** ${summaryPath}`,
              `📁 **完整记录：** ${transcriptPath}`,
            ].join("\n")
          : [
              `📋 **A2A 会话总结通知**`,
              "",
              `你的 Agent **${botName}** 的 A2A 会话已结束（本地关闭或网关 \`session_closed\`）。`,
              "",
              `- **Gateway 会话 id：** ${sessionId}`,
              `- **对端 agent id：** ${remoteAgentId || "—"}`,
              `- **结束原因：** ${reason}`,
              `- **时间段：** ${startShort} — ${endShort}`,
              "",
              "**摘要：**",
              condensed,
              "",
              `📁 **摘要文件：** ${summaryPath}`,
              `📁 **完整记录：** ${transcriptPath}`,
            ].join("\n");

      appendToDefaultAssistantMainChat(
        { contactRepository: this.contactRepo, chatRepository: this.chatRepo },
        { content: notificationContent },
      );
      this._line(`[a2a-summary] done (${trigger}) session=${sessionId} → ${summaryDir}`);
    } catch (e) {
      this._line(`[a2a-summary] error session=${sessionId}: ${e?.message || e}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IPC-facing methods (called by A2AIpcBridge for user actions in UI)
  // ═══════════════════════════════════════════════════════════════════════════

  async sendUserMessage(sessionId, content) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found: " + sessionId);
    const result = await this.outbound.sendMessage(sessionId, content, session.localAgentId, session.localChatId);
    this._touchA2aIdleSummaryActivity(sessionId);
    return result;
  }

  async openUserSession(fromAgentId, toAgentId) {
    return this.outbound.initiateSession(fromAgentId, toAgentId, null);
  }

  /**
   * Send a user's message to a remote bot via the A2A Gateway.
   * Opens a session if one doesn't already exist for this chatId.
   * @returns {{ sessionId: string, messageId: string, seq: number }}
   */
  async sendToRemoteBot({ chatId, toAgentId, content }) {
    if (!chatId || !toAgentId || !content) {
      throw new Error("chatId, toAgentId, and content are required");
    }
    if (!this._registeredAgentIds.length) {
      throw new Error("No local agents registered — create a bot first");
    }
    const localAgentId = this._registeredAgentIds[0];

    let sessionId = this._chatToA2ASession.get(chatId);
    if (!sessionId) {
      const session = await this.outbound.initiateSession(localAgentId, toAgentId, null);
      sessionId = session.sessionId;
      this._chatToA2ASession.set(chatId, sessionId);
      this.sessions.register({
        sessionId,
        fromAgentId: localAgentId,
        toAgentId,
        localAgentId,
        remoteAgentId: toAgentId,
        localChatId: chatId,
        maxTurns: 100,
        sessionOrigin: "user_outbound",
      });
      console.log(TAG, `opened outbound session ${sessionId} for chat ${chatId}`);
    }

    const session = this.sessions.get(sessionId);
    const senderId = session?.localAgentId || localAgentId;
    const result = await this.client.sendMessage({
      sessionId,
      content,
      contentType: "text/plain",
      senderType: "agent",
      senderId,
    });

    console.log(TAG, `user message sent to remote bot session=${sessionId} seq=${result.seq}`);
    void this._pollRemoteBotReplyAfterSend(sessionId, result.seq, chatId, toAgentId);
    return { sessionId, messageId: result.messageId, seq: result.seq };
  }

  /**
   * @private
   */
  async _pollRemoteBotReplyAfterSend(sessionId, afterSeq, chatId, remoteAgentId) {
    const delayMs = 500;
    const maxAttempts = 90;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, delayMs));
      if (!this._running) return;
      let rows;
      try {
        rows = await this.client.fetchMessages(sessionId, afterSeq);
      } catch {
        continue;
      }
      if (!Array.isArray(rows) || rows.length === 0) continue;

      for (const row of rows) {
        const senderId = row.sender_id || row.senderId;
        const seq = row.seq != null ? Number(row.seq) : null;
        const text = row.content != null ? String(row.content) : "";
        if (!senderId || String(senderId) !== String(remoteAgentId)) continue;
        if (seq == null || seq <= afterSeq) continue;

        const dk = `${sessionId}:${seq}`;
        if (this._remoteReplyDedupe.has(dk)) return;
        this._remoteReplyDedupe.add(dk);
        this._trimRemoteReplyDedupe();

        const session = this.sessions.get(sessionId);
        const localChatId = session?.localChatId || chatId;
        if (localChatId) {
          this._cacheInboundMessage(localChatId, text, remoteAgentId);
        }
        this._pushSessionEvent("message_in", {
          sessionId,
          chatId: localChatId || null,
          senderId,
          content: text,
        });
        console.log(TAG, `Remote bot reply delivered via poll (session=${sessionId} seq=${seq})`);
        return;
      }
    }
    console.warn(TAG, `poll: no remote reply within ${(maxAttempts * delayMs) / 1000}s session=${sessionId}`);
  }

  async discoverAgents(query) {
    return this.client.discover(query);
  }

  /**
   * Run one auto-discovery tick for a bot now (UI manual trigger).
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async triggerManualAutoDiscovery(agentId) {
    const id = agentId != null ? String(agentId).trim() : "";
    if (!id) return { ok: false, error: "agentId is required" };
    if (!this._running) return { ok: false, error: "A2A is not running" };
    if (!this._registeredAgentIds.includes(id)) {
      return { ok: false, error: "This bot is not in the registered local agent list" };
    }
    const strategy = this._getStrategyForBot(id);
    if (!strategy?.autoDiscover) {
      return { ok: false, error: "Turn on Auto discovery and save strategy for this bot first" };
    }
    if (!this._contactHistory) {
      return { ok: false, error: "Local DB unavailable (contact history)" };
    }
    this._line(`[manual-discovery] running tick for bot ${id}`);
    const sched = this._scheduler
      || new AutoDiscoveryScheduler({
        orchestrator: this,
        contactHistoryTracker: this._contactHistory,
      });
    await sched.runSingleTick(id, strategy);
    return { ok: true };
  }

  async fetchSessionMessages(sessionId, afterSeq) {
    return this.client.fetchMessages(sessionId, afterSeq);
  }

  getStatus() {
    return {
      running: this._running,
      connectionState: this.client.connectionState,
      registeredAgents: this._registeredAgentIds.length,
      activeSessions: this.sessions.listActive().length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Engine integration (same pattern as channel adapters)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ensure an engine session exists for the given sessionKey.
   * For auto_discovery sessions, appends conversationGoal to the system prompt
   * using a separate engine session key so normal conversations are unaffected.
   *
   * @param {string} sessionKey
   * @param {string} contactId
   * @param {object} [a2aOpts]
   * @param {string|null} [a2aOpts.conversationGoal] — auto_discovery goal text
   * @param {"inbound"|"user_outbound"|"auto_discovery"|string} [a2aOpts.sessionOrigin]
   * @param {string|null} [a2aOpts.remoteAgentId]
   */
  async _ensureBotSession(sessionKey, contactId, a2aOpts = {}) {
    const { getEngineForContact } = require("../conversation/engineRegistry.cjs");
    const { getRunner } = require("../conversation/PiConversationEngine.cjs");
    const runner = await getRunner();

    if (runner.hasSession(sessionKey)) return;

    const { engine, rawConfig, assistantConfigId, defaultContactId } = getEngineForContact(
      contactId,
      { contactRepository: this.contactRepo, assistantConfigRepository: this.assistantConfigRepo },
    );

    console.log(TAG, `_ensureBotSession config:`, {
      contactId,
      assistantConfigId,
      hasSystemPrompt: !!(rawConfig?.systemPrompt),
      systemPromptLength: (rawConfig?.systemPrompt || "").length,
      systemPromptPreview: (rawConfig?.systemPrompt || "").slice(0, 200),
      skills: rawConfig?.skills ? Object.keys(rawConfig.skills) : [],
    });

    const models = Array.isArray(rawConfig?.models) ? rawConfig.models : [];
    const activeModel = models.find((m) => m && m.active) || models[0];
    if (!activeModel?.provider || !activeModel?.model) {
      throw new Error(`No model configured for contact ${contactId}`);
    }

    let apiKey = (activeModel.apiKey && String(activeModel.apiKey).trim()) || "";
    if (!apiKey && this.assistantConfigRepo?.getModelApiKeyFromConfig) {
      apiKey = this.assistantConfigRepo.getModelApiKeyFromConfig(assistantConfigId, activeModel.id) || "";
    }
    if (!apiKey && assistantConfigId !== defaultContactId && this.assistantConfigRepo?.getModelApiKeyFromConfig) {
      apiKey = this.assistantConfigRepo.getModelApiKeyFromConfig(defaultContactId, activeModel.id) || "";
    }
    if (!apiKey) {
      throw new Error(`No API key for contact ${contactId}`);
    }

    const { ensureBotWorkplace } = require("../creezPaths.cjs");
    const workDir = ensureBotWorkplace(this.creezHome, contactId);
    const agentDir = this.creezHome;

    const memory = this.memoryStore ? await this.memoryStore.read() : { content: "", path: "" };

    const {
      conversationGoal = null,
      sessionOrigin = null,
      remoteAgentId = null,
    } = a2aOpts && typeof a2aOpts === "object" ? a2aOpts : {};

    const localDisplayName = this._resolveLocalBotDisplayName(contactId);
    let peerDisplayName = "Unknown peer";
    let peerCardSummary = "";
    if (remoteAgentId) {
      const peer = await this._resolvePeerDisplayForPrompt(remoteAgentId);
      peerDisplayName = peer.displayName;
      peerCardSummary = peer.cardSummary;
    }

    // 1. Creator's system prompt is the primary identity / personality
    const creatorPrompt = (rawConfig?.systemPrompt && String(rawConfig.systemPrompt).trim()) || "";

    // 2. A2A session context (who you are, who you're talking to)
    const sessionContext =
      sessionOrigin === "inbound" || sessionOrigin === "auto_discovery"
        ? buildA2aRoleContextPrompt(sessionOrigin, localDisplayName, peerDisplayName, peerCardSummary)
        : "";

    // 3. A2A rules (behavioral guidelines for the network interaction)
    let a2aRules = "";
    if (sessionOrigin === "auto_discovery") {
      a2aRules = A2A_INITIATOR_AGENT_PROMPT;
    } else if (sessionOrigin === "inbound") {
      a2aRules = A2A_RESPONDER_AGENT_PROMPT;
    }

    // 4. Auto-discovery conversation goal (if applicable)
    const goalBlock = conversationGoal
      ? GOAL_PROMPT_SUFFIX.replace("{GOAL}", String(conversationGoal))
      : "";

    // Compose: creator prompt → context → rules → goal
    const finalPrompt = [creatorPrompt, sessionContext, a2aRules, goalBlock]
      .filter(Boolean)
      .join("\n");

    console.log(TAG, `_ensureBotSession prompt composition:`, {
      creatorPromptLength: creatorPrompt.length,
      creatorPromptPreview: creatorPrompt.slice(0, 300),
      hasSessionContext: !!sessionContext,
      hasA2aRules: !!a2aRules,
      hasGoal: !!goalBlock,
      finalPromptLength: finalPrompt.length,
    });

    let effectiveConfig = rawConfig;
    if (sessionContext || a2aRules || goalBlock) {
      effectiveConfig = { ...rawConfig, systemPrompt: finalPrompt };
    }

    await engine.init({
      chatId: sessionKey,
      sessionKey,
      contactId,
      assistantConfigId,
      defaultContactId,
      assistantConfig: effectiveConfig,
      provider: activeModel.provider,
      modelId: activeModel.model,
      apiKey,
      workDir,
      agentDir,
      memoryContent: memory.content || "",
      memoryPath: memory.path || "",
      sendEvent: () => {},
      sendError: () => {},
    });
  }

  /**
   * Prompt the engine and collect the assistant reply.
   * @returns {string|null}
   */
  async _getAgentReply(sessionKey, text) {
    const { getRunner } = require("../conversation/PiConversationEngine.cjs");
    const { getEngineForContact } = require("../conversation/engineRegistry.cjs");
    const runner = await getRunner();

    let replyContent = "";
    const listenerId = `a2a:${sessionKey}:${Date.now()}`;

    const collector = {
      send(channel, data) {
        if (channel === "agent:eventError") return;
        if (data.type === "message_end" && data.message?.content) {
          const c = data.message.content;
          replyContent = typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c.filter((x) => x.type === "text").map((x) => x.text).join("")
              : "";
        }
      },
      isDestroyed() { return false; },
    };

    const { engine } = getEngineForContact(null, {
      contactRepository: this.contactRepo,
      assistantConfigRepository: this.assistantConfigRepo,
    });

    runner.addListener(sessionKey, listenerId, collector);
    try {
      console.log(TAG, "Engine processing...");
      await engine.prompt({ chatId: sessionKey, text, images: [] });
    } finally {
      runner.removeListener(sessionKey, listenerId);
    }

    return replyContent || null;
  }

  /** @private */
  _cleanupEngineSession(sessionKey) {
    const { getRunner } = require("../conversation/PiConversationEngine.cjs");
    getRunner().then((runner) => {
      if (runner.abort) runner.abort(sessionKey);
    }).catch(() => {});
  }

  /** @private — is this a session the user opened to talk to a remote bot? */
  _isUserOutboundSession(sessionId) {
    for (const [, sid] of this._chatToA2ASession) {
      if (sid === sessionId) return true;
    }
    return false;
  }

  /** @private */
  _cacheInboundMessage(localChatId, content, remoteBotId) {
    try {
      const nowTs = Math.floor(Date.now() / 1000);
      this.chatRepo.appendMessage({
        id: randomUUID(),
        chatId: localChatId,
        sender: remoteBotId ? "assistant" : "user",
        content,
        status: "done",
        botId: remoteBotId || null,
        createdAt: nowTs,
        updatedAt: nowTs,
        channelType: "a2a",
      });
    } catch (e) {
      console.warn(TAG, "cache inbound msg failed:", e.message,
        { localChatId, remoteBotId, contactExists: remoteBotId ? !!this.contactRepo?.getById(remoteBotId) : "n/a" });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-discovery scheduler management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch agents from the backend and sync a2a_strategy_json to local SQLite.
   * Solves the case where strategy was set on the backend but local DB is empty
   * (e.g. migration added the column after the strategy was saved).
   * @private
   */
  async _syncStrategiesFromBackend(bots) {
    if (!this.assistantConfigRepo) {
      this._line("[strategy-sync] no assistantConfigRepo — skip");
      return;
    }
    try {
      const result = await this.client.fetchOwnerAgents();
      const items = result?.items || result || [];
      this._line(`[strategy-sync] backend returned ${items.length} agent(s)`);

      const localBotIds = new Set(bots.map((b) => b.id));
      let synced = 0;

      for (const agent of items) {
        const id = agent.id;
        if (!id || !localBotIds.has(id)) continue;

        const remoteStrategy = agent.a2a_strategy_json;
        if (!remoteStrategy || typeof remoteStrategy !== "object") {
          this._line(`[strategy-sync] bot ${id}: backend has no strategy`);
          continue;
        }

        const localConfig = this.assistantConfigRepo.getRawConfigById(id);
        if (localConfig?.a2aStrategyJson && localConfig.a2aStrategyJson.autoDiscover != null) {
          this._line(`[strategy-sync] bot ${id}: local already has strategy (autoDiscover=${localConfig.a2aStrategyJson.autoDiscover}), skip`);
          continue;
        }

        this._line(`[strategy-sync] bot ${id}: syncing strategy from backend (autoDiscover=${remoteStrategy.autoDiscover})`);
        try {
          this.assistantConfigRepo.saveConfigById(id, { a2aStrategyJson: remoteStrategy });
          synced++;
        } catch (e) {
          console.warn(TAG, `[strategy-sync] saveConfigById failed for ${id}:`, e.message);
        }
      }

      if (synced > 0) {
        this._line(`[strategy-sync] synced ${synced} strategy(ies) from backend`);
      }
    } catch (e) {
      this._line(`[strategy-sync] fetch from backend failed: ${e.message} — using local data only`);
    }
  }

  /**
   * Start (or restart) the auto-discovery scheduler with strategy data from local bots.
   * @private
   */
  _startScheduler(bots) {
    if (this._scheduler) {
      this._scheduler.stop();
    }

    if (!this._contactHistory) {
      this._line("[scheduler] No db provided — auto-discovery scheduler disabled");
      return;
    }

    this._line(`[scheduler] Checking ${bots.length} local bot(s) for auto-discovery strategy...`);

    const botStrategies = [];
    for (const bot of bots) {
      const strategy = this._getStrategyForBot(bot.id);
      if (!strategy) {
        this._line(`[scheduler]   bot ${bot.id} (${bot.name}): no strategy in local DB`);
      } else if (!strategy.autoDiscover) {
        this._line(`[scheduler]   bot ${bot.id} (${bot.name}): strategy exists but autoDiscover=false`);
      } else {
        this._line(`[scheduler]   bot ${bot.id} (${bot.name}): autoDiscover=true, target="${strategy.targetDescription || ""}", interval=${strategy.scanIntervalMinutes}min`);
        botStrategies.push({ agentId: bot.id, strategy });
      }
    }

    if (botStrategies.length === 0) {
      this._line("[scheduler] No bots have auto-discovery enabled — scheduler idle");
      return;
    }

    this._scheduler = new AutoDiscoveryScheduler({
      orchestrator: this,
      contactHistoryTracker: this._contactHistory,
    });
    this._scheduler.start(botStrategies);
    this._line(`[scheduler] Auto-discovery scheduler started for ${botStrategies.length} bot(s)`);
  }

  /**
   * Read the strategy JSON for a bot from local assistant_config.
   * @private
   */
  _getStrategyForBot(botId) {
    try {
      if (!this.assistantConfigRepo) return null;
      const config = this.assistantConfigRepo.getRawConfigById(botId);
      if (config?.a2aStrategyJson) {
        const s = typeof config.a2aStrategyJson === "string"
          ? JSON.parse(config.a2aStrategyJson)
          : config.a2aStrategyJson;
        return s;
      }
    } catch (e) {
      console.warn(TAG, `getStrategyForBot ${botId} failed:`, e.message);
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internal helpers
  // ═══════════════════════════════════════════════════════════════════════════

  _pushSessionEvent(type, data) {
    try {
      this.sendToRenderer({ channel: "a2a:sessionEvent", type, ...data });
    } catch (_) {}
  }

  /** Display name for system prompt (contact + assistant config), not raw id. */
  _resolveLocalBotDisplayName(contactId) {
    const id = contactId != null ? String(contactId).trim() : "";
    if (!id) return "Local bot";
    try {
      const bot = this.contactRepo?.getById?.(id);
      const config = this.assistantConfigRepo?.getRawConfigById?.(id);
      const n = (bot?.name && String(bot.name).trim()) || (config?.name && String(config.name).trim());
      return n || id;
    } catch {
      return id;
    }
  }

  /**
   * Peer display name + one-line card description via Gateway GET /a2a/agents/card.
   * Falls back to local contact name (if user added that agent) then agent id.
   * @returns {{ displayName: string, cardSummary: string }}
   */
  async _resolvePeerDisplayForPrompt(remoteAgentId) {
    const id = remoteAgentId != null ? String(remoteAgentId).trim() : "";
    if (!id) return { displayName: "a user", cardSummary: "" };
    try {
      const data = await this.client.fetchPublicAgentCard(id);
      const card = data?.agentCard && typeof data.agentCard === "object" ? data.agentCard : {};
      const displayName =
        (data?.name && String(data.name).trim())
        || (card.name && String(card.name).trim());
      if (displayName) {
        const rawDesc = card.description != null ? String(card.description) : "";
        return { displayName, cardSummary: truncateOneLine(rawDesc, 400) };
      }
    } catch {
      /* gateway lookup failed — try local */
    }
    try {
      const contact = this.contactRepo?.getById?.(id);
      const fromContact = contact?.name && String(contact.name).trim();
      if (fromContact) return { displayName: fromContact, cardSummary: "" };
    } catch (_) {}
    // Visitor from miniapp: not a registered agent, use short ID prefix
    const shortId = id.length > 8 ? id.slice(0, 8) : id;
    return { displayName: `user (${shortId})`, cardSummary: "" };
  }

  _getLocalBots() {
    if (!this.contactRepo) return [];
    try {
      const { items = [] } = this.contactRepo.list({ type: "bot" }) || {};
      return items.filter((c) => {
        if (!c || c.type !== "bot") return false;
        const origin = c.botOrigin || c.bot_origin || "";
        return !origin || origin === "assistant" || origin === "author";
      });
    } catch (e) {
      console.warn(TAG, "list local bots failed:", e.message);
      return [];
    }
  }

  _buildAgentEntry(bot) {
    const config = this.assistantConfigRepo
      ? this.assistantConfigRepo.getRawConfigById(bot.id)
      : null;

    const name = bot.name || config?.name || "Unnamed Bot";
    const description = config?.systemPrompt
      ? config.systemPrompt.substring(0, 200)
      : "";

    const strategy = this._getStrategyForBot(bot.id);

    return {
      agentId: bot.id,
      agentCard: {
        name,
        description,
        url: "",
        version: "1.0",
        capabilities: {
          streaming: true,
          pushNotifications: false,
          stateTransitionHistory: false,
        },
        defaultInputModes: ["text/plain"],
        defaultOutputModes: ["text/plain"],
        skills: [],
      },
      strategy: strategy || undefined,
      openingMessage: strategy?.openingMessage || undefined,
      visibility: "public",
    };
  }
}

module.exports = { A2ASessionOrchestrator };
