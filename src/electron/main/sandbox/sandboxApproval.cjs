const crypto = require("node:crypto");

const pendingApprovals = new Map();

function makeId() {
  return `sandbox-approval-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function requestSandboxApproval({ request, sendRequest, timeoutMs = 120000 } = {}) {
  if (typeof sendRequest !== "function") {
    return Promise.resolve({ allowed: false, reason: "Approval UI is unavailable." });
  }
  const id = makeId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pendingApprovals.has(id)) return;
      pendingApprovals.delete(id);
      resolve({ allowed: false, reason: "Approval timed out." });
    }, timeoutMs);
    pendingApprovals.set(id, {
      resolve(decision) {
        clearTimeout(timer);
        resolve(decision);
      },
    });
    sendRequest({
      id,
      ...(request && typeof request === "object" ? request : {}),
      timeoutMs,
      createdAt: Date.now(),
    });
  });
}

function resolveSandboxApproval(id, decision = {}) {
  const key = String(id || "").trim();
  if (!key || !pendingApprovals.has(key)) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Approval request not found or already resolved." } };
  }
  const pending = pendingApprovals.get(key);
  pendingApprovals.delete(key);
  pending.resolve({
    allowed: Boolean(decision.allowed),
    reason: String(decision.reason || ""),
  });
  return { ok: true, data: { resolved: true } };
}

module.exports = {
  requestSandboxApproval,
  resolveSandboxApproval,
};
