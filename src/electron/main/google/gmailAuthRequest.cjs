const crypto = require("node:crypto");

const pendingGmailAuthRequests = new Map();

function makeId() {
  return `gmail-auth-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function requestGmailAuth({ request, sendRequest } = {}) {
  if (typeof sendRequest !== "function") {
    return Promise.resolve({ allowed: false, reason: "Gmail authorization UI is unavailable." });
  }
  const id = makeId();
  return new Promise((resolve) => {
    pendingGmailAuthRequests.set(id, {
      resolve(decision) {
        resolve(decision);
      },
    });
    sendRequest({
      id,
      ...(request && typeof request === "object" ? request : {}),
      createdAt: Date.now(),
    });
  });
}

function resolveGmailAuth(id, decision = {}) {
  const key = String(id || "").trim();
  if (!key || !pendingGmailAuthRequests.has(key)) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Gmail auth request not found or already resolved." } };
  }
  const pending = pendingGmailAuthRequests.get(key);
  pendingGmailAuthRequests.delete(key);
  pending.resolve({
    allowed: Boolean(decision.allowed),
    reason: String(decision.reason || ""),
  });
  return { ok: true, data: { resolved: true } };
}

module.exports = {
  requestGmailAuth,
  resolveGmailAuth,
};
