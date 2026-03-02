const test = require("node:test");
const assert = require("node:assert/strict");

const { createSenderAdapter } = require("../electron/main/conversation/PiConversationEngine.cjs");
const { AGENT_EVENT_CHANNEL, AGENT_EVENT_ERROR_CHANNEL } = require("../electron/main/conversation/contract.cjs");

test("createSenderAdapter exposes callable isDestroyed method", () => {
  const sender = createSenderAdapter({});
  assert.equal(typeof sender.isDestroyed, "function");
  assert.equal(sender.isDestroyed(), false);
});

test("createSenderAdapter forwards event and error channels", () => {
  const events = [];
  const errors = [];
  const sender = createSenderAdapter({
    sendEvent: (payload) => events.push(payload),
    sendError: (message) => errors.push(message),
  });

  sender.send(AGENT_EVENT_CHANNEL, { type: "agent_ready" });
  sender.send(AGENT_EVENT_ERROR_CHANNEL, "Connection error.");
  sender.send("unknown:channel", { ignored: true });

  assert.deepEqual(events, [{ type: "agent_ready" }]);
  assert.deepEqual(errors, ["Connection error."]);
});
