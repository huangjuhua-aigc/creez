#!/usr/bin/env node
/**
 * 将主进程文件复制到 dist/，供 electron-builder 打包使用。
 * 跨平台（Windows/Linux/macOS）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const mainFiles = ["main.js", "preload.js", "agent-runner.mjs"];

if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST, { recursive: true });
}

for (const name of mainFiles) {
  const srcPath = path.join(SRC, name);
  const destPath = path.join(DIST, name);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log("Copied", name, "-> dist/");
  }
}

console.log("Main process files copied to dist/");
