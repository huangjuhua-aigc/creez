const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSandboxPolicy } = require("../electron/main/sandbox/sandboxPolicy.cjs");

test("sandbox tools expose read-only toolset for headless/external policies", async () => {
  const { createCreezSandboxTools } = await import("../electron/main/sandbox/sandboxTools.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "creez-tools-ro-"));
  for (const scenario of ["default", "headless", "remote_user"]) {
    const policy = createSandboxPolicy({ scenario, workDir: root });
    const tools = createCreezSandboxTools({ cwd: root, policy });
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["find", "grep", "ls", "read"], scenario);
  }
});

test("sandbox tools expose write and bash only for trusted desktop workspace-write", async () => {
  const { createCreezSandboxTools } = await import("../electron/main/sandbox/sandboxTools.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "creez-tools-rw-"));
  const policy = createSandboxPolicy({ scenario: "default_assistant", workDir: root });
  const tools = createCreezSandboxTools({ cwd: root, policy });
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["bash", "edit", "find", "grep", "ls", "read", "write"]);
});

test("read tool blocks sensitive files", async () => {
  const { createCreezSandboxTools } = await import("../electron/main/sandbox/sandboxTools.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "creez-tools-sensitive-"));
  await fs.writeFile(path.join(root, ".env"), "SECRET=1", "utf8");
  const policy = createSandboxPolicy({ scenario: "desktop_chat", workDir: root });
  const readTool = createCreezSandboxTools({ cwd: root, policy }).find((tool) => tool.name === "read");
  await assert.rejects(
    () => readTool.execute("tc", { path: ".env" }),
    /SENSITIVE_PATH/,
  );
});

test("write tool writes through to host only for default assistant", async () => {
  const { createCreezSandboxTools } = await import("../electron/main/sandbox/sandboxTools.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "creez-tools-host-write-"));
  const defaultPolicy = createSandboxPolicy({ scenario: "default_assistant", workDir: root });
  const defaultWrite = createCreezSandboxTools({ cwd: root, policy: defaultPolicy }).find((tool) => tool.name === "write");
  await defaultWrite.execute("tc", { path: "host.txt", content: "synced" });
  assert.equal(await fs.readFile(path.join(root, "host.txt"), "utf8"), "synced");

  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "creez-tools-no-host-write-"));
  const trustedPolicy = createSandboxPolicy({ scenario: "trusted_desktop", workDir: sandboxRoot });
  const trustedWrite = createCreezSandboxTools({ cwd: sandboxRoot, policy: trustedPolicy }).find((tool) => tool.name === "write");
  await assert.rejects(
    () => trustedWrite.execute("tc", { path: "blocked.txt", content: "nope" }),
    /HOST_WRITE_DISABLED/,
  );
  await assert.rejects(() => fs.stat(path.join(sandboxRoot, "blocked.txt")), /ENOENT/);
});
