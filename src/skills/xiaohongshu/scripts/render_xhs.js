#!/usr/bin/env node
/**
 * 小红书卡片渲染脚本 - Node.js 版
 * 使用: node render_xhs.js <markdown_file> [--theme default] [--mode separator] ...
 * 依赖: npm install marked yaml playwright && npx playwright install chromium
 */
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const yaml = require('yaml');
const { chromium } = require('playwright');

const SCRIPT_DIR = path.dirname(__dirname);
const ASSETS_DIR = path.join(SCRIPT_DIR, 'assets');
const THEMES_DIR = path.join(ASSETS_DIR, 'themes');
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1440;
const MAX_HEIGHT = 2160;
const AVAILABLE_THEMES = ['default', 'playful-geometric', 'neo-brutalism', 'botanical', 'professional', 'retro', 'terminal', 'sketch'];
const PAGING_MODES = ['separator', 'auto-fit', 'auto-split', 'dynamic'];

const THEME_BACKGROUNDS = {
    'default': 'linear-gradient(180deg, #f3f3f3 0%, #f9f9f9 100%)',
    'playful-geometric': 'linear-gradient(135deg, #8B5CF6 0%, #F472B6 100%)',
    'neo-brutalism': 'linear-gradient(135deg, #FF4757 0%, #FECA57 100%)',
    'botanical': 'linear-gradient(135deg, #4A7C59 0%, #8FBC8F 100%)',
    'professional': 'linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)',
    'retro': 'linear-gradient(135deg, #D35400 0%, #F39C12 100%)',
    'terminal': 'linear-gradient(135deg, #0D1117 0%, #161B22 100%)',
    'sketch': 'linear-gradient(135deg, #555555 0%, #888888 100%)'
};
const THEME_TITLE_GRADIENTS = {
    'default': 'linear-gradient(180deg, #111827 0%, #4B5563 100%)',
    'playful-geometric': 'linear-gradient(180deg, #7C3AED 0%, #F472B6 100%)',
    'neo-brutalism': 'linear-gradient(180deg, #000000 0%, #FF4757 100%)',
    'botanical': 'linear-gradient(180deg, #1F2937 0%, #4A7C59 100%)',
    'professional': 'linear-gradient(180deg, #1E3A8A 0%, #2563EB 100%)',
    'retro': 'linear-gradient(180deg, #8B4513 0%, #D35400 100%)',
    'terminal': 'linear-gradient(180deg, #39D353 0%, #58A6FF 100%)',
    'sketch': 'linear-gradient(180deg, #111827 0%, #6B7280 100%)',
};

function parseArgs() {
    const args = process.argv.slice(2);
    const options = { markdownFile: null, outputDir: process.cwd(), theme: 'default', mode: 'separator', width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, maxHeight: MAX_HEIGHT, dpr: 2 };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i], next = args[i + 1];
        if ((arg === '-o' || arg === '--output-dir') && next) { options.outputDir = next; i++; }
        else if ((arg === '-t' || arg === '--theme') && next) { options.theme = next; i++; }
        else if ((arg === '-m' || arg === '--mode') && next) { options.mode = next; i++; }
        else if ((arg === '-w' || arg === '--width') && next) { options.width = parseInt(next); i++; }
        else if ((arg === '--height') && next) { options.height = parseInt(next); i++; }
        else if ((arg === '--max-height') && next) { options.maxHeight = parseInt(next); i++; }
        else if ((arg === '--dpr') && next) { options.dpr = parseInt(next); i++; }
        else if (!arg.startsWith('-')) options.markdownFile = arg;
    }
    return options;
}

function parseMarkdownFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    let metadata = {}, body = content;
    if (yamlMatch) {
        try { metadata = yaml.parse(yamlMatch[1]) || {}; } catch (e) {}
        body = content.slice(yamlMatch[0].length);
    }
    return { metadata, body: body.trim() };
}

function splitContentBySeparator(body) {
    return body.split(/\n---+\n/).map(p => p.trim()).filter(p => p);
}

function loadThemeCss(theme) {
    const f = path.join(THEMES_DIR, theme + '.css');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf-8');
    const d = path.join(THEMES_DIR, 'default.css');
    return fs.existsSync(d) ? fs.readFileSync(d, 'utf-8') : '';
}

function generateCoverHtml(metadata, theme, width, height) {
    const emoji = metadata.emoji || '📝';
    let title = (metadata.title || '标题').slice(0, 15);
    let subtitle = (metadata.subtitle || '').slice(0, 15);
    const bg = THEME_BACKGROUNDS[theme] || THEME_BACKGROUNDS['default'];
    const titleBg = THEME_TITLE_GRADIENTS[theme] || THEME_TITLE_GRADIENTS['default'];
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>封面</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Noto Sans SC',sans-serif;width:${width}px;height:${height}px;overflow:hidden;}
.cover-container{width:${width}px;height:${height}px;background:${bg};position:relative;overflow:hidden;}
.cover-inner{position:absolute;width:${Math.floor(width*0.88)}px;height:${Math.floor(height*0.91)}px;left:${Math.floor(width*0.06)}px;top:${Math.floor(height*0.045)}px;background:#F3F3F3;border-radius:25px;display:flex;flex-direction:column;padding:${Math.floor(width*0.074)}px ${Math.floor(width*0.079)}px;}
.cover-emoji{font-size:${Math.floor(width*0.167)}px;line-height:1.2;margin-bottom:${Math.floor(height*0.035)}px;}
.cover-title{font-weight:900;font-size:${Math.floor(width*0.12)}px;line-height:1.4;background:${titleBg};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;flex:1;word-break:break-all;}
.cover-subtitle{font-weight:350;font-size:${Math.floor(width*0.067)}px;color:#000;margin-top:auto;}
</style></head><body><div class="cover-container"><div class="cover-inner"><div class="cover-emoji">${emoji}</div><div class="cover-title">${title}</div><div class="cover-subtitle">${subtitle}</div></div></div></body></html>`;
}

function generateCardHtml(content, theme, pageNumber, totalPages, width, height, mode) {
    const htmlContent = marked.parse(content);
    const themeCss = loadThemeCss(theme);
    const pageText = totalPages > 1 ? `${pageNumber}/${totalPages}` : '';
    const bg = THEME_BACKGROUNDS[theme] || THEME_BACKGROUNDS['default'];
    let containerStyle = `width:${width}px;min-height:${height}px;background:${bg};position:relative;padding:50px;overflow:hidden;`;
    let innerStyle = `background:rgba(255,255,255,0.95);border-radius:20px;padding:60px;min-height:calc(${height}px - 100px);box-shadow:0 8px 32px rgba(0,0,0,0.1);`;
    if (mode === 'auto-fit') { containerStyle = `width:${width}px;height:${height}px;background:${bg};position:relative;padding:50px;overflow:hidden;`; innerStyle = `background:rgba(255,255,255,0.95);border-radius:20px;padding:60px;height:calc(${height}px - 100px);box-shadow:0 8px 32px rgba(0,0,0,0.1);overflow:hidden;display:flex;flex-direction:column;`; }
    else if (mode === 'dynamic') { innerStyle = `background:rgba(255,255,255,0.95);border-radius:20px;padding:60px;box-shadow:0 8px 32px rgba(0,0,0,0.1);`; }
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>卡片</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Noto Sans SC',sans-serif;width:${width}px;overflow:hidden;background:transparent;}
.card-container{${containerStyle}}.card-inner{${innerStyle}}.card-content{line-height:1.7;}.card-content-scale{transform-origin:top left;}
${themeCss}.page-number{position:absolute;bottom:80px;right:80px;font-size:36px;color:rgba(255,255,255,0.8);}
</style></head><body><div class="card-container"><div class="card-inner"><div class="card-content"><div class="card-content-scale">${htmlContent}</div></div></div><div class="page-number">${pageText}</div></div></body></html>`;
}

async function renderHtmlToImage(htmlContent, outputPath, width, height, mode, maxHeight, dpr) {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: mode !== 'dynamic' ? height : maxHeight }, deviceScaleFactor: dpr });
    await page.setContent(htmlContent);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    let actualHeight;
    if (mode === 'auto-fit') {
        await page.evaluate(() => {
            const viewportContent = document.querySelector('.card-content');
            const scaleEl = document.querySelector('.card-content-scale');
            if (!viewportContent || !scaleEl) return;
            scaleEl.style.transform = 'none'; scaleEl.style.width = ''; scaleEl.style.height = '';
            const aw = viewportContent.clientWidth, ah = viewportContent.clientHeight;
            const cw = Math.max(scaleEl.scrollWidth, scaleEl.getBoundingClientRect().width);
            const ch = Math.max(scaleEl.scrollHeight, scaleEl.getBoundingClientRect().height);
            if (!aw || !ah || !cw || !ch) return;
            const scale = Math.min(1, aw / cw, ah / ch);
            scaleEl.style.width = (aw / scale) + 'px';
            scaleEl.style.transformOrigin = 'top left';
            scaleEl.style.transform = `translate(0,0) scale(${scale})`;
        });
        await page.waitForTimeout(100);
        actualHeight = height;
    } else if (mode === 'dynamic') {
        actualHeight = Math.max(height, Math.min(await page.evaluate(() => document.querySelector('.card-container')?.scrollHeight || document.body.scrollHeight), maxHeight));
    } else {
        actualHeight = Math.max(height, await page.evaluate(() => document.querySelector('.card-container')?.scrollHeight || document.body.scrollHeight));
    }
    await page.screenshot({ path: outputPath, clip: { x: 0, y: 0, width, height: actualHeight }, type: 'png' });
    await browser.close();
    console.log(`  ✅ 已生成: ${outputPath} (${width}x${actualHeight})`);
}

async function main() {
    const opt = parseArgs();
    if (!opt.markdownFile || !fs.existsSync(opt.markdownFile)) {
        console.error('❌ 请提供有效的 Markdown 文件路径');
        process.exit(1);
    }
    const { metadata, body } = parseMarkdownFile(opt.markdownFile);
    const cardContents = splitContentBySeparator(body);
    if (!fs.existsSync(opt.outputDir)) fs.mkdirSync(opt.outputDir, { recursive: true });
    console.log('\n🎨 开始渲染:', opt.markdownFile);
    if (metadata.emoji || metadata.title) {
        const coverPath = path.join(opt.outputDir, 'cover.png');
        await renderHtmlToImage(generateCoverHtml(metadata, opt.theme, opt.width, opt.height), coverPath, opt.width, opt.height, 'separator', opt.maxHeight, opt.dpr);
    }
    for (let i = 0; i < cardContents.length; i++) {
        const cardPath = path.join(opt.outputDir, `card_${i + 1}.png`);
        await renderHtmlToImage(generateCardHtml(cardContents[i], opt.theme, i + 1, cardContents.length, opt.width, opt.height, opt.mode), cardPath, opt.width, opt.height, opt.mode, opt.maxHeight, opt.dpr);
    }
    console.log('\n✨ 渲染完成！', opt.outputDir);
}

main().catch(console.error);
