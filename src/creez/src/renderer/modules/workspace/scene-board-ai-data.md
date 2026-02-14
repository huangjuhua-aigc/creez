# 分镜板 AI 图片 / 视频 数据结构（供 Review）

与 mcp_frontend 的 image-modal / video-modal 对齐，便于后续接入真实生成 API。

---

## 1. 画面（关键帧）与 AI 图片

### 1.1 存储位置

- **`scene.picture`**：`{ frames: FrameImage[][] }`
- **`picture.frames`**：数组的数组。`frames[i]` 表示第 i 个「关键帧」槽位，每个槽位内是多张 AI 生成图（按时间序）。
- **`scene.selected_image`**（可选）：当前选为展示的图片 URL，用于预览/导出。

### 1.2 单条图片记录 `FrameImageItem`

```ts
interface FrameImageItem {
  /** 生成结果图片 URL 列表（多图模型如 MJ 可能多张） */
  image_urls: string[];
  /** 任务状态 */
  status: "completed" | "isloading" | "failed" | "overtime" | "waiting_backend" | "placeholder";
  /** 生成时使用的参数，用于回显与重新生成 */
  parameters?: {
    prompt: string;
    model: string;
    aspect_ratio: string;
    reference_image_list?: Array<{ url: string; file_id?: string; name?: string }>;
  };
  /** 异步任务 ID，轮询/回调用 */
  taskId?: string;
  created_at?: number;
  /** 失败时的错误信息 */
  errorMessage?: string;
}
```

### 1.3 关键帧槽位

- **`picture.frames[frameIndex]`**：`FrameImageItem[]`，按 `created_at` 倒序展示（最新在前）。
- 新增关键帧时：向 `picture.frames` push 空数组 `[]`，然后打开「AI 图片」面板，编辑该 `frameIndex`。

---

## 2. 视频与 AI 视频

### 2.1 存储位置

- **`scene.videos`**：`VideoItem[]`，当前镜头下所有 AI 视频生成记录（按时间序）。
- **`scene.selected_video`**（可选）：当前选为展示的视频 URL。
- **`scene.video_note`**（可选）：纯文本备注，与 `videos` 并列。

### 2.2 单条视频记录 `VideoItem`

```ts
interface VideoItem {
  /** 单 URL 兼容 */
  video_url?: string;
  /** 多 URL（如多清晰度）以第一个为主展示 */
  video_urls?: string[];
  status: "completed" | "isloading" | "failed" | "overtime" | "waiting_backend" | "placeholder";
  parameters?: {
    prompt: string;
    model: string;
    frames?: string[];  /** 关键帧列表，frames[0]=首帧，frames[1]=尾帧 */
    aspect_ratio: string;
    duration: number;
    generate_audio?: boolean;
    extended_params?: Record<string, unknown>;
  };
  taskId?: string;
  created_at?: number;
  errorMessage?: string;
}
```

### 2.3 交互约定

- **无视频时**：视频列显示「+ 添加视频」按钮，点击打开 AI 视频面板。
- **有视频时**：不再显示「添加视频」按钮，点击单元格（或摘要）进入 AI 视频面板。

---

## 3. 与参考实现的对应关系

| 参考 (mcp_frontend)     | Creez 分镜板                         |
|-------------------------|--------------------------------------|
| `picture.first_frame`   | 未使用；仅用 `picture.frames`       |
| `picture.frames[i]`     | `picture.frames[i]` 同义             |
| `scene.videos`          | `scene.videos` 同义                  |
| `scene.selected_image`  | `scene.selected_image` 同义          |
| `scene.selected_video`  | `scene.selected_video` 同义          |

---

## 4. Review 检查项

- [ ] `FrameImageItem` 是否需增加字段（如 `description` 与当前 `status: "draft"` 的兼容）。
- [ ] `reference_image_list` 是否限制最多 5 张与参考一致。
- [ ] 视频 `parameters.duration` 单位是否统一为秒。
- [ ] 生成中占位：图片用 `status: "isloading"` + `taskId`，视频同理，轮询/WebSocket 由后续接入实现。
