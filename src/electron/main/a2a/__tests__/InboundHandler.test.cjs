const test = require("node:test");
const assert = require("node:assert/strict");
const { InboundHandler } = require("../handlers/InboundHandler.cjs");

function createMockOrchestrator() {
  const calls = [];
  return {
    calls,
    handleSessionOpened: async (event) => { calls.push({ method: "handleSessionOpened", event }); },
    handleInboundMessage: async (event) => { calls.push({ method: "handleInboundMessage", event }); },
    handleSessionClosed: async (event) => { calls.push({ method: "handleSessionClosed", event }); },
  };
}

test("routes session_opened to orchestrator", async () => {
  const orch = createMockOrchestrator();
  const handler = new InboundHandler(orch);

  await handler.onEvent({
    type: "session_opened",
    payload: { sessionId: "s1", fromAgentId: "a", toAgentId: "b" },
  });

  assert.equal(orch.calls.length, 1);
  assert.equal(orch.calls[0].method, "handleSessionOpened");
  assert.equal(orch.calls[0].event.payload.sessionId, "s1");
});

test("routes message_in to orchestrator", async () => {
  const orch = createMockOrchestrator();
  const handler = new InboundHandler(orch);

  await handler.onEvent({
    type: "message_in",
    sessionId: "s1",
    payload: { content: "hello", senderId: "agent-a" },
  });

  assert.equal(orch.calls.length, 1);
  assert.equal(orch.calls[0].method, "handleInboundMessage");
  assert.equal(orch.calls[0].event.sessionId, "s1");
  assert.equal(orch.calls[0].event.payload.content, "hello");
});

test("routes session_closed to orchestrator", async () => {
  const orch = createMockOrchestrator();
  const handler = new InboundHandler(orch);

  await handler.onEvent({
    type: "session_closed",
    sessionId: "s1",
    payload: { sessionId: "s1" },
  });

  assert.equal(orch.calls.length, 1);
  assert.equal(orch.calls[0].method, "handleSessionClosed");
});

test("heartbeat_ack does not call orchestrator", async () => {
  const orch = createMockOrchestrator();
  const handler = new InboundHandler(orch);

  await handler.onEvent({ type: "heartbeat_ack", payload: { message: "ok" } });
  assert.equal(orch.calls.length, 0);
});

test("unknown event type does not throw", async () => {
  const orch = createMockOrchestrator();
  const handler = new InboundHandler(orch);

  await handler.onEvent({ type: "some_future_event", payload: {} });
  assert.equal(orch.calls.length, 0);
});

test("handles orchestrator errors gracefully", async () => {
  const orch = {
    handleSessionOpened: async () => { throw new Error("test error"); },
    handleInboundMessage: async () => { throw new Error("test error"); },
    handleSessionClosed: async () => { throw new Error("test error"); },
  };
  const handler = new InboundHandler(orch);

  await handler.onEvent({
    type: "session_opened",
    payload: { sessionId: "s1" },
  });
  // Should not throw
});
