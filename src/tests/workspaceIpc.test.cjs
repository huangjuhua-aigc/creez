const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");

const { CHANNELS } = require("../electron/main/channels.cjs");
const { registerWorkspaceIpc } = require("../electron/main/workspaceIpc.cjs");

function createIpcMainMock() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  };
}

async function createTempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("workspace IPC supports tree, CRUD and read/write", async () => {
  const workspaceRoot = await createTempDir("creezv2-workspace-");
  await fsp.writeFile(path.join(workspaceRoot, "hello.txt"), "hello", "utf8");
  await fsp.mkdir(path.join(workspaceRoot, "src"));

  const ipcMain = createIpcMainMock();
  const appStateStore = {
    async getState() {
      return { workspaceRoot };
    },
  };
  registerWorkspaceIpc(ipcMain, appStateStore);

  const tree = await ipcMain.handlers.get(CHANNELS.WORKSPACE_GET_TREE)(null, { depth: 3 });
  assert.equal(tree.ok, true);
  assert.equal(tree.data.rootPath.length > 0, true);
  assert.equal(Array.isArray(tree.data.nodes), true);

  const createFile = await ipcMain.handlers.get(CHANNELS.WORKSPACE_CREATE)(null, {
    parentPath: workspaceRoot,
    name: "new.txt",
    type: "file",
    content: "first",
  });
  assert.equal(createFile.ok, true);

  const read = await ipcMain.handlers.get(CHANNELS.WORKSPACE_READ_FILE)(null, {
    path: path.join(workspaceRoot, "new.txt"),
    encoding: "utf8",
  });
  assert.equal(read.ok, true);
  assert.equal(read.data.content, "first");

  const write = await ipcMain.handlers.get(CHANNELS.WORKSPACE_WRITE_FILE)(null, {
    path: path.join(workspaceRoot, "new.txt"),
    content: "updated",
    encoding: "utf8",
  });
  assert.equal(write.ok, true);

  const rename = await ipcMain.handlers.get(CHANNELS.WORKSPACE_RENAME)(null, {
    path: path.join(workspaceRoot, "new.txt"),
    newName: "renamed.txt",
  });
  assert.equal(rename.ok, true);

  const del = await ipcMain.handlers.get(CHANNELS.WORKSPACE_DELETE)(null, {
    path: path.join(workspaceRoot, "renamed.txt"),
  });
  assert.equal(del.ok, true);
});

test("workspace IPC blocks path outside workspace root", async () => {
  const workspaceRoot = await createTempDir("creezv2-workspace-root-");
  const outside = await createTempDir("creezv2-workspace-outside-");
  const outsideFile = path.join(outside, "outside.txt");
  await fsp.writeFile(outsideFile, "x", "utf8");

  const ipcMain = createIpcMainMock();
  const appStateStore = {
    async getState() {
      return { workspaceRoot };
    },
  };
  registerWorkspaceIpc(ipcMain, appStateStore);

  const read = await ipcMain.handlers.get(CHANNELS.WORKSPACE_READ_FILE)(null, {
    path: outsideFile,
    encoding: "utf8",
  });
  assert.equal(read.ok, false);
  assert.equal(read.error.code, "FORBIDDEN_PATH");
});
