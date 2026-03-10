/**
 * Storyboard storage: <workspaceRoot>/.creez/storyboard/
 * - index.json: list of projects
 * - {projectId}/meta.json, content.json, assets/
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const INDEX_FILE = "index.json";
const META_FILE = "meta.json";
const CONTENT_FILE = "content.json";
const ASSETS_DIR = "assets";
const UPLOADS_SUBDIR = "uploads";
const GENERATED_IMAGE_SUBDIR = "generated/image";
const GENERATED_VIDEO_SUBDIR = "generated/video";

const DEFAULT_WORKSPACE_ROOT = path.join(
  require("node:os").homedir(),
  ".creez",
  "workplace"
);

/**
 * Resolve storyboard root. Uses workspaceRoot from app state; fallback DEFAULT_WORKSPACE_ROOT.
 * @param {string | null | undefined} workspaceRoot
 * @returns {string}
 */
function getStoryboardRoot(workspaceRoot) {
  const root =
    workspaceRoot && String(workspaceRoot).trim()
      ? String(workspaceRoot).trim()
      : DEFAULT_WORKSPACE_ROOT;
  return path.join(root, ".creez", "storyboard");
}

/**
 * Empty content for new projects.
 */
function emptyContent() {
  return {
    script: "",
    artAssets: [],
    sceneImages: [],
    sceneVideos: [],
    audioBgm: [],
    audioVoiceover: [],
    timeline: { tracks: [] },
  };
}

/**
 * Ensure storyboard root and index exist. Idempotent.
 * @param {string} storyboardRoot
 */
async function ensureRootAndIndex(storyboardRoot) {
  await fs.mkdir(storyboardRoot, { recursive: true });
  const indexPath = path.join(storyboardRoot, INDEX_FILE);
  try {
    await fs.access(indexPath);
  } catch {
    await fs.writeFile(
      indexPath,
      JSON.stringify({ projects: [] }, null, 2),
      "utf8"
    );
  }
}

/**
 * @param {string} storyboardRoot
 * @returns {Promise<Array<{ id: string, title: string, thumbnailPath?: string, createdAt: number, updatedAt: number }>>}
 */
async function listProjects(storyboardRoot) {
  await ensureRootAndIndex(storyboardRoot);
  const indexPath = path.join(storyboardRoot, INDEX_FILE);
  const raw = await fs.readFile(indexPath, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { projects: [] };
  }
  return Array.isArray(data.projects) ? data.projects : [];
}

/**
 * @param {string} storyboardRoot
 * @param {string} projectId
 * @returns {Promise<{ meta: object, content: object } | null>}
 */
async function getProject(storyboardRoot, projectId) {
  if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) return null;
  const dir = path.join(storyboardRoot, projectId);
  try {
    await fs.access(dir);
  } catch {
    return null;
  }
  const metaPath = path.join(dir, META_FILE);
  const contentPath = path.join(dir, CONTENT_FILE);
  let metaRaw;
  let contentRaw;
  try {
    metaRaw = await fs.readFile(metaPath, "utf8");
    contentRaw = await fs.readFile(contentPath, "utf8");
  } catch {
    return null;
  }
  let meta;
  let content;
  try {
    meta = JSON.parse(metaRaw);
    content = JSON.parse(contentRaw);
  } catch {
    return null;
  }
  return { meta, content };
}

/**
 * Create project dir and files. Returns projectId.
 * New projects start with empty content (script, assets, timeline).
 * @param {string} storyboardRoot
 * @param {{ title?: string, prompt?: string }} options
 * @returns {Promise<string>} projectId
 */
async function createProject(storyboardRoot, options = {}) {
  await ensureRootAndIndex(storyboardRoot);
  const projectId = randomUUID();
  const dir = path.join(storyboardRoot, projectId);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, ASSETS_DIR, UPLOADS_SUBDIR), {
    recursive: true,
  });
  await fs.mkdir(path.join(dir, ASSETS_DIR, GENERATED_IMAGE_SUBDIR), {
    recursive: true,
  });
  await fs.mkdir(path.join(dir, ASSETS_DIR, GENERATED_VIDEO_SUBDIR), {
    recursive: true,
  });

  const now = Math.floor(Date.now() / 1000);
  const meta = {
    title: options.title || "Untitled",
    prompt: options.prompt || "",
    supplementPayload: undefined,
    createdAt: now,
    updatedAt: now,
    thumbnailPath: undefined,
  };
  const content = emptyContent();

  await fs.writeFile(
    path.join(dir, META_FILE),
    JSON.stringify(meta, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(dir, CONTENT_FILE),
    JSON.stringify(content, null, 2),
    "utf8"
  );

  const indexPath = path.join(storyboardRoot, INDEX_FILE);
  const indexRaw = await fs.readFile(indexPath, "utf8");
  let indexData;
  try {
    indexData = JSON.parse(indexRaw);
  } catch {
    indexData = { projects: [] };
  }
  if (!Array.isArray(indexData.projects)) indexData.projects = [];
  indexData.projects.push({
    id: projectId,
    title: meta.title,
    thumbnailPath: undefined,
    createdAt: now,
    updatedAt: now,
  });
  await fs.writeFile(
    indexPath,
    JSON.stringify(indexData, null, 2),
    "utf8"
  );

  return projectId;
}

/**
 * Update project meta and/or content. Merges into index.
 * @param {string} storyboardRoot
 * @param {string} projectId
 * @param {{ meta?: object, content?: object }} updates
 */
async function updateProject(storyboardRoot, projectId, updates) {
  if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error("Invalid projectId");
  }
  const dir = path.join(storyboardRoot, projectId);
  await fs.access(dir);

  const now = Math.floor(Date.now() / 1000);

  if (updates.meta !== undefined) {
    const metaPath = path.join(dir, META_FILE);
    const existing = await getProject(storyboardRoot, projectId);
    const meta = {
      ...(existing?.meta || {}),
      ...updates.meta,
      updatedAt: now,
    };
    await fs.writeFile(
      metaPath,
      JSON.stringify(meta, null, 2),
      "utf8"
    );
  }

  if (updates.content !== undefined) {
    await fs.writeFile(
      path.join(dir, CONTENT_FILE),
      JSON.stringify(updates.content, null, 2),
      "utf8"
    );
  }

  const indexPath = path.join(storyboardRoot, INDEX_FILE);
  const indexRaw = await fs.readFile(indexPath, "utf8");
  let indexData;
  try {
    indexData = JSON.parse(indexRaw);
  } catch {
    indexData = { projects: [] };
  }
  const projects = Array.isArray(indexData.projects) ? indexData.projects : [];
  const idx = projects.findIndex((p) => p.id === projectId);
  const current = await getProject(storyboardRoot, projectId);
  const meta = current?.meta || {};
  const entry = {
    id: projectId,
    title: meta.title,
    thumbnailPath: meta.thumbnailPath,
    createdAt: meta.createdAt ?? now,
    updatedAt: now,
  };
  if (idx >= 0) {
    projects[idx] = { ...projects[idx], ...entry };
  } else {
    projects.push(entry);
  }
  indexData.projects = projects;
  await fs.writeFile(
    indexPath,
    JSON.stringify(indexData, null, 2),
    "utf8"
  );
}

/**
 * Write a file into project assets; returns relative path for use in content (e.g. assets/generated/image/xxx.png).
 * @param {string} storyboardRoot
 * @param {string} projectId
 * @param {'upload' | 'generated/image' | 'generated/video'} kind
 * @param {string} filename - e.g. "abc.png" or use a UUID
 * @param {Buffer | Uint8Array} data
 * @returns {Promise<string>} relative path
 */
async function writeAssetFile(storyboardRoot, projectId, kind, filename, data) {
  const dir = path.join(storyboardRoot, projectId, ASSETS_DIR);
  const sub =
    kind === "upload"
      ? UPLOADS_SUBDIR
      : kind === "generated/image"
        ? GENERATED_IMAGE_SUBDIR
        : GENERATED_VIDEO_SUBDIR;
  const fullDir = path.join(dir, sub);
  await fs.mkdir(fullDir, { recursive: true });
  const fullPath = path.join(fullDir, filename);
  await fs.writeFile(fullPath, data);
  return path.join(ASSETS_DIR, sub, filename).replace(/\\/g, "/");
}

/**
 * Resolve relative path to absolute file URL or path for reading.
 * @param {string} storyboardRoot
 * @param {string} projectId
 * @param {string} relativePath - e.g. "assets/generated/image/xxx.png"
 * @returns {string} absolute path
 */
function resolveAssetPath(storyboardRoot, projectId, relativePath) {
  return path.join(storyboardRoot, projectId, relativePath);
}

/**
 * Set the active source/generation for a resource inside a project's content.
 * @param {string} storyboardRoot
 * @param {string} projectId
 * @param {'artAsset'|'sceneImage'|'sceneVideo'} resourceType
 * @param {string} resourceId
 * @param {'upload'|'ai_generation'} activeSource
 * @param {string|undefined} activeGenerationId
 */
async function setActive(storyboardRoot, projectId, resourceType, resourceId, activeSource, activeGenerationId) {
  if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("Invalid projectId");
  const project = await getProject(storyboardRoot, projectId);
  if (!project) throw new Error("Project not found");
  const content = project.content || emptyContent();

  const listKey = resourceType === "artAsset" ? "artAssets" : resourceType === "sceneImage" ? "sceneImages" : "sceneVideos";
  const list = content[listKey];
  if (!Array.isArray(list)) throw new Error(`No ${listKey} array in content`);
  const item = list.find((r) => r.id === resourceId);
  if (!item) throw new Error(`Resource ${resourceId} not found in ${listKey}`);

  item.activeSource = activeSource;
  item.activeGenerationId = activeSource === "ai_generation" ? activeGenerationId : undefined;

  await updateProject(storyboardRoot, projectId, { content });
}

/**
 * Remove an asset or scene video from the project content and from timeline clips that reference it.
 * @param {string} storyboardRoot
 * @param {string} projectId
 * @param {'artAsset'|'sceneImage'|'sceneVideo'} resourceType
 * @param {string} resourceId
 */
async function removeResource(storyboardRoot, projectId, resourceType, resourceId) {
  if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("Invalid projectId");
  const project = await getProject(storyboardRoot, projectId);
  if (!project) throw new Error("Project not found");
  const content = project.content || emptyContent();

  const listKey = resourceType === "artAsset" ? "artAssets" : resourceType === "sceneImage" ? "sceneImages" : "sceneVideos";
  const list = content[listKey];
  if (!Array.isArray(list)) return;
  const nextList = list.filter((r) => r.id !== resourceId);
  if (nextList.length === list.length) return;
  content[listKey] = nextList;

  const timeline = content.timeline;
  if (timeline && Array.isArray(timeline.tracks)) {
    timeline.tracks = timeline.tracks.map((track) => ({
      ...track,
      clips: (track.clips || []).filter(
        (clip) => !(clip.resourceType === resourceType && clip.id === resourceId)
      ),
    }));
  }

  await updateProject(storyboardRoot, projectId, { content });
}

/**
 * Remove a single AI generation from a resource.
 */
async function removeGeneration(storyboardRoot, projectId, resourceType, resourceId, generationId) {
  if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("Invalid projectId");
  const project = await getProject(storyboardRoot, projectId);
  if (!project) throw new Error("Project not found");
  const content = project.content || emptyContent();

  const listKey = resourceType === "artAsset" ? "artAssets" : resourceType === "sceneImage" ? "sceneImages" : "sceneVideos";
  const list = content[listKey];
  if (!Array.isArray(list)) return;
  const item = list.find((r) => r.id === resourceId);
  if (!item) return;

  const genKey = (resourceType === "sceneVideo") ? "aiVideoGenerations" : "aiImageGenerations";
  if (!Array.isArray(item[genKey])) return;
  item[genKey] = item[genKey].filter((g) => g.id !== generationId);

  if (item.activeGenerationId === generationId) {
    item.activeGenerationId = item[genKey][0]?.id;
    item.activeSource = item.activeGenerationId ? "ai_generation" : "ai_generation";
  }

  await updateProject(storyboardRoot, projectId, { content });
}

/**
 * Add a new empty resource to the project.
 * @param {string} storyboardRoot
 * @param {string} projectId
 * @param {'artAsset'|'sceneImage'|'sceneVideo'} resourceType
 * @param {string} name
 * @param {{ activeSource?: 'ai_generation'|'local_disk', localPath?: string }} [opts]
 * @returns {Promise<{id:string}>} the new resource id
 */
async function addResource(storyboardRoot, projectId, resourceType, name, opts) {
  if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("Invalid projectId");
  const project = await getProject(storyboardRoot, projectId);
  if (!project) throw new Error("Project not found");
  const content = project.content || emptyContent();

  const listKey = resourceType === "artAsset" ? "artAssets" : resourceType === "sceneImage" ? "sceneImages" : "sceneVideos";
  if (!Array.isArray(content[listKey])) content[listKey] = [];

  const id = `${resourceType.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const genKey = resourceType === "sceneVideo" ? "aiVideoGenerations" : "aiImageGenerations";
  const activeSource = opts?.activeSource === "local_disk" ? "local_disk" : "ai_generation";
  const item = { id, name, [genKey]: [], activeSource };
  if (activeSource === "local_disk" && opts?.localPath) item.localPath = opts.localPath;

  content[listKey].push(item);
  await updateProject(storyboardRoot, projectId, { content });
  return { id };
}

/**
 * Set localImage (and optionally localPath) on a resource. Used after uploading a file for local_disk assets.
 * @param {string} storyboardRoot
 * @param {string} projectId
 * @param {'artAsset'|'sceneImage'} resourceType
 * @param {string} resourceId
 * @param {string} localImagePath - relative path e.g. "assets/uploads/xxx.jpg"
 */
async function setResourceLocalImage(storyboardRoot, projectId, resourceType, resourceId, localImagePath) {
  if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("Invalid projectId");
  const project = await getProject(storyboardRoot, projectId);
  if (!project) throw new Error("Project not found");
  const content = project.content || emptyContent();
  const listKey = resourceType === "artAsset" ? "artAssets" : "sceneImages";
  const list = content[listKey];
  if (!Array.isArray(list)) return;
  const item = list.find((r) => r.id === resourceId);
  if (!item) return;
  item.localImage = localImagePath;
  item.localPath = item.localPath || localImagePath;
  await updateProject(storyboardRoot, projectId, { content });
}

/**
 * Write an uploaded file to project assets and set the resource's localImage.
 * @param {string} storyboardRoot
 * @param {string} projectId
 * @param {'artAsset'|'sceneImage'} resourceType
 * @param {string} resourceId
 * @param {Buffer|Uint8Array} data
 * @param {string} filename - e.g. "image.jpg"
 * @returns {Promise<string>} relative path set on the resource
 */
async function uploadLocalAssetFile(storyboardRoot, projectId, resourceType, resourceId, data, filename) {
  const ext = path.extname(filename) || ".jpg";
  const safeName = `${resourceId}-${Date.now()}${ext}`;
  const relativePath = await writeAssetFile(storyboardRoot, projectId, "upload", safeName, data);
  await setResourceLocalImage(storyboardRoot, projectId, resourceType, resourceId, relativePath);
  return relativePath;
}

/**
 * Delete a project: remove its directory and remove from index.
 * @param {string} storyboardRoot
 * @param {string} projectId
 */
async function deleteProject(storyboardRoot, projectId) {
  if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error("Invalid projectId");
  }
  const dir = path.join(storyboardRoot, projectId);
  try {
    await fs.rm(dir, { recursive: true });
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
  const indexPath = path.join(storyboardRoot, INDEX_FILE);
  let indexRaw;
  try {
    indexRaw = await fs.readFile(indexPath, "utf8");
  } catch {
    return;
  }
  let indexData;
  try {
    indexData = JSON.parse(indexRaw);
  } catch {
    return;
  }
  if (!Array.isArray(indexData.projects)) return;
  indexData.projects = indexData.projects.filter((p) => p.id !== projectId);
  await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2), "utf8");
}

module.exports = {
  getStoryboardRoot,
  DEFAULT_WORKSPACE_ROOT,
  ensureRootAndIndex,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  writeAssetFile,
  resolveAssetPath,
  emptyContent,
  setActive,
  removeResource,
  removeGeneration,
  addResource,
  setResourceLocalImage,
  uploadLocalAssetFile,
};
