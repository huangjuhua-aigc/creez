/**
 * Periodically scans for discoverable agents and initiates auto-discovery sessions.
 *
 * Lifecycle: start() → tick() runs on interval → stop() on teardown.
 * Each tick iterates local bots that have autoDiscover enabled, discovers targets
 * from the Gateway, filters out self/offline/already-contacted, and opens sessions.
 */

const TAG = "[A2A:scheduler]";

class AutoDiscoveryScheduler {
  /**
   * @param {{
   *   orchestrator: import('./A2ASessionOrchestrator.cjs').A2ASessionOrchestrator,
   *   contactHistoryTracker: import('./ContactHistoryTracker.cjs').ContactHistoryTracker,
   * }} deps
   */
  constructor(deps) {
    this.orch = deps.orchestrator;
    this.history = deps.contactHistoryTracker;
    this._timers = new Map();
    this._running = false;
  }

  /**
   * Start the scheduler for all bots with auto-discovery enabled.
   * @param {Array<{ agentId: string, strategy: object }>} botStrategies
   */
  start(botStrategies) {
    this.stop();
    this._running = true;

    for (const { agentId, strategy } of botStrategies) {
      if (!strategy?.autoDiscover) continue;
      const intervalMs = (strategy.scanIntervalMinutes || 60) * 60_000;

      console.log(TAG, `scheduling bot ${agentId} every ${strategy.scanIntervalMinutes || 60}min`);

      const timer = setInterval(() => {
        if (!this._running) return;
        this._tick(agentId, strategy).catch((e) => {
          console.error(TAG, `tick error for ${agentId}:`, e.message);
        });
      }, intervalMs);

      this._timers.set(agentId, timer);

      setTimeout(() => {
        if (!this._running) return;
        this._tick(agentId, strategy).catch((e) => {
          console.error(TAG, `initial tick error for ${agentId}:`, e.message);
        });
      }, 5_000);
    }
  }

  stop() {
    this._running = false;
    for (const timer of this._timers.values()) {
      clearInterval(timer);
    }
    this._timers.clear();
  }

  /**
   * Run one discovery tick immediately (e.g. manual trigger from UI).
   * Does not depend on interval timers.
   */
  async runSingleTick(agentId, strategy) {
    const prev = this._running;
    this._running = true;
    try {
      await this._tick(agentId, strategy);
    } finally {
      this._running = prev;
    }
  }

  /**
   * One tick for a single bot: discover → filter → initiate sessions.
   * @private
   */
  async _tick(agentId, strategy) {
    if (!this._running) return;

    const activeSessions = this.orch.sessions.getActiveCountByAgent(agentId);
    const maxConcurrent = strategy.maxConcurrent || 2;
    if (activeSessions >= maxConcurrent) {
      console.log(TAG, `bot ${agentId}: ${activeSessions} active sessions (max ${maxConcurrent}), skip tick`);
      return;
    }

    const dailyCount = this.history.getTodayCount(agentId);
    const maxDaily = strategy.maxDailySessions || 10;
    if (dailyCount >= maxDaily) {
      console.log(TAG, `bot ${agentId}: daily limit reached (${dailyCount}/${maxDaily}), skip tick`);
      return;
    }

    let targets;
    try {
      const result = await this.orch.discoverAgents({
        q: strategy.targetDescription || "",
        limit: 20,
      });
      targets = result?.items || result || [];
    } catch (e) {
      console.warn(TAG, `discover failed for ${agentId}:`, e.message);
      return;
    }

    console.log(TAG, `bot ${agentId}: discover returned ${targets.length} candidate(s), query="${strategy.targetDescription || ""}"`);

    const registeredIds = new Set(this.orch._registeredAgentIds);
    const slotsAvailable = maxConcurrent - activeSessions;
    let initiated = 0;

    for (const target of targets) {
      if (initiated >= slotsAvailable) break;

      const targetId = target.agentId || target.id;
      if (!targetId) continue;

      if (registeredIds.has(targetId)) {
        console.log(TAG, `  skip ${targetId} (${target.name}): is self/local agent`);
        continue;
      }

      if (target.online === false) {
        console.log(TAG, `  skip ${targetId} (${target.name}): offline`);
        continue;
      }

      const targetUpdatedAt = target.updatedAt || target.updated_at || null;
      if (!this.history.shouldContact(agentId, targetId, targetUpdatedAt)) {
        console.log(TAG, `  skip ${targetId} (${target.name}): already contacted and not updated since`);
        continue;
      }

      try {
        await this._initiateAutoSession(agentId, targetId, strategy);
        initiated++;
        console.log(TAG, `auto-discovery: ${agentId} → ${targetId} session initiated`);
      } catch (e) {
        console.error(TAG, `auto-discovery initiation failed ${agentId}→${targetId}:`, e.message);
      }
    }

    if (initiated === 0) {
      console.log(TAG, `bot ${agentId}: no eligible targets found this tick`);
    }
  }

  /**
   * Open a session and send the opening message.
   * @private
   */
  async _initiateAutoSession(localAgentId, targetAgentId, strategy) {
    const session = await this.orch.outbound.initiateSession(
      localAgentId,
      targetAgentId,
      strategy.openingMessage || null,
    );
    const sessionId = session.sessionId;

    this.orch.sessions.register({
      sessionId,
      fromAgentId: localAgentId,
      toAgentId: targetAgentId,
      localAgentId,
      remoteAgentId: targetAgentId,
      localChatId: null,
      state: "running",
      maxTurns: strategy.maxTurns || 20,
      sessionOrigin: "auto_discovery",
      conversationGoal: strategy.conversationGoal || "",
    });

    this.history.record(localAgentId, targetAgentId, sessionId);
  }
}

module.exports = { AutoDiscoveryScheduler };
