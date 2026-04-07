const { CHANNELS } = require("./channels.cjs");
const path = require("node:path");

const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");

/**
 * Convert a single reference image URL/path to a base64 data URI for the Doubao API.
 * @param {string} url - file path, file://, creez-asset://projectId/path, http(s) URL, or data:image/...;base64,...
 * @param {string} projectId - for resolving creez-asset paths
 * @param {string} storyboardRoot - absolute path to storyboard root
 * @returns {Promise<string|null>} data:image/xxx;base64,... or null on failure
 */
async function referenceUrlToBase64DataUri(url, projectId, storyboardRoot) {
  if (!url || typeof url !== "string") return null;
  const s = url.trim();
  if (s.startsWith("data:image/")) return s;

  let buf;
  if (s.startsWith("creez-asset://")) {
    try {
      const u = new URL(s);
      const relPath = decodeURIComponent(u.pathname).replace(/^\/+/, "").replace(/\//g, path.sep);
      const absPath = path.join(storyboardRoot, u.hostname || projectId, relPath);
      buf = await fs.readFile(absPath);
    } catch (e) {
      console.warn("[creez storyboard] referenceUrlToBase64 creez-asset failed", s.slice(0, 60), e?.message);
      return null;
    }
  } else if (s.startsWith("file:///")) {
    try {
      const filePath = s.replace(/^file:\/\/\//, "").replace(/\//g, path.sep);
      buf = await fs.readFile(filePath);
    } catch (e) {
      console.warn("[creez storyboard] referenceUrlToBase64 file failed", s.slice(0, 60), e?.message);
      return null;
    }
  } else if (/^[A-Za-z]:[\\/]|^\/[^/]/.test(s) || path.isAbsolute(s)) {
    try {
      buf = await fs.readFile(s);
    } catch (e) {
      console.warn("[creez storyboard] referenceUrlToBase64 path failed", s.slice(0, 60), e?.message);
      return null;
    }
  } else if (s.startsWith("http://") || s.startsWith("https://")) {
    try {
      const res = await fetch(s);
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.warn("[creez storyboard] referenceUrlToBase64 fetch failed", s.slice(0, 60), e?.message);
      return null;
    }
  } else {
    const absPath = path.join(storyboardRoot, projectId, s.replace(/\//g, path.sep));
    try {
      buf = await fs.readFile(absPath);
    } catch (e) {
      console.warn("[creez storyboard] referenceUrlToBase64 relative failed", s.slice(0, 60), e?.message);
      return null;
    }
  }

  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e;
  const mime = isPng ? "image/png" : "image/jpeg";
  const base64 = buf.toString("base64");
  return `data:${mime};base64,${base64}`;
}
const {
  getStoryboardRoot,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject: deleteProjectStorage,
  writeAssetFile,
  setActive: setActiveStorage,
  removeResource: removeResourceStorage,
  removeGeneration: removeGenerationStorage,
  addResource: addResourceStorage,
  uploadLocalAssetFile: uploadLocalAssetFileStorage,
} = require("./storyboard/storyboardStorage.cjs");

const { resolveCreezBackendBase } = require("./creezBackendBase.cjs");
const { isCreezVerboseDebug } = require("./creezDebug.cjs");

const DEFAULT_CREEZ_API_KEY = "make_creator_easy";

function storyboardBackendBase() {
  return resolveCreezBackendBase();
}

function backendUnreachableMessage() {
  const base = storyboardBackendBase();
  return `Backend unreachable at ${base}. Check network or set CREEZ_BACKEND_URL for a different host.`;
}

/** 无超时的 HTTP Agent，用于耗时的 storyboard/generate 请求，避免 UND_ERR_HEADERS_TIMEOUT */
let noTimeoutAgent = null;
function getNoTimeoutAgent() {
  if (noTimeoutAgent) return noTimeoutAgent;
  try {
    const { Agent } = require("undici");
    noTimeoutAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  } catch (_) {
    noTimeoutAgent = false;
  }
  return noTimeoutAgent;
}

/** 解析 chunked 故事板响应：服务端先发 ": heartbeat\n"，最后一行是 JSON */
async function parseChunkedStoryboardBody(response) {
  const text = await response.text();
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const lastJsonLine = lines.filter((line) => !line.startsWith(":")).pop();
  if (!lastJsonLine) return {};
  try {
    return JSON.parse(lastJsonLine);
  } catch {
    return {};
  }
}

function ok(data) {
  return { ok: true, data };
}

function err(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ appStateStore: { getState: () => Promise<{ workspaceRoot?: string | null; creezApiKey?: string | null }> }; skillManager?: { getSkillEnv: (skillId: string) => Promise<Record<string, string>> } }} deps
 */
function registerStoryboardIpc(ipcMain, deps) {
  const { appStateStore, skillManager } = deps;

  async function getRoot() {
    const state = appStateStore ? await appStateStore.getState() : {};
    return getStoryboardRoot(state.workspaceRoot ?? null);
  }

  /** Creez API Key: 优先 ~/.creez/.env（与小红书技能一致），其次应用状态，再环境变量，最后默认值。 */
  async function getCreezApiKey() {
    if (skillManager && typeof skillManager.getSkillEnv === "function") {
      const env = await skillManager.getSkillEnv("creez");
      const fromEnv = env.CREEZ_API_KEY != null && String(env.CREEZ_API_KEY).trim() !== "" ? String(env.CREEZ_API_KEY).trim() : null;
      if (fromEnv) return fromEnv;
    }
    const state = appStateStore ? await appStateStore.getState() : {};
    const fromState = state.creezApiKey != null && String(state.creezApiKey).trim() !== "" ? String(state.creezApiKey).trim() : null;
    if (fromState) return fromState;
    return process.env.CREEZ_API_KEY || DEFAULT_CREEZ_API_KEY;
  }

  ipcMain.handle(CHANNELS.STORYBOARD_LIST, async () => {
    try {
      const root = await getRoot();
      const projects = await listProjects(root);
      return ok({
        items: projects.map((p) => ({
          id: p.id,
          title: p.title,
          thumbnailPath: p.thumbnailPath,
          thumbnailUrl: p.thumbnailPath
            ? null
            : null,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      });
    } catch (e) {
      console.error("[creez storyboard] list error", e?.message || e);
      return err("LIST_ERROR", e?.message || "Failed to list projects");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_GET, async (_event, payload) => {
    const projectId =
      payload?.projectId != null ? String(payload.projectId).trim() : "";
    if (!projectId) return err("VALIDATION_ERROR", "projectId is required");
    try {
      const root = await getRoot();
      const project = await getProject(root, projectId);
      if (!project) return err("NOT_FOUND", "Project not found");
      const { meta, content } = project;
      return ok({
        id: projectId,
        title: meta.title,
        thumbnailUrl: meta.thumbnailPath ?? null,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        prompt: meta.prompt,
        supplementPayload: meta.supplementPayload,
        content,
      });
    } catch (e) {
      console.error("[creez storyboard] get error", e?.message || e);
      return err("GET_ERROR", e?.message || "Failed to get project");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_CREATE, async (_event, payload) => {
    const title =
      payload?.title != null ? String(payload.title).trim() : undefined;
    const prompt =
      payload?.prompt != null ? String(payload.prompt).trim() : undefined;
    try {
      const root = await getRoot();
      const projectId = await createProject(root, {
        title: title || "Untitled",
        prompt: prompt || "",
      });
      return ok({ projectId });
    } catch (e) {
      console.error("[creez storyboard] create error", e?.message || e);
      return err("CREATE_ERROR", e?.message || "Failed to create project");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_DELETE_PROJECT, async (_event, payload) => {
    const projectId =
      payload?.projectId != null ? String(payload.projectId).trim() : "";
    if (!projectId) return err("VALIDATION_ERROR", "projectId is required");
    try {
      const root = await getRoot();
      await deleteProjectStorage(root, projectId);
      return ok({ deleted: true });
    } catch (e) {
      console.error("[creez storyboard] deleteProject error", e?.message || e);
      return err("DELETE_ERROR", e?.message || "Failed to delete project");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_UPDATE, async (_event, payload) => {
    const projectId =
      payload?.projectId != null ? String(payload.projectId).trim() : "";
    if (!projectId) return err("VALIDATION_ERROR", "projectId is required");
    const metaPatch = payload?.meta;
    const contentPatch = payload?.content;
    if (metaPatch === undefined && contentPatch === undefined) {
      return err("VALIDATION_ERROR", "Provide meta and/or content to update");
    }
    try {
      const root = await getRoot();
      const updates = {};
      if (metaPatch !== undefined) updates.meta = metaPatch;
      if (contentPatch !== undefined) updates.content = contentPatch;
      await updateProject(root, projectId, updates);
      return ok({ updated: true });
    } catch (e) {
      console.error("[creez storyboard] update error", e?.message || e);
      return err("UPDATE_ERROR", e?.message || "Failed to update project");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_GET_ASSET_URL, async (_event, payload) => {
    const projectId = payload?.projectId != null ? String(payload.projectId).trim() : "";
    const relativePath = payload?.relativePath != null ? String(payload.relativePath).trim() : "";
    if (!projectId || !relativePath) return err("VALIDATION_ERROR", "projectId and relativePath are required");
    try {
      const encoded = encodeURI(relativePath.replace(/\\/g, "/"));
      const url = `creez-asset://${projectId}/${encoded}`;
      return ok({ url });
    } catch (e) {
      console.error("[creez storyboard] getAssetUrl error", e?.message || e);
      return err("GET_ASSET_URL_ERROR", e?.message || "Failed to resolve asset URL");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_SET_ACTIVE, async (_event, payload) => {
    const projectId =
      payload?.projectId != null ? String(payload.projectId).trim() : "";
    const resourceType = payload?.resourceType;
    const resourceId =
      payload?.resourceId != null ? String(payload.resourceId).trim() : "";
    const activeSource = payload?.activeSource;
    const activeGenerationId = payload?.activeGenerationId;
    if (!projectId || !resourceType || !resourceId || !activeSource) {
      return err(
        "VALIDATION_ERROR",
        "projectId, resourceType, resourceId, activeSource are required"
      );
    }
    if (
      resourceType !== "artAsset" &&
      resourceType !== "sceneImage" &&
      resourceType !== "sceneVideo"
    ) {
      return err("VALIDATION_ERROR", "resourceType must be artAsset | sceneImage | sceneVideo");
    }
    if (
      activeSource === "ai_generation" &&
      (activeGenerationId == null || String(activeGenerationId).trim() === "")
    ) {
      return err("VALIDATION_ERROR", "activeGenerationId required when activeSource is ai_generation");
    }
    try {
      const root = await getRoot();
      await setActiveStorage(
        root,
        projectId,
        resourceType,
        resourceId,
        activeSource,
        activeSource === "ai_generation" ? String(activeGenerationId).trim() : undefined
      );
      return ok({ updated: true });
    } catch (e) {
      console.error("[creez storyboard] setActive error", e?.message || e);
      return err("SET_ACTIVE_ERROR", e?.message || "Failed to set active");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_DELETE_RESOURCE, async (_event, payload) => {
    const projectId = payload?.projectId != null ? String(payload.projectId).trim() : "";
    const resourceType = payload?.resourceType;
    const resourceId = payload?.resourceId != null ? String(payload.resourceId).trim() : "";
    if (!projectId || !resourceId) return err("VALIDATION_ERROR", "projectId and resourceId are required");
    const allowed = ["artAsset", "sceneImage", "sceneVideo"];
    if (!allowed.includes(resourceType)) return err("VALIDATION_ERROR", "resourceType must be artAsset, sceneImage, or sceneVideo");
    try {
      const root = await getRoot();
      await removeResourceStorage(root, projectId, resourceType, resourceId);
      return ok({ deleted: true });
    } catch (e) {
      console.error("[creez storyboard] deleteResource error", e?.message || e);
      return err("DELETE_ERROR", e?.message || "Failed to delete resource");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_DELETE_GENERATION, async (_event, payload) => {
    const projectId = payload?.projectId != null ? String(payload.projectId).trim() : "";
    const resourceType = payload?.resourceType;
    const resourceId = payload?.resourceId != null ? String(payload.resourceId).trim() : "";
    const generationId = payload?.generationId != null ? String(payload.generationId).trim() : "";
    if (!projectId || !resourceId || !generationId) return err("VALIDATION_ERROR", "projectId, resourceId, and generationId are required");
    const allowed = ["artAsset", "sceneImage", "sceneVideo"];
    if (!allowed.includes(resourceType)) return err("VALIDATION_ERROR", "invalid resourceType");
    try {
      const root = await getRoot();
      await removeGenerationStorage(root, projectId, resourceType, resourceId, generationId);
      return ok({ deleted: true });
    } catch (e) {
      console.error("[creez storyboard] deleteGeneration error", e?.message || e);
      return err("DELETE_ERROR", e?.message || "Failed to delete generation");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_ADD_RESOURCE, async (_event, payload) => {
    const projectId = payload?.projectId != null ? String(payload.projectId).trim() : "";
    const resourceType = payload?.resourceType;
    const name = payload?.name != null ? String(payload.name).trim() : "";
    if (!projectId || !name) return err("VALIDATION_ERROR", "projectId and name are required");
    const allowed = ["artAsset", "sceneImage", "sceneVideo"];
    if (!allowed.includes(resourceType)) return err("VALIDATION_ERROR", "invalid resourceType");
    const opts = {};
    if (payload?.activeSource === "local_disk") opts.activeSource = "local_disk";
    if (payload?.localPath != null) opts.localPath = String(payload.localPath).trim();
    try {
      const root = await getRoot();
      const result = await addResourceStorage(root, projectId, resourceType, name, opts);
      return ok(result);
    } catch (e) {
      console.error("[creez storyboard] addResource error", e?.message || e);
      return err("ADD_ERROR", e?.message || "Failed to add resource");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_UPLOAD_LOCAL_ASSET, async (_event, payload) => {
    const projectId = payload?.projectId != null ? String(payload.projectId).trim() : "";
    const resourceType = payload?.resourceType;
    const resourceId = payload?.resourceId != null ? String(payload.resourceId).trim() : "";
    const fileData = payload?.fileData;
    const filename = payload?.filename != null ? String(payload.filename).trim() : "image.jpg";
    if (!projectId || !resourceId || !fileData) return err("VALIDATION_ERROR", "projectId, resourceId, and fileData are required");
    const allowed = ["artAsset", "sceneImage"];
    if (!allowed.includes(resourceType)) return err("VALIDATION_ERROR", "invalid resourceType (artAsset or sceneImage only)");
    let base64 = typeof fileData === "string" ? fileData : "";
    if (base64.startsWith("data:")) {
      const i = base64.indexOf(",");
      base64 = i >= 0 ? base64.slice(i + 1) : "";
    }
    if (!base64) return err("VALIDATION_ERROR", "fileData must be base64 or data URL");
    try {
      const buffer = Buffer.from(base64, "base64");
      const root = await getRoot();
      const relativePath = await uploadLocalAssetFileStorage(root, projectId, resourceType, resourceId, buffer, filename);
      return ok({ localImage: relativePath });
    } catch (e) {
      console.error("[creez storyboard] uploadLocalAsset error", e?.message || e);
      return err("UPLOAD_ERROR", e?.message || "Failed to upload local asset");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_GENERATE_IMAGE, async (_event, payload) => {
    const projectId = payload?.projectId != null ? String(payload.projectId).trim() : "";
    const resourceType = payload?.resourceType;
    const resourceId = payload?.resourceId != null ? String(payload.resourceId).trim() : "";
    const prompt = payload?.prompt != null ? String(payload.prompt).trim() : "";
    const model = payload?.model;
    const ratio = payload?.ratio || "16:9";
    const numImages = Math.min(10, Math.max(1, parseInt(payload?.numImages, 10) || 1));
    const enableWebSearch = Boolean(payload?.enableWebSearch);
    const referenceImageUrls = Array.isArray(payload?.referenceImageUrls) ? payload.referenceImageUrls : [];
    const referenceImageBase64sFromFrontend = Array.isArray(payload?.referenceImageBase64s) ? payload.referenceImageBase64s : [];
    const hasRefInput =
      referenceImageBase64sFromFrontend.length > 0 ||
      referenceImageUrls.some((u) => typeof u === "string" && String(u).trim());

    if (!projectId) return err("VALIDATION_ERROR", "projectId is required");
    if (!prompt && !hasRefInput) {
      return err("VALIDATION_ERROR", "prompt or at least one reference image is required");
    }
    if (!resourceType || !resourceId) return err("VALIDATION_ERROR", "resourceType and resourceId are required");

    try {
      const root = await getRoot();
      const base64Refs = [...referenceImageBase64sFromFrontend];
      for (const url of referenceImageUrls) {
        if (!url || typeof url !== "string") continue;
        if (url.startsWith("data:image/")) {
          base64Refs.push(url);
          continue;
        }
        const dataUri = await referenceUrlToBase64DataUri(url, projectId, root);
        if (dataUri) base64Refs.push(dataUri);
      }

      const httpsFallbackUrls = referenceImageUrls
        .filter((u) => typeof u === "string" && /^\s*https?:\/\//i.test(u))
        .map((u) => u.trim())
        .slice(0, 10);

      const apiKey = await getCreezApiKey();
      let response;
      try {
        response = await fetch(`${storyboardBackendBase()}/media/generate-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            prompt,
            model,
            ratio,
            numImages,
            enableWebSearch,
            referenceImageBase64s: base64Refs.length ? base64Refs : undefined,
            referenceImageUrls:
              base64Refs.length > 0 ? undefined : httpsFallbackUrls.length ? httpsFallbackUrls : undefined,
          }),
        });
      } catch (fetchErr) {
        const msg = fetchErr?.message || String(fetchErr);
        if (msg === "fetch failed" || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
          return err("SERVICE_UNAVAILABLE", backendUnreachableMessage());
        }
        throw fetchErr;
      }
      const result = await response.json();
      if (!result.ok) return err("GENERATION_ERROR", result.error?.message || "Image generation failed");

      const images = Array.isArray(result.data?.images) ? result.data.images : [];
      const imageUrls = images.map((img) => img?.data).filter(Boolean);
      if (imageUrls.length === 0) return err("GENERATION_ERROR", "No image URL(s) returned");

      const project = await getProject(root, projectId);
      if (!project) return err("NOT_FOUND", "Project not found");
      const content = project.content;
      const listKey = resourceType === "artAsset" ? "artAssets" : "sceneImages";
      const list = content[listKey] || [];
      const item = list.find((r) => r.id === resourceId);
      if (!item) return err("NOT_FOUND", "Resource not found");

      if (!Array.isArray(item.aiImageGenerations)) item.aiImageGenerations = [];
      const createdAt = Math.floor(Date.now() / 1000);
      const newGens = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const genId = `gen-img-${Date.now()}-${randomUUID().slice(0, 8)}-${i}`;
        let savedRelPath = imageUrl;
        if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
          try {
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
              const contentType = (imgRes.headers.get("content-type") || "").toLowerCase();
              const buf = Buffer.from(await imgRes.arrayBuffer());
              const isImage = contentType.includes("image/") || /\.(png|jpe?g)/i.test(imageUrl);
              if (isImage && buf.length >= 100) {
                const ext = /\.png/i.test(imageUrl) ? ".png" : ".jpg";
                savedRelPath = await writeAssetFile(root, projectId, "generated/image", `${genId}${ext}`, buf);
              }
            }
          } catch (e) {
            console.warn("[creez storyboard] generateImage download error", e?.message || e);
          }
        }
        newGens.push({
          id: genId,
          url: savedRelPath,
          prompt,
          model: model || "default",
          ratio,
          createdAt,
          imageRefs: [],
        });
      }
      for (const g of newGens) item.aiImageGenerations.push(g);
      item.activeSource = "ai_generation";
      item.activeGenerationId = newGens[0].id;
      await updateProject(root, projectId, { content });

      const first = newGens[0];
      return ok({
        generationId: first.id,
        url: first.url,
        generationIds: newGens.map((g) => g.id),
        urls: newGens.map((g) => g.url),
      });
    } catch (e) {
      console.error("[creez storyboard] generateImage error", e?.message || e);
      return err("GENERATION_ERROR", e?.message || "Image generation failed");
    }
  });

  ipcMain.handle(CHANNELS.STORYBOARD_GENERATE_VIDEO, async (_event, payload) => {
    const projectId = payload?.projectId != null ? String(payload.projectId).trim() : "";
    const resourceId = payload?.resourceId != null ? String(payload.resourceId).trim() : "";
    const prompt = payload?.prompt != null ? String(payload.prompt).trim() : "";
    const model = payload?.model;
    const ratio = payload?.ratio || "16:9";
    const duration = payload?.duration || "5";
    const startFrameUrl = payload?.startFrameUrl || "";
    const endFrameUrl = payload?.endFrameUrl || "";

    if (!projectId || !resourceId) return err("VALIDATION_ERROR", "projectId and resourceId are required");
    if (!startFrameUrl) return err("VALIDATION_ERROR", "startFrameUrl is required for video generation");

    try {
      const body = { prompt, model, ratio, duration: String(duration).replace(/\D/g, "") || "5", startFrameUrl, wait: true };
      if (endFrameUrl) body.endFrameUrl = endFrameUrl;

      const apiKey = await getCreezApiKey();
      const response = await fetch(`${storyboardBackendBase()}/media/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!result.ok) return err("GENERATION_ERROR", result.error?.message || "Video generation failed");

      const videoUrl = result.data?.videoUrl;
      const taskId = result.data?.taskId;
      if (!videoUrl) return err("GENERATION_ERROR", "No video URL returned (task may still be processing)");

      const root = await getRoot();
      const genId = `gen-vid-${Date.now()}-${randomUUID().slice(0, 8)}`;
      let savedRelPath = videoUrl;

      if (videoUrl.startsWith("http://") || videoUrl.startsWith("https://")) {
        try {
          const vidRes = await fetch(videoUrl);
          const buf = Buffer.from(await vidRes.arrayBuffer());
          savedRelPath = await writeAssetFile(root, projectId, "generated/video", `${genId}.mp4`, buf);
        } catch {
          savedRelPath = videoUrl;
        }
      }

      const project = await getProject(root, projectId);
      if (!project) return err("NOT_FOUND", "Project not found");
      const content = project.content;

      const newGen = {
        id: genId,
        url: savedRelPath,
        prompt,
        model: model || "default",
        ratio,
        duration: duration + (String(duration).includes("s") ? "" : "s"),
        createdAt: Math.floor(Date.now() / 1000),
        taskId,
        keyframes: [],
      };

      const list = content.sceneVideos || [];
      const item = list.find((r) => r.id === resourceId);
      if (item) {
        if (!Array.isArray(item.aiVideoGenerations)) item.aiVideoGenerations = [];
        item.aiVideoGenerations.push(newGen);
        item.activeSource = "ai_generation";
        item.activeGenerationId = genId;
      }
      await updateProject(root, projectId, { content });

      return ok({ generationId: genId, url: savedRelPath, taskId });
    } catch (e) {
      console.error("[creez storyboard] generateVideo error", e?.message || e);
      return err("GENERATION_ERROR", e?.message || "Video generation failed");
    }
  });
  // ── Storyboard Agent IPC (backend handles generation) ───────────────────

  ipcMain.handle(CHANNELS.STORYBOARD_AGENT_CREATE, async (_event, payload) => {
    const title = payload?.title != null ? String(payload.title).trim() : undefined;
    const prompt = payload?.prompt != null ? String(payload.prompt).trim() : undefined;
    if (!prompt) return err("VALIDATION_ERROR", "prompt is required");

    try {
      const root = await getRoot();
      const projectId = await createProject(root, {
        title: title || "Untitled",
        prompt: prompt || "",
      });

      const apiKey = await getCreezApiKey();
      const url = `${storyboardBackendBase()}/storyboard/generate`;
      const fetchOpts = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ prompt }),
      };
      let response;
      const agent = getNoTimeoutAgent();
      if (agent) {
        fetchOpts.dispatcher = agent;
        response = await fetch(url, fetchOpts);
      } else {
        const STORYBOARD_FETCH_MS = 60 * 60 * 1000;
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), STORYBOARD_FETCH_MS);
        fetchOpts.signal = controller.signal;
        try {
          response = await fetch(url, fetchOpts);
        } finally {
          clearTimeout(tid);
        }
      }

      const result = await parseChunkedStoryboardBody(response);
      if (isCreezVerboseDebug()) {
        console.log("[creez storyboard] 后端返回 result.ok:", result.ok, "result.data keys:", result.data ? Object.keys(result.data) : []);
        if (result.data?.content) {
          console.log("[creez storyboard] 后端 content keys:", Object.keys(result.data.content));
        } else {
          console.warn("[creez storyboard] 后端未返回 content，result.data:", result.data ? JSON.stringify(result.data).slice(0, 300) : "undefined");
        }
      }
      if (!result.ok) {
        return err(
          result.error?.code || "BACKEND_ERROR",
          result.error?.message || "Backend request failed"
        );
      }

      const content = result.data?.content;
      if (content) {
        await updateProject(root, projectId, { content });
        return ok({ projectId, status: "ready" });
      }

      return err("GENERATE_ERROR", result.error?.message || "Backend did not return content");
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg === "fetch failed" || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
        return err("SERVICE_UNAVAILABLE", backendUnreachableMessage());
      }
      console.error("[creez storyboard] agentCreate error", msg);
      return err("AGENT_CREATE_ERROR", msg);
    }
  });

}

module.exports = {
  registerStoryboardIpc,
};
