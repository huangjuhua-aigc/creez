---
name: xiaohongshu
description: 小红书笔记制作与发布。撰写笔记内容，生成 Markdown 并渲染为封面与多张卡片图，可选脚本发布到小红书。
metadata: {"creez":{"emoji":"📕","requires":{"bins":["python","node"]}}}
read_when:
  - 用户要发小红书笔记、做图文内容
  - 需要把资料或主题写成小红书风格并出图
  - 需要生成可直接发布的封面与多张正文卡片图
---

# 小红书笔记制作与发布

根据用户需求撰写小红书风格内容，生成用于渲染的 Markdown，调用脚本渲染为封面与卡片图，可选调用发布脚本发到小红书。

## 使用场景

- 用户明确要「发一篇小红书」「做一条小红书笔记」时使用本技能。
- 用户提供主题、资料或大纲，需要转化为小红书风格标题+正文并产出配图时使用本技能。
- 需要产出多图/卡片式笔记（封面 + 若干正文图）时使用本技能；单图或纯文字发布不强制走本技能。

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

**调用方法**：
1. 先理解即将发送的Markdown文件，调用生成图片的技能（image-generator），生成一张小红书的封面图（cover.png）
2. 在根据带发送Markdown文件中的内容，调用生成图片的技能（image-generator），生成一张小红书多张正文卡片图背景图
3. 根据Markdown文件的内容，调用生成图片的技能（image-generator），把markdown中的文字按段落拆分，把文件压在正文卡片背景图上。


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

- **渲染**：`pip install -r requirements.txt`，并执行 `playwright install chromium`。脚本会从技能目录读取 `assets/`（封面/卡片模板与 `assets/themes/` 主题 CSS）。
- **发布**：依赖 `xhs`（见 requirements.txt）；必须配置有效的 `XHS_COOKIE`。
- **技能资源**：`scripts/render_xhs.py`、`scripts/render_xhs.js`、`scripts/publish_xhs.py`；`assets/`、`assets/themes/`。

## 注意事项

1. Markdown 文件与渲染输出建议放在同一工作目录，或用 `-o` 指定输出目录。
2. 图片尺寸默认 1080×1440（3:4），符合小红书推荐。
3. Cookie 会过期，发布失败时需重新获取并更新 `.env`。
