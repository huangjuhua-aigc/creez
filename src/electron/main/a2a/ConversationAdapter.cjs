/**
 * Converts between A2A message format and the PiConversationEngine input/output.
 */

class ConversationAdapter {
  /**
   * A2A inbound message → Engine prompt input.
   * @param {{ content: string, contentType?: string }} a2aMessage
   * @returns {{ text: string, images: any[] }}
   */
  toEngineInput(a2aMessage) {
    return {
      text: a2aMessage.content || "",
      images: [],
    };
  }

  /**
   * Engine reply text → A2A outbound message fields.
   * @param {string} replyText
   * @returns {{ content: string, contentType: string }}
   */
  toA2AOutput(replyText) {
    return {
      content: typeof replyText === "string" ? replyText : String(replyText || ""),
      contentType: "text/plain",
    };
  }

  /**
   * Extract assistant reply text from a raw engine event (message_end).
   * Handles both string and array content formats.
   * @param {{ message?: { content?: string | Array } }} event
   * @returns {string}
   */
  extractReplyFromEvent(event) {
    const c = event?.message?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .filter((x) => x && x.type === "text")
        .map((x) => x.text || "")
        .join("");
    }
    return "";
  }

  /**
   * Check whether the reply text contains the [END] signal.
   * The agent outputs [END] when it judges the conversation goal is achieved
   * or the conversation should be closed.
   * @param {string} text
   * @returns {boolean}
   */
  detectEndSignal(text) {
    if (!text || typeof text !== "string") return false;
    return text.includes("[END]");
  }

  /**
   * Remove the [END] tag from the reply so the clean message is sent to the peer.
   * @param {string} text
   * @returns {string}
   */
  stripEndSignal(text) {
    if (!text || typeof text !== "string") return text || "";
    return text.replace(/\[END\]/gi, "").trim();
  }
}

module.exports = { ConversationAdapter };
