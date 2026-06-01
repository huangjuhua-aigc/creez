const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createSandboxPolicy,
  isSensitivePath,
} = require("../electron/main/sandbox/sandboxPolicy.cjs");
const {
  analyzeCommand,
  executeCommand,
  getSimpleDeleteCommand,
  isDeleteCommand,
  isFileMutationCommand,
  validatePathAccess,
  requestPathAccess,
} = require("../electron/main/sandbox/sandboxRunner.cjs");

test("low trust scenarios are read-only", () => {
  for (const scenario of ["default", "remote_user", "a2a_agent", "auto_discovery", "headless"]) {
    const policy = createSandboxPolicy({ scenario, workDir: os.tmpdir() });
    assert.equal(policy.mode, "read-only");
    assert.equal(policy.allowWrite, false);
    assert.equal(policy.allowBash, false);
    assert.deepEqual(policy.writableRoots, []);
  }
});

test("trusted desktop scenarios use workspace-write sandbox", () => {
  for (const scenario of ["default_assistant", "trusted_desktop", "desktop_chat"]) {
    const policy = createSandboxPolicy({ scenario, workDir: os.tmpdir() });
    assert.equal(policy.mode, "workspace-write", scenario);
    assert.equal(policy.allowWrite, true, scenario);
    assert.equal(policy.allowBash, true, scenario);
    assert.equal(policy.writableRoots.length, 1, scenario);
    assert.equal(policy.hostWriteThrough, scenario === "default_assistant", scenario);
  }
});

test("path access stays inside sandbox and blocks sensitive paths", () => {
  const root = path.join(os.tmpdir(), "creez-sandbox-test");
  const policy = createSandboxPolicy({ scenario: "trusted_desktop", workDir: root });
  assert.equal(validatePathAccess(policy, path.join(root, "notes.txt"), "read"), path.join(root, "notes.txt"));
  assert.throws(() => validatePathAccess(policy, path.join(root, "..", "outside.txt"), "read"), /PATH_OUTSIDE_SANDBOX/);
  assert.throws(() => validatePathAccess(policy, path.join(root, ".env"), "read"), /SENSITIVE_PATH/);
  assert.equal(isSensitivePath(path.join(root, "id_rsa")), true);
});

test("local assistant can read bundled skills outside workspace but still blocks sensitive config", () => {
  const root = path.join(os.tmpdir(), "creez-sandbox-workspace");
  const agentDir = path.join(os.tmpdir(), "creez-sandbox-agent");
  const policy = createSandboxPolicy({ scenario: "default_assistant", workDir: root, agentDir });
  assert.equal(
    validatePathAccess(policy, path.join(agentDir, "skills", "demo", "SKILL.md"), "read"),
    path.join(agentDir, "skills", "demo", "SKILL.md"),
  );
  assert.throws(() => validatePathAccess(policy, path.join(agentDir, "auth.json"), "read"), /PATH_OUTSIDE_SANDBOX|SENSITIVE_PATH/);
  assert.throws(() => validatePathAccess(policy, path.join(agentDir, ".env"), "read"), /PATH_OUTSIDE_SANDBOX|SENSITIVE_PATH/);
});

test("local assistant can read explicit skill directories outside workspace", () => {
  const root = path.join(os.tmpdir(), "creez-sandbox-workspace");
  const appSkillsDir = path.join(os.tmpdir(), "creez-app-skills");
  const botSkillsDir = path.join(os.tmpdir(), "creez-bot-skills");
  const policy = createSandboxPolicy({
    scenario: "trusted_desktop",
    workDir: root,
    skillDirs: [appSkillsDir, botSkillsDir],
  });
  assert.equal(
    validatePathAccess(policy, path.join(appSkillsDir, "xiaohongshu", "SKILL.md"), "read"),
    path.join(appSkillsDir, "xiaohongshu", "SKILL.md"),
  );
  assert.equal(
    validatePathAccess(policy, path.join(botSkillsDir, "custom", "references", "guide.md"), "read"),
    path.join(botSkillsDir, "custom", "references", "guide.md"),
  );
  assert.throws(() => validatePathAccess(policy, path.join(appSkillsDir, "custom", ".env"), "read"), /SENSITIVE_PATH/);
});

test("read-only policy blocks writes", () => {
  const root = path.join(os.tmpdir(), "creez-sandbox-test");
  const policy = createSandboxPolicy({ scenario: "headless", workDir: root });
  assert.throws(() => validatePathAccess(policy, path.join(root, "out.txt"), "write"), /READ_ONLY/);
});

test("desktop sensitive paths require approval before access", async () => {
  const root = path.join(os.tmpdir(), "creez-sandbox-test");
  const deniedPolicy = createSandboxPolicy({ scenario: "trusted_desktop", workDir: root });
  await assert.rejects(
    () => requestPathAccess(deniedPolicy, path.join(root, ".env"), "read"),
    /SENSITIVE_PATH/,
  );

  const allowedPolicy = createSandboxPolicy({
    scenario: "trusted_desktop",
    workDir: root,
    requestApproval: async () => ({ allowed: true }),
  });
  assert.equal(
    await requestPathAccess(allowedPolicy, path.join(root, ".env"), "read"),
    path.join(root, ".env"),
  );
});

test("delete commands require approval in desktop sandbox", async () => {
  const root = path.join(os.tmpdir(), "creez-sandbox-test");
  const commands = [
    "rm notes.txt",
    "rm -f notes.txt",
    "del notes.txt",
    "erase notes.txt",
    "Remove-Item notes.txt",
    "rmdir old-folder",
    "git clean -fd",
    "rm \"C:/Users/huangjuhua-desktop/.creez/workplace/twitter_mobile.png\" && echo \"已删除！\"",
  ];
  for (const command of commands) {
    assert.equal(isDeleteCommand(command), true, command);
    let approvalCount = 0;
    const policy = createSandboxPolicy({
      scenario: "trusted_desktop",
      workDir: root,
      requestApproval: async (request) => {
        approvalCount++;
        assert.equal(request.risk, "dangerous_command");
        assert.equal(request.command, command);
        return { allowed: false };
      },
    });
    await assert.rejects(() => analyzeCommand(policy, command), /DANGEROUS_COMMAND/);
    assert.equal(approvalCount, 1, command);
  }
});

test("default assistant simple delete commands write through to host after approval", async () => {
  const fs = require("node:fs/promises");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "creez-sandbox-delete-"));
  const file = path.join(root, "notes.txt");
  await fs.writeFile(file, "delete me", "utf8");
  let approvalCount = 0;
  const policy = createSandboxPolicy({
    scenario: "default_assistant",
    workDir: root,
    requestApproval: async () => {
      approvalCount++;
      return { allowed: true };
    },
  });
  assert.deepEqual(getSimpleDeleteCommand("rm notes.txt"), { target: "notes.txt", recursive: false });
  const result = await executeCommand("rm notes.txt", root, { policy });
  assert.equal(result.exitCode, 0);
  assert.equal(approvalCount, 1);
  await assert.rejects(() => fs.stat(file), /ENOENT/);
});

test("non-default trusted scenarios do not use host delete adapter", async () => {
  const fs = require("node:fs/promises");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "creez-sandbox-no-host-delete-"));
  const file = path.join(root, "notes.txt");
  await fs.writeFile(file, "keep me", "utf8");
  const policy = createSandboxPolicy({
    scenario: "trusted_desktop",
    workDir: root,
    requestApproval: async () => ({ allowed: true }),
  });
  assert.equal(policy.hostWriteThrough, false);
  assert.deepEqual(getSimpleDeleteCommand("rm notes.txt"), { target: "notes.txt", recursive: false });
  await assert.rejects(() => executeCommand("rm notes.txt", root, { policy }), /HOST_WRITE_DISABLED/);
  assert.equal(await fs.readFile(file, "utf8"), "keep me");
});

test("default assistant shell file mutations require approval and write through to host", async () => {
  const fs = require("node:fs/promises");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "creez-sandbox-host-write-"));
  const file = path.join(root, "created.txt");
  let approvalCount = 0;
  const policy = createSandboxPolicy({
    scenario: "default_assistant",
    workDir: root,
    requestApproval: async (request) => {
      approvalCount++;
      assert.equal(request.risk, "host_filesystem_mutation");
      return { allowed: true };
    },
  });
  const command = process.platform === "win32"
    ? "echo hello> created.txt"
    : "printf hello > created.txt";
  assert.equal(isFileMutationCommand(command), true);
  const result = await executeCommand(command, root, { policy });
  assert.equal(result.exitCode, 0);
  assert.equal(approvalCount, 1);
  assert.match(await fs.readFile(file, "utf8"), /hello/);
});

test("non-default trusted scenarios reject host shell file mutations", async () => {
  const fs = require("node:fs/promises");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "creez-sandbox-host-write-deny-"));
  const policy = createSandboxPolicy({
    scenario: "trusted_desktop",
    workDir: root,
    requestApproval: async () => ({ allowed: true }),
  });
  const command = process.platform === "win32"
    ? "echo hello> created.txt"
    : "printf hello > created.txt";
  assert.equal(isFileMutationCommand(command), true);
  await assert.rejects(() => executeCommand(command, root, { policy }), /HOST_WRITE_DISABLED/);
  await assert.rejects(() => fs.stat(path.join(root, "created.txt")), /ENOENT/);
});
