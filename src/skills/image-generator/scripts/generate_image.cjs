/**
 * 生成图片技能入口。根据 prompt 调用生图服务，返回图片 URL 及生成信息。
 * 参考图入参仅支持线上 URL 或本机路径，内部会转为 base64 再请求后端。
 */
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getImageGenerator } = require("../../../services/media/imageGenerators/index.cjs");

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
 * @param {object} [options] - ratio, numImages, model, referenceImageUrls（仅 URL 或本机路径）, enableWebSearch
 * @returns {Promise<{ generation: Array<{ id, url, prompt, model, ratio, createdAt, imageRefs?, image }> }>}
 */
module.exports = async function generate_image(prompt, options = {}) {
  const generator = getImageGenerator();
  if (!generator) {
    throw new Error("Image generator not configured (DOUBAO_API_KEY / media.volcApiKey)");
  }

  const ratio = (options.ratio != null ? String(options.ratio).trim() : "") || "16:9";
  const numImages = Math.min(10, Math.max(1, parseInt(options.numImages, 10) || 1));
  const referenceImageUrls = Array.isArray(options.referenceImageUrls)
    ? options.referenceImageUrls.filter((u) => typeof u === "string").slice(0, 5)
    : [];
  const referenceImageBase64s = await refsToBase64(referenceImageUrls);
  const enableWebSearch = Boolean(options.enableWebSearch);

  const result = await generator.generate({
    prompt: String(prompt || "").trim(),
    model: options.model,
    ratio,
    numImages,
    enableWebSearch,
    referenceImageUrls: referenceImageBase64s.length ? undefined : referenceImageUrls,
    referenceImageBase64s: referenceImageBase64s.length ? referenceImageBase64s : undefined,
  });

  const images = result?.images || [];
  const promptStr = String(prompt || "").trim();
  const model = options.model || "default";
  const createdAt = nowSec();
  const imageRefs = referenceImageUrls.length ? referenceImageUrls : undefined;

  const generation = images.map((img, i) => ({
    id: makeId("gen-img"),
    url: img.data || "",
    prompt: promptStr,
    model,
    ratio,
    createdAt,
    ...(imageRefs != null && { imageRefs }),
    image: img.data || "",
  }));

  return { generation };
};
