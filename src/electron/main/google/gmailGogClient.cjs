const { execFile } = require("node:child_process");

function resolveGogExecutable(repository) {
  const configured = repository?.getAccount?.()?.gogPath;
  return configured || process.env.CREEZ_GOG_PATH || "gog";
}

function runGog(args, { timeoutMs = 120000, repository } = {}) {
  return new Promise((resolve, reject) => {
    const executable = resolveGogExecutable(repository);
    execFile(executable, args.map((v) => String(v)), { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const msg = [stderr, stdout, error.message].filter(Boolean).join("\n").trim();
        const e = new Error(msg || `gog command failed. Make sure gog is installed and available in PATH, or set CREEZ_GOG_PATH. Tried: ${executable}`);
        e.code = error.code;
        reject(e);
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function parseJsonOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error("gog returned non-JSON output.");
  }
}

function normalizeList(raw) {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.messages)
      ? raw.messages
      : Array.isArray(raw?.items)
        ? raw.items
        : [];
  return items.map((m) => ({
    id: m.id || m.messageId || m.message_id || "",
    threadId: m.threadId || m.thread_id || "",
    labelIds: m.labelIds || m.labels || [],
    snippet: m.snippet || m.preview || "",
    from: m.from || m.sender || "",
    to: m.to || "",
    cc: m.cc || "",
    subject: m.subject || "",
    date: m.date || m.internalDate || "",
  })).filter((m) => m.id);
}

class GmailGogClient {
  constructor({ repository } = {}) {
    this.repository = repository;
  }

  getAccount() {
    const account = this.repository?.getAccount?.();
    if (account?.provider !== "gog" || !account.gogAccount) {
      const err = new Error("Gmail is not configured for gog.");
      err.code = "NEED_GOOGLE_AUTH";
      throw err;
    }
    return account.gogAccount;
  }

  getStatus() {
    const status = this.repository?.getStatus?.() || { connected: false };
    return status.provider === "gog" ? status : { connected: false, provider: "gog" };
  }

  async setup({ credentialsPath, googleEmail } = {}) {
    const file = String(credentialsPath || "").trim();
    const email = String(googleEmail || "").trim();
    if (!file) throw new Error("client_secret.json path is required.");
    if (!email) throw new Error("Gmail account is required.");
    await runGog(["auth", "credentials", file], { repository: this.repository });
    await runGog(
      ["auth", "add", email, "--services", "gmail", "--timeout", "15m", "--force-consent"],
      { timeoutMs: 16 * 60 * 1000, repository: this.repository },
    );
    this.repository.saveGogAccount({ googleEmail: email, gogCredentialsPath: file });
    return this.repository.getStatus();
  }

  async listMessages({ query = "", maxResults = 10 } = {}) {
    const account = this.getAccount();
    const max = Math.max(1, Math.min(Number(maxResults) || 10, 20));
    const { stdout } = await runGog([
      "gmail", "messages", "search",
      String(query || "in:inbox"),
      "--account", account,
      "--max", String(max),
      "--json",
    ], { repository: this.repository });
    const raw = parseJsonOutput(stdout);
    const messages = normalizeList(raw);
    return { resultSizeEstimate: messages.length, nextPageToken: "", messages };
  }

  async readMessage({ id, maxChars = 20000 } = {}) {
    const account = this.getAccount();
    const messageId = String(id || "").trim();
    if (!messageId) throw new Error("message id is required.");
    const { stdout } = await runGog([
      "gmail", "get", messageId,
      "--account", account,
      "--format", "full",
      "--json",
    ], { repository: this.repository });
    const raw = parseJsonOutput(stdout) || {};
    const body = String(raw.body || raw.text || raw.plain || raw.snippet || "");
    const limit = Math.max(1000, Math.min(Number(maxChars) || 20000, 50000));
    return {
      id: raw.id || messageId,
      threadId: raw.threadId || raw.thread_id || "",
      labelIds: raw.labelIds || raw.labels || [],
      snippet: raw.snippet || "",
      from: raw.from || raw.sender || "",
      to: raw.to || "",
      cc: raw.cc || "",
      subject: raw.subject || "",
      date: raw.date || "",
      body: body.length > limit ? body.slice(0, limit) + "\n\n[truncated]" : body,
      truncated: body.length > limit,
    };
  }

  async sendMessage({ to, cc, bcc, subject, body } = {}) {
    const account = this.getAccount();
    const args = [
      "gmail", "send",
      "--account", account,
      "--to", Array.isArray(to) ? to.join(",") : String(to || ""),
      "--subject", String(subject || ""),
      "--body", String(body || ""),
    ];
    if (cc) args.push("--cc", Array.isArray(cc) ? cc.join(",") : String(cc));
    if (bcc) args.push("--bcc", Array.isArray(bcc) ? bcc.join(",") : String(bcc));
    const { stdout } = await runGog(args, { repository: this.repository });
    const raw = (() => {
      try { return parseJsonOutput(stdout) || {}; } catch { return {}; }
    })();
    return {
      id: raw.id || "",
      threadId: raw.threadId || "",
      labelIds: raw.labelIds || ["SENT"],
    };
  }
}

module.exports = {
  GmailGogClient,
  runGog,
  resolveGogExecutable,
};
