/**
 * Converts public/logo.svg to public/icon.png (256x256) for Electron app icon.
 * Run: node scripts/svg-to-icon.cjs
 */
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = path.join(__dirname, "..");
const svgPath = path.join(projectRoot, "public", "logo.svg");
const outPath = path.join(projectRoot, "public", "icon.png");
const size = 256;

if (!fs.existsSync(svgPath)) {
  console.error("Missing public/logo.svg");
  process.exit(1);
}

async function run() {
  const sharp = require("sharp");
  await sharp(svgPath)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log("Written", outPath);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
