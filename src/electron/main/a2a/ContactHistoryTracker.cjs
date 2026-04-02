/**
 * Tracks auto-discovery contact history in local SQLite.
 * Used by AutoDiscoveryScheduler to decide whether a bot should be re-contacted.
 *
 * Cooldown strategy (update-based):
 *   - If the target bot was never contacted → allow
 *   - If contacted before → only allow if target's updated_at > our last_contacted_at
 *     (meaning the bot has new content worth re-engaging)
 */

const { randomUUID } = require("node:crypto");

const TAG = "[A2A:history]";

class ContactHistoryTracker {
  /**
   * @param {import('better-sqlite3').Database} db — the local SQLite database instance
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Record that fromAgent contacted toAgent in a session.
   * Upserts into a2a_contact_history. Increments total_sessions on conflict.
   */
  record(fromAgentId, toAgentId, sessionId) {
    const now = new Date().toISOString();
    try {
      const stmt = this.db.prepare(`
        INSERT INTO a2a_contact_history (id, from_agent_id, to_agent_id, last_session_id, last_contacted_at, total_sessions, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(from_agent_id, to_agent_id) DO UPDATE SET
          last_session_id = excluded.last_session_id,
          last_contacted_at = excluded.last_contacted_at,
          total_sessions = a2a_contact_history.total_sessions + 1
      `);
      stmt.run(randomUUID(), fromAgentId, toAgentId, sessionId, now, now);
    } catch (e) {
      console.error(TAG, "record failed:", e.message);
    }
  }

  /**
   * Decide if fromAgent should contact toAgent again.
   * Returns true if:
   *   1. No prior contact exists, OR
   *   2. The target bot has been updated since the last contact (targetUpdatedAt > last_contacted_at)
   *
   * @param {string} fromAgentId
   * @param {string} toAgentId
   * @param {string} targetUpdatedAt — ISO timestamp from the Gateway (target bot's updated_at)
   * @returns {boolean}
   */
  shouldContact(fromAgentId, toAgentId, targetUpdatedAt) {
    try {
      const row = this.db.prepare(
        `SELECT last_contacted_at FROM a2a_contact_history WHERE from_agent_id = ? AND to_agent_id = ?`
      ).get(fromAgentId, toAgentId);

      if (!row) return true;

      if (!targetUpdatedAt) return false;

      const lastContacted = new Date(row.last_contacted_at).getTime();
      const targetUpdated = new Date(targetUpdatedAt).getTime();
      return targetUpdated > lastContacted;
    } catch (e) {
      console.warn(TAG, "shouldContact query failed:", e.message);
      return false;
    }
  }

  /**
   * Count how many auto-discovery sessions fromAgent has initiated today.
   * Used for daily-limit enforcement.
   * @param {string} fromAgentId
   * @returns {number}
   */
  getTodayCount(fromAgentId) {
    try {
      const row = this.db.prepare(
        `SELECT COUNT(*) AS cnt FROM a2a_contact_history
         WHERE from_agent_id = ? AND last_contacted_at >= date('now')`
      ).get(fromAgentId);
      return row?.cnt || 0;
    } catch (e) {
      console.warn(TAG, "getTodayCount failed:", e.message);
      return 0;
    }
  }
}

module.exports = { ContactHistoryTracker };
