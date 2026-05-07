const { CHANNELS } = require("../channels.cjs");
const { createSandboxPolicy, explainPolicy } = require("./sandboxPolicy.cjs");
const { resolveSandboxApproval } = require("./sandboxApproval.cjs");

function ok(data) {
  return { ok: true, data };
}

function registerSandboxIpc(ipcMain, deps = {}) {
  ipcMain.handle(CHANNELS.SANDBOX_GET_STATUS, async () => {
    const policy = createSandboxPolicy({
      scenario: "trusted_desktop",
      workDir: deps.workDir || process.cwd(),
      agentDir: deps.creezHome || "",
    });
    return ok({
      available: true,
      mode: policy.mode,
      backend: policy.backend,
      summary: explainPolicy(policy),
      note: "Creez sandbox policy layer is enabled. Native OS backends can be strengthened per platform.",
    });
  });

  ipcMain.handle(CHANNELS.SANDBOX_APPROVAL_DECIDE, async (_event, payload = {}) => {
    return resolveSandboxApproval(payload?.id, {
      allowed: Boolean(payload?.allowed),
      reason: payload?.reason,
    });
  });
}

module.exports = {
  registerSandboxIpc,
};
