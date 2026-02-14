# 生视频调用指南

本文档说明如何使用 `skill_generate_video.py` 为 storyboard 中的镜头生成视频。

## 概述

- **脚本职责**：接收主流程传入的**所有参数**，调用 `fire_and_forget_generate_video`，并将 `status: "isloading"` 的占位符写回 storyboard。**脚本内部不调用 LLM**。
- **主流程职责**：在 tool call 时生成/准备所有参数并传入脚本。
- **异步执行**：脚本调用 `fire_and_forget_generate_video` 异步发起任务，后端完成后会更新 `video_tasks`，前端轮询或订阅即可获取最终结果。
- **先图后视频**：生视频前必须先有首帧图，`first_frame_image` 由主流程从 shot 的 `picture.frames` 取首帧 URL（如 `picture.frames[0][0].image_urls[0]`，**file://**）传入。
- **Backend 调用**：脚本通过 **HTTP POST** 调用后端异步生视频接口（`BACKEND_BASE_URL` + `/creez/videos/async_generations`）；首/尾帧若为 **file://** 会在请求时转为 **base64**，storyboard 内仍存 file://。需配置 **BACKEND_BASE_URL** 或 `--backend_base_url`。

## 参数来源

### 由用户语义生成（主流程 LLM）

| 参数 | 说明 | 用户未提及时 |
|------|------|--------------|
| `prompt` | 视频提示词 | 由 LLM 根据 shot 的 type、movement、description 生成 |
| `model` | 视频模型 | 使用**项目默认配置** |
| `aspect_ratio` | 宽高比 | 使用**项目默认配置** |
| `duration` | 视频时长（秒） | 使用**项目默认配置** |

### 从 storyboard 获取（非 LLM）

| 参数 | 说明 |
|------|------|
| `first_frame_image` | 从该镜头 `picture.frames` 取：如 `frames[0][0].image_urls[0]`（第一个已完成记录的首张图，**file://**）。主流程读 storyboard 时一并获取；若无可用首帧，主流程应直接报错，不调用脚本 |
| `last_frame_image` | 可选，尾帧图 URL |

### 系统级参数（非 LLM 产生）

| 参数 | 说明 |
|------|------|
| `user_id` | 从当前会话/系统取出，调用 tool 时传入 |
| `project_id` | 从当前项目/系统取出，调用 tool 时传入 |
| `chat_id` | 从当前会话/系统取出，调用 tool 时传入 |

这三个参数可在工程上于调用 tool 时硬编码从系统取出并传入。

---

## 功能

为指定镜头发起视频生成任务，写入 `shot.videos` 数组。

## 执行位置

**必须在项目根目录（`mcp_host_backend`）下执行**，以便脚本能正确 import `fire_and_forget_call_tool`。

## 命令格式

需配置后端地址：环境变量 **BACKEND_BASE_URL** 或参数 **--backend_base_url**。首/尾帧若为 file:// 会在请求时转为 base64。

```bash
python scripts/skill_generate_video.py <storyboard.json> \
  --shot_id <镜头ID> \
  --prompt "<视频提示词>" \
  --model "<模型名>" \
  --aspect_ratio "<宽高比>" \
  --duration <秒数> \
  --first_frame_image "file:///D:/path/to/first.png" \
  [--last_frame_image "file:///..."] \
  [--backend_base_url "https://..."] \
  [--user_id "..."] \
  [--project_id "..."] \
  [--chat_id "..."]
```

## 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `storyboard.json` | ✅ | storyboard JSON 文件路径（位置参数） |
| `--shot_id` | ✅ | 镜头 shot_id（整数） |
| `--prompt` | ✅ | 视频 prompt，由主流程 LLM 生成 |
| `--model` | ✅ | 视频模型，用户未提及时用项目默认 |
| `--aspect_ratio` | ✅ | 宽高比（如 16:9），用户未提及时用项目默认 |
| `--duration` | ✅ | 视频时长（秒），用户未提及时用项目默认 |
| `--first_frame_image` | ✅ | 首帧图 URL（**file://** 或 http(s)），从 shot.picture.frames 取；file:// 请求时转为 base64 |
| `--last_frame_image` | — | 尾帧图 URL（可选），file:// 同上 |
| `--backend_base_url` | — | 后端 base URL（也可用环境变量 BACKEND_BASE_URL） |
| `--user_id` | — | 系统级参数 |
| `--project_id` | — | 系统级参数 |
| `--chat_id` | — | 系统级参数 |

## 执行流程（脚本内部）

1. **读取** storyboard JSON
2. **查找** 对应 shot（按 shot_id）
3. **校验** first_frame_image 非空，否则返回错误
4. **发起任务**：调用 `fire_and_forget_generate_video(task_id, **kwargs)`，传入主流程提供的所有参数
5. **写回占位符**：在 storyboard 中写入 `status: "isloading"` 的 generatedVideo 对象（使用传入的 prompt、model、aspect_ratio、duration、first_frame_image 等）
6. **保存** storyboard 文件
7. **返回** JSON 结果（含 task_id、shot_id）

## 示例

### 示例 1：生成视频

```bash
python scripts/skill_generate_video.py storyboard.json \
  --shot_id 3 \
  --prompt "中景缓慢推镜，黎明时分的海岸线" \
  --model "doubao-seedance-pro" \
  --aspect_ratio "16:9" \
  --duration 5 \
  --first_frame_image "file:///D:/工作目录/.creez/.../shot3_0.png" \
  --user_id "user_xxx" \
  --project_id "proj_xxx" \
  --chat_id "chat_xxx"
```

### 示例 2：指定时长与尾帧

```bash
python scripts/skill_generate_video.py storyboard.json \
  --shot_id 5 \
  --prompt "慢速推镜" \
  --model "doubao-seedance-pro" \
  --aspect_ratio "16:9" \
  --duration 10 \
  --first_frame_image "file:///.../first.png" \
  --last_frame_image "file:///.../last.png"
```

## 常见问题

### Q1：first_frame_image 在主流程如何获取？

**A**：主流程读取 storyboard 后，从 `shot.picture.frames` 中查找（如遍历 `frames[0]` 或第一组）第一个 `status: "completed"` 且有 `image_urls` 的项，取 `image_urls[0]`（**file://**）。若无可用首帧，应在调用脚本前报错，不发起生视频请求。

### Q2：脚本执行后 storyboard 会立即有结果视频吗？

**A**：不会。脚本只写入 `status: "isloading"` 的占位符，实际生成由后端异步完成。后端完成后会更新 `video_tasks`，前端轮询或订阅即可获取最终结果（`status: "completed"` + `video_urls`）。

### Q3：如何在 tool call 中传入参数？

**A**：主流程在发起 tool call 前应：

1. 调用 LLM（如 `scene_parameter_utils.generate_scene_video_parameters`）根据 shot + 用户语义生成 prompt、model、aspect_ratio、duration
2. 若用户未提及，使用项目默认配置
3. 从 storyboard 的 `shot.picture.frames` 取 first_frame_image
4. 从系统取出 user_id、project_id、chat_id
5. 将所有参数传给脚本

**重要**：执行完脚本后，**无需再手动编辑 storyboard 文件**，脚本已自动写回。

## 返回结果

### 成功

```json
{
  "success": true,
  "task_id": "uuid",
  "shot_id": 3,
  "message": "已提交视频生成任务 task_id=uuid，storyboard 已写入 isloading 占位并保存"
}
```

### 失败

```json
{
  "success": false,
  "message": "shot_id 3 无可用首帧图，请先生成首帧图"
}
```

```json
{
  "success": false,
  "message": "shot_id 999 not found"
}
```
