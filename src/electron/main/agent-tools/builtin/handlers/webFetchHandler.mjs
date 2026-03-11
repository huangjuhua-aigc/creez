import { asTextEnvelope, buildErrorEnvelope, buildSuccessEnvelope } from "../errorProtocol.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function truncateText(text, maxChars) {
  if (!text || text.length <= maxChars) return { text: text || "", truncated: false };
  return { text: text.slice(0, maxChars) + "\n\n[truncated]", truncated: true };
}

function looksLikeHtml(text) {
  const head = text.trimStart().slice(0, 256).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function stripHtmlTags(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&nbsp;/gi, " ");
  text = text.replace(/&amp;/gi, "&");
  text = text.replace(/&lt;/gi, "<");
  text = text.replace(/&gt;/gi, ">");
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : undefined;
}

export function createWebFetchHandler(runtimeContext = {}) {
  return {
    id: "web_fetch",
    async execute(args = {}) {
      const url = String(args?.url || "").trim();
      const extractMode = String(args?.extractMode || "text").trim();
      const maxCharsRaw = Number(args?.maxChars);
      const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw >= 100
        ? Math.min(maxCharsRaw, DEFAULT_MAX_CHARS)
        : DEFAULT_MAX_CHARS;

      if (!url) {
        const envelope = buildErrorEnvelope({
          toolName: "web_fetch",
          code: "INVALID_ARGUMENT",
          message: "url is required.",
          retryable: false,
          nextAction: "Call web_fetch again with a valid HTTP/HTTPS URL.",
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "web_fetch") }], details: envelope, isError: true };
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        const envelope = buildErrorEnvelope({
          toolName: "web_fetch",
          code: "INVALID_URL",
          message: "Invalid URL format. Must be http or https.",
          retryable: false,
          nextAction: "Fix the URL and retry.",
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "web_fetch") }], details: envelope, isError: true };
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        const envelope = buildErrorEnvelope({
          toolName: "web_fetch",
          code: "INVALID_URL",
          message: "URL must use http or https protocol.",
          retryable: false,
          nextAction: "Fix the URL protocol and retry.",
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "web_fetch") }], details: envelope, isError: true };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("timeout")), DEFAULT_TIMEOUT_MS);
      const start = Date.now();

      try {
        const response = await fetch(url, {
          headers: {
            Accept: "text/html, application/json, text/plain, */*",
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
          },
          redirect: "follow",
          signal: controller.signal,
        });
        const tookMs = Date.now() - start;
        const contentType = response.headers.get("content-type") || "application/octet-stream";

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const detail = body ? truncateText(body, 2000).text : response.statusText;
          const envelope = buildErrorEnvelope({
            toolName: "web_fetch",
            code: "HTTP_ERROR",
            message: `HTTP ${response.status}: ${detail}`,
            retryable: response.status >= 500 || response.status === 429,
            nextAction: response.status === 429 ? "Wait a moment and retry." : "Try a different URL or check if the site is accessible.",
            details: { status: response.status, url, tookMs },
          });
          return { content: [{ type: "text", text: asTextEnvelope(envelope, "web_fetch") }], details: envelope, isError: true };
        }

        const rawBody = await response.text();
        let text = rawBody;
        let title;
        let extractor = "raw";

        if (contentType.includes("text/html") || looksLikeHtml(rawBody)) {
          title = extractTitle(rawBody);
          text = stripHtmlTags(rawBody);
          extractor = "html-strip";
        } else if (contentType.includes("application/json")) {
          try {
            text = JSON.stringify(JSON.parse(rawBody), null, 2);
            extractor = "json";
          } catch {
            extractor = "raw";
          }
        }

        const truncated = truncateText(text, maxChars);
        const envelope = buildSuccessEnvelope({
          toolName: "web_fetch",
          data: {
            url,
            finalUrl: response.url || url,
            status: response.status,
            contentType: contentType.split(";")[0].trim(),
            title: title || undefined,
            extractMode,
            extractor,
            truncated: truncated.truncated,
            length: truncated.text.length,
            tookMs,
          },
        });

        const resultText = title
          ? `Title: ${title}\n\n${truncated.text}`
          : truncated.text;

        return {
          content: [{ type: "text", text: `${asTextEnvelope(envelope, "web_fetch")}\n\n${resultText}` }],
          details: envelope,
        };
      } catch (error) {
        const isTimeout = String(error?.message || "").includes("timeout") || error?.name === "AbortError";
        const envelope = buildErrorEnvelope({
          toolName: "web_fetch",
          code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
          message: isTimeout ? "web_fetch timed out." : (error?.message || "web_fetch request failed."),
          retryable: true,
          nextAction: "Retry once. If still failing, inform user the URL is unreachable.",
          details: { url },
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "web_fetch") }], details: envelope, isError: true };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
