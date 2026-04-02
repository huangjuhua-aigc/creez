const test = require("node:test");
const assert = require("node:assert/strict");
const { A2AGatewayClient } = require("../A2AGatewayClient.cjs");

test("constructor stores gatewayUrl and ownerId", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "device-1" });
  assert.equal(client.gatewayUrl, "http://localhost:3001");
  assert.equal(client.ownerId, "device-1");
  assert.equal(client.connectionState, "disconnected");
  client.destroy();
});

test("constructor strips trailing slashes", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001//", ownerId: "d1" });
  assert.equal(client.gatewayUrl, "http://localhost:3001");
  client.destroy();
});

test("destroy stops heartbeat and sets destroyed", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "d1" });
  client._heartbeatTimer = setInterval(() => {}, 100000);
  client.destroy();
  assert.equal(client._heartbeatTimer, null);
  assert.equal(client._destroyed, true);
});

test("startHeartbeat and stopHeartbeat", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "d1" });

  client.startHeartbeat(["a1", "a2"]);
  assert.ok(client._heartbeatTimer !== null);
  assert.deepEqual(client._heartbeatAgentIds, ["a1", "a2"]);

  client.stopHeartbeat();
  assert.equal(client._heartbeatTimer, null);
  client.destroy();
});

test("startHeartbeat with empty array does nothing", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "d1" });
  client.startHeartbeat([]);
  assert.equal(client._heartbeatTimer, null);
  client.destroy();
});

test("disconnectSSE clears reconnect timer", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "d1" });
  client._reconnectTimer = setTimeout(() => {}, 100000);
  client.disconnectSSE();
  assert.equal(client._reconnectTimer, null);
  assert.equal(client._sseState, "disconnected");
  client.destroy();
});

test("connectSSE does nothing when destroyed", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "d1" });
  client.destroy();
  client.connectSSE(() => {});
  assert.equal(client._sseState, "disconnected");
});

test("_parseSSEBlock parses event correctly", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "d1" });
  const events = [];
  client._onEvent = (e) => events.push(e);

  client._parseSSEBlock('event: message_in\ndata: {"sessionId":"s1","payload":{"content":"hi"}}');

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "message_in");
  assert.equal(events[0].sessionId, "s1");

  client.destroy();
});

test("_parseSSEBlock ignores keepalive comments", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "d1" });
  const events = [];
  client._onEvent = (e) => events.push(e);

  client._parseSSEBlock(": keepalive");
  assert.equal(events.length, 0);

  client.destroy();
});

test("_parseSSEBlock handles missing data", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "d1" });
  const events = [];
  client._onEvent = (e) => events.push(e);

  client._parseSSEBlock("event: heartbeat_ack");
  assert.equal(events.length, 0);

  client.destroy();
});

test("_parseSSEBlock handles malformed JSON", () => {
  const client = new A2AGatewayClient({ gatewayUrl: "http://localhost:3001", ownerId: "d1" });
  const events = [];
  client._onEvent = (e) => events.push(e);

  client._parseSSEBlock("data: {not json}");
  assert.equal(events.length, 0);

  client.destroy();
});
