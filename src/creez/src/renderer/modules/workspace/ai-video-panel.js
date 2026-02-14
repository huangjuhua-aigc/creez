/**
 * AI 视频生成面板
 * 数据结构见 scene-board-ai-data.md — scene.videos 为 VideoItem[]
 * 参数配置参考 mcp_frontend video-modal.tsx
 */

function pathToFileUrl(path) {
  if (!path) return "";
  const normalized = String(path).replace(/\\/g, "/");
  return normalized.match(/^[a-zA-Z]:/) ? `file:///${normalized}` : `file://${normalized}`;
}

function toFileSrc(url) {
  if (!url) return null;
  if (String(url).startsWith("data:") || String(url).startsWith("http")) return url;
  return pathToFileUrl(url);
}

const DEFAULT_MODEL = "doubao-seedance-pro";
const DEFAULT_ASPECT = "16:9";
const MAX_PROMPT_LENGTH = 800;
const VIDEO_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

// 模型配置：与 video-modal.tsx 对齐
const MODELS_BOTH_FRAMES = [{ value: "doubao-seedance-lite", label: "即梦Lite" }];
const MODELS_ONE_OR_NONE = [
  { value: "doubao-seedance-lite", label: "即梦Lite" },
  { value: "doubao-seedance-pro", label: "即梦Pro" },
  { value: "veo3", label: "VEO3" },
  { value: "veo3-fast", label: "VEO3 fast" },
  { value: "veo3.1-quality", label: "VEO3.1" },
  { value: "veo3.1-fast", label: "VEO3.1 Fast" },
  { value: "sora-2", label: "Sora-2" },
  { value: "sora-2-pro", label: "Sora-2 Pro" },
  { value: "wan2.6", label: "wan2.6" },
];

function getModelsForFrames(hasFirst, hasLast) {
  if (hasFirst && hasLast) return MODELS_BOTH_FRAMES;
  return MODELS_ONE_OR_NONE;
}

function getAspectOptions(model) {
  if (model === "veo3.1-fast" || model === "veo3.1-quality") {
    return [
      { value: "16:9", label: "16:9 (横屏)" },
      { value: "9:16", label: "9:16 (竖屏)" },
    ];
  }
  if (model === "sora-2" || model === "sora-2-pro") {
    return [
      { value: "16:9", label: "16:9 (横屏)" },
      { value: "9:16", label: "9:16 (竖屏)" },
      { value: "1:1", label: "1:1 (方形)" },
    ];
  }
  if (model === "wan2.6") {
    return [
      { value: "16:9", label: "16:9 (横屏)" },
      { value: "9:16", label: "9:16 (竖屏)" },
      { value: "1:1", label: "1:1 (方形)" },
      { value: "4:3", label: "4:3 (传统)" },
      { value: "3:4", label: "3:4 (竖屏传统)" },
    ];
  }
  return [
    { value: "16:9", label: "16:9 (横屏)" },
    { value: "9:16", label: "9:16 (竖屏)" },
    { value: "1:1", label: "1:1 (方形)" },
    { value: "4:3", label: "4:3 (传统)" },
    { value: "3:4", label: "3:4 (竖屏传统)" },
  ];
}

function getDurationOptions(model) {
  if (model === "veo3.1-fast" || model === "veo3.1-quality") return [8];
  if (model === "veo3" || model === "veo3-fast") return [8];
  if (model === "sora-2") return [10, 15];
  if (model === "sora-2-pro") return [15, 25];
  if (model === "wan2.6") return [5, 10, 15];
  if (model === "doubao-seedance-pro") return [4, 5, 6, 7, 8, 9, 10, 11, 12];
  return [5, 10];
}

function supportsGenerateAudio(model) {
  return [
    "veo3",
    "veo3-fast",
    "veo3.1",
    "veo3.1-fast",
    "veo3.1-quality",
    "wan2.6",
    "doubao-seedance-pro",
  ].includes(model);
}

function createField(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "scene-ai-field";
  const label = document.createElement("div");
  label.className = "scene-ai-field-label";
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

/**
 * @param {object} opts
 * @param {object[]} opts.videos - 视频列表（VideoItem[]）
 * @param {string} [opts.selectedVideo] - 当前选中的视频 URL
 * @param {(updates: { videos?: object[], selected_video?: string }) => void} opts.onUpdate - 数据变更时回调
 * @param {object[]} [opts.sceneImages] - 当前镜头的已生成图片，用于首/尾帧选择
 * @param {object[]} [opts.artAssets] - 美术资产列表
 * @param {string} [opts.filePath] - 分镜板文件路径
 * @param {object} [opts.scene] - 当前镜头数据
 */
export function openVideoPanel(opts) {
  const {
    videos: initialVideos = [],
    selectedVideo,
    onUpdate,
    sceneImages = [],
    artAssets = [],
    filePath = "",
    scene = {},
  } = opts;

  let videos = (Array.isArray(initialVideos) ? initialVideos : [])
    .filter((item) => item && typeof item === "object")
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  /** @type {string[]} 关键帧图片 URL 列表，按顺序：frames[0]=首帧，frames[1]=尾帧 */
  let frames = [];
  let promptValue = "";
  let selectedVideoLocal = selectedVideo;

  const overlay = document.createElement("div");
  overlay.className = "scene-ai-panel-overlay";
  const panel = document.createElement("div");
  panel.className = "scene-ai-panel scene-ai-video-panel";

  const header = document.createElement("div");
  header.className = "scene-ai-panel-header";
  header.textContent = "AI 视频生成";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "scene-ai-panel-close";
  closeBtn.textContent = "×";
  closeBtn.title = "关闭";
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "scene-ai-panel-body";

  const left = document.createElement("div");
  left.className = "scene-ai-panel-left";
  const right = document.createElement("div");
  right.className = "scene-ai-panel-right";

  const frameFileInput = document.createElement("input");
  frameFileInput.type = "file";
  frameFileInput.accept = "image/jpeg,image/png";
  frameFileInput.style.display = "none";

  // 关键帧（样式同 AI 图片参考图）
  const keyFrameField = document.createElement("div");
  keyFrameField.className = "scene-ai-field";
  const keyFrameLabel = document.createElement("div");
  keyFrameLabel.className = "scene-ai-field-label";
  keyFrameLabel.textContent = "关键帧";
  keyFrameField.appendChild(keyFrameLabel);
  const keyFrameBox = document.createElement("div");
  keyFrameBox.className = "scene-ai-ref-dashed scene-ai-keyframe-box";
  const keyFrameContent = document.createElement("div");
  keyFrameContent.className = "scene-ai-ref-content scene-ai-keyframe-content";
  keyFrameBox.appendChild(keyFrameContent);
  keyFrameBox.appendChild(frameFileInput);
  keyFrameField.appendChild(keyFrameBox);
  left.appendChild(keyFrameField);

  // 视频创意
  const descField = document.createElement("div");
  descField.className = "scene-ai-field scene-ai-video-prompt-row";
  const descHeader = document.createElement("div");
  descHeader.className = "scene-ai-field-row";
  const descLabel = document.createElement("div");
  descLabel.className = "scene-ai-field-label";
  descLabel.textContent = "视频创意";
  const aiGenBtn = document.createElement("button");
  aiGenBtn.type = "button";
  aiGenBtn.className = "scene-ai-gen-prompt-btn";
  aiGenBtn.textContent = "AI生成";
  aiGenBtn.title = "视频 AI 生成描述即将支持";
  aiGenBtn.disabled = true;
  descHeader.appendChild(descLabel);
  descHeader.appendChild(aiGenBtn);
  descField.appendChild(descHeader);
  const promptWrap = document.createElement("div");
  promptWrap.className = "scene-ai-prompt-wrap";
  const promptInput = document.createElement("textarea");
  promptInput.className = "scene-ai-input scene-ai-prompt-input";
  promptInput.rows = 4;
  promptInput.placeholder = "请输入视频创意…";
  promptInput.maxLength = MAX_PROMPT_LENGTH;
  const promptCount = document.createElement("div");
  promptCount.className = "scene-ai-prompt-count";
  promptWrap.appendChild(promptInput);
  promptWrap.appendChild(promptCount);
  descField.appendChild(promptWrap);
  left.appendChild(descField);

  const modelField = createField("模型", (() => {
    const sel = document.createElement("select");
    sel.className = "scene-ai-select";
    return sel;
  })());
  modelField.classList.add("scene-ai-video-params-row");
  left.appendChild(modelField);

  const aspectField = createField("尺寸", (() => {
    const sel = document.createElement("select");
    sel.className = "scene-ai-select";
    return sel;
  })());
  aspectField.classList.add("scene-ai-video-params-row");
  left.appendChild(aspectField);

  const durationField = createField("时长（秒）", (() => {
    const sel = document.createElement("select");
    sel.className = "scene-ai-select";
    return sel;
  })());
  durationField.classList.add("scene-ai-video-params-row");
  left.appendChild(durationField);

  const modelSelect = left.querySelectorAll(".scene-ai-select")[0];
  const aspectSelect = left.querySelectorAll(".scene-ai-select")[1];
  const durationSelect = left.querySelectorAll(".scene-ai-select")[2];

  const audioField = document.createElement("div");
  audioField.className = "scene-ai-field scene-ai-audio-field";
  const audioLabel = document.createElement("label");
  audioLabel.className = "scene-ai-checkbox-label";
  const audioCheck = document.createElement("input");
  audioCheck.type = "checkbox";
  audioCheck.className = "scene-ai-checkbox";
  audioCheck.id = "scene-video-generate-audio";
  audioLabel.appendChild(audioCheck);
  const audioSpan = document.createElement("span");
  audioSpan.textContent = " 生成音频";
  audioLabel.appendChild(audioSpan);
  audioField.appendChild(audioLabel);
  left.appendChild(audioField);

  const genBtn = document.createElement("button");
  genBtn.type = "button";
  genBtn.className = "scene-ai-generate-btn primary";
  genBtn.textContent = "生成";
  left.appendChild(genBtn);

  const rightTitle = document.createElement("div");
  rightTitle.className = "scene-ai-panel-right-title";
  rightTitle.textContent = "生成记录";
  right.appendChild(rightTitle);
  const listEl = document.createElement("div");
  listEl.className = "scene-ai-list";
  right.appendChild(listEl);

  function renderKeyFrameContent() {
    keyFrameContent.innerHTML = "";
    const row = document.createElement("div");
    row.className = "scene-ai-keyframe-row";

    function makeSlot(index, label) {
      const imgValue = frames[index] || "";
      const slot = document.createElement("div");
      slot.className = "scene-ai-keyframe-slot";
      const slotLabel = document.createElement("div");
      slotLabel.className = "scene-ai-keyframe-slot-label";
      slotLabel.textContent = label;
      slot.appendChild(slotLabel);
      const box = document.createElement("div");
      box.className = "scene-ai-ref-dashed scene-ai-keyframe-slot-box";
      if (!imgValue) {
        box.onclick = () => {
          openFrameImagePicker(index);
        };
        box.style.cursor = "pointer";
        const inner = document.createElement("div");
        inner.className = "scene-ai-ref-empty";
        inner.innerHTML = `
          <div class="scene-ai-ref-empty-main">点击选择</div>
          <div class="scene-ai-ref-empty-hint">jpg、png</div>
          <div class="scene-ai-ref-link" data-action="pick">从已生成图片选择</div>
        `;
        box.appendChild(inner);
        inner.querySelector("[data-action=pick]")?.addEventListener("click", (e) => {
          e.stopPropagation();
          openFrameImagePicker(index);
        });
      } else {
        box.onclick = null;
        box.style.cursor = "";
        const wrap = document.createElement("div");
        wrap.className = "scene-ai-ref-thumb scene-ai-keyframe-thumb";
        const img = document.createElement("img");
        img.src = imgValue.startsWith("data:") || imgValue.startsWith("http") ? imgValue : toFileSrc(imgValue) || imgValue;
        img.alt = label;
        wrap.appendChild(img);
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "scene-ai-ref-remove";
        rm.textContent = "×";
        rm.onclick = (e) => {
          e.stopPropagation();
          frames = frames.filter((_, i) => i !== index);
          renderKeyFrameContent();
          updateModelAndParams();
        };
        wrap.appendChild(rm);
        box.appendChild(wrap);
      }
      slot.appendChild(box);
      return slot;
    }

    row.appendChild(makeSlot(0, "首帧"));
    row.appendChild(makeSlot(1, "尾帧"));
    keyFrameContent.appendChild(row);

    const actions = document.createElement("div");
    actions.className = "scene-ai-ref-actions";
    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "scene-ai-ref-btn";
    uploadBtn.textContent = "上传关键帧";
    uploadBtn.onclick = () => frameFileInput.click();
    actions.appendChild(uploadBtn);
    keyFrameContent.appendChild(actions);
  }

  function openFrameImagePicker(slotIndex) {
    const sources = [...effectiveSceneImages];
    if (artAssets && artAssets.length) {
      artAssets.forEach((a) => {
        const url = a.image_urls?.[0] || a.image_url;
        if (url) sources.push({ image_urls: [url], url, name: a.name });
      });
    }
    const urls = [];
    sources.forEach((item) => {
      const u = item.image_urls?.[0] || item.url;
      if (u && !urls.some((x) => x === u)) urls.push(u);
    });
    if (urls.length === 0) {
      alert("暂无可选图片，请先生成关键帧图片");
      return;
    }
    const picker = document.createElement("div");
    picker.className = "scene-ai-panel-overlay";
    const card = document.createElement("div");
    card.className = "scene-ai-asset-picker";
    const title = document.createElement("div");
    title.className = "scene-ai-panel-header";
    title.textContent = slotIndex === 0 ? "选择首帧图片" : "选择尾帧图片";
    const closeP = document.createElement("button");
    closeP.type = "button";
    closeP.className = "scene-ai-panel-close";
    closeP.textContent = "×";
    closeP.onclick = () => document.body.removeChild(picker);
    title.appendChild(closeP);
    const grid = document.createElement("div");
    grid.className = "scene-asset-picker-grid";
    urls.forEach((url) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scene-asset-picker-item";
      const img = document.createElement("img");
      img.src = toFileSrc(url) || url;
      img.alt = "";
      btn.appendChild(img);
      btn.onclick = () => {
        const next = [...frames];
        while (next.length <= slotIndex) next.push("");
        next[slotIndex] = url;
        frames = next;
        document.body.removeChild(picker);
        renderKeyFrameContent();
        updateModelAndParams();
      };
      grid.appendChild(btn);
    });
    card.appendChild(title);
    card.appendChild(grid);
    picker.appendChild(card);
    picker.onclick = (ev) => {
      if (ev.target === picker) document.body.removeChild(picker);
    };
    document.body.appendChild(picker);
  }

  frameFileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    frameFileInput.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("图片大小不超过 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      if (frames.length < 2) {
        frames = [...frames, url];
      } else {
        frames = [frames[0], url];
      }
      renderKeyFrameContent();
      updateModelAndParams();
    };
    reader.readAsDataURL(file);
  });

  function updateModelAndParams() {
    const hasFirst = !!frames[0];
    const hasLast = !!frames[1];
    const models = getModelsForFrames(hasFirst, hasLast);
    const cur = modelSelect.value;
    modelSelect.innerHTML = models.map((m) => `<option value="${m.value}">${m.label}</option>`).join("");
    if (models.some((m) => m.value === cur)) {
      modelSelect.value = cur;
    } else {
      modelSelect.value = models[0].value;
    }
    updateAspectOptions();
    updateDurationOptions();
    updateAudioVisibility();
  }

  function updateAspectOptions() {
    const opts = getAspectOptions(modelSelect.value);
    const cur = aspectSelect.value;
    aspectSelect.innerHTML = opts.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
    aspectSelect.value = opts.some((o) => o.value === cur) ? cur : opts[0].value;
  }

  function updateDurationOptions() {
    const opts = getDurationOptions(modelSelect.value);
    const cur = Number(durationSelect.value);
    durationSelect.innerHTML = opts.map((d) => `<option value="${d}">${d}秒</option>`).join("");
    durationSelect.value = opts.includes(cur) ? String(cur) : String(opts[0]);
  }

  function updateAudioVisibility() {
    const show = supportsGenerateAudio(modelSelect.value);
    audioField.style.display = show ? "" : "none";
    if (!show) audioCheck.checked = false;
  }

  function updatePromptCount() {
    promptCount.textContent = `${promptInput.value.length}/${MAX_PROMPT_LENGTH}`;
  }

  promptInput.addEventListener("input", () => {
    promptValue = promptInput.value;
    updatePromptCount();
  });

  modelSelect.addEventListener("change", () => {
    updateAspectOptions();
    updateDurationOptions();
    updateAudioVisibility();
  });

  function renderList() {
    listEl.innerHTML = "";
    if (!videos.length) {
      const empty = document.createElement("div");
      empty.className = "scene-ai-list-empty";
      empty.textContent = "暂无生成记录";
      listEl.appendChild(empty);
      return;
    }
    videos.forEach((item, idx) => {
      const url =
        item.video_url ||
        (Array.isArray(item.video_urls) && item.video_urls[0]) ||
        item.url ||
        "";
      const card = document.createElement("div");
      card.className = "scene-ai-card" + (url && url === selectedVideoLocal ? " scene-ai-card-selected" : "");
      const thumbWrap = document.createElement("div");
      thumbWrap.className = "scene-ai-card-thumb scene-ai-video-thumb";
      if (url) {
        const video = document.createElement("video");
        video.src = toFileSrc(url) || url;
        video.muted = true;
        video.preload = "metadata";
        video.playsInline = true;
        thumbWrap.appendChild(video);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "scene-ai-card-placeholder";
        placeholder.textContent =
          item.status === "isloading" || item.status === "waiting_backend"
            ? "生成中…"
            : item.status === "failed" || item.status === "overtime"
              ? "失败"
              : "—";
        thumbWrap.appendChild(placeholder);
      }
      const meta = document.createElement("div");
      meta.className = "scene-ai-card-meta";
      const promptText = (item.parameters && item.parameters.prompt) || "";
      meta.textContent = promptText ? promptText.slice(0, 60) + (promptText.length > 60 ? "…" : "") : "无描述";
      const actions = document.createElement("div");
      actions.className = "scene-ai-card-actions";
      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "scene-ai-card-btn";
      selectBtn.textContent = "选用";
      selectBtn.disabled = !url;
      selectBtn.onclick = (e) => {
        e.stopPropagation();
        selectedVideoLocal = url;
        onUpdate?.({ selected_video: url });
        renderList();
      };
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "scene-ai-card-btn";
      delBtn.textContent = "删除";
      delBtn.onclick = () => {
        videos = videos.filter((_, i) => i !== idx);
        onUpdate?.({ videos });
        renderList();
      };
      actions.appendChild(selectBtn);
      actions.appendChild(delBtn);
      card.appendChild(thumbWrap);
      card.appendChild(meta);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  function loadParamsFromFirst() {
    const first = videos[0];
    if (first?.parameters) {
      const p = first.parameters;
      if (p.prompt) promptInput.value = p.prompt;
      promptValue = promptInput.value;
      if (p.model && modelSelect.querySelector(`option[value="${p.model}"]`)) modelSelect.value = p.model;
      const ar = p.extended_params?.aspect_ratio ?? p.aspect_ratio;
      if (ar && aspectSelect.querySelector(`option[value="${ar}"]`)) aspectSelect.value = ar;
      const d = p.extended_params?.duration ?? p.duration;
      if (typeof d === "number" && durationSelect.querySelector(`option[value="${d}"]`))
        durationSelect.value = String(d);
      const ga = p.extended_params?.generate_audio ?? p.generate_audio;
      if (typeof ga === "boolean") audioCheck.checked = ga;
      if (Array.isArray(p.frames) && p.frames.length > 0) {
        frames = p.frames.map((f) => {
          if (typeof f === "string") return f;
          if (f?.type === "base64" && f?.data) return f.data;
          if (f?.url) return f.url;
          return "";
        }).filter(Boolean);
      } else {
        const ff = p.first_frame_image;
        const lf = p.last_frame_image;
        if (typeof ff === "string" || typeof lf === "string") {
          frames = [ff || "", lf || ""].filter(Boolean);
        }
      }
    }
    updatePromptCount();
    updateModelAndParams();
  }

  let pollTimer = null;

  /** 存到 .scene_board 的格式：只存本地路径或 http URL，不存 base64 */
  function buildFramesForStorage() {
    const list = frames.filter((u) => u && !u.startsWith("data:"));
    return list.length ? list : undefined;
  }

  /** 仅发请求时把本地路径转成 base64 */
  async function buildFramesForRequest(workDir) {
    const list = frames.filter(Boolean);
    if (!list.length) return [];
    const out = [];
    for (const u of list) {
      if (u.startsWith("data:")) {
        out.push({ type: "base64", data: u });
        continue;
      }
      if (u.startsWith("http://") || u.startsWith("https://")) {
        out.push({ url: u });
        continue;
      }
      const res = await window.creez?.readFileAsDataUrl?.(u, workDir);
      if (res?.ok && res.dataUrl) out.push({ type: "base64", data: res.dataUrl });
      else out.push({ url: u });
    }
    return out;
  }

  async function doGenerate() {
    const config = await (window.creez?.getConfig?.() || Promise.resolve(null));
    const workDir = config?.workDir || "";
    const promptText = promptInput.value.trim();
    if (!promptText) {
      alert("请填写视频创意");
      promptInput.focus();
      return;
    }
    const model = modelSelect.value;
    const hasFirst = !!frames[0];
    const hasLast = !!frames[1];
    if (hasFirst && hasLast && model !== "doubao-seedance-lite") {
      alert("同时有首尾帧时只支持即梦Lite");
      return;
    }
    const framesForRequest = await buildFramesForRequest(workDir);
    const params = {
      prompt: promptText,
      model,
      aspect_ratio: aspectSelect.value,
      duration: Number(durationSelect.value),
      frames: buildFramesForStorage(),
      generate_audio: supportsGenerateAudio(model) ? audioCheck.checked : undefined,
    };
    const body = {
      panel_id: filePath || "creez",
      chat_id: filePath || "creez",
      ...params,
      frames: framesForRequest,
      created_at: Date.now(),
    };
    // user_id 来自主进程 creez:getUserId → IMAGE_GEN_USER_ID（环境变量 CREEZ_USER_ID 或默认 UUID）
    const user_id = await window.creez?.getCreezUserId?.();
    const res = await window.creez?.videoGenCreate?.({ body, user_id });
    if (!res?.ok) {
      alert(res?.error || "创建任务失败");
      return;
    }
    const taskId = res.task_id;
    const placeholder = {
      video_url: "",
      video_urls: [],
      status: "isloading",
      parameters: params,
      taskId,
      created_at: body.created_at,
    };
    videos = [placeholder, ...videos];
    onUpdate?.({ videos });
    renderList();

    const poll = async () => {
      const loadingIds = videos.filter((v) => v.status === "isloading" && v.taskId).map((v) => v.taskId);
      if (loadingIds.length === 0) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      const pollRes = await window.creez?.videoGenPoll?.({ task_ids: loadingIds, user_id });
      if (!pollRes?.ok) return;
      const data = pollRes.data || {};
      let anyDone = false;
      const now = Date.now();
      for (const v of videos) {
        if (v.status !== "isloading" || !v.taskId) continue;
        const taskId = v.taskId;
        const r = data[taskId];
        if (!r) continue;
        const done = r.status === "completed" || r.status === "failed" || r.status === "overtime";
        if (!done) continue;
        anyDone = true;
        const elapsedMs = v.created_at ? now - v.created_at : 0;
        if (elapsedMs > VIDEO_TIMEOUT_MS) {
          videos = videos.map((i) => (i.taskId === taskId ? { ...i, status: "failed", errorMessage: "任务超时" } : i));
          onUpdate?.({ videos });
          renderList();
          continue;
        }
        const urls = Array.isArray(r.video_urls) && r.video_urls.length > 0
          ? r.video_urls
          : r.video_url
            ? [r.video_url]
            : [];
        videos = videos.map((i) =>
          i.taskId === taskId
            ? {
                ...i,
                status: r.status === "completed" ? "completed" : "failed",
                video_urls: urls,
                video_url: urls[0] || "",
                errorMessage: r.status !== "completed" ? r.message || "失败" : undefined,
              }
            : i
        );
      }
      if (anyDone) {
        onUpdate?.({ videos });
        renderList();
      }
    };
    if (!pollTimer) pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    poll();
  }

  genBtn.addEventListener("click", doGenerate);

  closeBtn.addEventListener("click", () => {
    if (pollTimer) clearInterval(pollTimer);
    document.body.removeChild(overlay);
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      if (pollTimer) clearInterval(pollTimer);
      document.body.removeChild(overlay);
    }
  });

  // 收集当前镜头的已生成图片（用于首/尾帧选择）
  const collectedSceneImages = [];
  if (scene?.picture?.frames) {
    const frames = scene.picture.frames;
    frames.forEach((f) => {
      const urls = Array.isArray(f.image_urls) ? f.image_urls : [];
      urls.forEach((u) => {
        if (u && f.status === "completed") collectedSceneImages.push({ image_urls: [u], url: u });
      });
    });
  }
  if (scene?.selected_image) {
    const u = scene.selected_image;
    if (u && !collectedSceneImages.some((x) => x.url === u))
      collectedSceneImages.push({ image_urls: [u], url: u });
  }

  const effectiveSceneImages = sceneImages.length ? sceneImages : collectedSceneImages;

  (() => {
    updateModelAndParams();
    loadParamsFromFirst();
    renderList();
    renderKeyFrameContent();
  })();

  body.appendChild(left);
  body.appendChild(right);
  panel.appendChild(header);
  panel.appendChild(body);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}
