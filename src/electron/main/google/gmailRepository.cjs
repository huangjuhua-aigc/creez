const ACCOUNT_ID = "default";

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function getSafeStorage() {
  try {
    return require("electron").safeStorage || null;
  } catch {
    return null;
  }
}

function encodeSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  const safeStorage = getSafeStorage();
  if (safeStorage?.isEncryptionAvailable?.()) {
    return "safe:" + safeStorage.encryptString(text).toString("base64");
  }
  return "plain:" + Buffer.from(text, "utf8").toString("base64");
}

function decodeSecret(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.startsWith("safe:")) {
    const safeStorage = getSafeStorage();
    if (!safeStorage?.isEncryptionAvailable?.()) return "";
    return safeStorage.decryptString(Buffer.from(raw.slice(5), "base64"));
  }
  if (raw.startsWith("plain:")) {
    return Buffer.from(raw.slice(6), "base64").toString("utf8");
  }
  return raw;
}

class GmailRepository {
  constructor(db) {
    this.db = db;
    this.getStmt = db.prepare("SELECT * FROM gmail_accounts WHERE id = ?");
    this.upsertStmt = db.prepare(`
      INSERT INTO gmail_accounts (
        id, google_email, access_token, refresh_token, scope, expiry_date, provider, gog_account, gog_path, created_at, updated_at
      ) VALUES (
        @id, @google_email, @access_token, @refresh_token, @scope, @expiry_date, @provider, @gog_account, @gog_path, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        google_email = @google_email,
        access_token = @access_token,
        refresh_token = @refresh_token,
        scope = @scope,
        expiry_date = @expiry_date,
        provider = @provider,
        gog_account = @gog_account,
        gog_path = @gog_path,
        updated_at = @updated_at
    `);
    this.deleteStmt = db.prepare("DELETE FROM gmail_accounts WHERE id = ?");
  }

  getAccount() {
    const row = this.getStmt.get(ACCOUNT_ID);
    if (!row) return null;
    return {
      id: row.id,
      googleEmail: row.google_email || "",
      accessToken: decodeSecret(row.access_token),
      refreshToken: decodeSecret(row.refresh_token),
      scope: row.scope || "",
      expiryDate: row.expiry_date || 0,
      provider: row.provider || "native",
      gogAccount: row.gog_account || "",
      gogPath: row.gog_path || "",
      createdAt: row.created_at || 0,
      updatedAt: row.updated_at || 0,
    };
  }

  getStatus() {
    const account = this.getAccount();
    if (account?.provider === "gog" && account?.gogAccount) {
      return {
        connected: true,
        provider: "gog",
        googleEmail: account.gogAccount,
        scope: "gog:gmail",
      };
    }
    if (!account?.refreshToken) {
      return { connected: false, provider: account?.provider || "gog", googleEmail: "", scope: "" };
    }
    return {
      connected: true,
      provider: "native",
      googleEmail: account.googleEmail || "",
      scope: account.scope || "",
      expiryDate: account.expiryDate || 0,
    };
  }

  saveAccount(patch = {}) {
    const current = this.getAccount();
    const ts = nowSeconds();
    const refreshToken = patch.refreshToken || current?.refreshToken || "";
    if (!refreshToken) throw new Error("refresh_token is required.");
    this.upsertStmt.run({
      id: ACCOUNT_ID,
      google_email: patch.googleEmail || current?.googleEmail || "",
      access_token: encodeSecret(patch.accessToken || current?.accessToken || ""),
      refresh_token: encodeSecret(refreshToken),
      scope: patch.scope || current?.scope || "",
      expiry_date: Number(patch.expiryDate || current?.expiryDate || 0),
      provider: patch.provider || current?.provider || "native",
      gog_account: patch.gogAccount || current?.gogAccount || "",
      gog_path: patch.gogPath || current?.gogPath || "",
      created_at: current?.createdAt || ts,
      updated_at: ts,
    });
    return this.getAccount();
  }

  saveGogAccount({ googleEmail, gogPath } = {}) {
    const current = this.getAccount();
    const ts = nowSeconds();
    const email = String(googleEmail || "").trim();
    if (!email) throw new Error("Gmail account is required.");
    this.upsertStmt.run({
      id: ACCOUNT_ID,
      google_email: email,
      access_token: encodeSecret(current?.accessToken || ""),
      refresh_token: encodeSecret(current?.refreshToken || "gog"),
      scope: "gog:gmail",
      expiry_date: 0,
      provider: "gog",
      gog_account: email,
      gog_path: String(gogPath || current?.gogPath || "").trim(),
      created_at: current?.createdAt || ts,
      updated_at: ts,
    });
    return this.getAccount();
  }

  saveGogPath(gogPath) {
    const current = this.getAccount();
    const ts = nowSeconds();
    this.upsertStmt.run({
      id: ACCOUNT_ID,
      google_email: current?.googleEmail || "",
      access_token: encodeSecret(current?.accessToken || ""),
      refresh_token: encodeSecret(current?.refreshToken || "gog"),
      scope: current?.scope || "gog:gmail",
      expiry_date: Number(current?.expiryDate || 0),
      provider: current?.provider || "gog",
      gog_account: current?.gogAccount || "",
      gog_path: String(gogPath || "").trim(),
      created_at: current?.createdAt || ts,
      updated_at: ts,
    });
    return this.getAccount();
  }

  clear() {
    this.deleteStmt.run(ACCOUNT_ID);
  }
}

module.exports = {
  GmailRepository,
  encodeSecret,
  decodeSecret,
};
