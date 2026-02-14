# 生图调用指南

本文档说明如何使用 `skill_generate_image.py` 为 storyboard 中的镜头生成图片。

## 概述

- **脚本职责**：接收主流程传入的**所有参数**，将 `reference_image_list` 中 **file://** 在请求时转为 **base64**，**HTTP POST** 调用后端异步生图接口（`BACKEND_BASE_URL` + `/creez/images/async_generations`），并将 `status: "isloading"` 的占位符写回 storyboard。storyboard 内仍存 **file://** 以兼容既有数据。**脚本内部不调用 LLM**。
- **主流程职责**：在 tool call 时生成/准备所有参数并传入脚本；需配置 **BACKEND_BASE_URL**（或 `--backend_base_url`）指向后端服务。
- **异步执行**：后端接口立即返回 task_id，任务异步执行，完成后更新 `image_tasks`，前端轮询或订阅即可获取最终结果。

## 参数来源

### 由用户语义生成

| 参数 | 说明 | 用户未提及时 |
|------|------|--------------|
| `prompt` | 生图提示词 | 由 LLM 根据 shot 的 type、movement、description、active_assets 生成 |
| `model` | 生图模型 | 使用**项目默认配置** |
| `aspect_ratio` | 宽高比 | 使用**项目默认配置** |
| `reference_image_list` | 参考图列表 | 使用当前 shot 的 **active_assets** 从 `art_materials.asset` 取 `image_urls[0]` 构造 |

`reference_image_list` 格式：`[{"url": "file:///..."}, ...]`（每项仅需 **url**，为 **file://** 本地路径）


---

## 功能

为指定镜头的图片（写入 `picture.frames`）发起图片生成任务。`picture.frames` 为二维数组：`frames[组索引][记录索引]`，新生成记录可追加到第一组或新组。

## 执行位置


## 命令格式

需配置后端地址：环境变量 **BACKEND_BASE_URL** 或参数 **--backend_base_url**（如 `https://your-backend.example.com`）。未配置时脚本仍会写 storyboard 占位但不发起生图请求。

```bash
python scripts/skill_generate_image.py <storyboard.json> \
  --shot_id <镜头ID> \
  --prompt "<生图提示词>" \
  --model "<模型名>" \
  --aspect_ratio "<宽高比>" \
  --reference_image_list '[{"url":"file:///D:/path/to/image.png"}]' \
  [--frame_index 0] \
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
| `--prompt` | ✅ | 生图 prompt，由主流程 LLM 生成 |
| `--model` | ✅ | 生图模型，用户未提及时用项目默认 |
| `--aspect_ratio` | ✅ | 宽高比（如 16:9），用户未提及时用项目默认 |
| `--reference_image_list` | ✅ | 参考图列表 JSON 数组，每项 `{"url":"file:///..."}`；请求接口时 file:// 会转为 base64，storyboard 内仍存 file:// |
| `--frame_index` | — | 默认 `0`。0 = 写入 `picture.frames[0]`（首组），≥1 = 追加到新组 `picture.frames` |
| `--backend_base_url` | — | 后端 base URL（也可用环境变量 BACKEND_BASE_URL），如未配置则不调用生图接口 |
| `--user_id` | 调用后端时必填 | 当前用户 ID；脚本会放入请求头 **X-User-Id** 调用后端，与 Creez_backend 的 `require_user_id` 一致，缺失时后端返回 401 |
| `--project_id` | — | 系统级参数，随请求体传给后端 |
| `--chat_id` | — | 系统级参数，随请求体传给后端 |

## 执行流程（脚本内部）

1. **读取** storyboard JSON
2. **查找** 对应 shot（按 shot_id）
3. **发起任务**：调用 `fire_and_forget_generate_image(task_id, **kwargs)`，传入主流程提供的所有参数
4. **写回占位符**：在 storyboard 中写入 `status: "isloading"` 的 generatedImage 对象（使用传入的 prompt、model、aspect_ratio、reference_image_list）
5. **保存** storyboard 文件
6. **返回** JSON 结果（含 task_id、shot_id、frame_index）

## 示例

### 示例 1：生成首帧图

```bash
python scripts/skill_generate_image.py storyboard.json \
  --shot_id 3 \
  --prompt "中景缓慢推镜，黎明时分的海岸线上，参考图1中的络腮胡男子(遇难状态)" \
  --model "doubao-seedream-4-0" \
  --aspect_ratio "16:9" \
  --reference_image_list '[{"url":"file:///D:/工作目录/.creez/sceneboard/assets/角色A.png"}]' \
  --user_id "user_xxx" \
  --project_id "proj_xxx" \
  --chat_id "chat_xxx"
```

### 示例 2：生成关键帧（写入 frames）

```bash
python scripts/skill_generate_image.py storyboard.json \
  --shot_id 5 \
  --frame_index 1 \
  --prompt "特写镜头，角色表情" \
  --model "doubao-seedream-4-0" \
  --aspect_ratio "1:1" \
  --reference_image_list '[]'
```

## 常见问题

### Q1：reference_image_list 在主流程如何构造？

**A**：从 `art_materials.asset` 中按 `shot.active_assets`（资产 id）取对应资产的 `image_urls[0]`（**file://**）构造 `[{"url": "file:///..."}]`。若用户未指定参考图，直接使用当前 active_assets 对应的 asset 的 image_urls。

### Q2：脚本执行后 storyboard 会立即有结果图吗？

**A**：不会。脚本只写入 `status: "isloading"` 的占位符，实际生成由后端异步完成。后端完成后会更新 `image_tasks`，前端轮询或订阅即可获取最终结果（`status: "completed"` + `image_urls`）。

### Q3：如何传入 user_id？后端如何校验？

**A**：后端（Creez_backend）从 **HTTP Header** 的 **X-User-Id** 读取 user_id（见 `middleware/auth.require_user_id`），不从请求体读取。Creez 前端在**调用 tool/skill 时**应把当前用户的 user_id 传入（例如在发起 skill_generate_image 或对应 tool call 时，由前端代码将 user_id 写入调用参数）。

### Q4：如何在 tool call 中传入参数？

**A**：主流程在发起 tool call 前应：

1. 调用 LLM（如 `scene_parameter_utils.generate_scene_image_parameters`）根据 shot + 用户语义生成 prompt、model、aspect_ratio
2. 若用户未提及 model/aspect_ratio，使用项目默认配置
3. 从 storyboard 的 `art_materials.asset` 按 `shot.active_assets` 构造 reference_image_list
4. **由前端/调用方**从当前会话取出 user_id、project_id、chat_id，在调用 tool/skill 时传入
5. 将所有参数传给脚本（user_id 由脚本放入请求头 X-User-Id，其余在请求体中）

**重要**：执行完脚本后，**无需再手动编辑 storyboard 文件**，脚本已自动写回。

## 返回结果

### 成功

```json
{
  "success": true,
  "task_id": "uuid",
  "shot_id": 3,
  "frame_index": 0,
  "message": "已提交生图任务 task_id=uuid，storyboard 已写入 isloading 占位并保存"
}
```

### 失败

```json
{
  "success": false,
  "message": "shot_id 999 not found"
}
```

```json
{
  "success": false,
  "message": "reference_image_list 格式错误，需为合法 JSON 数组"
}
```
