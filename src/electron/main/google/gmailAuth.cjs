const crypto = require("node:crypto");
const http = require("node:http");
const { shell } = require("electron");
const { GMAIL_SCOPES } = require("./gmailClient.cjs");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function makeLoopbackServer({ state, timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;
    let callbackResolve;
    let callbackReject;
    const callbackPromise = new Promise((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close(() => callbackReject(new Error("Google OAuth timed out.")));
    }, timeoutMs);

    server.on("request", (req, res) => {
      const host = req.headers.host || "127.0.0.1";
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Creez Gmail authorization failed</h2><p>Invalid OAuth state.</p>");
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h2>Creez Gmail authorization failed</h2><p>${error || "Missing code."}</p>`);
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          server.close(() => callbackReject(new Error(error || "Google OAuth returned no code.")));
        }
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>Gmail connected to Creez</h2><p>You can close this browser tab and return to Creez.</p>");
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        const redirectUri = `http://127.0.0.1:${server.address().port}`;
        server.close(() => callbackResolve({ code, redirectUri }));
      }
    });

    server.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        callbackReject(error);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        clearTimeout(timer);
        server.close(() => reject(new Error("Unable to create OAuth loopback server.")));
        return;
      }
      resolve({ server, redirectUri: `http://127.0.0.1:${address.port}`, callbackPromise });
    });
  });
}

class GmailOAuthService {
  constructor({ repository, gmailClient, fetchImpl, clientId, clientSecret } = {}) {
    this.repository = repository;
    this.gmailClient = gmailClient;
    this.fetchImpl = fetchImpl || fetch;
    this.clientId = clientId || process.env.CREEZ_GOOGLE_CLIENT_ID || "";
    this.clientSecret = clientSecret || process.env.CREEZ_GOOGLE_CLIENT_SECRET || "";
  }

  getStatus() {
    return this.repository?.getStatus?.() || { connected: false };
  }

  async connect() {
    if (!this.clientId) {
      return {
        ok: false,
        error: {
          code: "GOOGLE_CLIENT_ID_MISSING",
          message: "CREEZ_GOOGLE_CLIENT_ID is required before connecting Gmail.",
        },
      };
    }

    const state = crypto.randomBytes(16).toString("hex");
    let serverInfo;
    try {
      serverInfo = await makeLoopbackServer({ state });
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set("client_id", this.clientId);
      authUrl.searchParams.set("redirect_uri", serverInfo.redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GMAIL_SCOPES.join(" "));
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);
      await shell.openExternal(authUrl.toString());
      const callback = await serverInfo.callbackPromise;
      const status = await this.exchangeCode(callback);
      return { ok: true, data: status };
    } catch (error) {
      if (serverInfo?.server?.listening) {
        try { serverInfo.server.close(); } catch { /* ignore */ }
      }
      return { ok: false, error: { code: "GOOGLE_OAUTH_ERROR", message: error?.message || String(error) } };
    }
  }

  async exchangeCode({ code, redirectUri }) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    if (this.clientSecret) body.set("client_secret", this.clientSecret);
    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.refresh_token) {
      throw new Error(json?.error_description || json?.error || "Google token exchange failed.");
    }
    const expiryDate = Date.now() + Number(json.expires_in || 3600) * 1000;
    this.repository.saveAccount({
      accessToken: json.access_token || "",
      refreshToken: json.refresh_token,
      scope: json.scope || GMAIL_SCOPES.join(" "),
      expiryDate,
    });
    let googleEmail = "";
    try {
      const profile = await this.gmailClient.getProfile();
      googleEmail = profile?.emailAddress || "";
    } catch {
      // Keep the token even if profile lookup fails; Gmail calls can still work.
    }
    if (googleEmail) {
      this.repository.saveAccount({ googleEmail });
    }
    return this.repository.getStatus();
  }

  disconnect() {
    this.repository?.clear?.();
    return { connected: false };
  }
}

module.exports = {
  GmailOAuthService,
  makeLoopbackServer,
};
