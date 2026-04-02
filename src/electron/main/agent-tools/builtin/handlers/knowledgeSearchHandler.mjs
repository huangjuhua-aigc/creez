import { createRequire } from "node:module";
import { asTextEnvelope, buildErrorEnvelope, buildSuccessEnvelope } from "../errorProtocol.mjs";

const require = createRequire(import.meta.url);
const { resolveCreezBackendBase } = require("../../../creezBackendBase.cjs");

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

function normalizeTopK(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TOP_K;
  return Math.max(1, Math.min(MAX_TOP_K, Math.floor(n)));
}

function normalizeMatch(raw, index) {
  const payload = raw?.payload && typeof raw.payload === "object" ? raw.payload : {};
  return {
    rank: index + 1,
    id: raw?.id != null ? String(raw.id) : "",
    score: Number(raw?.score || 0),
    text: String(payload.text || "").trim(),
    sourceId: payload.source_id ? String(payload.source_id) : "",
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
  };
}

function formatMatches(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return "No relevant knowledge found.";
  return matches
    .map((m) => {
      const scoreText = Number.isFinite(m.score) ? m.score.toFixed(4) : "n/a";
      const sourceText = m.sourceId ? ` source=${m.sourceId}` : "";
      return `#${m.rank} score=${scoreText}${sourceText}\n${m.text || "(empty text)"}`;
    })
    .join("\n\n");
}

export function createKnowledgeSearchHandler(runtimeContext = {}) {
  return {
    id: "knowledge_search",
    async execute(args = {}) {
      const query = String(args?.query || "").trim();
      const topK = normalizeTopK(args?.topK);
      const botId = String(runtimeContext?.contactId || "").trim();
      const chatId = runtimeContext?.chatId ? String(runtimeContext.chatId) : "";

      if (!botId) {
        const envelope = buildErrorEnvelope({
          toolName: "knowledge_search",
          code: "MISSING_BOT_SCOPE",
          message: "knowledge_search requires a valid contactId scope.",
          retryable: false,
          nextAction: "Ask the system to provide contactId before retrying knowledge search.",
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "knowledge_search") }], details: envelope, isError: true };
      }
      if (!query) {
        const envelope = buildErrorEnvelope({
          toolName: "knowledge_search",
          code: "INVALID_ARGUMENT",
          message: "query is required.",
          retryable: false,
          nextAction: "Call knowledge_search again with a concrete factual question.",
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "knowledge_search") }], details: envelope, isError: true };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("timeout")), DEFAULT_TIMEOUT_MS);
      const baseUrl = resolveCreezBackendBase();
      const endpoint = `${baseUrl.replace(/\/+$/, "")}/knowledge/search`;
      console.log("[creezv2 knowledge_search] request", {
        endpoint,
        body: { botId, query, topK },
        chatId,
      });

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botId, query, topK }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          console.log("[creezv2 knowledge_search] response-error", {
            status: response.status,
            ok: payload?.ok || false,
            message: payload?.error?.message || "",
          });
          const envelope = buildErrorEnvelope({
            toolName: "knowledge_search",
            code: "BACKEND_ERROR",
            message: payload?.error?.message || `knowledge backend returned HTTP ${response.status}`,
            retryable: response.status >= 500 || response.status === 429,
            nextAction: "If retryable, retry once with narrower query; otherwise ask user for missing factual details.",
            details: { status: response.status, endpoint, botId, chatId },
          });
          return { content: [{ type: "text", text: asTextEnvelope(envelope, "knowledge_search") }], details: envelope, isError: true };
        }

        const matches = Array.isArray(payload?.data?.matches)
          ? payload.data.matches.map((item, index) => normalizeMatch(item, index))
          : [];
        const firstMatchPreview =
          matches.length > 0 && matches[0]?.text
            ? String(matches[0].text).slice(0, 120).replace(/\s+/g, " ").trim() + (String(matches[0].text).length > 120 ? "…" : "")
            : undefined;
        console.log("[creezv2 knowledge_search] response-ok", {
          status: response.status,
          matchCount: matches.length,
          query,
          botId,
          firstMatchPreview,
        });
        if (matches.length === 0) {
          const envelope = buildErrorEnvelope({
            toolName: "knowledge_search",
            code: "NO_RESULTS",
            message: "No relevant knowledge found for current bot scope.",
            retryable: false,
            nextAction: "Ask user for exact missing facts or try a more specific query.",
            details: { endpoint, botId, chatId, topK },
          });
          return { content: [{ type: "text", text: asTextEnvelope(envelope, "knowledge_search") }], details: envelope, isError: true };
        }

        const envelope = buildSuccessEnvelope({
          toolName: "knowledge_search",
          data: {
            query,
            botId,
            chatId,
            topK,
            count: matches.length,
            matches,
          },
        });

        return {
          content: [
            { type: "text", text: `${asTextEnvelope(envelope, "knowledge_search")}\n\n${formatMatches(matches)}` },
          ],
          details: envelope,
        };
      } catch (error) {
        console.log("[creezv2 knowledge_search] network-error", {
          message: error?.message || String(error),
        });
        const isTimeout = String(error?.message || "").includes("timeout") || error?.name === "AbortError";
        const envelope = buildErrorEnvelope({
          toolName: "knowledge_search",
          code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
          message: isTimeout ? "knowledge_search timed out." : (error?.message || "knowledge_search request failed."),
          retryable: true,
          nextAction: "Retry once. If still failing, continue without KB and ask user for concrete facts.",
          details: { endpoint, botId, chatId },
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "knowledge_search") }], details: envelope, isError: true };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
