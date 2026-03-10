---
name: video-generator
description: 根据首帧图（及可选尾帧）和提示词生成短视频。由 Agent 在需要生成视频时自行调用。
---

# Video Generator（生成视频）

## 使用场景

- 用户或上游任务需要「根据一张/多张关键帧图片生成短视频」时，由 Agent 判断并调用本技能。
- 与故事板技能并列：故事板负责端到端产出故事板数据；本技能仅负责单次视频生成，供通用对话或其它工作流使用。

## 任务介绍

本技能根据 `startFrameUrl`（必填）及可选的 `endFrameUrl`、`prompt` 等，调用后端视频生成服务（豆包 Seedance 等），默认同步等待完成后返回视频 URL。

技能实现入口为 `scripts/generate_video.cjs`。

## 方法定义（Method Contract）

### `generate_video`

- 功能：根据首帧（及可选尾帧）和提示词生成短视频。
- 输入：
  - `payload: object`
    - `startFrameUrl: string` 必填，首帧图片 URL
    - `endFrameUrl?: string` 可选，尾帧图片 URL
    - `keyframes?: string[]` 可选，若提供则首元素作为 startFrameUrl、末元素作为 endFrameUrl
    - `prompt?: string` 视频描述/动作提示
    - `duration?: string` 时长（秒），如 `"5"`、`"10"`，默认 `"5"`
    - `ratio?: string` 宽高比，如 `"16:9"`、`"adaptive"`，默认 `"adaptive"`
    - `wait?: boolean` 是否同步等待生成完成，默认 true；false 时仅返回 taskId
- 输出：`{ generation: { id, url, prompt, model, ratio, duration, createdAt, taskId?, keyframes? } }`，若 `wait=false` 则 `url` 可能为空、`taskId` 存在。

## 方法调用示例（Node）

工作目录为 `creez_backend/src` 或从项目根执行：

```bash
node -e "const f=require('./src/skills/video-generator/scripts/generate_video.cjs'); f({ startFrameUrl: 'https://example.com/frame.jpg', prompt: '镜头缓慢推进' }).then(r=>console.log(JSON.stringify(r,null,2)));"
```

## 与后端接口对应关系

- 本技能与 `POST /media/generate-video` 使用同一套视频生成服务与参数约定（startFrameUrl、endFrameUrl、prompt、duration、ratio、wait），可在技能内直接调用 service 层，或由上层通过 HTTP 调用接口。
