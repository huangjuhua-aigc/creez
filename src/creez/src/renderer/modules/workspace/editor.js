export function isTabDirty(tab) {
  return tab.data.isEditable && tab.draft !== tab.savedContent;
}

export function renderTabs({
  tabsContainer,
  openTabs,
  activeTabPath,
  activateTab,
  closeTab,
  reorderTabs,
  isTabDirtyFn = isTabDirty,
}) {
  tabsContainer.innerHTML = "";
  openTabs.forEach((tab, index) => {
    const tabEl = document.createElement("div");
    tabEl.className = "tab" + (tab.path === activeTabPath ? " active" : "");
    tabEl.draggable = true;
    tabEl.dataset.index = String(index);

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.name;
    tabEl.appendChild(label);

    if (isTabDirtyFn(tab)) {
      const dot = document.createElement("span");
      dot.className = "tab-dirty";
      dot.title = "已修改";
      tabEl.appendChild(dot);
    }

    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.path);
    });

    tabEl.appendChild(close);
    tabEl.addEventListener("click", () => activateTab(tab.path));
    tabEl.addEventListener("dragstart", (event) => {
      tabEl.classList.add("dragging");
      event.dataTransfer.setData("text/plain", String(index));
    });
    tabEl.addEventListener("dragend", () => {
      tabEl.classList.remove("dragging");
    });
    tabEl.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    tabEl.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromIndex = Number(event.dataTransfer.getData("text/plain"));
      if (!Number.isNaN(fromIndex)) {
        reorderTabs(fromIndex, index);
      }
    });
    tabsContainer.appendChild(tabEl);
  });
}

export function reorderTabs(openTabs, fromIndex, toIndex) {
  if (fromIndex === toIndex) return openTabs;
  const next = [...openTabs];
  const moved = next.splice(fromIndex, 1)[0];
  next.splice(toIndex, 0, moved);
  return next;
}

export async function closeTab({
  filePath,
  openTabs,
  activeTabPath,
  currentConfig,
  creez,
  isTabDirtyFn = isTabDirty,
}) {
  const tab = openTabs.find((t) => t.path === filePath);
  if (tab && isTabDirtyFn(tab)) {
    const choice = await creez.showSaveConfirm("当前文件已修改，是否保存？");
    if (choice === 2) {
      return { openTabs, activeTabPath, cancelled: true };
    }
    if (choice === 0) {
      await creez.writeFile(tab.path, tab.draft || "", currentConfig.workDir);
      tab.savedContent = tab.draft;
    }
  }
  const nextTabs = openTabs.filter((t) => t.path !== filePath);
  const nextActive = activeTabPath === filePath ? (nextTabs.length ? nextTabs[0].path : null) : activeTabPath;
  return { openTabs: nextTabs, activeTabPath: nextActive, cancelled: false };
}

export function renderEditor({
  editorContent,
  openTabs,
  activeTabPath,
  renderTabs,
  renderEditor,
  renderSceneBoardEditor,
  onSceneBoardSave = null,
}) {
  const tab = openTabs.find((item) => item.path === activeTabPath);
  editorContent.innerHTML = "";

  if (!tab) {
    editorContent.innerHTML = '<div class="empty-state">请选择左侧文件进行查看或编辑。</div>';
    return;
  }

  if (tab.data.kind === "text") {
    const ext = tab.path.toLowerCase();
    if (ext.endsWith(".scene_board")) {
      const editor = renderSceneBoardEditor(tab, () => {
        renderTabs();
        renderEditor();
      }, undefined, onSceneBoardSave);
      editorContent.appendChild(editor);
      const tableWrap = editor.querySelector(".scene-board-table-wrap");
      if (tableWrap) {
        if (typeof tab.sceneBoardScrollLeft === "number") {
          requestAnimationFrame(() => {
            tableWrap.scrollLeft = tab.sceneBoardScrollLeft;
          });
        }
        tableWrap.addEventListener("scroll", () => {
          tab.sceneBoardScrollLeft = tableWrap.scrollLeft;
        });
      }
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "editor-text-wrap";

    const gutter = document.createElement("div");
    gutter.className = "editor-gutter";
    gutter.setAttribute("aria-hidden", "true");

    const textarea = document.createElement("textarea");
    textarea.className = "editor-textarea";
    textarea.value = tab.draft ?? "";
    textarea.spellcheck = false;

    function updateGutter() {
      const lineCount = Math.max(1, (textarea.value || "").split("\n").length);
      gutter.innerHTML = "";
      for (let i = 1; i <= lineCount; i++) {
        const line = document.createElement("div");
        line.className = "editor-gutter-line";
        line.textContent = i;
        gutter.appendChild(line);
      }
      const h = textarea.scrollHeight;
      gutter.style.minHeight = h + "px";
      textarea.style.height = h + "px";
    }

    updateGutter();
    requestAnimationFrame(() => updateGutter());
    textarea.addEventListener("input", () => {
      tab.draft = textarea.value;
      renderTabs();
      updateGutter();
    });

    wrap.appendChild(gutter);
    wrap.appendChild(textarea);
    editorContent.appendChild(wrap);
    return;
  }

  if (tab.data.kind === "html") {
    const frame = document.createElement("div");
    frame.className = "preview-frame";
    frame.innerHTML = tab.data.content || "<p>无内容</p>";
    editorContent.appendChild(frame);
    return;
  }

  if (tab.data.kind === "pdf") {
    const wrap = document.createElement("div");
    wrap.className = "file-preview-center";
    const embed = document.createElement("embed");
    embed.className = "file-preview";
    embed.src = tab.data.fileUrl;
    embed.type = "application/pdf";
    wrap.appendChild(embed);
    editorContent.appendChild(wrap);
    return;
  }

  if (tab.data.kind === "image") {
    const wrap = document.createElement("div");
    wrap.className = "file-preview-center";
    const img = document.createElement("img");
    img.src = tab.data.fileUrl;
    img.className = "file-preview-img";
    wrap.appendChild(img);
    editorContent.appendChild(wrap);
    return;
  }

  if (tab.data.kind === "audio") {
    const wrap = document.createElement("div");
    wrap.className = "file-preview-center";
    const audio = document.createElement("audio");
    audio.src = tab.data.fileUrl;
    audio.controls = true;
    audio.style.width = "100%";
    wrap.appendChild(audio);
    editorContent.appendChild(wrap);
    return;
  }

  if (tab.data.kind === "video") {
    const wrap = document.createElement("div");
    wrap.className = "file-preview-center";
    const video = document.createElement("video");
    video.src = tab.data.fileUrl;
    video.controls = true;
    video.className = "file-preview-video";
    wrap.appendChild(video);
    editorContent.appendChild(wrap);
    return;
  }

  const info = document.createElement("div");
  info.className = "binary-info";
  info.textContent = `该文件为二进制格式（${tab.data.extension || "unknown"}），大小 ${
    tab.data.size || "-"
  } 字节，暂不支持预览。`;
  editorContent.appendChild(info);
}
