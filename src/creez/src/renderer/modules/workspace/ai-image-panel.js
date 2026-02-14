/**
 * AI 图片生成面板（关键帧）
 * 数据结构见 scene-board-ai-data.md — picture.frames[frameIndex] 为 FrameImageItem[]
 */

function pathToFileUrl(path) {
  if (!path) return "";
  const normalized = String(path).replace(/\\/g, "/");
  return normalized.match(/^[a-zA-Z]:/) ? `file:///${normalized}` : `file://${normalized}`;
}

function toFileSrc(url) {
  if (!url) return null;
  if (String(url).startsWith("data:") || String(url).startsWith("http") || String(url).startsWith("file:")) return url;
  return pathToFileUrl(url);
}

const DEFAULT_MODEL = "doubao-seedream-4-0";
const DEFAULT_ASPECT = "9:16";
const MAX_REF_IMAGES = 5;
const MAX_PROMPT_LENGTH = 800;
const IMAGE_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

const MODELS_0_1_REF = [
  { value: "doubao-seedream-4-0", label: "即梦4.0" },
  { value: "doubao-seedream-4-5", label: "即梦4.5" },
  { value: "gemini-2.5-flash-image", label: "Nano Banana" },
  { value: "gemini-3-pro", label: "Nano Banana Pro" },
  { value: "gpt4o-image", label: "GPT-4o Image" },
];
const MODELS_2_3_REF = MODELS_0_1_REF;
const MODELS_4_5_REF = [
  { value: "doubao-seedream-4-0", label: "即梦4.0" },
  { value: "doubao-seedream-4-5", label: "即梦4.5" },
  { value: "gemini-3-pro", label: "Nano Banana Pro" },
  { value: "gpt4o-image", label: "GPT-4o Image" },
];
const GPT4O_ASPECTS = ["1:1", "16:9", "9:16"];
const ALL_ASPECTS = ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9", "9:21"];

function getModelsForRefCount(n) {
  if (n >= 4) return MODELS_4_5_REF;
  if (n >= 2) return MODELS_2_3_REF;
  return MODELS_0_1_REF;
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
 * @param {object[]} opts.images - 关键帧的图片列表（FrameImageItem[]）
 * @param {string} [opts.selectedImage] - 当前选中的图片 URL
 * @param {(updates: { images?: object[], selected_image?: string }) => void} opts.onUpdate - 数据变更时回调
 * @param {object[]} [opts.artAssets] - 美术资产列表
 * @param {string} [opts.filePath] - 分镜板文件路径
 * @param {object} [opts.scene] - 当前镜头数据，用于 AI 生成 prompt
 */
export function openImagePanel(opts) {
  const { images: initialImages = [], selectedImage, onUpdate, artAssets = [], filePath = "", scene = {} } = opts;
  let images = (Array.isArray(initialImages) ? initialImages : [])
    .filter((item) => item && typeof item === "object")
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  let referenceImageList = [];
  let workDir = "";
  let promptValue = "";
  let mentionDropdown = null;
  let mentionState = { show: false, query: "", selectedIndex: 0, lastAtPos: -1 };
  let selectedImageLocal = selectedImage;

  const overlay = document.createElement("div");
  overlay.className = "scene-ai-panel-overlay";
  const panel = document.createElement("div");
  panel.className = "scene-ai-panel scene-ai-image-panel";

  const header = document.createElement("div");
  header.className = "scene-ai-panel-header";
  header.textContent = "AI 关键帧图片";
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

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/jpeg,image/png";
  fileInput.style.display = "none";

  const refField = document.createElement("div");
  refField.className = "scene-ai-field";
  const refLabel = document.createElement("div");
  refLabel.className = "scene-ai-field-label";
  refLabel.textContent = "参考图";
  refField.appendChild(refLabel);
  const refBox = document.createElement("div");
  refBox.className = "scene-ai-ref-dashed";
  const refContent = document.createElement("div");
  refContent.className = "scene-ai-ref-content";
  refBox.appendChild(refContent);
  refBox.appendChild(fileInput);
  refField.appendChild(refBox);
  left.appendChild(refField);

  const descField = document.createElement("div");
  descField.className = "scene-ai-field";
  const descHeader = document.createElement("div");
  descHeader.className = "scene-ai-field-row";
  const descLabel = document.createElement("div");
  descLabel.className = "scene-ai-field-label";
  descLabel.textContent = "创意描述";
  const aiGenBtn = document.createElement("button");
  aiGenBtn.type = "button";
  aiGenBtn.className = "scene-ai-gen-prompt-btn";
  aiGenBtn.textContent = "AI生成";
  descHeader.appendChild(descLabel);
  descHeader.appendChild(aiGenBtn);
  descField.appendChild(descHeader);
  const promptWrap = document.createElement("div");
  promptWrap.className = "scene-ai-prompt-wrap";
  const promptInput = document.createElement("textarea");
  promptInput.className = "scene-ai-input scene-ai-prompt-input";
  promptInput.rows = 4;
  promptInput.placeholder = "请输入创作提示词…（输入@可提及美术资产）";
  promptInput.maxLength = MAX_PROMPT_LENGTH;
  const promptCount = document.createElement("div");
  promptCount.className = "scene-ai-prompt-count";
  promptWrap.appendChild(promptInput);
  promptWrap.appendChild(promptCount);
  descField.appendChild(promptWrap);
  left.appendChild(descField);

  left.appendChild(createField("模型", (() => {
    const sel = document.createElement("select");
    sel.className = "scene-ai-select";
    return sel;
  })()));
  const modelSelect = left.querySelector(".scene-ai-select");

  left.appendChild(createField("比例", (() => {
    const sel = document.createElement("select");
    sel.className = "scene-ai-select";
    return sel;
  })()));
  const aspectSelect = left.querySelectorAll(".scene-ai-select")[1];

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

  function renderRefContent() {
    refContent.innerHTML = "";
    if (referenceImageList.length === 0) {
      refBox.onclick = () => fileInput.click();
      refBox.style.cursor = "pointer";
      const inner = document.createElement("div");
      inner.className = "scene-ai-ref-empty";
      inner.innerHTML = `
        <div class="scene-ai-ref-empty-main">点击上传参考图片</div>
        <div class="scene-ai-ref-empty-hint">支持 jpg、png 格式</div>
        <div class="scene-ai-ref-empty-hint">大小不超过 10MB</div>
        <div class="scene-ai-ref-link" data-action="from-assets">从美术资产中选择</div>
      `;
      refContent.appendChild(inner);
      inner.querySelector("[data-action=from-assets]").onclick = (e) => {
        e.stopPropagation();
        openAssetPicker();
      };
    } else {
      refBox.onclick = null;
      refBox.style.cursor = "";
      const thumbs = document.createElement("div");
      thumbs.className = "scene-ai-ref-thumbs";
      referenceImageList.forEach((item, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "scene-ai-ref-thumb";
        const img = document.createElement("img");
        const u = item.url || "";
        img.src = u.startsWith("data:") || u.startsWith("http") || u.startsWith("file:") ? u : (workDir ? toFileSrc(workDir.replace(/\\/g, "/") + "/" + u.replace(/^[/\\]+/, "")) : null) || u || "";
        img.alt = "";
        wrap.appendChild(img);
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "scene-ai-ref-remove";
        rm.textContent = "×";
        rm.onclick = (e) => {
          e.stopPropagation();
          referenceImageList = referenceImageList.filter((_, i) => i !== idx);
          renderRefContent();
          updateModelOptions();
        };
        wrap.appendChild(rm);
        thumbs.appendChild(wrap);
      });
      const actions = document.createElement("div");
      actions.className = "scene-ai-ref-actions";
      const uploadBtn = document.createElement("button");
      uploadBtn.type = "button";
      uploadBtn.className = "scene-ai-ref-btn";
      uploadBtn.textContent = "本地上传";
      uploadBtn.onclick = () => fileInput.click();
      const assetBtn = document.createElement("button");
      assetBtn.type = "button";
      assetBtn.className = "scene-ai-ref-btn";
      assetBtn.textContent = "从美术资产";
      assetBtn.onclick = openAssetPicker;
      actions.appendChild(uploadBtn);
      actions.appendChild(assetBtn);
      refContent.appendChild(thumbs);
      refContent.appendChild(actions);
    }
  }

  function openAssetPicker() {
    const picker = document.createElement("div");
    picker.className = "scene-ai-panel-overlay";
    const card = document.createElement("div");
    card.className = "scene-ai-asset-picker";
    const title = document.createElement("div");
    title.className = "scene-ai-panel-header";
    title.textContent = "选择美术资产";
    const closeP = document.createElement("button");
    closeP.type = "button";
    closeP.className = "scene-ai-panel-close";
    closeP.textContent = "×";
    closeP.onclick = () => document.body.removeChild(picker);
    title.appendChild(closeP);
    const grid = document.createElement("div");
    grid.className = "scene-asset-picker-grid";
    artAssets.forEach((asset) => {
      const url = asset.image_urls?.[0];
      const name = asset.name || asset.visual_state || "资产";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scene-asset-picker-item";
      if (url) {
        const img = document.createElement("img");
        img.src = toFileSrc(url) || url;
        img.alt = name;
        btn.appendChild(img);
      }
      const label = document.createElement("span");
      label.textContent = name;
      btn.appendChild(label);
      btn.onclick = async () => {
        if (url?.startsWith("data:") || url?.startsWith("http") || url?.startsWith("file:")) {
          addReferenceImage(url, asset.id || asset.file_id, name);
        } else {
          const cfg = await (window.creez?.getConfig?.() || Promise.resolve(null));
          const wd = cfg?.workDir || "";
          const pathToUse = url || asset.file_id;
          const res = pathToUse ? await window.creez?.readFileAsDataUrl?.(pathToUse, wd) : null;
          if (res?.ok && res.dataUrl) addReferenceImage(res.dataUrl, asset.id || asset.file_id, name);
          else addReferenceImage(toFileSrc(url) || url, asset.id || asset.file_id, name);
        }
        document.body.removeChild(picker);
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

  function addReferenceImage(url, file_id, name) {
    if (referenceImageList.length >= MAX_REF_IMAGES) {
      alert("最多 5 张参考图");
      return;
    }
    if (referenceImageList.some((r) => r.url === url)) return;
    referenceImageList.push({ url, file_id, name });
    renderRefContent();
    updateModelOptions();
  }

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    fileInput.value = "";
    if (!file || !file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("图片大小不超过 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => addReferenceImage(reader.result, undefined, file.name);
    reader.readAsDataURL(file);
  });

  function updateModelOptions() {
    const models = getModelsForRefCount(referenceImageList.length);
    const cur = modelSelect.value;
    modelSelect.innerHTML = models.map((m) => `<option value="${m.value}">${m.label}</option>`).join("");
    if (models.some((m) => m.value === cur)) modelSelect.value = cur;
    else {
      modelSelect.value = models[0].value;
      updateAspectOptions();
    }
    updateAspectOptions();
  }

  function updateAspectOptions() {
    const isGpt4o = modelSelect.value === "gpt4o-image";
    const opts = isGpt4o ? GPT4O_ASPECTS : ALL_ASPECTS;
    const cur = aspectSelect.value;
    aspectSelect.innerHTML = opts.map((r) => `<option value="${r}">${r}</option>`).join("");
    aspectSelect.value = opts.includes(cur) ? cur : isGpt4o ? "1:1" : opts[0];
  }

  function updatePromptCount() {
    promptCount.textContent = `${promptInput.value.length}/${MAX_PROMPT_LENGTH}`;
  }

  function checkMention() {
    const val = promptInput.value;
    const pos = promptInput.selectionStart || 0;
    const before = val.substring(0, pos);
    const lastAt = before.lastIndexOf("@");
    if (lastAt === -1) {
      hideMention();
      return;
    }
    const after = before.substring(lastAt + 1);
    if (after.includes(" ") || after.includes("\n")) {
      hideMention();
      return;
    }
    const query = after.toLowerCase();
    const filtered = artAssets.filter(
      (a) => (a.name || "").toLowerCase().includes(query) || (a.visual_state || "").toLowerCase().includes(query)
    );
    if (filtered.length === 0) {
      hideMention();
      return;
    }
    mentionState = { show: true, query, selectedIndex: 0, lastAtPos: lastAt, filtered };
    showMention(filtered);
  }

  function showMention(assets) {
    if (mentionDropdown && mentionDropdown.parentNode) mentionDropdown.remove();
    mentionDropdown = document.createElement("div");
    mentionDropdown.className = "scene-ai-mention-dropdown";
    const rect = promptInput.getBoundingClientRect();
    mentionDropdown.style.top = rect.bottom + 4 + "px";
    mentionDropdown.style.left = rect.left + "px";
    mentionDropdown.style.minWidth = Math.max(rect.width, 200) + "px";
    assets.forEach((asset, i) => {
      const row = document.createElement("div");
      row.className = "scene-ai-mention-item" + (i === mentionState.selectedIndex ? " selected" : "");
      row.textContent = "@" + (asset.name || asset.visual_state || "资产");
      row.onclick = () => selectMention(asset);
      row.onmouseenter = () => {
        mentionState.selectedIndex = i;
        mentionDropdown.querySelectorAll(".scene-ai-mention-item").forEach((el, j) => el.classList.toggle("selected", j === i));
      };
      mentionDropdown.appendChild(row);
    });
    document.body.appendChild(mentionDropdown);
  }

  function hideMention() {
    mentionState.show = false;
    if (mentionDropdown && mentionDropdown.parentNode) mentionDropdown.remove();
    mentionDropdown = null;
  }

  function selectMention(asset) {
    const val = promptInput.value;
    const pos = promptInput.selectionStart || 0;
    const before = val.substring(0, mentionState.lastAtPos);
    const after = val.substring(pos);
    const name = asset.name || asset.visual_state || "资产";
    const newVal = before + "@" + name + after;
    promptInput.value = newVal;
    promptValue = newVal;
    updatePromptCount();
    promptInput.setSelectionRange(before.length + name.length + 1, before.length + name.length + 1);
    promptInput.focus();
    hideMention();
    const url = asset.image_urls?.[0];
    if (url) {
      if (url.startsWith("data:") || url.startsWith("http") || url.startsWith("file:")) {
        addReferenceImage(url, asset.id || asset.file_id, name);
      } else {
        (async () => {
          const cfg = await (window.creez?.getConfig?.() || Promise.resolve(null));
          const wd = cfg?.workDir || "";
          const pathToUse = url || asset.file_id;
          const res = pathToUse ? await window.creez?.readFileAsDataUrl?.(pathToUse, wd) : null;
          if (res?.ok && res.dataUrl) addReferenceImage(res.dataUrl, asset.id || asset.file_id, name);
          else addReferenceImage(toFileSrc(url) || url, asset.id || asset.file_id, name);
        })();
      }
    }
  }

  promptInput.addEventListener("input", () => {
    promptValue = promptInput.value;
    updatePromptCount();
    checkMention();
  });
  promptInput.addEventListener("keydown", (e) => {
    if (mentionState.show && mentionDropdown) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mentionState.selectedIndex = Math.min(mentionState.selectedIndex + 1, mentionState.filtered.length - 1);
        mentionDropdown.querySelectorAll(".scene-ai-mention-item").forEach((el, j) => el.classList.toggle("selected", j === mentionState.selectedIndex));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        mentionState.selectedIndex = Math.max(mentionState.selectedIndex - 1, 0);
        mentionDropdown.querySelectorAll(".scene-ai-mention-item").forEach((el, j) => el.classList.toggle("selected", j === mentionState.selectedIndex));
      } else if (e.key === "Enter" && mentionState.filtered?.length) {
        e.preventDefault();
        selectMention(mentionState.filtered[mentionState.selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideMention();
      }
    }
  });
  promptInput.addEventListener("blur", () => setTimeout(hideMention, 150));

  let isGeneratingPrompt = false;
  aiGenBtn.addEventListener("click", async () => {
    if (isGeneratingPrompt) return;
    isGeneratingPrompt = true;
    aiGenBtn.disabled = true;
    aiGenBtn.textContent = "生成中…";
    try {
      // user_id 来自主进程 creez:getUserId → IMAGE_GEN_USER_ID（环境变量 CREEZ_USER_ID 或默认 UUID）
      const user_id = await window.creez?.getCreezUserId?.();
      const res = await window.creez?.imageGenGeneratePrompt?.({
        scene: { ...scene, panel_id: filePath, chat_id: filePath },
        user_id,
      });
      if (!res?.ok) {
        alert(res?.error || "生成失败");
        return;
      }
      const d = res.data;
      if (d?.prompt) promptInput.value = d.prompt;
      promptValue = promptInput.value;
      updatePromptCount();
      if (d?.model) modelSelect.value = d.model;
      if (d?.aspect_ratio) {
        if (modelSelect.value === "gpt4o-image" && !["1:1", "16:9", "9:16"].includes(d.aspect_ratio)) {
          aspectSelect.value = "1:1";
        } else aspectSelect.value = d.aspect_ratio;
      }
      if (d?.reference_image_list && Array.isArray(d.reference_image_list) && referenceImageList.length < MAX_REF_IMAGES) {
        const toAdd = d.reference_image_list.slice(0, MAX_REF_IMAGES - referenceImageList.length);
        toAdd.forEach((item) => {
          const u = typeof item === "string" ? item : item?.url;
          if (u && !referenceImageList.some((r) => r.url === u)) referenceImageList.push({ url: u });
        });
        renderRefContent();
        updateModelOptions();
      }
    } finally {
      isGeneratingPrompt = false;
      aiGenBtn.disabled = false;
      aiGenBtn.textContent = "AI生成";
    }
  });

  modelSelect.addEventListener("change", updateAspectOptions);

  function renderList() {
    listEl.innerHTML = "";
    if (!images.length) {
      const empty = document.createElement("div");
      empty.className = "scene-ai-list-empty";
      empty.textContent = "暂无生成记录";
      listEl.appendChild(empty);
      return;
    }
    images.forEach((item, idx) => {
      const urls = Array.isArray(item.image_urls) ? item.image_urls : [];
      const url = urls[0];
      const card = document.createElement("div");
      card.className = "scene-ai-card" + (url && url === selectedImageLocal ? " scene-ai-card-selected" : "");
      card.title = "点击可把该图的参数填入左侧";
      card.addEventListener("click", (e) => {
        if (e.target.closest(".scene-ai-card-btn")) return;
        if (item?.parameters) fillParamsFromItem(item);
      });
      const thumbWrap = document.createElement("div");
      thumbWrap.className = "scene-ai-card-thumb";
      if (url) {
        const img = document.createElement("img");
        const u = url;
        img.src =
          u.startsWith("data:") || u.startsWith("http") || u.startsWith("file:")
            ? u
            : workDir
            ? toFileSrc(workDir.replace(/\\/g, "/") + "/" + String(u).replace(/^[/\\]+/, "")) || u
            : u;
        img.alt = "";
        thumbWrap.appendChild(img);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "scene-ai-card-placeholder";
        placeholder.textContent = item.status === "isloading" ? "生成中…" : item.status === "failed" ? "失败" : "—";
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
        selectedImageLocal = url;
        onUpdate?.({ selected_image: url });
        renderList();
      };
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "scene-ai-card-btn";
      delBtn.textContent = "删除";
      delBtn.onclick = () => {
        images = images.filter((_, i) => i !== idx);
        onUpdate?.({ images });
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

  /** 从某条生成记录的 parameters 回填到左侧表单（点击已生成图片时调用） */
  function fillParamsFromItem(item) {
    if (!item?.parameters) return;
    const p = item.parameters;
    if (p.prompt != null) {
      promptInput.value = p.prompt;
      promptValue = promptInput.value;
    }
    if (p.model && modelSelect.querySelector(`option[value="${p.model}"]`)) modelSelect.value = p.model;
    if (p.aspect_ratio) aspectSelect.value = p.aspect_ratio;
    if (p.reference_image_list && Array.isArray(p.reference_image_list)) {
      referenceImageList.length = 0;
      p.reference_image_list.slice(0, MAX_REF_IMAGES).forEach((x) => {
        const u = typeof x === "string" ? x : x?.url;
        if (u) referenceImageList.push({ url: u });
      });
      renderRefContent();
    }
    updatePromptCount();
    updateModelOptions();
  }

  function loadParamsFromFirst() {
    const first = images[0];
    if (first?.parameters) {
      const p = first.parameters;
      if (p.prompt) promptInput.value = p.prompt;
      promptValue = promptInput.value;
      if (p.model && modelSelect.querySelector(`option[value="${p.model}"]`)) modelSelect.value = p.model;
      if (p.aspect_ratio) aspectSelect.value = p.aspect_ratio;
      if (p.reference_image_list && Array.isArray(p.reference_image_list) && referenceImageList.length < MAX_REF_IMAGES) {
        const toAdd = p.reference_image_list
          .map((item) => (typeof item === "string" ? item : item?.url))
          .filter((u) => u && !referenceImageList.some((r) => r.url === u));
        toAdd.slice(0, MAX_REF_IMAGES - referenceImageList.length).forEach((url) => referenceImageList.push({ url }));
        renderRefContent();
      }
    }
    updatePromptCount();
    updateModelOptions();
  }

  let pollTimer = null;

  /** 存到 .scene_board 的格式：只存本地路径或 http URL，不存 base64 */
  function buildReferenceImageListForStorage() {
    if (!referenceImageList.length) return undefined;
    const list = referenceImageList
      .map((item) => item.url || "")
      .filter((u) => u && !u.startsWith("data:"));
    return list.length ? list.map((url) => ({ url })) : undefined;
  }

  /** file:// URL 转成绝对路径给 readFileAsDataUrl */
  function fileUrlToPath(fileUrl) {
    if (!fileUrl || !String(fileUrl).startsWith("file://")) return fileUrl;
    const s = String(fileUrl).replace(/^file:\/\/+/i, "");
    return s.replace(/^\/([a-zA-Z]:)/, "$1");
  }

  /** 仅发请求时把本地路径/file:// 转成 base64 */
  async function buildReferenceImageListForRequest(workDir) {
    if (!referenceImageList.length) return undefined;
    const out = [];
    for (const item of referenceImageList) {
      const u = item.url || "";
      if (u.startsWith("data:")) {
        out.push({ type: "base64", data: u });
        continue;
      }
      if (u.startsWith("http://") || u.startsWith("https://")) {
        out.push({ url: u });
        continue;
      }
      const pathForRead = u.startsWith("file://") ? fileUrlToPath(u) : u;
      const res = await window.creez?.readFileAsDataUrl?.(pathForRead, pathForRead && pathForRead.match(/^[a-zA-Z]:/) ? "" : workDir);
      if (res?.ok && res.dataUrl) out.push({ type: "base64", data: res.dataUrl });
      else out.push({ url: u });
    }
    return out.length ? out : undefined;
  }

  async function doGenerate() {
    const config = await (window.creez?.getConfig?.() || Promise.resolve(null));
    workDir = config?.workDir || "";
    const promptText = promptInput.value.trim();
    if (!promptText) {
      alert("请填写创意描述");
      promptInput.focus();
      return;
    }
    const refListForRequest = await buildReferenceImageListForRequest(workDir);
    const params = {
      prompt: promptText,
      model: modelSelect.value,
      aspect_ratio: aspectSelect.value,
      reference_image_list: buildReferenceImageListForStorage(),
    };
    const body = {
      panel_id: filePath || "creez",
      chat_id: filePath || "creez",
      ...params,
      reference_image_list: refListForRequest,
      created_at: Date.now(),
    };
    // user_id 来自主进程 creez:getUserId → IMAGE_GEN_USER_ID（环境变量 CREEZ_USER_ID 或默认 UUID）
    const user_id = await window.creez?.getCreezUserId?.();
    const res = await window.creez?.imageGenCreate?.({ body, user_id });
    if (!res?.ok) {
      alert(res?.error || "创建任务失败");
      return;
    }
    const taskId = res.task_id;
    const placeholder = { image_urls: [], status: "isloading", parameters: params, taskId, created_at: body.created_at };
    images = [placeholder, ...images];
    onUpdate?.({ images });
    renderList();

    const poll = async () => {
      const loadingIds = images.filter((img) => img.status === "isloading" && img.taskId).map((img) => img.taskId);
      if (loadingIds.length === 0) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      const pollRes = await window.creez?.imageGenPoll?.({ task_ids: loadingIds, user_id });
      if (!pollRes?.ok) return;
      const data = pollRes.data || {};
      let anyDone = false;
      const now = Date.now();
      for (const img of images) {
        if (img.status !== "isloading" || !img.taskId) continue;
        const taskId = img.taskId;
        const r = data[taskId];
        if (!r) continue;
        const done = r.status === "completed" || r.status === "failed" || r.status === "overtime";
        if (!done) continue;
        anyDone = true;
        const elapsedMs = img.created_at ? now - img.created_at : 0;
        if (elapsedMs > IMAGE_TIMEOUT_MS) {
          images = images.map((i) => (i.taskId === taskId ? { ...i, status: "failed", errorMessage: "任务超时" } : i));
          onUpdate?.({ images });
          renderList();
          continue;
        }
        let urls =
          r.image_urls && Array.isArray(r.image_urls) && r.image_urls.length > 0
            ? r.image_urls
            : r.image_url
            ? [r.image_url]
            : [];
        if (r.status === "completed" && urls.length > 0 && workDir) {
          const basename = filePath ? filePath.replace(/^.*[/\\]/, "") : "default.scene_board";
          const baseRel = `.creez/sceneboard/${basename}/image`;
          const saved = [];
          for (let i = 0; i < urls.length; i++) {
            const u = urls[i];
            if (u && (u.startsWith("http://") || u.startsWith("https://"))) {
              const dl = await window.creez?.imageGenDownloadAndSave?.({ imageUrl: u, workDir, saveRelativePath: `${baseRel}/${taskId}_${i}` });
              const rel = dl?.ok && dl.relativePath ? dl.relativePath : u;
              saved.push(rel.startsWith("file:") ? rel : pathToFileUrl((workDir.replace(/\\/g, "/") + "/" + String(rel).replace(/^[/\\]+/, ""))));
            } else {
              saved.push(u.startsWith("file:") || u.startsWith("data:") ? u : pathToFileUrl((workDir.replace(/\\/g, "/") + "/" + String(u).replace(/^[/\\]+/, ""))));
            }
          }
          urls = saved;
        }
        images = images.map((i) =>
          i.taskId === taskId
            ? {
                ...i,
                status: r.status === "completed" ? "completed" : "failed",
                image_urls: urls,
                errorMessage: r.status !== "completed" ? r.message || "失败" : undefined,
              }
            : i
        );
      }
      if (anyDone) {
        onUpdate?.({ images });
        renderList();
      }
    };
    if (!pollTimer) pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    poll();
  }

  genBtn.addEventListener("click", doGenerate);

  closeBtn.addEventListener("click", () => {
    hideMention();
    if (pollTimer) clearInterval(pollTimer);
    document.body.removeChild(overlay);
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      hideMention();
      if (pollTimer) clearInterval(pollTimer);
      document.body.removeChild(overlay);
    }
  });

  (async () => {
    const cfg = await (window.creez?.getConfig?.() || Promise.resolve(null));
    workDir = cfg?.workDir || "";
    updateModelOptions();
    loadParamsFromFirst();
    renderList();
    renderRefContent();
  })();

  body.appendChild(left);
  body.appendChild(right);
  panel.appendChild(header);
  panel.appendChild(body);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}
