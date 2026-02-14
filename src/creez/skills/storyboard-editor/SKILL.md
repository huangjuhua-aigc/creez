---
name: storyboard-editor
description: 'Edit and manage storyboard JSON files for video production. use this skill when: (1) the user needs to create or establish a 分镜故事板 (storyboard), OR (2) the filename ends with .scene_board, OR (3) the JSON file contains both "scene_board" and "art_materials" top-level keys. Handles operations on scene_board (shots array), art_materials (assets), picture generation parameters, and active_assets references. Do NOT use for general JSON editing, configuration files, or non-storyboard structures.'
---

# Storyboard Editor

Professional storyboard JSON file editor for video production workflows. Manages scene boards, art materials, and AI-generated visual content.

## Data Structure Overview

下面是一个简化版的 **storyboard JSON 示例**，用于直观理解结构（字段与真实 schema 一致，图片/参考图 URL 为 **file://** 本地路径，部分内容用 `...` 省略）：

```json
{
  "name": "第1集-晨雾中的海岸",
  "style": "写实、冷色调、电影感",
  "scene_board": [
    {
      "shot_id": 1,
      "scene_index": 0,
      "type": "中景",
      "movement": "缓慢推镜",
      "description": "黎明时分的海岸线上，主角被海浪卷到沙滩上。",
      "visual": "",
      "action": "",
      "dialogue": "",
      "sound": "",
      "active_assets": [
        "asset_1770908649829_hl7c3qry8",
        "asset_xxx_场景A"
      ],
      "picture": {
        "frames": [
          [
            {
              "image_urls": [
                "file:///D:/工作目录/.creez/sceneboard/xxx.scene_board/image/shot1_0.png"
              ],
              "status": "completed",
              "parameters": {
                "prompt": "中景缓慢推镜，黎明海岸，参考角色A，冷色调写实电影感",
                "model": "doubao-seedream-4-5",
                "aspect_ratio": "16:9",
                "reference_image_list": [
                  { "url": "file:///D:/工作目录/.creez/sceneboard/assets/角色A.png" }
                ]
              },
              "taskId": "img-task-1",
              "created_at": 1706789123456
            }
          ]
        ]
      },
      "videos": [
        {
          "status": "completed",
          "taskId": "video-task-1",
          "created_at": 1706789129999,
          "video_urls": [
            "file:///D:/工作目录/.creez/sceneboard/xxx.scene_board/video/shot1.mp4"
          ],
          "parameters": {
            "prompt": "中景缓慢推镜，黎明海岸线，主角被浪卷到沙滩上",
            "model": "doubao-seedance-pro",
            "first_frame_image": "file:///.../shot1_0.png",
            "last_frame_image": "file:///.../shot1_last.png"
          }
        }
      ]
    }
  ],
  "art_materials": {
    "asset": [
      {
        "id": "asset_1770908649829_hl7c3qry8",
        "name": "金发小男孩-标准状态",
        "desc": "金发、蓝眼睛的小男孩，穿着破旧的外套。",
        "visual_state": "标准状态",
        "asset_type": "角色",
        "image_urls": [
          "file:///D:/工作目录/.creez/sceneboard/assets/角色A.png"
        ]
      },
      {
        "id": "asset_xxx_场景A",
        "name": "黎明海岸线",
        "desc": "多云天空、低饱和度的石滩海岸，浪花翻涌。",
        "visual_state": "黎明",
        "asset_type": "场景",
        "image_urls": [
          "file:///D:/工作目录/.creez/sceneboard/assets/场景A.png"
        ]
      }
    ]
  }
}
```

关键点回顾：

- `scene_board` 是镜头数组，**顺序即成片顺序**。
- 每个 shot 必须有 `shot_id` 和 `scene_index`，且 `scene_index` 0..n-1 连续。
- `active_assets` 存的是 **资产的 id**（与 `art_materials.asset[].id` 对应）。
- `picture.frames` 为 **二维数组**：`frames[组索引][记录索引]`，每组内为多条生成记录；每条记录含 `image_urls`（**file://**）、`status`、`parameters`（含 `reference_image_list`，每项仅需 `url`，**file://**）、`taskId`、`created_at`。**不再使用 first_frame**。
- shot 可选字段：`visual`、`action`、`dialogue`、`sound`。asset 可选字段：`asset_type`（如「角色」「场景」）。
- 图片与参考图 URL 统一为 **file://** 绝对路径。

## Common Operations

### 1. 新建故事板（Create New Storyboard）

当用户需要建立一个分镜故事板时：在合适路径下创建一个**后缀为 `.scene_board`** 的文件，文件内容为如下 JSON。具体镜头、素材等内容由后续任务（如添加镜头、添加素材等）填充。

```json
{
  "name": "",
  "style": "",
  "scene_board": [],
  "art_materials": {
    "asset": []
  }
}
```

**方法：** 使用 write_file 或等价方式，在目标路径（如项目下的 `xxx.scene_board`）创建该文件即可。

### 2. Add New Shot

在分镜中新增一个镜头：可指定插入位置（不传则追加到末尾），并可设类型、运镜、描述、时长。脚本会自动分配 `shot_id`、维护 `scene_index` 并写回 JSON。

```bash
python scripts/add_shot.py <storyboard.json> [-p position] [-t type] [-m movement] [-d description] [--duration N]
```

**参数：** `-p/--position` 插入位置（0-based，不传则追加到末尾）、`-t/--type` 镜头类型、`-m/--movement` 运镜、`-d/--description` 描述、`--duration` 时长（秒）。

**示例：**
```bash
# 在末尾追加一个空镜头
python scripts/add_shot.py 分镜.scene_board

# 在位置 0 插入一个中景推镜，描述「开场」，时长 5 秒
python scripts/add_shot.py 分镜.scene_board -p 0 -t 中景 -m 推镜 -d "开场镜头" --duration 5
```

### 3. Modify Shot Content

修改已有镜头的文案（类型、运镜、描述、时长）或资产引用（`active_assets`）。先 `load_storyboard` 得到 `scene_board`，按 `scene_index` 取到对应 shot 后改字段，再 `save_storyboard` 写回。

**Text Fields:**
```python
from skill_utils import (
    load_storyboard, 
    save_storyboard
)

storyboard = load_storyboard(storyboard_path)
shot = storyboard['scene_board'][scene_index]

shot["type"] = "中景"
shot["movement"] = "缓慢推镜"
shot["description"] = "新的镜头描述"
shot["duration"] = 5
....

storyboard['scene_board'][scene_index] = shot

save_storyboard(storyboard, storyboard_path)
```

**Asset References:**
在镜头上挂接或移除素材引用：直接修改 `shot["active_assets"]` 数组，元素为素材的 `id`（与 `art_materials.asset[].id` 一致）。

```python
# Add asset reference
shot["active_assets"].append("asset_xxx_hl7c3qry8")

# Remove asset reference
shot["active_assets"].remove("asset_xxx_hl7c3qry8")
```

### 4. Add Art Material

管理素材库：通过在 `storyboard["art_materials"]["asset"]` 中新增条目，供各个镜头通过 `active_assets` 引用。资产使用 `id`（唯一，如 `asset_时间戳_随机串`），图片为 `image_urls` 数组（**file://**）。

```python
# Add new asset（id 需唯一，image_urls 可为空数组，生成后填入 file:// URL）
new_asset = {
    "id": "asset_1770908649829_hl7c3qry8",
    "name": "素材名称",
    "desc": "详细描述",
    "image_urls": [],
    "visual_state": "状态",
    "asset_type": "角色"
}
storyboard["art_materials"]["asset"].append(new_asset)

```

### 5. Generate Picture（生成分镜图片）

Read **[`references/image_generation_guide.md`](references/image_generation_guide.md)** and `scripts/skill_generate_image` for implementation.

**快速示例：**（`reference_image_list` 每项仅需 `url`，为 **file://** 路径）。调用 tool/skill 时由 Creez 前端将 user_id（及 project_id、chat_id）传入。
```bash
python scripts/skill_generate_image.py storyboard.json \
  --shot_id 3 \
  --prompt "<主流程 LLM 生成的 prompt>" \
  --model "doubao-seedream-4-0" \
  --aspect_ratio "16:9" \
  --reference_image_list '[{"url":"file:///D:/工作目录/.creez/sceneboard/assets/xxx.png"}]' \
  --user_id "..." \
  --project_id "..." \
  --chat_id "..."
```

### 6. Generate Video（生成分镜视频）
Read **[`references/video_generation_guide.md`](references/video_generation_guide.md)** and `scripts/skill_generate_video` for implementation.

**快速示例：**（首帧图从该镜头 `picture.frames` 中取：如 `picture.frames[0][0].image_urls[0]`，为 **file://** URL）
```bash
python scripts/skill_generate_video.py storyboard.json \
  --shot_id 3 \
  --prompt "<LLM解析语义生成的prompt>" \
  --model "doubao-seedance-pro" \
  --aspect_ratio "16:9" \
  --duration 5 \
  --first_frame_image "file:///D:/工作目录/.creez/.../shot3_0.png" \
  --user_id "..." \
  --project_id "..." \
  --chat_id "..."
```

### 7. Reorder Shots

调整镜头顺序：可交换两个镜头的位置，或将某个镜头移动到新的下标位置，最后统一重排所有 `scene_index`。

```python
# Swap two shots
scene_board[i], scene_board[j] = scene_board[j], scene_board[i]

# Or move one shot to a new position
shot = scene_board.pop(old_index)
scene_board.insert(new_index, shot)

# Update scene_index for all shots
for idx, shot in enumerate(scene_board):
    shot["scene_index"] = idx
```

### 8. Remove shot

删除指定镜头：根据 `scene_index` 或 `shot_id` 找到对应 shot，从 `scene_board` 中移除后，重新整理剩余镜头的 `scene_index` 并保存。

```python
from skill_utils import load_storyboard, save_storyboard, update_scene_indices

storyboard = load_storyboard(storyboard_path)
scene_board = storyboard["scene_board"]

# 例：按 scene_index 删除
removed = scene_board.pop(scene_index)

# 或：按 shot_id 删除
# scene_board[:] = [s for s in scene_board if s.get("shot_id") != target_shot_id]

# 重排 scene_index
update_scene_indices(scene_board)
save_storyboard(storyboard, storyboard_path)
```

### 9. Remove asset

从素材库中删除某个素材条目，并同时清理所有镜头中对该素材的 `active_assets` 引用，避免留下失效引用。

```python
from skill_utils import load_storyboard, save_storyboard, remove_asset_references

storyboard = load_storyboard(storyboard_path)
scene_board = storyboard["scene_board"]
art_materials = storyboard.get("art_materials", {})

target_id = "要删除的资产 id"

# 1) 从素材库删除该 asset
assets = art_materials.get("asset", [])
storyboard["art_materials"]["asset"] = [
    a for a in assets if a.get("id") != target_id
]

# 2) 清理所有镜头里的引用
remove_count = remove_asset_references(scene_board, target_id)

save_storyboard(storyboard, storyboard_path)
print(f"Removed {remove_count} references to asset {target_id}")
```

## Prompt Construction

When generating pictures, construct prompts by combining:

1. **Shot technical specs**: `{type} {movement}镜头`
2. **Shot description**: From `description` field
3. **Asset references**: Details from `active_assets`
4. **Style consistency**: Overall scene style

**Pattern:**
```
{type}{movement}镜头，{description}。
参考图1中的{asset1.desc}，
参考图2中的{asset2.desc}。
场景环境：{environment_style}
画面风格：{visual_style}
```

**Example:**
```
中景缓慢推镜，黎明时分的海岸线上，参考图1中的络腮胡男子被海浪卷抛在沙滩上。
场景环境：冷色调蓝色和灰色天空，昏暗光线，神秘压抑氛围。
画面风格：干净、高分辨率、写实质感，低饱和度，自然光，4K ARRI Alexa质感。
```

## Validation Rules

Before saving, validate:

1. **Unique IDs:**
   - All `shot_id` must be unique
   - All asset `id` in art_materials must be unique

2. **Sequential Indexing:**
   - `scene_index` must be 0, 1, 2, ..., n-1
   - No gaps or duplicates

3. **Asset References:**
   - All `active_assets` IDs must exist in `art_materials.asset[].id`
   - Reference image `url` 为 **file://**，指向本地资源

4. **Required Fields:**
   - Each shot must have: shot_id, scene_index, picture, videos；picture 含 `frames`（二维数组）
   - Each asset must have: id, name, desc, visual_state；图片为 `image_urls` 数组

5. **Data Types:**
   - `shot_id`: integer
   - `scene_index`: integer
   - `active_assets`: array of strings（资产 id）
   - `image_urls`: array of strings（**file://** URL）
   - `picture.frames`: 二维数组，每组内为生成记录

Read `scripts/validate_storyboard.py` for implementation.

## Response Format

After modification, provide:

1. **Summary of changes:**
   - What was modified
   - Which shots/assets affected
   - Number of operations performed

2. **Validation status:**
   - ✅ All validations passed
   - ⚠️ Warnings (if any)
   - ❌ Errors (if any)

3. **Next steps (if applicable):**
   - Pending generation tasks
   - Suggested follow-up actions

**Example:**
```
✅ Storyboard updated successfully!

📝 Changes:
  • Added 2 new shots (IDs: 19, 20)
  • Modified shot #3 description
  • Updated 1 art material (金发小男孩)
  • Reordered shots: moved shot #5 to position 3

🔍 Validation:
  ✅ All shot IDs unique
  ✅ Scene indices sequential
  ✅ Asset references valid
  ✅ Required fields complete

📊 Storyboard stats:
  • Total shots: 20
  • Total assets: 15
  • Shots with pictures: 18
  • Shots with videos: 0
```

## Bundled Resources

### scripts/（本 skill 目录下已有，可直接读取参考）

- **add_shot.py**: 在指定位置插入新镜头的示例实现
- **validate_storyboard.py**: 校验 storyboard JSON 结构
- **skill_utils.py**: 工具函数（ID 生成、scene_index 更新等）
- **skill_generate_image.py**: 为指定镜头/帧发起生图任务；通过 HTTP 调用后端异步生图接口（`BACKEND_BASE_URL` + `/creez/images/async_generations`），storyboard 中 reference 存 file://，请求时 file:// 转为 base64。
- **skill_generate_video.py**: 为指定镜头发起生视频任务；通过 HTTP 调用后端异步生视频接口（`BACKEND_BASE_URL` + `/creez/videos/async_generations`），首/尾帧 file:// 请求时转为 base64。

其余操作（删除镜头、重排、修改镜头属性、添加 asset 等）无需单独脚本：按上文 Common Operations 的步骤，用 read_file / edit_file / write_file 直接读写 storyboard JSON 即可。

生图/生视频脚本的详细调用说明、参数、示例分别见 **`references/image_generation_guide.md`** 与 **`references/video_generation_guide.md`**。用户端无 backend 代码时，需配置 **`BACKEND_BASE_URL`**（或传参 `--backend_base_url`）指向后端服务地址。

### references/

- **prompt_guidelines.md**: 首帧/视频生成时的 prompt 构建建议
- **image_generation_guide.md**: 生图脚本详细调用指南
- **video_generation_guide.md**: 生视频脚本详细调用指南

## Common User Requests

| User Says | Operation | Key Steps |
|-----------|-----------|-----------|
| "新建/建立一个分镜故事板" | 新建故事板 | 在合适路径创建后缀为 .scene_board 的文件，内容为空的 name/style/scene_board/art_materials JSON |
| "在第3个镜头后添加一个新镜头" | Add shot | Insert at position 3, update indices |
| "删除第5个镜头" | Delete shot | Remove shot_id=5, update indices |
| "把第2个镜头移到第5个位置" | Reorder | Move shot, update all indices |
| "修改第1个镜头的描述" | Modify text | Update description field |
| "第3个镜头改为特写" | Modify type | Update type field |
| "添加一个新角色素材" | Add asset | Create new asset with UUID |
| "给第2个镜头生成首帧图片" | Generate picture | Construct prompt, call API |
| "交换第4和第6个镜头" | Swap shots | Swap positions, update indices |

## Important Notes

1. **Always validate** after modifications
2. **Update scene_index** when changing shot order
3. **Preserve generation history** in picture/videos arrays
4. **为新建资产生成唯一 id**（如 `asset_<时间戳>_<随机串>`）
5. **Maintain asset references** when deleting shots
6. **Backup original** before major changes
