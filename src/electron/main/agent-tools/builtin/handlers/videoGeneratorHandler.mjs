import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createRequire } from "node:module";
import { asTextEnvelope, buildErrorEnvelope, buildSuccessEnvelope } from "../errorProtocol.mjs";

const require = createRequire(import.meta.url);
const { resolveCreezBackendBase } = require("../../../creezBackendBase.cjs");
const DEFAULT_TIMEOUT_MS = 300_000;

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
  const fromEnv = (process.env.CREEZ_BACKEND_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const file = loadCreezEnvFile();
  const fromFile = (file.CREEZ_BACKEND_URL || "").trim();
  if (fromFile) return fromFile.replace(/\/+$/, "");
  return resolveCreezBackendBase();
}

export function createVideoGeneratorHandler(runtimeContext = {}) {
  return {
    id: "video_generator",
    async execute(args = {}) {
      let startFrameUrl = String(args?.startFrameUrl || "").trim();
      let endFrameUrl = args?.endFrameUrl ? String(args.endFrameUrl).trim() : undefined;
      const keyframes = Array.isArray(args?.keyframes)
        ? args.keyframes.filter((u) => typeof u === "string")
        : [];
      if (keyframes.length > 0) {
        startFrameUrl = startFrameUrl || keyframes[0];
        if (keyframes.length > 1) endFrameUrl = endFrameUrl || keyframes[keyframes.length - 1];
      }

      if (!startFrameUrl) {
        const envelope = buildErrorEnvelope({
          toolName: "video_generator",
          code: "INVALID_ARGUMENT",
          message: "startFrameUrl (or keyframes) is required.",
          retryable: false,
          nextAction: "Provide a startFrameUrl (image URL) to generate video from.",
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "video_generator") }], details: envelope, isError: true };
      }

      const apiKey = resolveCreezApiKey();
      if (!apiKey) {
        const envelope = buildErrorEnvelope({
          toolName: "video_generator",
          code: "MISSING_API_KEY",
          message: "Creez API key not found. Set in Settings or CREEZ_API_KEY env.",
          retryable: false,
          nextAction: "Ask user to configure Creez API Key in Settings → Advanced.",
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "video_generator") }], details: envelope, isError: true };
      }

      const prompt = String(args?.prompt || "").trim();
      const duration = String(args?.duration || "5").replace(/\D/g, "") || "5";
      const ratio = String(args?.ratio || "adaptive").trim();
      const wait = args?.wait !== false;

      const baseUrl = resolveBackendUrl().replace(/\/+$/, "");
      const endpoint = `${baseUrl}/media/generate-video`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("timeout")), DEFAULT_TIMEOUT_MS);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            prompt,
            startFrameUrl,
            endFrameUrl: endFrameUrl || undefined,
            duration,
            ratio,
            wait,
          }),
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.ok) {
          const msg = payload?.error?.message || `HTTP ${response.status}`;
          const envelope = buildErrorEnvelope({
            toolName: "video_generator",
            code: "BACKEND_ERROR",
            message: msg,
            retryable: response.status >= 500 || response.status === 429,
            nextAction: "Retry once or inform user of the error.",
            details: { status: response.status, endpoint },
          });
          return { content: [{ type: "text", text: asTextEnvelope(envelope, "video_generator") }], details: envelope, isError: true };
        }

        const data = payload.data || {};
        const generation = {
          url: data.videoUrl || "",
          taskId: data.taskId || undefined,
          prompt,
          duration: `${duration}s`,
          ratio,
          startFrameUrl,
          endFrameUrl: endFrameUrl || undefined,
        };

        const envelope = buildSuccessEnvelope({
          toolName: "video_generator",
          data: { generation },
        });

        const summary = generation.url
          ? `Video: ${generation.url}`
          : generation.taskId
            ? `Video generation started (task: ${generation.taskId}). Check back later for the result.`
            : "Video generation submitted.";

        return {
          content: [{ type: "text", text: `${asTextEnvelope(envelope, "video_generator")}\n\n${summary}` }],
          details: envelope,
        };
      } catch (error) {
        const isTimeout = String(error?.message || "").includes("timeout") || error?.name === "AbortError";
        const isUnreachable = /fetch failed|ECONNREFUSED|ENOTFOUND/.test(error?.message || "");
        const envelope = buildErrorEnvelope({
          toolName: "video_generator",
          code: isTimeout ? "TIMEOUT" : isUnreachable ? "BACKEND_UNREACHABLE" : "NETWORK_ERROR",
          message: isTimeout
            ? "video_generator timed out (video generation can take minutes)."
            : isUnreachable
              ? `Backend unreachable at ${baseUrl}.`
              : (error?.message || "Request failed."),
          retryable: !isUnreachable,
          nextAction: isUnreachable ? "Ask user to check if creez_backend is running." : "Retry once.",
          details: { endpoint },
        });
        return { content: [{ type: "text", text: asTextEnvelope(envelope, "video_generator") }], details: envelope, isError: true };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
