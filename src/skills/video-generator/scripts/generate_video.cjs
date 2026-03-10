/**
 * 生成视频技能入口。根据首帧（及可选尾帧）和提示词调用视频生成服务，返回视频 URL 或 taskId。
 * 与 POST /media/generate-video 参数约定一致，供 Agent 通过 mediaTools 调用。
 */
const { randomUUID } = require("node:crypto");
const { getVideoGenerator } = require("../../../services/media/videoGenerators/index.cjs");

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function makeId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * @param {object} [payload] - startFrameUrl, endFrameUrl?, keyframes?, prompt?, duration?, ratio?, wait?
 * @returns {Promise<{ generation: object }>}
 */
module.exports = async function generate_video(payload = {}) {
  const generator = getVideoGenerator();
  if (!generator) {
    throw new Error("Video generator not configured (DOUBAO_API_KEY / media.volcApiKey)");
  }

  let startFrameUrl = payload.startFrameUrl != null ? String(payload.startFrameUrl).trim() : "";
  let endFrameUrl = payload.endFrameUrl != null ? String(payload.endFrameUrl).trim() : undefined;
  const keyframes = Array.isArray(payload.keyframes)
    ? payload.keyframes.filter((u) => typeof u === "string")
    : [];
  if (keyframes.length > 0) {
    startFrameUrl = startFrameUrl || keyframes[0];
    if (keyframes.length > 1) endFrameUrl = endFrameUrl || keyframes[keyframes.length - 1];
  }

  if (!startFrameUrl) {
    throw new Error("startFrameUrl or keyframes[0] is required for video generation");
  }

  const duration = (payload.duration != null ? String(payload.duration).replace(/\D/g, "") : "") || "5";
  const ratio = (payload.ratio != null ? String(payload.ratio).trim() : "") || "adaptive";
  const wait = payload.wait !== false;

  const result = await generator.generate({
    prompt: String(payload.prompt || "").trim(),
    startFrameUrl,
    endFrameUrl,
    duration,
    aspectRatio: ratio,
    generateAudio: false,
    wait,
  });

  return {
    generation: {
      id: makeId("gen-vid"),
      url: result?.videoUrl || "",
      prompt: String(payload.prompt || "").trim(),
      model: payload.model || "default",
      ratio,
      duration: `${duration}s`,
      createdAt: nowSec(),
      taskId: result?.taskId,
      keyframes: keyframes.length ? keyframes : [],
      usage: result?.usage,
    },
  };
};
