#!/usr/bin/env node
/**
 * 将 agent-runner.mjs 及其依赖（含 @mariozechner/pi-coding-agent、@sinclair/typebox 等）
 * 打成单个 agent-runner.bundle.cjs，避免打包后从 Temp 解析 node_modules 导致找不到包。
 */
const esbuild = require("esbuild");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

async function run() {
  await esbuild.build({
    entryPoints: [path.join(SRC, "agent-runner.mjs")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(DIST, "agent-runner.bundle.cjs"),
    external: [
      "electron",
      "@mariozechner/clipboard-win32-x64-msvc",
      "@mariozechner/clipboard-darwin-x64",
      "@mariozechner/clipboard-darwin-arm64",
      "@mariozechner/clipboard-linux-x64-gnu",
    ],
    sourcemap: false,
    minify: false,
    target: "node18",
  });
  console.log("Bundled agent-runner.mjs -> dist/agent-runner.bundle.cjs");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
