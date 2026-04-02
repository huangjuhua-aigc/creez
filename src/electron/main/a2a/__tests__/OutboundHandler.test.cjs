const test = require("node:test");
const assert = require("node:assert/strict");
const { OutboundHandler } = require("../handlers/OutboundHandler.cjs");

function createMockClient() {
  const calls = [];
  return {
    calls,
    sendMessage: async (req) => {
      calls.push({ method: "sendMessage", req });
      return { messageId: "msg-1", seq: calls.filter((c) => c.method === "sendMessage").length };
    },
    openSession: async (req) => {
      calls.push({ method: "openSession", req });
      return { sessionId: "session-new", state: "pending" };
    },
    closeSession: async (sessionId, reason) => {
      calls.push({ method: "closeSession", sessionId, reason });
      return { closed: true };
    },
  };
}

function createMockChatRepo() {
  const messages = [];
  return {
    messages,
    appendMessage: (msg) => { messages.push(msg); },
  };
}

test("sendMessage calls client and returns result", async () => {
  const client = createMockClient();
  const handler = new OutboundHandler(client);

  const result = await handler.sendMessage("s1", "Hello!", "agent-a", null);

  assert.equal(result.messageId, "msg-1");
  assert.equal(result.seq, 1);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].req.sessionId, "s1");
  assert.equal(client.calls[0].req.content, "Hello!");
  assert.equal(client.calls[0].req.senderId, "agent-a");
});

test("sendMessage caches locally when chatRepo and chatId are provided", async () => {
  const client = createMockClient();
  const chatRepo = createMockChatRepo();
  const handler = new OutboundHandler(client, { chatRepo });

  await handler.sendMessage("s1", "Reply text", "agent-b", "local-chat-1");

  assert.equal(chatRepo.messages.length, 1);
  assert.equal(chatRepo.messages[0].chatId, "local-chat-1");
  assert.equal(chatRepo.messages[0].content, "Reply text");
  assert.equal(chatRepo.messages[0].sender, "assistant");
  assert.equal(chatRepo.messages[0].channelType, "a2a");
});

test("sendMessage does not cache when no chatId", async () => {
  const client = createMockClient();
  const chatRepo = createMockChatRepo();
  const handler = new OutboundHandler(client, { chatRepo });

  await handler.sendMessage("s1", "Reply", "agent-a", null);
  assert.equal(chatRepo.messages.length, 0);
});

test("initiateSession opens session and sends opening message", async () => {
  const client = createMockClient();
  const handler = new OutboundHandler(client);

  const result = await handler.initiateSession("agent-a", "agent-b", "Hi!");

  assert.equal(result.sessionId, "session-new");
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].method, "openSession");
  assert.equal(client.calls[1].method, "sendMessage");
  assert.equal(client.calls[1].req.content, "Hi!");
});

test("initiateSession without opening message", async () => {
  const client = createMockClient();
  const handler = new OutboundHandler(client);

  await handler.initiateSession("agent-a", "agent-b", null);

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].method, "openSession");
});

test("closeSession delegates to client", async () => {
  const client = createMockClient();
  const handler = new OutboundHandler(client);

  const result = await handler.closeSession("s1", "user_closed");

  assert.equal(result.closed, true);
  assert.equal(client.calls[0].sessionId, "s1");
  assert.equal(client.calls[0].reason, "user_closed");
});
