/**
 * Sends outbound requests to the Gateway and caches messages locally.
 */

const { randomUUID } = require("node:crypto");

const TAG = "[A2A:outbound]";

class OutboundHandler {
  /**
   * @param {import('../A2AGatewayClient.cjs').A2AGatewayClient} client
   * @param {{ chatRepo?: object }} deps
   */
  constructor(client, deps = {}) {
    this.client = client;
    this.chatRepo = deps.chatRepo || null;
  }

  /**
   * Send a message to the Gateway and cache it locally.
   * @returns {{ messageId: string, seq: number }}
   */
  async sendMessage(sessionId, content, agentId, localChatId) {
    const result = await this.client.sendMessage({
      sessionId,
      content,
      contentType: "text/plain",
      senderType: "agent",
      senderId: agentId,
    });

    if (localChatId && this.chatRepo) {
      this._cacheMessage(localChatId, {
        content,
        sender: "assistant",
        botId: agentId,
        channelType: "a2a",
      });
    }

    console.log(TAG, `sent reply session=${sessionId} seq=${result.seq}`);
    return result;
  }

  /**
   * Initiate a new A2A session via the Gateway.
   */
  async initiateSession(fromAgentId, toAgentId, openingMessage) {
    const session = await this.client.openSession({
      sessionType: "agent_agent",
      fromAgentId,
      toAgentId,
    });

    if (openingMessage) {
      await this.sendMessage(session.sessionId, openingMessage, fromAgentId, null);
    }

    return session;
  }

  async closeSession(sessionId, reason = "completed") {
    return this.client.closeSession(sessionId, reason);
  }

  /** @private */
  _cacheMessage(chatId, msg) {
    if (!this.chatRepo) return;
    try {
      const nowTs = Math.floor(Date.now() / 1000);
      this.chatRepo.appendMessage({
        id: randomUUID(),
        chatId,
        sender: msg.sender,
        content: msg.content,
        status: "done",
        createdAt: nowTs,
        updatedAt: nowTs,
        botId: msg.botId || null,
        channelType: msg.channelType || "a2a",
      });
    } catch (e) {
      console.warn(TAG, "cache message failed:", e.message);
    }
  }
}

module.exports = { OutboundHandler };
