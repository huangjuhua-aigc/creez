import { asTextEnvelope, buildErrorEnvelope, buildSuccessEnvelope } from "../errorProtocol.mjs";

/**
 * Builtin tool: send a message to an external channel (Feishu, etc.) by user instruction.
 * runtimeContext.channelSend(channelType, { content }) is provided by ChannelManager.sendMessage.
 */
export function createChannelSendHandler(runtimeContext = {}) {
  const channelSend = runtimeContext.channelSend;

  return {
    id: "channel_send",
    async execute(args = {}) {
      const channel = String(args?.channel ?? "").trim().toLowerCase();
      const content = String(args?.content ?? "").trim();

      if (!channel) {
        const envelope = buildErrorEnvelope({
          toolName: "channel_send",
          code: "MISSING_CHANNEL",
          message: "channel is required (e.g. feishu).",
          retryable: false,
          nextAction: "Use channel 'feishu' when user asks to send via Feishu / 飞书.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "channel_send") }],
          details: envelope,
          isError: true,
        };
      }

      if (!content) {
        const envelope = buildErrorEnvelope({
          toolName: "channel_send",
          code: "MISSING_CONTENT",
          message: "content is required.",
          retryable: false,
          nextAction: "Extract the message body the user wants to send and pass it as content.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "channel_send") }],
          details: envelope,
          isError: true,
        };
      }

      if (typeof channelSend !== "function") {
        const envelope = buildErrorEnvelope({
          toolName: "channel_send",
          code: "CHANNEL_SEND_UNAVAILABLE",
          message: "Channel send is not available. Make sure the channel is enabled in Advanced Settings → Channel.",
          retryable: false,
          nextAction: "Ask user to enable the channel in Advanced Settings.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "channel_send") }],
          details: envelope,
          isError: true,
        };
      }

      try {
        const result = await channelSend(channel, { content });

        if (result?.ok) {
          const envelope = buildSuccessEnvelope({
            toolName: "channel_send",
            data: { channel, message_id: result.message_id },
          });
          return {
            content: [{ type: "text", text: asTextEnvelope(envelope, "channel_send") }],
            details: envelope,
          };
        }

        const envelope = buildErrorEnvelope({
          toolName: "channel_send",
          code: "SEND_FAILED",
          message: result?.error || "Send failed.",
          retryable: false,
          nextAction: "Check channel config in Advanced Settings → Channel and try again.",
          details: { channel, error: result?.error },
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "channel_send") }],
          details: envelope,
          isError: true,
        };
      } catch (err) {
        const envelope = buildErrorEnvelope({
          toolName: "channel_send",
          code: "CHANNEL_SEND_ERROR",
          message: err?.message || String(err),
          retryable: true,
          nextAction: "Retry or ask user to check channel configuration.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "channel_send") }],
          details: envelope,
          isError: true,
        };
      }
    },
  };
}
