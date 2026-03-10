/**
 * 生成图片技能入口。根据 prompt 调用 creez 后端生图接口，返回图片 URL 及生成信息。
 * 参考图入参仅支持线上 URL 或本机路径，内部会转为 base64 再请求后端。
 *
 * Creez API Key 来源（优先级）：options.creezApiKey → 环境变量 CREEZ_API_KEY → ~/.creez/.env（与设置页、小红书 Cookie 同文件）。
 */
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const DEFAULT_BACKEND_BASE_URL = "https://creez.lighton.video";

/** 从 ~/.creez/.env 读取 KEY=value，返回 { CREEZ_API_KEY?, CREEZ_BACKEND_URL? }（与小红书技能同文件） */
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
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function makeId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * 将参考图（线上 URL 或本机路径）转为 data URI（base64）。最多 5 张。
 * @param {string[]} refs - URL 或本地路径
 * @returns {Promise<string[]>} data:image/...;base64,... 数组
 */
async function refsToBase64(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const list = refs.filter((u) => typeof u === "string").slice(0, 5);
  const out = [];
  for (const one of list) {
    const s = String(one).trim();
    if (!s) continue;
    try {
      if (s.startsWith("http://") || s.startsWith("https://")) {
        const res = await fetch(s, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") || "image/jpeg";
        out.push(`data:${ct};base64,${buf.toString("base64")}`);
      } else {
        const abs = path.isAbsolute(s) ? s : path.resolve(process.cwd(), s);
        if (!fs.existsSync(abs)) continue;
        const buf = fs.readFileSync(abs);
        const ext = path.extname(abs).toLowerCase();
        const mime = MIME_BY_EXT[ext] || "image/jpeg";
        out.push(`data:${mime};base64,${buf.toString("base64")}`);
      }
    } catch (_) {
      // 单张失败则跳过，不中断整体
    }
  }
  return out;
}

/**
 * @param {string} prompt - 图片描述，必填
 * @param {object} [options] - ratio, numImages, model, referenceImageUrls（仅 URL 或本机路径）, enableWebSearch, backendBaseUrl, creezApiKey
 * @returns {Promise<{ generation: Array<{ id, url, prompt, model, ratio, createdAt, imageRefs?, image }> }>}
 */
module.exports = async function generate_image(prompt, options = {}) {
  const promptStr = String(prompt || "").trim();
  if (!promptStr) {
    throw new Error("prompt is required");
  }

  const creezEnv = loadCreezEnvFile();
  const baseUrl = (options.backendBaseUrl != null ? String(options.backendBaseUrl).trim() : null)
    || (process.env.CREEZ_BACKEND_URL && String(process.env.CREEZ_BACKEND_URL).trim())
    || (creezEnv.CREEZ_BACKEND_URL && String(creezEnv.CREEZ_BACKEND_URL).trim())
    || DEFAULT_BACKEND_BASE_URL;
  const apiKey = (options.creezApiKey != null && String(options.creezApiKey).trim() !== ""
    ? String(options.creezApiKey).trim()
    : null)
    || (process.env.CREEZ_API_KEY && String(process.env.CREEZ_API_KEY).trim())
    || (creezEnv.CREEZ_API_KEY && String(creezEnv.CREEZ_API_KEY).trim())
    || null;
  if (!apiKey) {
    throw new Error("Creez API key is required. Set in Settings (saved to ~/.creez/.env), or CREEZ_API_KEY env, or options.creezApiKey.");
  }

  const ratio = (options.ratio != null ? String(options.ratio).trim() : "") || "16:9";
  const numImages = Math.min(10, Math.max(1, parseInt(options.numImages, 10) || 1));
  const referenceImageUrls = Array.isArray(options.referenceImageUrls)
    ? options.referenceImageUrls.filter((u) => typeof u === "string").slice(0, 5)
    : [];
  const referenceImageBase64s = await refsToBase64(referenceImageUrls);
  const enableWebSearch = Boolean(options.enableWebSearch);

  const url = `${baseUrl.replace(/\/+$/, "")}/media/generate-image`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: promptStr,
        model: options.model,
        ratio,
        numImages,
        enableWebSearch,
        referenceImageBase64s: referenceImageBase64s.length ? referenceImageBase64s : undefined,
      }),
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg === "fetch failed" || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      throw new Error(`Backend unreachable at ${baseUrl}. Is creez_backend running (e.g. port 3001)?`);
    }
    throw e;
  }

  const result = await response.json();
  if (!result.ok) {
    const errMsg = result.error?.message || "Image generation failed";
    throw new Error(errMsg);
  }

  const images = Array.isArray(result.data?.images) ? result.data.images : [];
  const model = options.model || "default";
  const createdAt = nowSec();
  const imageRefs = referenceImageUrls.length ? referenceImageUrls : undefined;

  const generation = images.map((img) => ({
    id: makeId("gen-img"),
    url: img?.data || "",
    prompt: promptStr,
    model,
    ratio,
    createdAt,
    ...(imageRefs != null && { imageRefs }),
    image: img?.data || "",
  }));

  return { generation };
};
