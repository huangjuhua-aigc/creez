# 小红书技能（制作 + 发布）

只做两件事：**制作**（撰写内容 + 渲染成封面/卡片图）和**发布**（可选，脚本发到小红书）。其他能力以后再说。

## 能力概览

- 撰写小红书风格标题与正文
- 生成用于渲染的 Markdown（YAML 头 + 正文），用 `scripts/render_xhs.py` 得到 cover.png + card_*.png
- 可选：`scripts/publish_xhs.py` 发布到小红书（需配置 Cookie）

## 目录结构

```
xiaohongshu/
├── SKILL.md           # 技能说明（必读）
├── README.md
├── requirements.txt   # Python 依赖（渲染+发布）
├── env.example.txt    # Cookie 配置示例
├── scripts/           # render_xhs.py, render_xhs.js, publish_xhs.py
└── assets/            # 封面/卡片模板、主题 CSS（themes/）
```

`persona.md`、`references/` 仍保留在目录中，供后续扩展使用。

## 安装依赖

```bash
cd xiaohongshu
pip install -r requirements.txt
playwright install chromium
```

Node 渲染（可选）：`npm install marked yaml playwright` 且 `npx playwright install chromium`。

## 脚本发布配置

1. 复制 `env.example.txt` 为 `.env`，放在技能根目录或脚本能读到的上级目录。
2. 浏览器登录小红书，F12 → Network → 复制请求头 Cookie 到 `.env` 的 `XHS_COOKIE`。
3. 执行：`python scripts/publish_xhs.py -t "标题" -d "正文" -i cover.png card_1.png card_2.png`  
   使用 API 服务时加 `--api-mode`。
