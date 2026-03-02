#!/usr/bin/env node
/**
 * 向 OpenRouter 发一条测试请求，用于验证 API Key 和网络是否正常。
 * 用法：
 *   node src/scripts/test-openrouter.mjs
 *   OPENROUTER_API_KEY=sk-xxx node src/scripts/test-openrouter.mjs
 *   node src/scripts/test-openrouter.mjs sk-xxx
 *
 * 若不传 key，会尝试从 ~/.creez/auth.json 读取（与 Creez 应用一致）。
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";

function getApiKey() {
  const fromArg = process.argv[2];
  if (fromArg && fromArg.startsWith("sk-")) return fromArg;
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const creezHome = process.env.CREEZ_HOME || path.join(os.homedir(), ".creez");
  const authPath = path.join(creezHome, "auth.json");
  try {
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
      const key = auth?.runtimeApiKeys?.openrouter || auth?.openrouter;
      if (key && typeof key === "string" && key.trim()) return key.trim();
    }
  } catch (_) {}
  return null;
}

function post(url, body, headers) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const json = raw ? JSON.parse(raw) : {};
            resolve({ statusCode: res.statusCode, headers: res.headers, body: json });
          } catch {
            resolve({ statusCode: res.statusCode, headers: res.headers, raw });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  //const apiKey = getApiKey();
  const apiKey = "";
  if (!apiKey) {
    console.error("未找到 OpenRouter API Key。请设置 OPENROUTER_API_KEY 或传入参数，或在 ~/.creez/auth.json 中配置。");
    process.exit(1);
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  console.log("请求 OpenRouter:", OPENROUTER_URL);
  console.log("模型:", model);
  console.log("Key 前缀:", apiKey.slice(0, 7) + "...");

  const start = Date.now();
  try {
    const res = await post(
      OPENROUTER_URL,
      {
        model,
        messages: [{ role: "user", content: "Reply with exactly: OpenRouter OK" }],
        max_tokens: 50,
      },
      { Authorization: `Bearer ${apiKey}` }
    );
    const elapsed = Date.now() - start;
    console.log("状态码:", res.statusCode);
    console.log("耗时:", elapsed, "ms");

    if (res.statusCode === 200 && res.body?.choices?.[0]?.message?.content) {
      console.log("回复:", res.body.choices[0].message.content.trim());
      console.log("OpenRouter 请求成功。");
      return;
    }

    if (res.body?.error) {
      console.error("API 错误:", res.body.error.message || res.body.error);
    } else {
      console.error("响应:", JSON.stringify(res.body, null, 2).slice(0, 500));
    }
    process.exit(1);
  } catch (err) {
    console.error("请求失败:", err.message || err);
    process.exit(1);
  }
}

main();
