const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { AppStateStore } = require("../electron/main/appStateStore.cjs");

function tempHomeDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("AppStateStore returns default state when file does not exist", async () => {
  const homeDir = await tempHomeDir("creezv2-home-default-");
  const store = new AppStateStore({ homeDir });

  const state = await store.getState();
  assert.equal(state.lastTab, "chat");
  assert.equal(state.lastChatId, null);
  assert.equal(state.workspaceRoot, null);
  assert.equal(state.isLoggedIn, false);
});

test("AppStateStore persists and merges state updates", async () => {
  const homeDir = await tempHomeDir("creezv2-home-merge-");
  const store = new AppStateStore({ homeDir });

  const firstWrite = await store.setState({ lastTab: "settings", isLoggedIn: true });
  assert.equal(firstWrite.lastTab, "settings");
  assert.equal(firstWrite.isLoggedIn, true);

  const secondWrite = await store.setState({ workspaceRoot: "/tmp/workspace" });
  assert.equal(secondWrite.lastTab, "settings");
  assert.equal(secondWrite.workspaceRoot, "/tmp/workspace");
  assert.equal(secondWrite.isLoggedIn, true);
});

test("AppStateStore falls back to defaults on malformed JSON", async () => {
  const homeDir = await tempHomeDir("creezv2-home-malformed-");
  const brokenPath = path.join(homeDir, ".creez", "app-state.json");
  await fs.mkdir(path.dirname(brokenPath), { recursive: true });
  await fs.writeFile(brokenPath, "{ malformed", "utf8");

  const store = new AppStateStore({ homeDir });
  const state = await store.getState();
  assert.equal(state.lastTab, "chat");
  assert.equal(state.isLoggedIn, false);
});
