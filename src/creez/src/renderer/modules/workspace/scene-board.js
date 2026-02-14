function pathToFileUrl(path) {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  return normalized.match(/^[a-zA-Z]:/) ? `file:///${normalized}` : `file://${normalized}`;
}

function toFileSrc(imgUrl) {
  if (!imgUrl) return null;
  if (imgUrl.startsWith("data:") || imgUrl.startsWith("http") || imgUrl.startsWith("file:")) return imgUrl;
  return pathToFileUrl(imgUrl);
}

function shortenToSix(text) {
  const chars = [...String(text || "")];
  return chars.slice(0, 6).join("");
}

function generateAssetId() {
  return `asset_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

import { openImagePanel } from "./ai-image-panel.js";
import { openVideoPanel } from "./ai-video-panel.js";

export function parseJsonSafe(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getSceneBoardData(raw) {
  const data = parseJsonSafe(raw);
  if (!data || typeof data !== "object") {
    return { name: "", style: "", scene_board: [], art_materials: { asset: [] } };
  }
  const assetList = data.art_materials && Array.isArray(data.art_materials.asset) ? data.art_materials.asset : [];
  const assetsWithId = assetList.map((a) => {
    if (!a || typeof a !== "object") return a;
    return { ...a, id: a.id && String(a.id).trim() ? a.id : generateAssetId() };
  });
  return {
    name: data.name || "",
    style: data.style || "",
    scene_board: Array.isArray(data.scene_board) ? data.scene_board : [],
    art_materials: { asset: assetsWithId },
  };
}

function stripDataUrlsFromUrls(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr
    .map((u) => (typeof u === "string" ? u : u?.url))
    .filter((u) => u && !String(u).startsWith("data:"));
}

/** 将相对路径转为 file://，已是 file/http/data 则不动 */
function normalizeToFileUrl(url, workDir) {
  if (!url || typeof url !== "string") return url;
  const u = url.trim();
  if (u.startsWith("data:") || u.startsWith("http") || u.startsWith("file:")) return u;
  if (!workDir) return u;
  const joined = (workDir.replace(/\\/g, "/") + "/" + u.replace(/^[/\\]+/, "")).replace(/^\/+/, "");
  return pathToFileUrl(joined);
}

/** 持久化前兜底：过滤 data URL；将相对路径 image_urls 统一为 file://（需传入 workDir） */
function sanitizeSceneBoardForStorage(data, workDir = "") {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };

  if (out.art_materials && Array.isArray(out.art_materials.asset)) {
    out.art_materials = {
      ...out.art_materials,
      asset: out.art_materials.asset.map((a) => {
        if (!a || typeof a !== "object") return a;
        const next = { ...a };
        if (Array.isArray(next.image_urls)) {
          next.image_urls = stripDataUrlsFromUrls(next.image_urls).map((u) => normalizeToFileUrl(u, workDir));
        }
        return next;
      }),
    };
  }

  if (Array.isArray(out.scene_board)) {
    out.scene_board = out.scene_board.map((scene) => {
      const s = { ...scene };
      if (Array.isArray(s.picture?.frames)) {
        s.picture = { ...s.picture, frames: s.picture.frames.map((frameItems) => {
          if (!Array.isArray(frameItems)) return frameItems;
          return frameItems.map((item) => {
            if (!item || typeof item !== "object") return item;
            const nextItem = { ...item };
            if (Array.isArray(nextItem.image_urls)) {
              nextItem.image_urls = stripDataUrlsFromUrls(nextItem.image_urls).map((u) => normalizeToFileUrl(u, workDir));
            }
            if (nextItem.parameters) {
              const p = { ...nextItem.parameters };
              if (Array.isArray(p.reference_image_list)) {
                const list = stripDataUrlsFromUrls(p.reference_image_list).map((u) => normalizeToFileUrl(u, workDir));
                if (!list.length) delete p.reference_image_list;
                else p.reference_image_list = list.map((url) => ({ url }));
              }
              nextItem.parameters = p;
            }
            return nextItem;
          });
        }) };
      }
      if (Array.isArray(s.videos)) {
        s.videos = s.videos.map((v) => {
          if (!v || typeof v !== "object") return v;
          const nextV = { ...v };
          if (Array.isArray(nextV.video_urls)) nextV.video_urls = stripDataUrlsFromUrls(nextV.video_urls).map((u) => normalizeToFileUrl(u, workDir));
          if (typeof nextV.video_url === "string" && nextV.video_url.startsWith("data:")) delete nextV.video_url;
          if (nextV.parameters) {
            const p = { ...nextV.parameters };
            if (Array.isArray(p.frames)) {
              p.frames = p.frames
                .map((f) => (typeof f === "string" ? f : f?.url || (f?.type === "base64" ? null : f)))
                .filter((u) => u && !String(u).startsWith("data:"))
                .map((u) => normalizeToFileUrl(u, workDir));
              if (!p.frames.length) delete p.frames;
            }
            nextV.parameters = p;
          }
          return nextV;
        });
      }
      return s;
    });
  }
  return out;
}

export function showAddArtMaterialModal(onSubmit, workDir = "") {
  const modal = document.getElementById("add-art-material-modal");
  const nameInput = document.getElementById("add-art-material-name");
  const statusInput = document.getElementById("add-art-material-status");
  const typeSelect = document.getElementById("add-art-material-type");
  const fileInput = document.getElementById("add-art-material-file");
  const uploadArea = document.getElementById("add-art-material-upload");
  const placeholder = document.getElementById("add-art-material-upload-placeholder");
  const preview = document.getElementById("add-art-material-preview");
  const okBtn = document.getElementById("add-art-material-ok");
  const cancelBtn = document.getElementById("add-art-material-cancel");
  const closeBtn = document.getElementById("add-art-material-modal-close");
  if (!modal || !nameInput) return;

  let selectedImageRef = null;

  const reset = () => {
    nameInput.value = "";
    statusInput.value = "";
    typeSelect.value = "";
    fileInput.value = "";
    selectedImageRef = null;
    placeholder?.classList.remove("hidden");
    preview?.classList.add("hidden");
    if (preview) preview.src = "";
  };

  const finish = (submit, image_urls) => {
    modal.classList.add("hidden");
    okBtn.removeEventListener("click", onOk);
    cancelBtn?.removeEventListener("click", onCancel);
    closeBtn?.removeEventListener("click", onCancel);
    fileInput?.removeEventListener("change", handleFileChange);
    uploadArea?.removeEventListener("dragover", handleDragOver);
    uploadArea?.removeEventListener("drop", handleDrop);
    if (submit && Array.isArray(image_urls)) {
      const name = nameInput.value.trim();
      const visual_state = statusInput.value.trim();
      const asset_type = typeSelect.value.trim();
      onSubmit({ name, visual_state, asset_type, desc: "", image_urls });
    }
  };

  const onOk = async () => {
    const name = nameInput.value.trim();
    const visualState = statusInput.value.trim();
    const assetType = typeSelect.value.trim();
    if (!name) {
      alert("请填写资产名");
      nameInput.focus();
      return;
    }
    if (!visualState) {
      alert("请填写状态");
      statusInput.focus();
      return;
    }
    if (!assetType) {
      alert("请选择类型");
      typeSelect.focus();
      return;
    }
    if (!selectedImageRef) {
      alert("请上传图片");
      fileInput.focus();
      return;
    }
    let image_urls;
    if (selectedImageRef.startsWith("data:") && workDir && window.creez?.saveDataUrl) {
      const slug = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_").slice(0, 32) || "asset";
      const relativePath = `.creez/sceneboard/assets/${Date.now()}_${slug(name)}.png`;
      const res = await window.creez.saveDataUrl({ dataUrl: selectedImageRef, workDir, relativePath });
      if (!res?.ok || !res.relativePath) {
        alert(res?.error || "保存图片失败");
        return;
      }
      const absPath = (workDir.replace(/\\/g, "/") + "/" + res.relativePath).replace(/^\/+/, "");
      image_urls = [pathToFileUrl(absPath)];
    } else if (selectedImageRef.startsWith("http://") || selectedImageRef.startsWith("https://")) {
      image_urls = [selectedImageRef];
    } else {
      image_urls = [pathToFileUrl(selectedImageRef.replace(/\\/g, "/"))];
    }
    finish(true, image_urls);
  };
  const onCancel = () => finish(false, null);

  const isImageFile = (file) => {
    if (!file) return false;
    if (file.type && file.type.startsWith("image/")) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name || "");
  };

  const setPreview = (src) => {
    if (!src) return;
    placeholder?.classList.add("hidden");
    preview?.classList.remove("hidden");
    if (preview) preview.src = src;
  };

  const setSelectedImage = (file) => {
    if (!file || file.size > 6 * 1024 * 1024 || !isImageFile(file)) return;
    const localPath = file.path;
    if (localPath) {
      selectedImageRef = localPath;
      setPreview(pathToFileUrl(localPath));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      selectedImageRef = reader.result;
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = () => {
    const file = fileInput.files?.[0];
    setSelectedImage(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    setSelectedImage(file);
  };

  reset();
  modal.classList.remove("hidden");
  nameInput.focus();

  okBtn.addEventListener("click", onOk);
  cancelBtn?.addEventListener("click", onCancel);
  closeBtn?.addEventListener("click", onCancel);
  fileInput?.addEventListener("change", handleFileChange);
  uploadArea?.addEventListener("dragover", handleDragOver);
  uploadArea?.addEventListener("drop", handleDrop);
}

export function renderSceneBoardEditor(tab, onUpdate, workDir = "", onSave = null) {
  const wrapper = document.createElement("div");
  wrapper.className = "scene-board-editor";

  const data = getSceneBoardData(tab.draft || "");
  const scenes = data.scene_board;
  const assets = data.art_materials?.asset || [];

  const persist = (nextData) => {
    tab.draft = JSON.stringify(sanitizeSceneBoardForStorage(nextData, workDir), null, 2);
    onUpdate();
    onSave?.();
  };

  const addScene = () => {
    const newScene = {
      shot_id: (scenes.length || 0) + 1,
      type: "",
      movement: "",
      description: "",
      visual: "",
      action: "",
      dialogue: "",
      sound: "",
      active_assets: [],
      picture: { frames: [] },
      videos: [],
      scene_index: scenes.length || 0,
    };
    persist({ ...data, scene_board: [...scenes, newScene] });
  };

  const resolveAssetByRef = (ref, fallbackIndex) => {
    const normalizedRef = String(ref || "").trim();
    const matched = assets.find((asset) => String(asset?.id || "").trim() === normalizedRef);
    const picked = matched || null;
    const name = picked?.name || `美术资产 ${fallbackIndex + 1}`;
    const state = picked?.visual_state ? String(picked.visual_state).trim() : "";
    const combined = state ? `${name}-${state}` : name;
    return {
      id: picked?.id ?? null,
      label: shortenToSix(combined),
      image: toFileSrc(picked?.image_urls?.[0]),
    };
  };

  const artSection = document.createElement("div");
  artSection.className = "scene-board-section";
  artSection.dataset.section = "art";
  const artHeader = document.createElement("div");
  artHeader.className = "scene-board-section-header scene-board-section-header-toggle";
  artHeader.setAttribute("role", "button");
  artHeader.setAttribute("tabindex", "0");
  artHeader.setAttribute("aria-expanded", "true");
  const artHeaderCaret = document.createElement("span");
  artHeaderCaret.className = "scene-board-section-caret";
  artHeaderCaret.setAttribute("aria-hidden", "true");
  artHeader.appendChild(artHeaderCaret);
  artHeader.appendChild(document.createTextNode("美术资产"));
  artHeader.addEventListener("click", () => {
    artSection.classList.toggle("collapsed");
    artHeader.setAttribute("aria-expanded", artSection.classList.contains("collapsed") ? "false" : "true");
  });
  artHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      artSection.classList.toggle("collapsed");
      artHeader.setAttribute("aria-expanded", artSection.classList.contains("collapsed") ? "false" : "true");
    }
  });
  artSection.appendChild(artHeader);
  const artBody = document.createElement("div");
  artBody.className = "scene-board-section-body scene-board-assets-body";

  const assetTypeOrder = ["角色", "背景", "常见", "道具", "其他"];
  const groupedAssets = new Map();
  assets.forEach((asset, idx) => {
    const type = (asset?.asset_type || "其他").trim() || "其他";
    if (!groupedAssets.has(type)) groupedAssets.set(type, []);
    groupedAssets.get(type).push({ asset, idx });
  });
  const orderedTypes = [
    ...assetTypeOrder.filter((type) => groupedAssets.has(type)),
    ...Array.from(groupedAssets.keys()).filter((type) => !assetTypeOrder.includes(type)),
  ];
  if (!orderedTypes.length) orderedTypes.push("其他");

  let draggingAssetRef = null;
  const setAssetTransfer = (dataTransfer, id) => {
    const idStr = String(id || "").trim();
    if (!idStr) return;
    dataTransfer?.setData("application/x-scene-asset", JSON.stringify({ id: idStr }));
    dataTransfer?.setData("text/plain", `scene-asset:${idStr}`);
  };
  const parseAssetTransfer = (dataTransfer) => {
    if (!dataTransfer) return null;
    const custom = dataTransfer.getData("application/x-scene-asset");
    if (custom) {
      try {
        const parsed = JSON.parse(custom);
        const id = String(parsed?.id || "").trim();
        if (id) return { id };
      } catch {}
    }
    const plain = dataTransfer.getData("text/plain") || "";
    if (plain.startsWith("scene-asset:")) {
      const id = plain.replace(/^scene-asset:/, "").trim();
      if (id) return { id };
    }
    return null;
  };
  const refToActiveAssetId = (parsed) => {
    const id = parsed?.id && String(parsed.id).trim();
    return id || null;
  };
  const getAssetTransfer = (dataTransfer) => parseAssetTransfer(dataTransfer) || draggingAssetRef;

  orderedTypes.forEach((type) => {
    const group = document.createElement("div");
    group.className = "scene-asset-group";
    const title = document.createElement("div");
    title.className = "scene-asset-group-title";
    title.textContent = type;
    group.appendChild(title);

    const groupGrid = document.createElement("div");
    groupGrid.className = "scene-asset-group-grid";
    (groupedAssets.get(type) || []).forEach(({ asset, idx }) => {
      const card = document.createElement("div");
      card.className = "scene-card scene-asset-card";
      const imgSrc = toFileSrc(asset.image_urls?.[0]);
      if (imgSrc) {
        const img = document.createElement("img");
        img.src = imgSrc;
        img.alt = asset.name || "";
        img.className = "scene-asset-card-img";
        card.appendChild(img);
      }
      const label = document.createElement("div");
      label.className = "scene-asset-card-label";
      label.textContent = asset.visual_state
        ? `${asset.name || "美术资产"} (${asset.visual_state})`
        : asset.name || `美术资产 ${idx + 1}`;
      card.draggable = true;
      card.dataset.assetId = asset.id || "";
      card.dataset.assetName = asset.name || `美术资产 ${idx + 1}`;
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "copy";
        draggingAssetRef = { id: asset.id };
        setAssetTransfer(event.dataTransfer, asset.id);
      });
      card.addEventListener("dragend", () => {
        draggingAssetRef = null;
      });
      card.appendChild(label);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "scene-asset-card-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "删除该美术资产";
      removeBtn.setAttribute("aria-label", "删除");
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = assets.filter((_, i) => i !== idx);
        persist({ ...data, art_materials: { asset: next } });
      });
      card.appendChild(removeBtn);
      groupGrid.appendChild(card);
    });
    group.appendChild(groupGrid);
    artBody.appendChild(group);
  });

  const artActions = document.createElement("div");
  artActions.className = "scene-board-table-actions";
  const addAssetBtn = document.createElement("button");
  addAssetBtn.type = "button";
  addAssetBtn.className = "scene-board-add-flat-btn";
  addAssetBtn.innerHTML = '<span class="scene-board-add-flat-icon">+</span><span>添加美术资产</span>';
  addAssetBtn.title = "添加美术资产";
  addAssetBtn.setAttribute("aria-label", "添加美术资产");
  addAssetBtn.addEventListener("click", () =>
    showAddArtMaterialModal(
      (assetData) => {
        persist({
          ...data,
          art_materials: { asset: [...assets, { ...assetData, id: generateAssetId() }] },
        });
      },
      workDir
    )
  );
  artActions.appendChild(addAssetBtn);
  artSection.appendChild(artBody);
  artSection.appendChild(artActions);
  wrapper.appendChild(artSection);

  const boardSection = document.createElement("div");
  boardSection.className = "scene-board-section";
  boardSection.dataset.section = "board";
  const boardHeader = document.createElement("div");
  boardHeader.className = "scene-board-section-header scene-board-section-header-toggle";
  boardHeader.setAttribute("role", "button");
  boardHeader.setAttribute("tabindex", "0");
  boardHeader.setAttribute("aria-expanded", "true");
  const boardHeaderCaret = document.createElement("span");
  boardHeaderCaret.className = "scene-board-section-caret";
  boardHeaderCaret.setAttribute("aria-hidden", "true");
  boardHeader.appendChild(boardHeaderCaret);
  boardHeader.appendChild(document.createTextNode("分镜板"));
  boardHeader.addEventListener("click", () => {
    boardSection.classList.toggle("collapsed");
    boardHeader.setAttribute("aria-expanded", boardSection.classList.contains("collapsed") ? "false" : "true");
  });
  boardHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      boardSection.classList.toggle("collapsed");
      boardHeader.setAttribute("aria-expanded", boardSection.classList.contains("collapsed") ? "false" : "true");
    }
  });
  boardSection.appendChild(boardHeader);

  const getData = () => getSceneBoardData(tab.draft);
  const setSceneAt = (sceneIndex, mutator) => {
    const fresh = getData();
    const currentScenes = Array.isArray(fresh.scene_board) ? fresh.scene_board : [];
    const nextScenes = currentScenes.map((item, idx) =>
      idx === sceneIndex ? mutator({ ...item }) : item
    );
    persist({ ...fresh, scene_board: nextScenes });
  };
  const reorderScenes = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const nextScenes = [...scenes];
    const [moved] = nextScenes.splice(fromIndex, 1);
    if (!moved) return;
    nextScenes.splice(toIndex, 0, moved);
    persist({
      ...data,
      scene_board: nextScenes.map((scene, idx) => ({ ...scene, scene_index: idx, shot_id: idx + 1 })),
    });
  };
  let draggingSceneCell = null;
  const parseSceneCellTransfer = (dataTransfer) => {
    if (!dataTransfer) return null;
    const custom = dataTransfer.getData("application/x-scene-cell");
    if (custom) {
      try {
        const parsed = JSON.parse(custom);
        if (parsed && typeof parsed.field === "string") {
          return { field: parsed.field, value: String(parsed.value || "") };
        }
      } catch {}
    }
    const plain = dataTransfer.getData("text/plain") || "";
    if (plain.startsWith("scene-cell:")) {
      const match = plain.match(/^scene-cell:([^:]+):(.*)$/s);
      if (match) return { field: match[1], value: match[2] || "" };
    }
    return null;
  };
  const getSceneCellTransfer = (dataTransfer) => {
    return parseSceneCellTransfer(dataTransfer) || draggingSceneCell;
  };
  const createEditableText = (field, value, onCommit) => {
    const el = document.createElement("div");
    el.className = "scene-cell-editable scene-cell-editable-hint";
    el.contentEditable = "false";
    el.spellcheck = false;
    el.draggable = true;
    el.dataset.sceneField = field;
    el.textContent = value || "";
    let editing = false;
    const enterEdit = () => {
      if (editing) return;
      editing = true;
      el.contentEditable = "true";
      el.classList.add("is-editing");
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    const leaveEdit = (commit) => {
      if (!editing) return;
      if (commit) onCommit(el.textContent.trim());
      editing = false;
      el.contentEditable = "false";
      el.classList.remove("is-editing");
    };
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      enterEdit();
    });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        leaveEdit(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        leaveEdit(false);
      }
    });
    el.addEventListener("blur", () => leaveEdit(true));
    el.addEventListener("dragstart", (event) => {
      if (editing) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "copyMove";
      const payload = JSON.stringify({ field, value: el.textContent.trim() });
      draggingSceneCell = { field, value: el.textContent.trim() };
      event.dataTransfer.setData("application/x-scene-cell", payload);
      event.dataTransfer.setData("text/plain", `scene-cell:${field}:${el.textContent.trim()}`);
    });
    el.addEventListener("dragend", () => {
      draggingSceneCell = null;
      el.classList.remove("scene-cell-drop-target");
      el.parentElement?.classList.remove("scene-cell-drop-active");
    });
    return el;
  };
  const bindEditableCellDropTarget = (cellEl, field, targetEditableEl, onApply) => {
    cellEl.addEventListener("dragover", (event) => {
      const parsed = getSceneCellTransfer(event.dataTransfer);
      if (!parsed || parsed.field !== field) return;
      event.preventDefault();
      cellEl.classList.add("scene-cell-drop-active");
      targetEditableEl?.classList.add("scene-cell-drop-target");
    });
    cellEl.addEventListener("dragleave", () => {
      cellEl.classList.remove("scene-cell-drop-active");
      targetEditableEl?.classList.remove("scene-cell-drop-target");
    });
    cellEl.addEventListener("drop", (event) => {
      const parsed = getSceneCellTransfer(event.dataTransfer);
      if (!parsed || parsed.field !== field) return;
      event.preventDefault();
      const nextValue = (parsed.value || "").trim();
      if (targetEditableEl) targetEditableEl.textContent = nextValue;
      onApply(nextValue);
      cellEl.classList.remove("scene-cell-drop-active");
      targetEditableEl?.classList.remove("scene-cell-drop-target");
      draggingSceneCell = null;
    });
  };

  const boardBody = document.createElement("div");
  boardBody.className = "scene-board-table-wrap";
  const table = document.createElement("table");
  table.className = "scene-board-table";
  table.innerHTML = `
    <colgroup>
      <col style="width: 30px;" />
      <col style="width: 70px;" />
      <col style="width: 150px;" />
      <col style="width: 150px;" />
      <col style="width: 220px;" />
      <col style="width: 180px;" />
      <col style="width: 180px;" />
      <col style="width: 170px;" />
      <col style="width: 90px;" />
    </colgroup>
    <thead>
      <tr>
        <th class="scene-board-col-drag"></th>
        <th>镜头 ID</th>
        <th>景别 / 类型</th>
        <th>运动方式</th>
        <th>镜头描述</th>
        <th>激活资产</th>
        <th>画面</th>
        <th>视频</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  scenes.forEach((scene, index) => {
    const tr = document.createElement("tr");
    tr.dataset.index = String(index);
    tr.addEventListener("dragover", (event) => {
      const types = Array.from(event.dataTransfer.types || []);
      if (!types.includes("application/x-scene-row")) return;
      event.preventDefault();
      tr.classList.add("scene-row-drop-target");
    });
    tr.addEventListener("dragleave", () => tr.classList.remove("scene-row-drop-target"));
    tr.addEventListener("drop", (event) => {
      const rowPayload =
        event.dataTransfer.getData("application/x-scene-row") || event.dataTransfer.getData("text/plain");
      if (!rowPayload) return;
      event.preventDefault();
      tr.classList.remove("scene-row-drop-target");
      const from = Number(String(rowPayload).replace("scene-row:", ""));
      if (!Number.isNaN(from)) reorderScenes(from, index);
    });

    const dragTd = document.createElement("td");
    dragTd.className = "scene-board-col-drag";
    const dragHandle = document.createElement("span");
    dragHandle.className = "scene-row-drag-handle";
    dragHandle.textContent = "⋮⋮";
    dragHandle.draggable = true;
    dragHandle.addEventListener("dragstart", (event) => {
      tr.classList.add("scene-row-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-scene-row", String(index));
      event.dataTransfer.setData("text/plain", `scene-row:${index}`);
    });
    dragHandle.addEventListener("dragend", () => {
      tr.classList.remove("scene-row-dragging");
      tbody?.querySelectorAll(".scene-row-drop-target").forEach((row) => row.classList.remove("scene-row-drop-target"));
    });
    dragTd.appendChild(dragHandle);
    tr.appendChild(dragTd);

    const shotTd = document.createElement("td");
    shotTd.className = "scene-cell-readonly";
    shotTd.textContent = scene.shot_id == null ? String(index + 1) : String(scene.shot_id);
    tr.appendChild(shotTd);

    const typeTd = document.createElement("td");
    const typeEditable = createEditableText("type", scene.type || "", (next) =>
      setSceneAt(index, (item) => ({ ...item, type: next }))
    );
    typeTd.appendChild(typeEditable);
    bindEditableCellDropTarget(typeTd, "type", typeEditable, (next) =>
      setSceneAt(index, (item) => ({ ...item, type: next }))
    );
    tr.appendChild(typeTd);
    const movementTd = document.createElement("td");
    const movementEditable = createEditableText("movement", scene.movement || "", (next) =>
      setSceneAt(index, (item) => ({ ...item, movement: next }))
    );
    movementTd.appendChild(movementEditable);
    bindEditableCellDropTarget(movementTd, "movement", movementEditable, (next) =>
      setSceneAt(index, (item) => ({ ...item, movement: next }))
    );
    tr.appendChild(movementTd);
    const descTd = document.createElement("td");
    const descEditable = createEditableText("description", scene.description || "", (next) =>
      setSceneAt(index, (item) => ({ ...item, description: next }))
    );
    descTd.appendChild(descEditable);
    bindEditableCellDropTarget(descTd, "description", descEditable, (next) =>
      setSceneAt(index, (item) => ({ ...item, description: next }))
    );
    tr.appendChild(descTd);

    const activeAssets = Array.isArray(scene.active_assets) ? scene.active_assets : [];
    const activeTd = document.createElement("td");
    activeTd.className = "scene-cell-with-actions scene-col-active";
    activeTd.addEventListener("dragover", (event) => {
      const parsed = getAssetTransfer(event.dataTransfer);
      if (!refToActiveAssetId(parsed)) return;
      event.preventDefault();
      activeTd.classList.add("scene-cell-drop-target");
    });
    activeTd.addEventListener("dragleave", () => activeTd.classList.remove("scene-cell-drop-target"));
    activeTd.addEventListener("drop", (event) => {
      const parsed = getAssetTransfer(event.dataTransfer);
      const refId = refToActiveAssetId(parsed);
      if (!refId) return;
      event.preventDefault();
      activeTd.classList.remove("scene-cell-drop-target");
      setSceneAt(index, (item) => ({
        ...item,
        active_assets: [...(Array.isArray(item.active_assets) ? item.active_assets : []), refId],
      }));
      draggingAssetRef = null;
    });
    const activeList = document.createElement("div");
    activeList.className = "scene-active-asset-list";
    if (!activeAssets.length) {
      const empty = document.createElement("div");
      empty.className = "scene-cell-summary";
      empty.textContent = "未选择资产";
      activeList.appendChild(empty);
    } else {
      activeAssets.forEach((assetRef, activeIdx) => {
        const resolved = resolveAssetByRef(assetRef, activeIdx);
        const item = document.createElement("div");
        item.className = "scene-active-asset-item";
        item.draggable = true;
        const refId = resolved.id || String(assetRef || "").trim();
        item.addEventListener("dragstart", (event) => {
          event.dataTransfer.effectAllowed = "copyMove";
          draggingAssetRef = { id: refId };
          setAssetTransfer(event.dataTransfer, refId);
        });
        item.addEventListener("dragend", () => {
          draggingAssetRef = null;
        });
        if (resolved.image) {
          const thumb = document.createElement("img");
          thumb.className = "scene-active-asset-thumb";
          thumb.src = resolved.image;
          thumb.alt = resolved.label;
          item.appendChild(thumb);
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "scene-active-asset-thumb scene-active-asset-thumb-placeholder";
          placeholder.textContent = "图";
          item.appendChild(placeholder);
        }
        const text = document.createElement("div");
        text.className = "scene-active-asset-text";
        text.textContent = resolved.label;
        item.appendChild(text);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "scene-active-asset-remove";
        removeBtn.textContent = "×";
        removeBtn.title = "从本镜头移除该资产";
        removeBtn.setAttribute("aria-label", "移除");
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          setSceneAt(index, (scene) => ({
            ...scene,
            active_assets: (Array.isArray(scene.active_assets) ? scene.active_assets : []).filter(
              (_, i) => i !== activeIdx
            ),
          }));
        });
        item.appendChild(removeBtn);
        activeList.appendChild(item);
      });
    }
    const addAssetBtnInline = document.createElement("button");
    addAssetBtnInline.type = "button";
    addAssetBtnInline.className = "scene-cell-mini-btn";
    addAssetBtnInline.textContent = "+ 添加资产";
    addAssetBtnInline.addEventListener("click", () =>
      showAssetSelector(index)
    );
    const activeStack = document.createElement("div");
    activeStack.className = "scene-cell-stack";
    activeStack.appendChild(activeList);
    activeStack.appendChild(addAssetBtnInline);
    activeTd.appendChild(activeStack);
    tr.appendChild(activeTd);

    const picture = scene.picture && typeof scene.picture === "object" ? scene.picture : {};
    const pictureFrames = Array.isArray(picture.frames) ? picture.frames : [];
    const visualTd = document.createElement("td");
    visualTd.className = "scene-cell-with-actions scene-col-visual";
    const visualStack = document.createElement("div");
    visualStack.className = "scene-cell-stack";

    const openImagePanelForFrame = (frameIdx, frameImages) => {
      openImagePanel({
        images: Array.isArray(frameImages) ? frameImages : [],
        selectedImage: scene.selected_image,
        artAssets: assets,
        filePath: tab.path || "",
        scene: { shot_id: scene.shot_id, type: scene.type, movement: scene.movement, description: scene.description, panel_id: tab.path, chat_id: tab.path },
        onUpdate: ({ images: nextImages, selected_image }) => {
          setSceneAt(index, (s) => {
            let next = { ...s };
            if (nextImages !== undefined) {
              const pic = s.picture && typeof s.picture === "object" ? { ...s.picture } : { frames: [] };
              const f = Array.isArray(pic.frames) ? [...pic.frames] : [];
              while (f.length <= frameIdx) f.push([]);
              f[frameIdx] = nextImages;
              next = { ...next, picture: { ...pic, frames: f } };
            }
            if (selected_image !== undefined) next = { ...next, selected_image };
            return next;
          });
        },
      });
    };

    const addVisualFrameBtn = document.createElement("button");
    addVisualFrameBtn.type = "button";
    addVisualFrameBtn.className = "scene-cell-mini-btn";
    addVisualFrameBtn.textContent = "+ 添加画面";
    addVisualFrameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nextPicture = scene.picture && typeof scene.picture === "object" ? { ...scene.picture } : { frames: [] };
      const nextFrames = Array.isArray(nextPicture.frames) ? [...nextPicture.frames] : [];
      nextFrames.push([]);
      nextPicture.frames = nextFrames;
      setSceneAt(index, (item) => ({ ...item, picture: nextPicture }));
      const frameIdx = nextFrames.length - 1;
      openImagePanelForFrame(frameIdx, []);
    });

    if (pictureFrames.length === 0) {
      visualStack.appendChild(addVisualFrameBtn);
    } else {
      const visualList = document.createElement("div");
      visualList.className = "scene-visual-frame-list";
      pictureFrames.forEach((frameImages, frameIdx) => {
        const urls = Array.isArray(frameImages) ? frameImages : [];
        const firstWithUrl = urls.find((it) => {
          const arr = it?.image_urls || (it?.image_url ? [it.image_url] : []);
          return arr.length > 0 && !!arr[0];
        });
        const selInFrame = scene.selected_image ? urls.find((it) => {
          const arr = it?.image_urls || (it?.image_url ? [it.image_url] : []);
          return arr.some((u) => u === scene.selected_image) || arr[0] === scene.selected_image;
        }) : null;
        const displayItem = selInFrame || firstWithUrl;
        const thumbUrl = selInFrame ? scene.selected_image : (displayItem ? ((displayItem.image_urls || [])[0] || displayItem.image_url) : null);
        const promptText = (displayItem?.parameters?.prompt || "").slice(0, 10) + ((displayItem?.parameters?.prompt || "").length > 10 ? "…" : "");

        const resolvedSrc =
          thumbUrl && (thumbUrl.startsWith("data:") || thumbUrl.startsWith("http") || thumbUrl.startsWith("file:"))
            ? thumbUrl
            : thumbUrl && workDir
              ? toFileSrc(workDir.replace(/\\/g, "/") + "/" + (thumbUrl || "").replace(/^[/\\]+/, ""))
              : thumbUrl || null;

        const item = document.createElement("div");
        item.className = "scene-visual-frame-item scene-active-asset-item";
        item.title = "点击编辑画面";
        if (resolvedSrc) {
          const thumb = document.createElement("img");
          thumb.className = "scene-active-asset-thumb scene-visual-frame-thumb";
          thumb.src = resolvedSrc;
          thumb.alt = "";
          item.appendChild(thumb);
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "scene-active-asset-thumb scene-active-asset-thumb-placeholder scene-visual-frame-thumb-placeholder";
          placeholder.textContent = "?";
          item.appendChild(placeholder);
        }
        const text = document.createElement("div");
        text.className = "scene-active-asset-text scene-visual-frame-text";
        text.textContent = promptText || "无";
        item.appendChild(text);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "scene-active-asset-remove scene-visual-frame-remove";
        removeBtn.textContent = "×";
        removeBtn.title = "删除画面";
        removeBtn.setAttribute("aria-label", "删除");
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const pic = scene.picture && typeof scene.picture === "object" ? { ...scene.picture } : { frames: [] };
          const f = Array.isArray(pic.frames) ? [...pic.frames] : [];
          f.splice(frameIdx, 1);
          setSceneAt(index, (s) => ({ ...s, picture: { ...pic, frames: f } }));
        });
        item.appendChild(removeBtn);
        item.addEventListener("click", (e) => {
          if (e.target === removeBtn) return;
          openImagePanelForFrame(frameIdx, urls);
        });
        visualList.appendChild(item);
      });
      visualStack.appendChild(visualList);
      visualStack.appendChild(addVisualFrameBtn);
    }
    visualTd.appendChild(visualStack);
    tr.appendChild(visualTd);

    const videos = Array.isArray(scene.videos) ? scene.videos : Array.isArray(scene.video) ? scene.video : [];
    const videoTd = document.createElement("td");
    videoTd.className = "scene-cell-with-actions scene-col-video";
    const videoSummary = document.createElement("div");
    videoSummary.className = "scene-cell-summary";
    const firstVideo = videos[0];
    const firstVideoUrl =
      typeof firstVideo === "string"
        ? firstVideo
        : firstVideo?.video_url ||
          (Array.isArray(firstVideo?.video_urls) ? firstVideo.video_urls[0] : "") ||
          firstVideo?.url ||
          "";
    videoSummary.textContent = (scene.video_note || firstVideoUrl || "").trim() || "无视频内容";
    const videoMeta = document.createElement("div");
    videoMeta.className = "scene-cell-meta";
    videoMeta.textContent = videos.length ? `视频 ${videos.length} 个` : "暂无视频";
    const addVideoBtn = document.createElement("button");
    addVideoBtn.type = "button";
    addVideoBtn.className = "scene-cell-mini-btn";
    addVideoBtn.textContent = "+ 添加视频";
    const openVideoPanelForScene = () => {
      const sceneImagesForVideo = [];
      const pic = scene.picture && typeof scene.picture === "object" ? scene.picture : { frames: [] };
      const frames = Array.isArray(pic.frames) ? pic.frames : [];
      frames.forEach((frameArr) => {
        const arr = Array.isArray(frameArr) ? frameArr : [];
        arr.forEach((it) => {
          if (it?.status === "completed") {
            const urls = it.image_urls || (it.image_url ? [it.image_url] : []);
            urls.forEach((u) => u && sceneImagesForVideo.push({ image_urls: [u], url: u }));
          }
        });
      });
      if (scene.selected_image)
        sceneImagesForVideo.push({ image_urls: [scene.selected_image], url: scene.selected_image });
      openVideoPanel({
        videos,
        selectedVideo: scene.selected_video,
        scene,
        filePath: tab.path || "",
        artAssets: assets,
        sceneImages: sceneImagesForVideo,
        onUpdate: ({ videos: nextVideos, selected_video }) => {
          setSceneAt(index, (s) => {
            let next = { ...s };
            if (nextVideos !== undefined) next = { ...next, videos: nextVideos };
            if (selected_video !== undefined) next = { ...next, selected_video };
            return next;
          });
        },
      });
    };
    addVideoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openVideoPanelForScene();
    });
    const videoStack = document.createElement("div");
    videoStack.className = "scene-cell-stack";
    if (videos.length > 0) {
      videoStack.appendChild(videoSummary);
      videoStack.appendChild(videoMeta);
      videoStack.addEventListener("click", () => openVideoPanelForScene());
    } else {
      videoStack.appendChild(addVideoBtn);
    }
    videoTd.appendChild(videoStack);
    tr.appendChild(videoTd);

    const actionTd = document.createElement("td");
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "scene-delete-btn";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", () => {
      const nextScenes = scenes.filter((_, idx) => idx !== index);
      persist({ ...data, scene_board: nextScenes.map((item, idx) => ({ ...item, scene_index: idx })) });
    });
    actionTd.appendChild(deleteBtn);
    tr.appendChild(actionTd);

    tbody?.appendChild(tr);
  });

  if (!scenes.length && tbody) {
    const tr = document.createElement("tr");
    tr.className = "scene-board-empty-row";
    const td = document.createElement("td");
    td.colSpan = 9;
    td.textContent = "暂无分镜数据，点击左下角「添加分镜」。";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  boardBody.appendChild(table);
  const boardActions = document.createElement("div");
  boardActions.className = "scene-board-table-actions";
  const addSceneBtn = document.createElement("button");
  addSceneBtn.type = "button";
  addSceneBtn.className = "scene-board-add-flat-btn";
  addSceneBtn.innerHTML = '<span class="scene-board-add-flat-icon">+</span><span>添加分镜</span>';
  addSceneBtn.title = "添加分镜";
  addSceneBtn.setAttribute("aria-label", "添加分镜");
  addSceneBtn.addEventListener("click", addScene);
  boardActions.appendChild(addSceneBtn);
  boardSection.appendChild(boardBody);
  boardSection.appendChild(boardActions);
  wrapper.appendChild(boardSection);

  const timelineSection = document.createElement("div");
  timelineSection.className = "scene-board-section";
  timelineSection.dataset.section = "timeline";
  const timelineHeader = document.createElement("div");
  timelineHeader.className = "scene-board-section-header scene-board-section-header-toggle";
  timelineHeader.setAttribute("role", "button");
  timelineHeader.setAttribute("tabindex", "0");
  timelineHeader.setAttribute("aria-expanded", "true");
  const timelineHeaderCaret = document.createElement("span");
  timelineHeaderCaret.className = "scene-board-section-caret";
  timelineHeaderCaret.setAttribute("aria-hidden", "true");
  timelineHeader.appendChild(timelineHeaderCaret);
  timelineHeader.appendChild(document.createTextNode("时间线"));
  timelineHeader.addEventListener("click", () => {
    timelineSection.classList.toggle("collapsed");
    timelineHeader.setAttribute("aria-expanded", timelineSection.classList.contains("collapsed") ? "false" : "true");
  });
  timelineHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      timelineSection.classList.toggle("collapsed");
      timelineHeader.setAttribute("aria-expanded", timelineSection.classList.contains("collapsed") ? "false" : "true");
    }
  });
  timelineSection.appendChild(timelineHeader);
  const timelineBody = document.createElement("div");
  timelineBody.className = "scene-board-section-body scene-board-timeline-body";
  timelineSection.appendChild(timelineBody);
  try {
    buildTimelineContent(timelineBody, getData, persist, workDir, tab);
  } catch (error) {
    console.error("[SceneBoard] buildTimelineContent error:", error);
    const errorMsg = document.createElement("div");
    errorMsg.style.padding = "20px";
    errorMsg.style.color = "#ef4444";
    errorMsg.textContent = "时间线加载失败: " + (error?.message || String(error));
    timelineBody.appendChild(errorMsg);
  }
  wrapper.appendChild(timelineSection);
  return wrapper;

  function buildTimelineContent(container, getData, persist, workDir, tab) {
    container.innerHTML = "";
    const data = getData();
    const scenes = data.scene_board || [];
    const projectName = (data.name || "Timeline").replace(/\s+/g, "_").slice(0, 80);

    const IMAGE_DURATION_SECONDS = 2;
    const VIDEO_DEFAULT_DURATION_SECONDS = 5;
    const PIXELS_PER_SECOND_DEFAULT = 80;
    const PIXELS_PER_SECOND_MIN = 40;
    const PIXELS_PER_SECOND_MAX = 240;
    const RULER_HEIGHT = 40;
    const TRACK_STRIP_HEIGHT = 96;
    const TIMELINE_FPS = 30;

    const pickPreferredResource = (items) => {
      if (!Array.isArray(items) || items.length === 0) return undefined;
      const completed = items.filter((it) => it?.status === "completed");
      const pool = completed.length > 0 ? completed : items;
      const selected = pool.find((it) => it?.is_selected);
      if (selected) return selected;
      return [...pool].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))[pool.length - 1];
    };

    const resolveUrl = (url) => {
      if (!url) return "";
      if (url.startsWith("data:") || url.startsWith("http") || url.startsWith("file:")) return url;
      if (!url.match(/^[a-zA-Z]:/)) {
        const separator = workDir.includes("\\") ? "\\" : "/";
        return workDir + separator + url;
      }
      return url;
    };

    const buildTimelineItems = () => {
      const items = [];
      scenes.forEach((scene, sceneIndex) => {
        const preferredVideo = pickPreferredResource(scene.videos);
        if (preferredVideo) {
          const picture = scene.picture;
          const thumbUrl =
            preferredVideo.parameters?.first_frame_image ||
            (picture?.first_frame?.[0]?.image_urls?.[0]);
          items.push({
            id: `scene-${sceneIndex}-video`,
            sceneIndex,
            type: "video",
            label: scene.description || `镜头 ${scene.shot_id}`,
            durationSeconds: VIDEO_DEFAULT_DURATION_SECONDS,
            videoUrl: resolveUrl(preferredVideo.video_url || preferredVideo.video_urls?.[0]),
            thumbUrl: resolveUrl(thumbUrl),
          });
        } else {
          const picture = scene.picture || {};
          let frameGroups = [];
          if (Array.isArray(picture.frames) && picture.frames.length > 0) {
            frameGroups = picture.frames;
          } else if (Array.isArray(picture.first_frame) && picture.first_frame.length > 0) {
            frameGroups = [picture.first_frame];
          }
          if (frameGroups.length === 0 && Array.isArray(scene.images)) {
            frameGroups = [scene.images];
          }
          frameGroups.forEach((frameImages, frameIndex) => {
            const preferredImage = pickPreferredResource(frameImages);
            const url =
              preferredImage?.image_urls?.[0] ||
              (Array.isArray(picture?.first_frame) && picture.first_frame[0]?.image_urls?.[0]) ||
              "";
            if (!url) return;
            const resolvedUrl = resolveUrl(url);
            items.push({
              id: `scene-${sceneIndex}-frame-${frameIndex}`,
              sceneIndex,
              type: "image",
              label: scene.description
                ? `${scene.description} - 关键帧 ${frameIndex + 1}`
                : `镜头 ${scene.shot_id ?? sceneIndex + 1} - 关键帧 ${frameIndex + 1}`,
              durationSeconds: IMAGE_DURATION_SECONDS,
              imageUrl: resolvedUrl,
              thumbUrl: resolvedUrl,
            });
          });
        }
      });
      return items;
    };

    const formatTime = (seconds) => {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}:${s.toString().padStart(2, "0")}`;
    };
    const formatRulerLabel = (seconds) => {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    const timelineItems = buildTimelineItems();
    const clipStartTimes = [0];
    let total = 0;
    timelineItems.forEach((it) => {
      total += it.durationSeconds;
      clipStartTimes.push(total);
    });
    const totalDurationSeconds = total;

    let currentTimeSeconds = 0;
    let isPlaying = false;
    let pixelsPerSecond = PIXELS_PER_SECOND_DEFAULT;
    let currentClipIndex = -1;
    let currentItem = null;
    let offsetInClip = 0;
    let imageRafId = null;
    let videoEl = null;

    const getCurrentState = () => {
      if (timelineItems.length === 0) return { currentClipIndex: -1, currentItem: null, offsetInClip: 0 };
      const t = Math.max(0, Math.min(currentTimeSeconds, totalDurationSeconds - 0.001));
      let i = 0;
      while (i < clipStartTimes.length - 1 && clipStartTimes[i + 1] <= t) i++;
      const start = clipStartTimes[i];
      return {
        currentClipIndex: i,
        currentItem: timelineItems[i] ?? null,
        offsetInClip: t - start,
      };
    };

    const updateState = () => {
      const state = getCurrentState();
      currentClipIndex = state.currentClipIndex;
      currentItem = state.currentItem;
      offsetInClip = state.offsetInClip;
    };

    const topRow = document.createElement("div");
    topRow.className = "scene-board-timeline-top";
    const topSpacer = document.createElement("div");
    topSpacer.className = "scene-board-timeline-top-spacer";
    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "scene-board-export-xml-btn";
    exportBtn.textContent = "导出 XML";
    exportBtn.disabled = timelineItems.length === 0;
    exportBtn.title = "导出 FCP 7 格式 XML";
    const buildFcpXml = () => {
      const escapeXml = (s) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
      const secondsToFrames = (sec) => Math.round(sec * TIMELINE_FPS);
      const getExt = (url, type) => {
        const ext = (url || "").split(".").pop()?.toLowerCase();
        if (ext && ["mp4", "webm", "mov", "jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return ext;
        return type === "video" ? "mp4" : "jpg";
      };
      const fileParts = [];
      const clipParts = [];
      let fileId = 1;
      let clipItemId = 1;
      timelineItems.forEach((item, i) => {
        const recStart = clipStartTimes[i] ?? 0;
        const recEnd = recStart + item.durationSeconds;
        const recStartF = secondsToFrames(recStart);
        const recEndF = secondsToFrames(recEnd);
        const durationF = recEndF - recStartF;
        const ext = getExt(item.videoUrl || item.imageUrl || "", item.type);
        const fileName = `${String(i + 1).padStart(3, "0")}.${ext}`;
        const pathUrl = `media/${fileName}`;
        const fileIdStr = `file-${fileId}`;
        const clipItemIdStr = `clipitem-${clipItemId}`;
        fileId++;
        clipItemId++;
        fileParts.push(
          `<file id="${fileIdStr}">` +
            `<name>${escapeXml(fileName)}</name>` +
            `<pathurl>${escapeXml(pathUrl)}</pathurl>` +
            `<rate><timebase>${TIMELINE_FPS}</timebase><ntsc>FALSE</ntsc></rate>` +
            `<duration>${durationF}</duration></file>`
        );
        clipParts.push(
          `<clipitem id="${clipItemIdStr}">` +
            `<name>${escapeXml(item.label)}</name>` +
            `<enabled>TRUE</enabled>` +
            `<duration>${durationF}</duration>` +
            `<rate><timebase>${TIMELINE_FPS}</timebase><ntsc>FALSE</ntsc></rate>` +
            `<start>${recStartF}</start><end>${recEndF}</end>` +
            `<in>0</in><out>${durationF}</out>` +
            `<file id="${fileIdStr}"/>` +
            `</clipitem>`
        );
      });
      const totalFrames =
        timelineItems.length > 0
          ? secondsToFrames(clipStartTimes[clipStartTimes.length - 1] + timelineItems[timelineItems.length - 1].durationSeconds)
          : 0;
      const fileLines = fileParts.map((p) => "        " + p).join("\n");
      const clipLines = clipParts.map((p) => "              " + p).join("\n");
      const seqBody =
        `        <sequence id="sequence-1">` +
        `\n          <name>${escapeXml(projectName)}</name>` +
        `\n          <duration>${totalFrames}</duration>` +
        `\n          <rate><timebase>${TIMELINE_FPS}</timebase><ntsc>FALSE</ntsc></rate>` +
        `\n          <media>\n            <video>\n              <format>\n                <samplecharacteristics>` +
        `\n                  <width>1920</width>\n                  <height>1080</height>` +
        `\n                  <anamorphic>FALSE</anamorphic>\n                  <pixelaspectratio>square</pixelaspectratio>` +
        `\n                  <fielddominance>none</fielddominance>` +
        `\n                  <rate><timebase>${TIMELINE_FPS}</timebase><ntsc>FALSE</ntsc></rate>` +
        `\n                </samplecharacteristics>\n              </format>\n              <track>\n` +
        clipLines +
        `\n              </track>\n            </video>\n            <audio>\n              <numOutputChannels>2</numOutputChannels>` +
        `\n              <format>\n                <samplecharacteristics>\n                  <depth>16</depth>\n                  <samplerate>48000</samplerate>` +
        `\n                </samplecharacteristics>\n              </format>\n              <track/>\n            </audio>\n          </media>\n        </sequence>`;
      return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">\n  <project>\n' +
        `    <name>${escapeXml(projectName)}</name>\n    <children>\n      <bin>\n` +
        `        <name>${escapeXml(projectName)}</name>\n        <children>\n${fileLines}\n${seqBody}\n` +
        `        </children>\n      </bin>\n    </children>\n  </project>\n</xmeml>`
      );
    };
    topRow.appendChild(topSpacer);
    exportBtn.addEventListener("click", async () => {
      if (timelineItems.length === 0) return;
      try {
        const xml = buildFcpXml();
        const result = await window.creez?.showSaveDialog?.({
          title: "导出 XML",
          defaultPath: `${projectName}.xml`,
          filters: [{ name: "XML", extensions: ["xml"] }],
        });
        if (!result || result.canceled || !result.filePath) return;
        await window.creez?.writeFileAbsolute?.(result.filePath, xml);
        alert("已导出 XML：" + result.filePath);
      } catch (e) {
        console.error("导出 XML 失败", e);
        alert("导出失败：" + (e?.message || String(e)));
      }
    });
    topRow.appendChild(exportBtn);
    container.appendChild(topRow);

    const mainRow = document.createElement("div");
    mainRow.className = "scene-board-timeline-main";
    const leftCol = document.createElement("div");
    leftCol.className = "scene-board-timeline-left";
    const leftTitle = document.createElement("div");
    leftTitle.className = "scene-board-timeline-section-title";
    leftTitle.textContent = "分镜素材";
    leftCol.appendChild(leftTitle);
    const thumbGrid = document.createElement("div");
    thumbGrid.className = "scene-board-timeline-thumb-grid";
    scenes.forEach((scene, idx) => {
      const videos = scene.videos || [];
      const preferredVideo = pickPreferredResource(videos);
      const picture = scene.picture || {};
      let thumbUrl = preferredVideo?.parameters?.first_frame_image || picture?.first_frame?.[0]?.image_urls?.[0];
      if (thumbUrl) {
        thumbUrl = resolveUrl(thumbUrl);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scene-board-timeline-thumb-btn";
      btn.dataset.sceneIndex = String(idx);
      const thumbBox = document.createElement("div");
      thumbBox.className = "scene-board-timeline-thumb-box";
      if (thumbUrl) {
        const img = document.createElement("img");
        img.src = toFileSrc(thumbUrl) || thumbUrl;
        img.alt = scene.description || "镜头";
        thumbBox.appendChild(img);
      } else {
        const q = document.createElement("div");
        q.className = "scene-board-timeline-thumb-placeholder";
        q.textContent = "?";
        thumbBox.appendChild(q);
        const hint = document.createElement("div");
        hint.className = "scene-board-timeline-thumb-hint";
        hint.textContent = "分镜视频未生成";
        thumbBox.appendChild(hint);
      }
      btn.appendChild(thumbBox);
      btn.addEventListener("click", () => {
        const firstItem = timelineItems.find((it) => it.sceneIndex === idx);
        if (firstItem) {
          const i = timelineItems.indexOf(firstItem);
          currentTimeSeconds = clipStartTimes[i] ?? 0;
          updateState();
          if (firstItem.type === "video") {
            isPlaying = true;
            if (videoEl) {
              videoEl.currentTime = 0;
              videoEl.play().catch(() => {});
            }
          }
          refreshUI();
        }
      });
      thumbGrid.appendChild(btn);
    });
    leftCol.appendChild(thumbGrid);
    mainRow.appendChild(leftCol);

    const rightCol = document.createElement("div");
    rightCol.className = "scene-board-timeline-right";
    const rightTitle = document.createElement("div");
    rightTitle.className = "scene-board-timeline-section-title";
    rightTitle.textContent = "预览";
    rightCol.appendChild(rightTitle);
    const previewBox = document.createElement("div");
    previewBox.className = "scene-board-timeline-preview";
    const previewInner = document.createElement("div");
    previewInner.className = "scene-board-timeline-preview-inner";
    previewBox.appendChild(previewInner);
    const controlsRow = document.createElement("div");
    controlsRow.className = "scene-board-timeline-controls";
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "scene-board-timeline-play-btn";
    playBtn.textContent = "播放";
    const timeLabel = document.createElement("span");
    timeLabel.className = "scene-board-timeline-time";
    controlsRow.appendChild(playBtn);
    controlsRow.appendChild(timeLabel);
    previewBox.appendChild(controlsRow);
    rightCol.appendChild(previewBox);
    mainRow.appendChild(rightCol);
    container.appendChild(mainRow);

    const refreshUI = () => {
      updateState();
      previewInner.innerHTML = "";
      if (!currentItem) {
        const msg = document.createElement("div");
        msg.className = "scene-board-timeline-preview-msg";
        msg.textContent = "请选择左侧素材或下方时间线片段进行预览。";
        previewInner.appendChild(msg);
      } else if (currentItem.type === "video" && currentItem.videoUrl) {
        const src = toFileSrc(currentItem.videoUrl) || currentItem.videoUrl;
        const v = document.createElement("video");
        v.src = src;
        v.controls = true;
        v.className = "scene-board-timeline-video";
        v.addEventListener("loadeddata", () => {
          v.currentTime = offsetInClip;
          if (isPlaying) v.play().catch(() => {});
        });
        videoEl = v;
        previewInner.appendChild(v);
      } else if (currentItem.type === "image" && currentItem.imageUrl) {
        const img = document.createElement("img");
        img.src = toFileSrc(currentItem.imageUrl) || currentItem.imageUrl;
        img.alt = currentItem.label;
        img.className = "scene-board-timeline-preview-img";
        previewInner.appendChild(img);
      } else {
        const msg = document.createElement("div");
        msg.className = "scene-board-timeline-preview-msg";
        msg.textContent = "资源未生成或不可用";
        previewInner.appendChild(msg);
      }
      timeLabel.textContent = `${formatTime(currentTimeSeconds)} / ${formatTime(totalDurationSeconds)}`;
      playBtn.textContent = isPlaying ? "暂停" : "播放";
      updatePlayhead();
    };

    playBtn.addEventListener("click", () => {
      isPlaying = !isPlaying;
      if (currentItem?.type === "video" && videoEl) {
        if (isPlaying) videoEl.play().catch(() => {});
        else videoEl.pause();
      }
      refreshUI();
    });

    const trackSection = document.createElement("div");
    trackSection.className = "scene-board-timeline-track-section";
    const trackTitle = document.createElement("div");
    trackTitle.className = "scene-board-timeline-track-title";
    trackTitle.textContent = "视频轨";
    trackSection.appendChild(trackTitle);
    if (timelineItems.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "scene-board-timeline-empty";
      emptyMsg.textContent = "暂无可用片段，请先在分镜板中生成视频或关键帧图片。";
      trackSection.appendChild(emptyMsg);
    }
    const trackWrap = document.createElement("div");
    trackWrap.className = "scene-board-timeline-track-wrap";
    const trackStrip = document.createElement("div");
    trackStrip.className = "scene-board-timeline-track-strip scene-board-timeline-track-strip-relative";
    trackStrip.style.width = totalDurationSeconds * pixelsPerSecond + "px";
    trackStrip.addEventListener("click", (e) => {
      const rect = trackStrip.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const totalWidth = totalDurationSeconds * pixelsPerSecond;
      const t = Math.max(0, Math.min(totalDurationSeconds, (x / totalWidth) * totalDurationSeconds));
      currentTimeSeconds = t;
      updateState();
      if (currentItem?.type === "video" && videoEl) {
        videoEl.currentTime = offsetInClip;
      }
      refreshUI();
    });

    const ruler = document.createElement("div");
    ruler.className = "scene-board-timeline-ruler";
    ruler.style.height = RULER_HEIGHT + "px";
    ruler.style.width = totalDurationSeconds * pixelsPerSecond + "px";
    for (let i = 0; i <= Math.ceil(totalDurationSeconds); i++) {
      const tick = document.createElement("div");
      tick.className = "scene-board-timeline-ruler-tick";
      tick.style.left = i * pixelsPerSecond + "px";
      const lbl = document.createElement("span");
      lbl.className = "scene-board-timeline-ruler-label";
      lbl.textContent = formatRulerLabel(i);
      lbl.style.left = i * pixelsPerSecond + 2 + "px";
      ruler.appendChild(tick);
      ruler.appendChild(lbl);
    }
    trackStrip.appendChild(ruler);

    const clipsRow = document.createElement("div");
    clipsRow.className = "scene-board-timeline-clips";
    clipsRow.style.height = TRACK_STRIP_HEIGHT + "px";
    clipsRow.style.width = totalDurationSeconds * pixelsPerSecond + "px";
    timelineItems.forEach((item, index) => {
      const w = item.durationSeconds * pixelsPerSecond;
      const clip = document.createElement("div");
      clip.className = "scene-board-timeline-clip";
      clip.style.width = w + "px";
      clip.title = item.label;
      const thumbSrc = item.thumbUrl || item.imageUrl || item.videoUrl;
      if (thumbSrc) {
        clip.style.backgroundImage = `url(${toFileSrc(thumbSrc) || thumbSrc})`;
        clip.style.backgroundSize = `${Math.max(24, Math.min(48, w / 4))}px 100%`;
      }
      clip.addEventListener("click", (e) => {
        e.stopPropagation();
        currentTimeSeconds = clipStartTimes[index] ?? 0;
        updateState();
        refreshUI();
      });
      clipsRow.appendChild(clip);
    });
    trackStrip.appendChild(clipsRow);

    const playhead = document.createElement("div");
    playhead.className = "scene-board-timeline-playhead";
    playhead.style.left = "0px";
    const updatePlayhead = () => {
      playhead.style.left = (currentTimeSeconds * pixelsPerSecond) + "px";
    };
    trackStrip.appendChild(playhead);

    if (timelineItems.length > 0) {
      trackWrap.appendChild(trackStrip);
      trackSection.appendChild(trackWrap);
    }
    container.appendChild(trackSection);

    refreshUI();
  }

  function showAssetSelector(sceneIndex) {
    const overlay = document.createElement("div");
    overlay.className = "scene-asset-picker-overlay";
    const panel = document.createElement("div");
    panel.className = "scene-asset-picker";
    const header = document.createElement("div");
    header.className = "scene-asset-picker-header";
    header.textContent = "选择美术资产";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "scene-asset-picker-close";
    closeBtn.textContent = "×";
    const grid = document.createElement("div");
    grid.className = "scene-asset-picker-grid";
    assets.forEach((asset, idx) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "scene-asset-picker-item";
      const assetName = asset.name || `美术资产 ${idx + 1}`;
      const assetId = asset.id || "";
      item.draggable = true;
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "copy";
        draggingAssetRef = { id: assetId };
        setAssetTransfer(event.dataTransfer, assetId);
      });
      item.addEventListener("dragend", () => {
        draggingAssetRef = null;
      });
      item.addEventListener("click", () => {
        const list = Array.isArray(scenes[sceneIndex]?.active_assets) ? [...scenes[sceneIndex].active_assets] : [];
        if (assetId && !list.includes(assetId)) list.push(assetId);
        setSceneAt(sceneIndex, (scene) => ({ ...scene, active_assets: list }));
        document.body.removeChild(overlay);
      });
      const imgSrc = toFileSrc(asset.image_urls?.[0]);
      if (imgSrc) {
        const img = document.createElement("img");
        img.src = imgSrc;
        img.alt = assetName;
        item.appendChild(img);
      }
      const label = document.createElement("span");
      label.textContent = assetName;
      item.appendChild(label);
      grid.appendChild(item);
    });
    if (!assets.length) {
      const empty = document.createElement("div");
      empty.className = "scene-asset-picker-empty";
      empty.textContent = "暂无美术资产";
      grid.appendChild(empty);
    }
    closeBtn.addEventListener("click", () => document.body.removeChild(overlay));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) document.body.removeChild(overlay);
    });
    header.appendChild(closeBtn);
    panel.appendChild(header);
    panel.appendChild(grid);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }
}
