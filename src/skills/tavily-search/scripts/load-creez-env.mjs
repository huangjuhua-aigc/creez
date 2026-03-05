/**
 * Load env from ~/.creez/.env (and optional local .env). Same order as xiaohongshu:
 * Creez config first, then cwd .env, then skill root .env. First existing file wins.
 * Merges into process.env so TAVILY_API_KEY etc. are available.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

const home = process.env.HOME || process.env.USERPROFILE || "";
const envPaths = [
  path.join(home, ".creez", ".env"),
  path.join(process.cwd(), ".env"),
  path.join(skillRoot, ".env"),
];

for (const envPath of envPaths) {
  try {
    if (fs.existsSync(envPath)) {
      const loaded = parseEnvFile(envPath);
      for (const [k, v] of Object.entries(loaded)) {
        process.env[k] = v;
      }
      break;
    }
  } catch {
    // skip
  }
}
