/**
 * Routes SSE events received from the Gateway to the appropriate
 * Orchestrator method.
 */

const TAG = "[A2A:inbound]";

class InboundHandler {
  /** @param {import('../A2ASessionOrchestrator.cjs').A2ASessionOrchestrator} orchestrator */
  constructor(orchestrator) {
    this.orch = orchestrator;
  }

  async onEvent(event) {
    const type = event.type || "unknown";

    switch (type) {
      case "session_opened": {
        const sid = event.payload?.sessionId || event.sessionId;
        console.log(TAG, `session_opened session=${sid}`);
        await this.orch.handleSessionOpened(event).catch((e) => {
          console.error(TAG, "handleSessionOpened error:", e.message);
        });
        break;
      }

      case "message_in": {
        console.log(TAG, `message_in session=${event.sessionId} sender=${event.payload?.senderId}`);
        await this.orch.handleInboundMessage(event).catch((e) => {
          console.error(TAG, "handleInboundMessage error:", e.message);
        });
        break;
      }

      case "session_closed": {
        const sid = event.sessionId || event.payload?.sessionId;
        console.log(TAG, `session_closed session=${sid}`);
        await this.orch.handleSessionClosed(event).catch((e) => {
          console.error(TAG, "handleSessionClosed error:", e.message);
        });
        break;
      }

      case "heartbeat_ack":
        break;

      case "error":
        console.error(TAG, "Gateway error:", event.payload);
        break;

      default:
        console.log(TAG, `unhandled event type: ${type}`);
    }
  }
}

module.exports = { InboundHandler };
