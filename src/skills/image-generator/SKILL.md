---
name: image-generator
description: 根据文本提示生成图片，支持宽高比、参考图、多图等。由 Agent 在需要生图时自行调用。
---

# Image Generator（生成图片）

## 使用场景

- 用户或上游任务需要「根据描述生成一张/多张图片」时，由 Agent 判断并调用本技能。


## 任务介绍

本技能根据 `prompt` 请求 **creez 后端** 生图接口（`POST /media/generate-image`），返回图片 URL 及生成信息。

技能实现入口为 `scripts/generate_image.cjs`。


## 方法定义（Method Contract）

### `generate_image`

- 功能：根据提示词生成一张或多张图片。
- 输入：
  - `prompt: string` 必填，图片描述
  - `options?: object` 可选
    - `ratio?: string` 宽高比，如 `"16:9"`、`"1:1"`，默认 `"16:9"`
    - `numImages?: number` 生成数量 1–10，默认 1
    - `referenceImageUrls?: string[]` 参考图 URL 列表，最多 5 张
    - `enableWebSearch?: boolean` 是否启用联网搜索增强提示，默认 false
    - `creezApiKey?: string` 可选，请求后端时的 Bearer 密钥
- 输出：`{ generation: [{ id, url, prompt, model, ratio, createdAt, imageRefs?, image } ]}`

发布前需在技能根目录或脚本可读到的目录配置 `.env` 中的 `CREEZ_API_KEY`

## 方法调用示例（Node）

```bash
node -e "const f=require('./src/skills/image-generator/scripts/generate_image.cjs'); f('一只在阳光下睡觉的橘猫').then(r=>console.log(JSON.stringify(r,null,2)));"
```