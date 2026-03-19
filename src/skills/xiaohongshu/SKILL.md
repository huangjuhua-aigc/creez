---
name: xiaohongshu
description: 小红书笔记制作与发布。撰写笔记内容，生成 Markdown 并渲染为封面与多张卡片图，可选脚本发布到小红书。
列出以下几个使用场景
  - 用户要发小红书笔记、做图文内容
  - 需要把资料或主题写成小红书风格并出图
  - 需要生成可直接发布的封面与多张正文卡片图
  - 用户指定了标题/副标题/正文文案，要求把文字套在固定版式的小红书图文模板上导出图片（此时用本技能内的图文模板渲染，不要用 image-generator）
metadata: {"creez":{"emoji":"📕","requires":{"bins":["python","node"]}}}

---

# 小红书笔记制作与发布

根据用户需求撰写小红书风格内容，生成用于渲染的 Markdown，调用脚本渲染为封面与卡片图，可选调用发布脚本发到小红书。

## 使用场景

- 用户明确要「发一篇小红书」「做一条小红书笔记」时使用本技能。
- 用户提供主题、资料或大纲，需要转化为小红书风格标题+正文并产出配图时使用本技能。
- 需要产出多图/卡片式笔记（封面 + 若干正文图）时使用本技能；单图或纯文字发布不强制走本技能。

## 小红书内容创作整体流程
1. 选择已有或创建新的文件夹，用于管理一次创作的文件。
2. 根据用户需求创撰写笔记与生成 Markdown文件
3. 基于markdown文字内容创建图文内容。
4. 区分标题图片和正文图片调用小红书发布工具，完成发布。


## 撰写笔记与生成 Markdown

**调用场景**：在用户给出主题或资料后，先产出标题与正文，再生成**专门用于渲染**的 Markdown 文件（不要直接把正文当正文块粘贴，需按下列结构生成）。

**要求**：
- 标题：不超过 20 字，有吸引力（数字、疑问、感叹等）。
- 正文：分段清晰、少量 Emoji、短句；结尾可带 5–10 个相关标签。
- Markdown 必须包含 YAML 头部（封面信息），正文可用 `---` 拆成多张卡片（每段约 200 字内）。

**Markdown 结构**：

```yaml
---
emoji: "🚀"           # 封面装饰 Emoji
title: "大标题"        # 封面大标题（不超过15字）
subtitle: "副标题文案"  # 封面副标题（不超过15字）
---
```

正文紧跟在上方 `---` 之后；需多张卡片时用 `---` 分隔段落。示例见 `assets/example.md`。

---

## 渲染图片

**调用场景**：已有用于渲染的 Markdown 文件，需要生成封面图（cover.png）与多张正文卡片图（card_1.png, card_2.png, ...）时调用。输出为 1080×1440（3:4）的 PNG，可直接用于小红书发布。

**调用方法**：生成图文内容有两种方式，按场景择一使用。

1. **AI 生图**：基于对内容的理解和用户要求，直接调用 AI 生图能力（image-generator）生成封面与正文配图。先根据 Markdown（含 YAML 封面信息）理解主题与风格，再调用 image-generator 生成 cover.png 及多张卡片图（card_1.png、card_2.png、…）。适合需要插画、氛围图或自由版式时使用，但是请注意，生成图片的prompt上一定不要出现小红书字样，只说用于社交媒体封面图/正文图。
2. **预制图文模板**：利用本技能内的固定版式模板，将已有文案（标题、副标题、正文）导入模板并导出为图片。不调用 image-generator，而是调用本技能「图文模板渲染」下的 `render_cover`、`render_content` 脚本，把文字压在模板上产出 PNG。适合文案已定、只需套版出图时使用。详见下一节。

---

## 图文模板渲染（科技简洁风）

**何时必须用本节（不要用 image-generator）**：当用户已经给出或要求你撰写出「标题 + 副标题」「正文文案」，并希望**把这些文字压在固定版式的小红书图文模板上**导出为图片时，必须使用本节的 `render_cover` 和 `render_content` 脚本生成图片，**不要**调用 image-generator 或其它画图技能。image-generator 用于 AI 生成插画/配图；本节是「文案 + 固定模板」排版成图，两者场景不同。

**典型创作场景**：用户说「帮我做一条小红书」「用这段文案做一张小红书封面」「把下面这段文字做成小红书正文图」「用科技简洁风模板出图」等，且内容以文字为主、需要套在现成版式上时，优先走本节：先确定封面标题/副标题和正文文案，再调用本技能内脚本渲染，最后可选调用 `publish_xhs` 发布。

**技术说明**：两套模板（封面 + 正文）为科技简洁风，直接填入文字生成 750×1000（3:4）的 PNG。所有脚本与资源均在技能目录内，无需配置外部路径。

### 工具 1：render_cover（模板封面）

入参：`title`（必填）、`subtitle`（必填）、`backgroundImage`（可选）、`outputPath`（可选，默认 `cover.png`）。

行为：调用技能内脚本生成封面图并返回保存路径。

```bash
node {baseDir}/scripts/render_template.js --type cover --title "主标题" --subtitle "副标题" [--backgroundImage URL] [--output cover.png]
```

### 工具 2：render_content（模板正文图）

入参：`content`（必填）、`backgroundImage`（可选）、`outputPath`（可选，默认 `card_1.png`）。正文支持 `# 标题`、`1. 2.` 数字列表。

行为：调用技能内脚本生成正文图并返回保存路径。

```bash
node {baseDir}/scripts/render_template.js --type content --content "正文内容..." [--backgroundImage URL] [--output card_1.png]
```

### 与发布的衔接

得到 cover.png、card_1.png 等路径后，直接在本技能内调用 `publish_xhs`（见下），传入上述图片路径即可。

---

## 发布笔记（publish_xhs）

**调用场景**：已通过本技能或其它方式得到封面与正文卡片图（如 cover.png、card_1.png、card_2.png），用户要求**发布到小红书**时调用。发布前需在技能根目录或脚本可读到的目录配置 `.env` 中的 `XHS_COOKIE`（见 `env.example.txt`）。

**调用方法**：

```bash
python {baseDir}/scripts/publish_xhs.py --title "笔记标题" --desc "正文描述" --images cover.png card_1.png card_2.png [options]
```

示例：

```bash
python scripts/publish_xhs.py -t "5个效率神器" -d "正文内容..." -i cover.png card_1.png card_2.png
python scripts/publish_xhs.py -t "标题" -d "描述" -i cover.png card_1.png --private
```

**参数**：

| 参数 | 简写 | 说明 |
|------|------|------|
| `--title` | `-t` | 笔记标题（必填，≤20 字） |
| `--desc` | `-d` | 笔记描述/正文内容 |
| `--images` | `-i` | 图片路径列表（多个，顺序即展示顺序；通常最后放 cover） |
| `--private` |  | 设为私密笔记 |
| `--post-time` |  | 定时发布，格式 `2024-01-01 12:00:00` |
| `--api-mode` |  | 通过 xhs-api 服务发布 |
| `--api-url` |  | API 地址（不填时用环境变量 XHS_API_URL） |
| `--dry-run` |  | 仅校验参数，不实际发布 |

**Cookie 获取**：浏览器登录 https://www.xiaohongshu.com → F12 → Network → 任选请求 → 请求头中的 Cookie 整段复制到 `.env` 的 `XHS_COOKIE`。

---

## 依赖与资源

- **Markdown 渲染**：`pip install -r requirements.txt`，并执行 `playwright install chromium`。脚本会从技能目录读取 `assets/`（封面/卡片模板与 `assets/themes/` 主题 CSS）。
- **图文模板渲染**：需 Node.js 与 `puppeteer`（`npm install puppeteer` 或由运行环境提供）。脚本与模板均在技能内：`scripts/render_template.js`，`assets/template-render/`（cover.html、content.html）。**默认封面/正文背景**为模板内 CSS 浅灰模糊纹理（对齐 Xhstemplate 视觉，不依赖外部图）。可选：将自定义底图放在 `assets/template/default-bg.png`，`render_template.js` 会在未传 `--backgroundImage` 时自动用绝对 `file://` 注入。无需配置 `XHS_TEMPLATE_PROJECT_PATH`。
- **发布**：依赖 `xhs`（见 requirements.txt）；**发布前需在 `~/.creez/.env` 或技能目录 `.env` 中配置有效的 `XHS_COOKIE`**。
- **技能资源**：`scripts/render_template.js`、`scripts/publish_xhs.py`；`assets/`、`assets/themes/`、`assets/template-render/`；可选 `assets/template/default-bg.png`。

## 注意事项

1. Markdown 文件与渲染输出建议放在同一工作目录，或用 `-o` 指定输出目录。
2. 图片尺寸：Markdown 渲染默认 1080×1440（3:4）；图文模板渲染为 750×1000（3:4），均符合小红书推荐。
3. **Cookie 会过期，发布失败时需重新获取并更新 `.env` 中的 `XHS_COOKIE`。**
