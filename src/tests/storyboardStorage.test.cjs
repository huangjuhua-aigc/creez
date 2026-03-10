const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  getStoryboardRoot,
  DEFAULT_WORKSPACE_ROOT,
  ensureRootAndIndex,
  listProjects,
  getProject,
  createProject,
  updateProject,
  writeAssetFile,
  resolveAssetPath,
  emptyContent,
} = require("../electron/main/storyboard/storyboardStorage.cjs");

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("getStoryboardRoot uses workspaceRoot when set", () => {
  const root = getStoryboardRoot("/tmp/my-workspace");
  assert.equal(root, path.join("/tmp", "my-workspace", ".creez", "storyboard"));
});

test("getStoryboardRoot falls back to DEFAULT_WORKSPACE_ROOT when empty", () => {
  const root = getStoryboardRoot("");
  assert.equal(root, path.join(DEFAULT_WORKSPACE_ROOT, ".creez", "storyboard"));
  const rootNull = getStoryboardRoot(null);
  assert.equal(rootNull, path.join(DEFAULT_WORKSPACE_ROOT, ".creez", "storyboard"));
});

test("emptyContent returns valid content shape", () => {
  const c = emptyContent();
  assert.equal(typeof c.script, "string");
  assert.equal(c.script, "");
  assert.ok(Array.isArray(c.artAssets));
  assert.ok(Array.isArray(c.sceneImages));
  assert.ok(Array.isArray(c.sceneVideos));
  assert.ok(Array.isArray(c.audioBgm));
  assert.ok(Array.isArray(c.audioVoiceover));
  assert.ok(c.timeline && Array.isArray(c.timeline.tracks));
});

test("storyboard storage list, create, get, update", async () => {
  const storyboardRoot = await tempDir("creez-storyboard-");

  let list = await listProjects(storyboardRoot);
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 0);

  const projectId = await createProject(storyboardRoot, {
    title: "Test Project",
    prompt: "A test prompt",
  });
  assert.ok(projectId);
  assert.equal(projectId.length, 36);

  list = await listProjects(storyboardRoot);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, projectId);
  assert.equal(list[0].title, "Test Project");

  const project = await getProject(storyboardRoot, projectId);
  assert.ok(project);
  assert.equal(project.meta.title, "Test Project");
  assert.equal(project.meta.prompt, "A test prompt");
  assert.ok(project.content);
  assert.equal(project.content.script, "");
  assert.equal(project.content.artAssets.length, 0);

  assert.strictEqual(await getProject(storyboardRoot, "no-such-id"), null);
  assert.strictEqual(await getProject(storyboardRoot, ""), null);
  assert.strictEqual(await getProject(storyboardRoot, "../evil"), null);

  await updateProject(storyboardRoot, projectId, {
    meta: { title: "Updated Title" },
  });
  const afterUpdate = await getProject(storyboardRoot, projectId);
  assert.equal(afterUpdate.meta.title, "Updated Title");
  assert.equal(afterUpdate.meta.prompt, "A test prompt");

  const newContent = {
    ...emptyContent(),
    script: "Scene 1: intro",
  };
  await updateProject(storyboardRoot, projectId, { content: newContent });
  const afterContent = await getProject(storyboardRoot, projectId);
  assert.equal(afterContent.content.script, "Scene 1: intro");
});

test("storyboard writeAssetFile and resolveAssetPath", async () => {
  const storyboardRoot = await tempDir("creez-storyboard-asset-");
  const projectId = await createProject(storyboardRoot, {});

  const rel = await writeAssetFile(
    storyboardRoot,
    projectId,
    "generated/image",
    "gen-1.png",
    Buffer.from("fake-png")
  );
  assert.ok(rel.includes("assets"));
  assert.ok(rel.includes("generated/image"));
  assert.ok(rel.includes("gen-1.png"));

  const abs = resolveAssetPath(storyboardRoot, projectId, rel);
  assert.equal(abs, path.join(storyboardRoot, projectId, rel));
  const stat = await fs.stat(path.join(storyboardRoot, projectId, rel));
  assert.equal(stat.size, 8);
});

test("updateProject throws for invalid projectId", async () => {
  const storyboardRoot = await tempDir("creez-storyboard-invalid-");
  await assert.rejects(
    () => updateProject(storyboardRoot, "", { meta: { title: "x" } }),
    /Invalid projectId/
  );
  await assert.rejects(
    () => updateProject(storyboardRoot, "bad!!id", { meta: { title: "x" } }),
    /Invalid projectId/
  );
});
