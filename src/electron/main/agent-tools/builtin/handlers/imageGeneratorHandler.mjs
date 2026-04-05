import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { asTextEnvelope, buildErrorEnvelope, buildSuccessEnvelope } from "../errorProtocol.mjs";

const DEFAULT_BACKEND_BASE_URL = "https://creez.lighton.video";
const DEFAULT_TIMEOUT_MS = 120_000;
const GENERATED_IMAGE_DIR = "GeneratedImage";
const MAX_REFERENCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 5;

function isDataUrl(s) {
  return typeof s === "string" && s.trimStart().toLowerCase().startsWith("data:");
}

function getExtensionFromMimeOrUrl(mimeOrUrl, defaultExt = "png") {
  if (typeof mimeOrUrl !== "string") return defaultExt;
  const lower = mimeOrUrl.toLowerCase();
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("png")) return "png";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("gif")) return "gif";
  const pathPart = mimeOrUrl.split("?")[0];
  const ext = path.extname(pathPart).slice(1);
  if (ext) return ext;
  return defaultExt;
}

async function downloadToLocalFile(urlOrDataUrl, destPath) {
  if (isDataUrl(urlOrDataUrl)) {
    const mimeMatch = urlOrDataUrl.match(/^data:(image\/[^;]+);base64,/);
    const mime = mimeMatch ? mimeMatch[1] : "";
    const ext = getExtensionFromMimeOrUrl(mime);
    const finalPath = destPath + (path.extname(destPath) ? "" : `.${ext}`);
    const base64 = urlOrDataUrl.replace(/^data:image\/[^;]+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    fs.writeFileSync(finalPath, buf);
    return finalPath;
  }
  const res = await fetch(urlOrDataUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") || "";
  const ext = getExtensionFromMimeOrUrl(contentType) || getExtensionFromMimeOrUrl(urlOrDataUrl);
  const finalPath = destPath + (path.extname(destPath) ? "" : `.${ext}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(finalPath, buf);
  return finalPath;
}

function loadCreezEnvFile() {
  const envPath = path.join(os.homedir(), ".creez", ".env");
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

function resolveCreezApiKey() {
  const fromEnv = (process.env.CREEZ_API_KEY ?? "").trim();
  if (fromEnv) return fromEnv;
  const file = loadCreezEnvFile();
  return (file.CREEZ_API_KEY || "").trim() || null;
}

function resolveBackendUrl() {
  const fromEnv = (process.env.CREEZ_BACKEND_URL ?? "").trim();
  if (fromEnv) return fromEnv;
  const file = loadCreezEnvFile();
  return (file.CREEZ_BACKEND_URL || "").trim() || DEFAULT_BACKEND_BASE_URL;
}

function mimeFromExt(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function normalizeMime(mimeHeader) {
  if (typeof mimeHeader !== "string") return "image/png";
  const m = mimeHeader.split(";")[0].trim().toLowerCase();
  if (m.startsWith("image/")) return m;
  return "image/png";
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function coerceReferencePathList(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

/**
 * Resolve one reference to data:image/...;base64,... for backend referenceImageBase64s.
 * @param {string} ref
 * @param {string} workDir
 */
async function referencePathToDataUrl(ref, workDir) {
  const s = String(ref || "").trim();
  if (!s) throw new Error("empty path");

  if (isDataUrl(s)) {
    const lower = s.trimStart().toLowerCase();
    if (!lower.startsWith("data:image/")) {
      throw new Error("data URL must be an image (data:image/...)");
    }
    return s.trim();
  }

  if (/^https?:\/\//i.test(s)) {
    const res = await fetch(s, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("empty response body");
    if (buf.length > MAX_REFERENCE_IMAGE_BYTES) {
      throw new Error(`image larger than ${MAX_REFERENCE_IMAGE_BYTES} bytes`);
    }
    const mime = normalizeMime(res.headers.get("content-type") || "");
    return `data:${mime};base64,${buf.toString("base64")}`;
  }

  let filePath = s;
  if (s.startsWith("file://")) {
    try {
      filePath = fileURLToPath(s);
    } catch {
      throw new Error("invalid file:// URL");
    }
  } else if (!path.isAbsolute(filePath)) {
    filePath = workDir ? path.join(workDir, filePath) : path.resolve(filePath);
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error("file not found or not a file");
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(`file larger than ${MAX_REFERENCE_IMAGE_BYTES} bytes`);
  }
  const buf = await fs.promises.readFile(filePath);
  const mime = mimeFromExt(filePath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * @param {unknown} argsRefs
 * @param {string} workDir
 * @returns {Promise<{ ok: true, base64s: string[] } | { ok: false, envelope: object }>}
 */
async function loadReferenceImagesAsBase64(argsRefs, workDir) {
  const list = coerceReferencePathList(argsRefs).slice(0, MAX_REFERENCE_IMAGES);
  if (list.length === 0) return { ok: true, base64s: [] };
  const base64s = [];
  for (let i = 0; i < list.length; i++) {
    try {
      base64s.push(await referencePathToDataUrl(list[i], workDir));
    } catch (e) {
      const msg = e?.message || String(e);
      const envelope = buildErrorEnvelope({
        toolName: "image_generator",
        code: "REFERENCE_IMAGE_ERROR",
        message: `Failed to load referenceImagePaths[${i}] (${list[i]}): ${msg}`,
        retryable: false,
        nextAction: "Fix path or URL, use a smaller image, or omit referenceImagePaths.",
      });
      return { ok: false, envelope };
    }
  }
  return { ok: true, base64s };
}

export function createImageGeneratorHandler(runtimeContext = {}) {
  const workDir = typeof runtimeContext?.workDir === "string" ? runtimeContext.workDir.trim() : "";
  return {
    id: "image_generator",
    async execute(args = {}) {
      const prompt = String(args?.prompt || "").trim();

      const apiKey = resolveCreezApiKey();
      if (!apiKey) {
        const envelope = buildErrorEnvelope({
          toolName: "image_generator",
          code: "MISSING_API_KEY",
          message: "Creez API key not found. Set in Settings or CREEZ_API_KEY env.",
          retryable: false,
          nextAction: "Ask user to configure Creez API Key in Settings → Advanced.",
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "image_generator") }], details: envelope, isError: true };
      }

      const ratio = String(args?.ratio || "16:9").trim();
      const numImages = Math.min(10, Math.max(1, parseInt(args?.numImages, 10) || 1));
      const enableWebSearch = Boolean(args?.enableWebSearch);

      const refLoad = await loadReferenceImagesAsBase64(args?.referenceImagePaths, workDir);
      if (!refLoad.ok) {
        return {
          content: [{ type: "text", text: asTextEnvelope(refLoad.envelope, "image_generator") }],
          details: refLoad.envelope,
          isError: true,
        };
      }
      const referenceImageBase64s = refLoad.base64s;

      if (!prompt && referenceImageBase64s.length === 0) {
        const envelope = buildErrorEnvelope({
          toolName: "image_generator",
          code: "INVALID_ARGUMENT",
          message: "prompt or referenceImagePaths is required.",
          retryable: false,
          nextAction:
            "Provide a text description, or paths/URLs to reference images for image-to-image.",
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "image_generator") }], details: envelope, isError: true };
      }

      const baseUrl = resolveBackendUrl().replace(/\/+$/, "");
      const endpoint = `${baseUrl}/media/generate-image`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("timeout")), DEFAULT_TIMEOUT_MS);

      try {
        const body = {
          prompt,
          ratio,
          numImages,
          enableWebSearch,
        };
        if (referenceImageBase64s.length > 0) {
          body.referenceImageBase64s = referenceImageBase64s;
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.ok) {
          const msg = payload?.error?.message || `HTTP ${response.status}`;
          const envelope = buildErrorEnvelope({
            toolName: "image_generator",
            code: "BACKEND_ERROR",
            message: msg,
            retryable: response.status >= 500 || response.status === 429,
            nextAction: "Retry once or inform user of the error.",
            details: { status: response.status, endpoint },
          });
          return { content: [{ type: "text", text: asTextEnvelope(envelope, "image_generator") }], details: envelope, isError: true };
        }

        const images = Array.isArray(payload.data?.images) ? payload.data.images : [];
        const generation = images.map((img, i) => ({
          index: i,
          url: img?.data || "",
          prompt,
          ratio,
          localPath: null,
        }));

        const outDir = workDir ? path.join(workDir, GENERATED_IMAGE_DIR) : null;
        if (outDir) {
          try {
            if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
            const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
            for (let i = 0; i < generation.length; i++) {
              const g = generation[i];
              if (!g.url) continue;
              const baseName = `generated-${ts}-${i + 1}`;
              const destPath = path.join(outDir, baseName);
              try {
                const finalPath = await downloadToLocalFile(g.url, destPath);
                if (finalPath) g.localPath = finalPath;
              } catch (_) {
                // keep url as fallback
              }
            }
          } catch (_) {
            // non-fatal: continue without local paths
          }
        }

        const envelope = buildSuccessEnvelope({
          toolName: "image_generator",
          data: {
            prompt,
            ratio,
            numImages,
            referenceImageCount: referenceImageBase64s.length,
            count: generation.length,
            generation: generation.map((g) => ({ ...g, localPath: g.localPath || undefined })),
          },
        });

        const markdownLines = generation
          .filter((g) => g.localPath || g.url)
          .map((g, i) => {
            let src = g.localPath || g.url;
            if (typeof src === "string" && src.includes("\\")) src = src.replace(/\\/g, "/");
            if (typeof src === "string" && src && !src.startsWith("http") && !src.startsWith("file:")) {
              src = "file:///" + src.replace(/^\/+/, "");
            }
            return `![Generated image ${i + 1}](${src})`;
          });
        const markdownBlock =
          markdownLines.length > 0
            ? `\n\n**Generated images — include the following in your reply so the user can see them:**\n\n${markdownLines.join("\n\n")}`
            : "";
        const urlList = generation
          .filter((g) => g.url)
          .map((g, i) => `Image ${i + 1}: ${g.localPath || g.url}`)
          .join("\n");
        const summary = (urlList || "No images returned.") + markdownBlock;

        return {
          content: [{ type: "text", text: `${asTextEnvelope(envelope, "image_generator")}\n\n${summary}` }],
          details: envelope,
        };
      } catch (error) {
        const isTimeout = String(error?.message || "").includes("timeout") || error?.name === "AbortError";
        const isUnreachable = /fetch failed|ECONNREFUSED|ENOTFOUND/.test(error?.message || "");
        const envelope = buildErrorEnvelope({
          toolName: "image_generator",
          code: isTimeout ? "TIMEOUT" : isUnreachable ? "BACKEND_UNREACHABLE" : "NETWORK_ERROR",
          message: isTimeout
            ? "image_generator timed out."
            : isUnreachable
              ? `Backend unreachable at ${baseUrl}.`
              : (error?.message || "Request failed."),
          retryable: !isUnreachable,
          nextAction: isUnreachable ? "Ask user to check if creez_backend is running." : "Retry once.",
          details: { endpoint },
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "image_generator") }], details: envelope, isError: true };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
