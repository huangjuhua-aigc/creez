import { asTextEnvelope, buildErrorEnvelope, buildSuccessEnvelope } from "../errorProtocol.mjs";

const DEFAULT_TIMEOUT_MS = 15000;

function resolveLeadApiBase() {
  const fromEnv = String(process.env.CREEZ_KNOWLEDGE_API_BASE || "").trim();
  return fromEnv || "https://creez.lighton.video";
}

function hasMinimalContact(args = {}) {
  const name = String(args?.name || "").trim();
  const email = String(args?.email || "").trim();
  const wechat = String(args?.wechat || "").trim();
  return name.length > 0 && (email.length > 0 || wechat.length > 0);
}

export function createVcLeadCaptureHandler(runtimeContext = {}) {
  return {
    id: "vc_lead_capture",
    async execute(args = {}) {
      const name = String(args?.name || "").trim();
      const email = String(args?.email || "").trim();
      const company = String(args?.company || "").trim();
      const wechat = String(args?.wechat || "").trim();
      const message = String(args?.message || "").trim();
      const contactId = runtimeContext?.contactId ? String(runtimeContext.contactId) : "";
      const chatId = runtimeContext?.chatId ? String(runtimeContext.chatId) : "";

      if (!hasMinimalContact(args)) {
        const envelope = buildErrorEnvelope({
          toolName: "vc_lead_capture",
          code: "INCOMPLETE_CONTACT",
          message: "Contact info is incomplete. Need at least name and (email or wechat).",
          retryable: false,
          nextAction:
            "Ask the user for their name and at least one of: email, WeChat ID. Then call vc_lead_capture again with the provided data.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "vc_lead_capture") }],
          details: envelope,
          isError: true,
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("timeout")), DEFAULT_TIMEOUT_MS);
      const baseUrl = resolveLeadApiBase();
      const endpoint = `${baseUrl.replace(/\/+$/, "")}/roundcloser/lead`;

      const body = {
        name,
        email: email || undefined,
        company: company || undefined,
        wechat: wechat || undefined,
        message: message || undefined,
        source: "roundcloser",
        device_id: contactId || undefined,
        chat_id: chatId || undefined,
        raw_payload: { name, email, company, wechat, message },
      };

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.ok) {
          const envelope = buildErrorEnvelope({
            toolName: "vc_lead_capture",
            code: "BACKEND_ERROR",
            message: payload?.error?.message || `Lead API returned HTTP ${response.status}`,
            retryable: response.status >= 500 || response.status === 429,
            nextAction:
              "If retryable, retry once; otherwise tell the user their info was not submitted and suggest they try again later or leave contact in another way.",
          });
          return {
            content: [{ type: "text", text: asTextEnvelope(envelope, "vc_lead_capture") }],
            details: envelope,
            isError: true,
          };
        }

        const envelope = buildSuccessEnvelope({
          toolName: "vc_lead_capture",
          data: { submitted: true, lead_id: payload?.data?.id },
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "vc_lead_capture") }],
          details: envelope,
        };
      } catch (error) {
        const isTimeout =
          String(error?.message || "").includes("timeout") || error?.name === "AbortError";
        const envelope = buildErrorEnvelope({
          toolName: "vc_lead_capture",
          code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
          message: isTimeout ? "vc_lead_capture timed out." : (error?.message || "Request failed."),
          retryable: true,
          nextAction: "Retry once; if still failing, tell the user to try again later.",
        });
        return {
          content: [{ type: "text", text: asTextEnvelope(envelope, "vc_lead_capture") }],
          details: envelope,
          isError: true,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
