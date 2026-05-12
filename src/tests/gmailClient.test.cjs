const test = require("node:test");
const assert = require("node:assert/strict");

const {
  base64UrlEncode,
  base64UrlDecode,
  createMimeMessage,
  extractBodyText,
  GmailClient,
  GmailAuthRequiredError,
} = require("../electron/main/google/gmailClient.cjs");

test("gmail base64url helpers round-trip unicode text", () => {
  const text = "hello Gmail 你好";
  assert.equal(base64UrlDecode(base64UrlEncode(text)), text);
  assert.equal(base64UrlEncode("abc").includes("="), false);
});

test("gmail creates plain text MIME message", () => {
  const mime = createMimeMessage({
    to: ["a@example.com", "b@example.com"],
    cc: "c@example.com",
    subject: "Hello",
    body: "Body text",
  });
  assert.match(mime, /^To: a@example.com, b@example.com\r\n/);
  assert.match(mime, /Cc: c@example.com\r\n/);
  assert.match(mime, /Subject: Hello\r\n/);
  assert.match(mime, /Content-Type: text\/plain/);
  assert.match(mime, /\r\n\r\nBody text$/);
});

test("gmail extracts text/plain body from message payload", () => {
  const message = {
    payload: {
      parts: [
        {
          mimeType: "text/plain",
          body: { data: base64UrlEncode("Plain body") },
        },
      ],
    },
  };
  assert.equal(extractBodyText(message), "Plain body");
});

test("gmail client throws auth required when no refresh token exists", async () => {
  const client = new GmailClient({
    repository: { getAccount: () => null },
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
    clientId: "client-id",
  });
  await assert.rejects(() => client.ensureAccessToken(), GmailAuthRequiredError);
});

test("gmail client sends base64url encoded raw MIME after token refresh", async () => {
  const saved = [];
  const calls = [];
  const client = new GmailClient({
    repository: {
      getAccount: () => ({ refreshToken: "refresh-token", accessToken: "", expiryDate: 0, scope: "" }),
      saveAccount: (patch) => saved.push(patch),
    },
    clientId: "client-id",
    fetchImpl: async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      if (String(url).includes("oauth2.googleapis.com")) {
        return {
          ok: true,
          json: async () => ({ access_token: "access-token", expires_in: 3600, scope: "gmail.send" }),
        };
      }
      return {
        ok: true,
        json: async () => ({ id: "msg-1", threadId: "thread-1", labelIds: ["SENT"] }),
      };
    },
  });

  const sent = await client.sendMessage({ to: "you@example.com", subject: "Hi", body: "There" });
  assert.equal(sent.id, "msg-1");
  assert.equal(saved[0].accessToken, "access-token");
  const gmailCall = calls.find((c) => c.url.includes("/messages/send"));
  assert.ok(gmailCall, "expected Gmail send call");
  const payload = JSON.parse(gmailCall.opts.body);
  const raw = base64UrlDecode(payload.raw);
  assert.match(raw, /To: you@example.com/);
  assert.match(raw, /Subject: Hi/);
  assert.match(raw, /There$/);
});
