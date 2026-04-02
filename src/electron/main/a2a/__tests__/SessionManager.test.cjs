const test = require("node:test");
const assert = require("node:assert/strict");
const { SessionManager } = require("../SessionManager.cjs");

test("register and get session", () => {
  const mgr = new SessionManager();
  const session = mgr.register({
    sessionId: "s1",
    fromAgentId: "agent-a",
    toAgentId: "agent-b",
    localAgentId: "agent-b",
    remoteAgentId: "agent-a",
    localChatId: "chat-1",
    state: "pending",
    maxTurns: 10,
  });

  assert.equal(session.sessionId, "s1");
  assert.equal(session.state, "pending");
  assert.equal(session.maxTurns, 10);
  assert.equal(session.turnCount, 0);

  const got = mgr.get("s1");
  assert.equal(got.sessionId, "s1");
  assert.equal(got.localAgentId, "agent-b");
});

test("get returns null for unknown session", () => {
  const mgr = new SessionManager();
  assert.equal(mgr.get("unknown"), null);
});

test("getByLocalChatId", () => {
  const mgr = new SessionManager();
  mgr.register({
    sessionId: "s1",
    fromAgentId: "a",
    toAgentId: "b",
    localAgentId: "b",
    remoteAgentId: "a",
    localChatId: "chat-x",
  });

  const found = mgr.getByLocalChatId("chat-x");
  assert.equal(found.sessionId, "s1");
  assert.equal(mgr.getByLocalChatId("no-such-chat"), null);
});

test("recordTurn increments turn count", () => {
  const mgr = new SessionManager();
  mgr.register({
    sessionId: "s1",
    fromAgentId: "a",
    toAgentId: "b",
    localAgentId: "b",
    remoteAgentId: "a",
    maxTurns: 5,
  });

  mgr.recordTurn("s1");
  assert.equal(mgr.get("s1").turnCount, 1);

  mgr.recordTurn("s1");
  assert.equal(mgr.get("s1").turnCount, 2);

  assert.equal(mgr.recordTurn("nonexistent"), null);
});

test("shouldEnd respects maxTurns", () => {
  const mgr = new SessionManager();
  mgr.register({
    sessionId: "s1",
    fromAgentId: "a",
    toAgentId: "b",
    localAgentId: "b",
    remoteAgentId: "a",
    maxTurns: 2,
  });

  assert.equal(mgr.shouldEnd("s1"), false);

  mgr.recordTurn("s1");
  assert.equal(mgr.shouldEnd("s1"), false);

  mgr.recordTurn("s1");
  assert.equal(mgr.shouldEnd("s1"), true);
});

test("shouldEnd returns true for ended sessions", () => {
  const mgr = new SessionManager();
  mgr.register({
    sessionId: "s1",
    fromAgentId: "a",
    toAgentId: "b",
    localAgentId: "b",
    remoteAgentId: "a",
  });

  mgr.setState("s1", "ended");
  assert.equal(mgr.shouldEnd("s1"), true);
});

test("shouldEnd returns true for unknown sessions", () => {
  const mgr = new SessionManager();
  assert.equal(mgr.shouldEnd("unknown"), true);
});

test("setState updates session state", () => {
  const mgr = new SessionManager();
  mgr.register({
    sessionId: "s1",
    fromAgentId: "a",
    toAgentId: "b",
    localAgentId: "b",
    remoteAgentId: "a",
  });

  mgr.setState("s1", "running");
  assert.equal(mgr.get("s1").state, "running");
});

test("remove deletes session", () => {
  const mgr = new SessionManager();
  mgr.register({
    sessionId: "s1",
    fromAgentId: "a",
    toAgentId: "b",
    localAgentId: "b",
    remoteAgentId: "a",
  });

  mgr.remove("s1");
  assert.equal(mgr.get("s1"), null);
});

test("listActive excludes ended sessions", () => {
  const mgr = new SessionManager();
  mgr.register({ sessionId: "s1", fromAgentId: "a", toAgentId: "b", localAgentId: "b", remoteAgentId: "a" });
  mgr.register({ sessionId: "s2", fromAgentId: "a", toAgentId: "c", localAgentId: "c", remoteAgentId: "a" });
  mgr.setState("s1", "ended");

  const active = mgr.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].sessionId, "s2");
});

test("clear removes all sessions", () => {
  const mgr = new SessionManager();
  mgr.register({ sessionId: "s1", fromAgentId: "a", toAgentId: "b", localAgentId: "b", remoteAgentId: "a" });
  mgr.register({ sessionId: "s2", fromAgentId: "a", toAgentId: "c", localAgentId: "c", remoteAgentId: "a" });

  mgr.clear();
  assert.equal(mgr.listActive().length, 0);
  assert.equal(mgr.get("s1"), null);
});

test("default maxTurns is 20", () => {
  const mgr = new SessionManager();
  const session = mgr.register({ sessionId: "s1", fromAgentId: "a", toAgentId: "b", localAgentId: "b", remoteAgentId: "a" });
  assert.equal(session.maxTurns, 20);
});
