import { createRequire } from "node:module";
import { asTextEnvelope, buildErrorEnvelope, buildSuccessEnvelope } from "../errorProtocol.mjs";

const require = createRequire(import.meta.url);
const { GmailAuthRequiredError } = require("../../../google/gmailClient.cjs");

function errorResult({ code, message, retryable = false, nextAction = "", details = {} }) {
  const envelope = buildErrorEnvelope({
    toolName: "gmail",
    code,
    message,
    retryable,
    nextAction,
    details,
  });
  return { content: [{ type: "text", text: asTextEnvelope(envelope, "gmail") }], details: envelope, isError: true };
}

function successResult(data, text = "") {
  const envelope = buildSuccessEnvelope({ toolName: "gmail", data });
  return {
    content: [{ type: "text", text: `${asTextEnvelope(envelope, "gmail")}${text ? `\n\n${text}` : ""}` }],
    details: envelope,
  };
}

function formatList(data) {
  const lines = [`Gmail messages (${data.messages.length}/${data.resultSizeEstimate || data.messages.length}):`];
  for (const m of data.messages) {
    lines.push([
      `- id: ${m.id}`,
      `  from: ${m.from || "(unknown)"}`,
      `  to: ${m.to || ""}`,
      `  date: ${m.date || ""}`,
      `  subject: ${m.subject || "(no subject)"}`,
      `  snippet: ${m.snippet || ""}`,
    ].join("\n"));
  }
  if (data.nextPageToken) lines.push(`nextPageToken: ${data.nextPageToken}`);
  return lines.join("\n");
}

function formatRead(data) {
  return [
    `id: ${data.id}`,
    `from: ${data.from || ""}`,
    `to: ${data.to || ""}`,
    data.cc ? `cc: ${data.cc}` : "",
    `date: ${data.date || ""}`,
    `subject: ${data.subject || "(no subject)"}`,
    "",
    data.body || "",
  ].filter((line) => line !== "").join("\n");
}

function summarizeSendArgs(args = {}) {
  const to = Array.isArray(args.to) ? args.to.join(", ") : String(args.to || "");
  const cc = Array.isArray(args.cc) ? args.cc.join(", ") : String(args.cc || "");
  const bcc = Array.isArray(args.bcc) ? args.bcc.join(", ") : String(args.bcc || "");
  return [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : "",
    bcc ? `Bcc: ${bcc}` : "",
    `Subject: ${String(args.subject || "(no subject)")}`,
    "",
    String(args.body || "").slice(0, 4000),
  ].filter((line) => line !== "").join("\n");
}

function emitAuthRequired(runtimeContext, action) {
  if (typeof runtimeContext.emitBuiltinEvent === "function") {
    runtimeContext.emitBuiltinEvent({
      type: "gmail_auth_required",
      toolName: "gmail",
      action,
      title: "Connect Gmail",
      message: "Creez needs your Google authorization before this agent can use Gmail.",
    });
  }
}

async function waitForAuth(runtimeContext, action) {
  if (typeof runtimeContext.requestGmailAuth === "function") {
    const decision = await runtimeContext.requestGmailAuth({
      title: "Connect Gmail",
      message: "Creez needs your Google authorization before this agent can use Gmail.",
      action,
    });
    return { allowed: Boolean(decision?.allowed), reason: decision?.reason || "" };
  }
  emitAuthRequired(runtimeContext, action);
  return { allowed: false, reason: "Gmail authorization UI is unavailable." };
}

async function ensureSendApproval(runtimeContext, args) {
  if (typeof runtimeContext.requestApproval !== "function") {
    return { allowed: false, reason: "Approval UI is unavailable." };
  }
  return runtimeContext.requestApproval({
    kind: "gmail_send",
    action: "send_gmail_message",
    risk: "external_email_send",
    title: "Send Gmail message?",
    message: "The agent wants to send an email from your connected Gmail account.",
    command: summarizeSendArgs(args),
  });
}

export function createGmailHandler(runtimeContext = {}) {
  return {
    id: "gmail",
    async execute(args = {}) {
      const action = String(args?.action || "list").trim().toLowerCase();
      const gmailClient = runtimeContext.gmailClient;
      if (!gmailClient) {
        return errorResult({
          code: "GMAIL_UNAVAILABLE",
          message: "Gmail client is not available in this Creez session.",
          nextAction: "Tell the user Gmail is not configured in this build.",
        });
      }

      try {
        const executeGmailAction = async () => {
          if (action === "list") {
            const data = await gmailClient.listMessages({
              query: args.query || "",
              maxResults: args.maxResults || 10,
              pageToken: args.pageToken || "",
            });
            return successResult({ action, ...data }, formatList(data));
          }

          if (action === "read") {
            const data = await gmailClient.readMessage({
              id: args.id || args.messageId,
              maxChars: args.maxChars || 20000,
            });
            return successResult({ action, message: data }, formatRead(data));
          }

          if (action === "send") {
            if (typeof gmailClient.ensureAccessToken === "function") {
              await gmailClient.ensureAccessToken();
            }
            const approval = await ensureSendApproval(runtimeContext, args);
            if (!approval?.allowed) {
              return errorResult({
                code: "USER_DENIED",
                message: approval?.reason || "User denied Gmail send.",
                nextAction: "Do not send the email. Tell the user it was not sent.",
              });
            }
            const data = await gmailClient.sendMessage(args);
            return successResult({ action, sent: data }, `Email sent.\nid: ${data.id}\nthreadId: ${data.threadId}`);
          }

          return null;
        };

        if (action === "connect") {
          const decision = await waitForAuth(runtimeContext, action);
          if (!decision.allowed) {
            return errorResult({
              code: "USER_CANCELLED",
              message: decision.reason || "User cancelled Gmail authorization.",
              nextAction: "Do not use Gmail until the user authorizes it.",
            });
          }
          const status = typeof gmailClient.getStatus === "function"
            ? gmailClient.getStatus()
            : { connected: false };
          return successResult({ action, status }, `Gmail connected as ${status.googleEmail || "(unknown account)"}.`);
        }

        if (action === "status") {
          const status = typeof gmailClient.getStatus === "function"
            ? gmailClient.getStatus()
            : { connected: false };
          if (!status?.connected) {
            const decision = await waitForAuth(runtimeContext, action);
            if (!decision.allowed) {
              return errorResult({
                code: "USER_CANCELLED",
                message: decision.reason || "User cancelled Gmail authorization.",
                nextAction: "Do not use Gmail until the user authorizes it.",
              });
            }
            const nextStatus = typeof gmailClient.getStatus === "function"
              ? gmailClient.getStatus()
              : { connected: false };
            if (!nextStatus?.connected) {
              return errorResult({
                code: "NEED_GOOGLE_AUTH",
                message: "Gmail is not connected yet.",
                retryable: true,
                nextAction: "Ask the user to finish Gmail authorization, then retry.",
                details: { provider: "google", scopes: ["gmail.readonly", "gmail.send"] },
              });
            }
            return successResult({ action, status: nextStatus }, `Gmail connected as ${nextStatus.googleEmail || "(unknown account)"}.`);
          }
          return successResult({ action, status }, `Gmail connected as ${status.googleEmail || "(unknown account)"}.`);
        }

        const operationResult = await executeGmailAction();
        if (operationResult) return operationResult;

        return errorResult({
          code: "INVALID_ARGUMENT",
          message: "action must be one of: connect, status, list, read, send.",
          nextAction: "Call gmail with action=connect, action=status, action=list, action=read, or action=send.",
        });
      } catch (error) {
        if (error instanceof GmailAuthRequiredError || error?.code === "NEED_GOOGLE_AUTH") {
          const decision = await waitForAuth(runtimeContext, action);
          if (!decision.allowed) {
            return errorResult({
              code: "USER_CANCELLED",
              message: decision.reason || "User cancelled Gmail authorization.",
              nextAction: "Do not use Gmail until the user authorizes it.",
            });
          }
          try {
            if (action === "list") {
              const data = await gmailClient.listMessages({
                query: args.query || "",
                maxResults: args.maxResults || 10,
                pageToken: args.pageToken || "",
              });
              return successResult({ action, ...data }, formatList(data));
            }
            if (action === "read") {
              const data = await gmailClient.readMessage({
                id: args.id || args.messageId,
                maxChars: args.maxChars || 20000,
              });
              return successResult({ action, message: data }, formatRead(data));
            }
            if (action === "send") {
              const approval = await ensureSendApproval(runtimeContext, args);
              if (!approval?.allowed) {
                return errorResult({
                  code: "USER_DENIED",
                  message: approval?.reason || "User denied Gmail send.",
                  nextAction: "Do not send the email. Tell the user it was not sent.",
                });
              }
              const data = await gmailClient.sendMessage(args);
              return successResult({ action, sent: data }, `Email sent.\nid: ${data.id}\nthreadId: ${data.threadId}`);
            }
          } catch (retryError) {
            return errorResult({
              code: retryError instanceof GmailAuthRequiredError || retryError?.code === "NEED_GOOGLE_AUTH" ? "NEED_GOOGLE_AUTH" : "GMAIL_ERROR",
              message: retryError?.message || String(retryError),
              retryable: retryError instanceof GmailAuthRequiredError || retryError?.code === "NEED_GOOGLE_AUTH",
              nextAction: "Explain the Gmail operation failed and ask the user whether to retry.",
              details: { provider: "google", scopes: ["gmail.readonly", "gmail.send"] },
            });
          }
        }
        return errorResult({
          code: "GMAIL_ERROR",
          message: error?.message || String(error),
          retryable: false,
          nextAction: "Explain the Gmail operation failed and ask the user whether to retry.",
        });
      }
    },
  };
}
