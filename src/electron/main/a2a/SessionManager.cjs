/**
 * In-memory state machine for active A2A sessions on the local daemon.
 * Tracks which sessions are running, turn counts, and max-turns enforcement.
 */

const TAG = "[A2A:sessions]";

class SessionManager {
  constructor() {
    /** @type {Map<string, SessionEntry>} */
    this._sessions = new Map();
  }

  /**
   * Register a new A2A session.
   * @param {{
   *   sessionId: string,
   *   fromAgentId: string,
   *   toAgentId: string,
   *   localAgentId: string,
   *   remoteAgentId: string,
   *   localChatId?: string,
   *   state?: string,
   *   maxTurns?: number,
   *   sessionOrigin?: "inbound" | "user_outbound" | "auto_discovery",
   *   conversationGoal?: string,
   * }} opts
   * @returns {SessionEntry}
   */
  register(opts) {
    const {
      sessionId, fromAgentId, toAgentId,
      localAgentId, remoteAgentId,
      localChatId, state, maxTurns,
      sessionOrigin, conversationGoal,
    } = opts;

    const entry = {
      sessionId,
      fromAgentId,
      toAgentId,
      localAgentId,
      remoteAgentId,
      localChatId: localChatId || null,
      state: state || "pending",
      turnCount: 0,
      maxTurns: maxTurns != null ? maxTurns : 20,
      sessionOrigin: sessionOrigin || "inbound",
      conversationGoal: conversationGoal || "",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this._sessions.set(sessionId, entry);
    console.log(TAG, `registered session=${sessionId} origin=${entry.sessionOrigin} local=${localAgentId} remote=${remoteAgentId}`);
    return entry;
  }

  get(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  getByLocalChatId(chatId) {
    for (const s of this._sessions.values()) {
      if (s.localChatId === chatId) return s;
    }
    return null;
  }

  recordTurn(sessionId) {
    const s = this._sessions.get(sessionId);
    if (!s) return null;
    s.turnCount++;
    s.lastActivityAt = Date.now();
    return s;
  }

  shouldEnd(sessionId) {
    const s = this._sessions.get(sessionId);
    if (!s) return true;
    if (s.state === "ended") return true;
    if (s.maxTurns > 0 && s.turnCount >= s.maxTurns) return true;
    return false;
  }

  setState(sessionId, state) {
    const s = this._sessions.get(sessionId);
    if (!s) return;
    s.state = state;
    if (state === "running") s.lastActivityAt = Date.now();
  }

  remove(sessionId) {
    this._sessions.delete(sessionId);
  }

  listActive() {
    const result = [];
    for (const s of this._sessions.values()) {
      if (s.state !== "ended") result.push(s);
    }
    return result;
  }

  /**
   * Count active auto_discovery sessions initiated by a specific local agent.
   * @param {string} agentId
   * @returns {number}
   */
  getActiveCountByAgent(agentId) {
    let count = 0;
    for (const s of this._sessions.values()) {
      if (s.state !== "ended" && s.sessionOrigin === "auto_discovery" && s.localAgentId === agentId) {
        count++;
      }
    }
    return count;
  }

  clear() {
    this._sessions.clear();
  }
}

module.exports = { SessionManager };
