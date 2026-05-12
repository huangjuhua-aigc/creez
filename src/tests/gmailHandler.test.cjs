const test = require("node:test");
const assert = require("node:assert/strict");

test("gmail handler waits for auth and retries when Gmail is not connected", async () => {
  const { createGmailHandler } = await import("../electron/main/agent-tools/builtin/handlers/gmailHandler.mjs");
  let authRequest = null;
  let calls = 0;
  const handler = createGmailHandler({
    gmailClient: {
      listMessages: async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error("auth required");
          err.code = "NEED_GOOGLE_AUTH";
          throw err;
        }
        return { messages: [], resultSizeEstimate: 0 };
      },
    },
    requestGmailAuth: async (request) => {
      authRequest = request;
      return { allowed: true };
    },
  });
  const result = await handler.execute({ action: "list", query: "newer_than:1d" });
  assert.equal(result.isError, undefined);
  assert.equal(result.details?.data?.action, "list");
  assert.equal(authRequest?.action, "list");
  assert.equal(calls, 2);
});

test("gmail handler connect action waits for auth request", async () => {
  const { createGmailHandler } = await import("../electron/main/agent-tools/builtin/handlers/gmailHandler.mjs");
  let authRequest = null;
  const handler = createGmailHandler({
    gmailClient: { getStatus: () => ({ connected: true, googleEmail: "me@example.com" }) },
    requestGmailAuth: async (request) => {
      authRequest = request;
      return { allowed: true };
    },
  });
  const result = await handler.execute({ action: "connect" });
  assert.equal(result.isError, undefined);
  assert.equal(result.details?.data?.status?.googleEmail, "me@example.com");
  assert.equal(authRequest?.action, "connect");
});

test("gmail handler stops when user cancels auth request", async () => {
  const { createGmailHandler } = await import("../electron/main/agent-tools/builtin/handlers/gmailHandler.mjs");
  const handler = createGmailHandler({
    gmailClient: {
      listMessages: async () => {
        const err = new Error("auth required");
        err.code = "NEED_GOOGLE_AUTH";
        throw err;
      },
    },
    requestGmailAuth: async () => ({ allowed: false, reason: "cancelled" }),
  });
  const result = await handler.execute({ action: "list" });
  assert.equal(result.isError, true);
  assert.equal(result.details?.error?.code, "USER_CANCELLED");
});

test("gmail handler status action reports connected account", async () => {
  const { createGmailHandler } = await import("../electron/main/agent-tools/builtin/handlers/gmailHandler.mjs");
  const handler = createGmailHandler({
    gmailClient: { getStatus: () => ({ connected: true, googleEmail: "me@example.com" }) },
  });
  const result = await handler.execute({ action: "status" });
  assert.equal(result.isError, undefined);
  assert.equal(result.details?.data?.status?.googleEmail, "me@example.com");
});

test("gmail handler requires user approval before sending", async () => {
  const { createGmailHandler } = await import("../electron/main/agent-tools/builtin/handlers/gmailHandler.mjs");
  let approvalRequest = null;
  let sendCalled = false;
  const handler = createGmailHandler({
    gmailClient: {
      ensureAccessToken: async () => "token",
      sendMessage: async () => {
        sendCalled = true;
        return { id: "msg-1", threadId: "thread-1" };
      },
    },
    requestApproval: async (request) => {
      approvalRequest = request;
      return { allowed: false, reason: "no" };
    },
  });
  const denied = await handler.execute({ action: "send", to: "a@example.com", subject: "Hi", body: "Body" });
  assert.equal(denied.isError, true);
  assert.equal(denied.details?.error?.code, "USER_DENIED");
  assert.equal(sendCalled, false);
  assert.equal(approvalRequest?.kind, "gmail_send");
  assert.match(approvalRequest?.command || "", /To: a@example.com/);
});

test("gmail handler sends after approval", async () => {
  const { createGmailHandler } = await import("../electron/main/agent-tools/builtin/handlers/gmailHandler.mjs");
  const handler = createGmailHandler({
    gmailClient: {
      ensureAccessToken: async () => "token",
      sendMessage: async () => ({ id: "msg-1", threadId: "thread-1" }),
    },
    requestApproval: async () => ({ allowed: true }),
  });
  const result = await handler.execute({ action: "send", to: "a@example.com", subject: "Hi", body: "Body" });
  assert.equal(result.isError, undefined);
  assert.equal(result.details?.data?.sent?.id, "msg-1");
});
