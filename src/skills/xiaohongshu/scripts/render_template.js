#!/usr/bin/env node
/**
 * 图文模板无头渲染：打开技能内 assets/template-render 下的 cover.html 或 content.html，
 * 传入 URL 参数，截图 #render-target 并保存为 PNG。
 * 用法（在技能根目录或任意目录，输出路径为相对或绝对）：
 *   node scripts/render_template.js --type cover --title "主标题" --subtitle "副标题" [--backgroundImage url] [--output cover.png]
 *   node scripts/render_template.js --type content --content "正文..." [--backgroundImage url] [--output card_1.png]
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const SKILL_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(SKILL_ROOT, 'assets', 'template-render');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type') out.type = args[++i];
    else if (args[i] === '--title') out.title = args[++i];
    else if (args[i] === '--subtitle') out.subtitle = args[++i];
    else if (args[i] === '--content') out.content = args[++i];
    else if (args[i] === '--backgroundImage') out.backgroundImage = args[++i];
    else if (args[i] === '--output') out.output = args[++i];
  }
  return out;
}

async function main() {
  const { type, title, subtitle, content, backgroundImage, output } = parseArgs();
  if (!type || type !== 'cover' && type !== 'content') {
    console.error('Usage: node render_template.js --type cover|content [--title T] [--subtitle S] | [--content C] [--backgroundImage URL] [--output path.png]');
    process.exit(1);
  }
  const outPath = (output || (type === 'cover' ? 'cover.png' : 'card_1.png'));
  const dest = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);

  const htmlFile = type === 'cover' ? 'cover.html' : 'content.html';
  const htmlPath = path.join(TEMPLATE_DIR, htmlFile);
  if (!fs.existsSync(htmlPath)) {
    console.error('Template not found:', htmlPath);
    process.exit(1);
  }

  const params = new URLSearchParams();
  if (title) params.set('title', title);
  if (subtitle) params.set('subtitle', subtitle);
  if (content) params.set('content', content);
  if (backgroundImage) params.set('backgroundImage', backgroundImage);
  const fileUrl = pathToFileURL(htmlPath).href + '?' + params.toString();

  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 750, height: 1000, deviceScaleFactor: 2 });
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 10000 });
    await page.waitForFunction('window.RENDER_READY === true', { timeout: 5000 });
    const el = await page.$('#render-target');
    if (!el) throw new Error('#render-target not found');
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await el.screenshot({ path: dest, type: 'png' });
    console.log('Saved:', dest);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
