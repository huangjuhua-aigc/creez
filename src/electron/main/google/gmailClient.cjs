const GMAIL_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
]);

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function base64UrlEncode(value) {
  return Buffer.from(String(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function getHeader(headers = [], name) {
  const lower = String(name || "").toLowerCase();
  const found = Array.isArray(headers)
    ? headers.find((h) => String(h?.name || "").toLowerCase() === lower)
    : null;
  return found?.value || "";
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectParts(payload, out = []) {
  if (!payload) return out;
  out.push(payload);
  for (const part of payload.parts || []) collectParts(part, out);
  return out;
}

function extractBodyText(message) {
  const parts = collectParts(message?.payload, []);
  const plain = parts.find((p) => p?.mimeType === "text/plain" && p?.body?.data);
  if (plain) return base64UrlDecode(plain.body.data);
  const html = parts.find((p) => p?.mimeType === "text/html" && p?.body?.data);
  if (html) return htmlToText(base64UrlDecode(html.body.data));
  const direct = message?.payload?.body?.data;
  return direct ? base64UrlDecode(direct) : "";
}

function summarizeMessage(message) {
  const headers = message?.payload?.headers || [];
  return {
    id: message?.id || "",
    threadId: message?.threadId || "",
    labelIds: message?.labelIds || [],
    snippet: message?.snippet || "",
    historyId: message?.historyId || "",
    internalDate: message?.internalDate || "",
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc"),
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
  };
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  const s = String(value || "").trim();
  return s ? [s] : [];
}

function foldHeaderLine(name, value) {
  const safe = String(value || "").replace(/[\r\n]+/g, " ").trim();
  return safe ? `${name}: ${safe}` : "";
}

function createMimeMessage({ to, cc, bcc, subject, body }) {
  const toList = normalizeRecipients(to);
  const ccList = normalizeRecipients(cc);
  const bccList = normalizeRecipients(bcc);
  if (toList.length === 0) throw new Error("At least one recipient is required.");
  const lines = [
    foldHeaderLine("To", toList.join(", ")),
    ...(ccList.length ? [foldHeaderLine("Cc", ccList.join(", "))] : []),
    ...(bccList.length ? [foldHeaderLine("Bcc", bccList.join(", "))] : []),
    foldHeaderLine("Subject", subject || "(no subject)"),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    String(body || ""),
  ];
  return lines.join("\r\n");
}

class GmailAuthRequiredError extends Error {
  constructor(message = "Google Gmail authorization is required.") {
    super(message);
    this.name = "GmailAuthRequiredError";
    this.code = "NEED_GOOGLE_AUTH";
  }
}

class GmailClient {
  constructor({ repository, fetchImpl, clientId, clientSecret } = {}) {
    this.repository = repository;
    this.fetchImpl = fetchImpl || fetch;
    this.clientId = clientId || process.env.CREEZ_GOOGLE_CLIENT_ID || "";
    this.clientSecret = clientSecret || process.env.CREEZ_GOOGLE_CLIENT_SECRET || "";
  }

  getStatus() {
    return this.repository?.getStatus?.() || { connected: false };
  }

  async ensureAccessToken() {
    const account = this.repository?.getAccount?.();
    if (!account?.refreshToken) throw new GmailAuthRequiredError();
    const expiresAt = Number(account.expiryDate || 0);
    if (account.accessToken && expiresAt > Date.now() + 60_000) return account.accessToken;
    if (!this.clientId) throw new Error("CREEZ_GOOGLE_CLIENT_ID is not configured.");

    const body = new URLSearchParams({
      client_id: this.clientId,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    });
    if (this.clientSecret) body.set("client_secret", this.clientSecret);
    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) throw new GmailAuthRequiredError(json?.error_description || "Google authorization expired.");
      throw new Error(json?.error_description || json?.error || `Token refresh failed (${response.status}).`);
    }
    const expiryDate = Date.now() + Number(json.expires_in || 3600) * 1000;
    this.repository.saveAccount({
      accessToken: json.access_token,
      refreshToken: account.refreshToken,
      googleEmail: account.googleEmail,
      scope: json.scope || account.scope,
      expiryDate,
    });
    return json.access_token;
  }

  async api(path, { method = "GET", query, body } = {}) {
    const token = await this.ensureAccessToken();
    const url = new URL(`${GMAIL_API_BASE}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value != null && String(value).trim() !== "") url.searchParams.set(key, String(value));
    }
    const response = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error?.message || json?.error_description || `Gmail API failed (${response.status}).`;
      if (response.status === 401 || response.status === 403) throw new GmailAuthRequiredError(message);
      throw new Error(message);
    }
    return json;
  }

  async getProfile() {
    return this.api("/users/me/profile");
  }

  async listMessages({ query = "", maxResults = 10, pageToken = "" } = {}) {
    const max = Math.max(1, Math.min(Number(maxResults) || 10, 20));
    const listed = await this.api("/users/me/messages", {
      query: { q: query, maxResults: max, pageToken },
    });
    const messages = [];
    for (const item of listed.messages || []) {
      const detail = await this.api(`/users/me/messages/${encodeURIComponent(item.id)}`, {
        query: { format: "metadata" },
      });
      messages.push(summarizeMessage(detail));
    }
    return {
      resultSizeEstimate: listed.resultSizeEstimate || 0,
      nextPageToken: listed.nextPageToken || "",
      messages,
    };
  }

  async readMessage({ id, maxChars = 20000 } = {}) {
    const messageId = String(id || "").trim();
    if (!messageId) throw new Error("message id is required.");
    const detail = await this.api(`/users/me/messages/${encodeURIComponent(messageId)}`, {
      query: { format: "full" },
    });
    const text = extractBodyText(detail);
    const limit = Math.max(1000, Math.min(Number(maxChars) || 20000, 50000));
    return {
      ...summarizeMessage(detail),
      body: text.length > limit ? text.slice(0, limit) + "\n\n[truncated]" : text,
      truncated: text.length > limit,
    };
  }

  async sendMessage({ to, cc, bcc, subject, body } = {}) {
    const mime = createMimeMessage({ to, cc, bcc, subject, body });
    const sent = await this.api("/users/me/messages/send", {
      method: "POST",
      body: { raw: base64UrlEncode(mime) },
    });
    return {
      id: sent.id || "",
      threadId: sent.threadId || "",
      labelIds: sent.labelIds || [],
    };
  }
}

module.exports = {
  GmailClient,
  GmailAuthRequiredError,
  GMAIL_SCOPES,
  base64UrlEncode,
  base64UrlDecode,
  createMimeMessage,
  extractBodyText,
  summarizeMessage,
};
