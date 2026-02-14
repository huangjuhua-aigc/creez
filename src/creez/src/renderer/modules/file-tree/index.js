export function createFileTreeModule({
  fileTreeContainer,
  contextMenu,
  getTreeQuery,
  getTreeData,
  getCurrentConfig,
  getFileIcon,
  joinPath,
  pathSeparator,
  windowCreez,
  defaultSceneBoardJson,
  openFile,
  setActiveTreeItem,
  refreshFileTree,
}) {
  let collapsedDirs = new Set();
  let initialCollapseDone = false;
  let inlineCreateState = null;
  let inlineRenameState = null;

  function ensureDefaultCollapsed(node) {
    if (initialCollapseDone || !node) return;
    function addAllDirs(n) {
      if (!n) return;
      if (n.type === "dir") collapsedDirs.add(n.path);
      (n.children || []).forEach(addAllDirs);
    }
    addAllDirs(node);
    initialCollapseDone = true;
  }

  function renderTree(node, container) {
    if (!node) return;
    ensureDefaultCollapsed(node);
    const filtered = filterTree(node, getTreeQuery());
    if (!filtered) {
      container.innerHTML = '<div class="empty-state">未找到匹配文件。</div>';
      return;
    }
    const root = document.createElement("div");
    root.className = "tree-root";
    filtered.children?.forEach((child) => {
      root.appendChild(renderTreeItem(child, filtered.path));
    });
    if (inlineCreateState && inlineCreateState.parentPath === filtered.path) {
      root.appendChild(createInlineCreateRow(inlineCreateState.parentPath, inlineCreateState.type));
    }
    container.appendChild(root);
  }

  function filterTree(node, query) {
    if (!query) return node;
    const lowered = query.toLowerCase();
    if (node.type === "file") {
      return node.name.toLowerCase().includes(lowered) ? node : null;
    }
    const children = (node.children || [])
      .map((child) => filterTree(child, query))
      .filter(Boolean);
    if (node.name.toLowerCase().includes(lowered) || children.length > 0) {
      return { ...node, children };
    }
    return null;
  }

  function renderTreeItem(node) {
    const item = document.createElement("div");
    item.className = "tree-item";
    if (node.type === "dir") item.classList.add("tree-folder");
    item.dataset.path = node.path;
    item.dataset.type = node.type;
    item.draggable = node.type === "file";

    if (node.type === "dir") {
      const caret = document.createElement("span");
      caret.className = "tree-caret" + (collapsedDirs.has(node.path) ? " collapsed" : "");
      caret.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleDirectory(node.path);
      });
      item.appendChild(caret);
      const folderIcon = document.createElement("span");
      folderIcon.className = "codicon codicon-folder tree-file-icon";
      folderIcon.setAttribute("aria-hidden", "true");
      item.appendChild(folderIcon);
    }

    if (node.type === "file") {
      const icon = getFileIcon(node.path);
      const iconEl = document.createElement("span");
      if (icon.type === "emoji") {
        iconEl.className = "tree-file-icon tree-file-icon-emoji";
        iconEl.textContent = icon.char;
      } else {
        iconEl.className = `codicon ${icon.class} tree-file-icon`;
        iconEl.setAttribute("aria-hidden", "true");
      }
      item.appendChild(iconEl);
    }

    const isRenameTarget = inlineRenameState && inlineRenameState.path === node.path;
    if (isRenameTarget) {
      item.classList.add("tree-inline-rename");
      const field = document.createElement("div");
      field.className = "tree-inline-name-field";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tree-inline-rename-input";
      input.value = node.name;
      input.setAttribute("data-inline-rename", "true");
      const errorText = document.createElement("div");
      errorText.className = "tree-inline-name-error hidden";
      field.appendChild(input);
      field.appendChild(errorText);
      item.appendChild(field);
      const parentDir = node.path.split(/[/\\\\]/).slice(0, -1).join(pathSeparator());
      let renaming = false;
      const finish = (submit) => {
        if (renaming) return;
        if (!submit) {
          renaming = true;
          inlineRenameState = null;
          fileTreeContainer.innerHTML = "";
          renderTree(getTreeData(), fileTreeContainer);
          return;
        }
        const newName = input.value.trim();
        if (!newName) {
          showInlineNameError(errorText, null);
          input.focus();
          return;
        }
        const newPath = joinPath(parentDir, newName);
        if (newPath === node.path) {
          renaming = true;
          inlineRenameState = null;
          fileTreeContainer.innerHTML = "";
          renderTree(getTreeData(), fileTreeContainer);
          return;
        }
        renaming = true;
        windowCreez.pathExists(newPath, getCurrentConfig()?.workDir, node.path).then((exists) => {
          if (exists) {
            renaming = false;
            showInlineNameError(errorText, newName);
            input.focus();
            return;
          }
          windowCreez.renamePath(node.path, newPath, getCurrentConfig().workDir).then(() => {
            inlineRenameState = null;
            refreshFileTree();
          }).catch(() => {
            renaming = false;
          });
        }).catch(() => {
          renaming = false;
        });
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      });
      input.addEventListener("input", () => clearInlineNameError(errorText));
      input.addEventListener("blur", () => finish(input.value.trim() !== "" && input.value.trim() !== node.name));
      input.addEventListener("click", (e) => e.stopPropagation());
      requestAnimationFrame(() => {
        input.select();
        input.focus();
      });
    } else {
      const label = document.createElement("span");
      label.textContent = node.name;
      item.appendChild(label);
    }

    item.addEventListener("click", (event) => {
      event.stopPropagation();
      if (inlineRenameState && inlineRenameState.path === node.path) return;
      setActiveTreeItem(node.path);
      if (node.type === "file") {
        openFile(node.path);
      } else {
        toggleDirectory(node.path);
      }
    });

    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, node.path, node.type === "dir" ? "dir" : "file");
    });

    item.addEventListener("dragstart", (event) => {
      if (node.type === "file") {
        event.dataTransfer.setData("text/plain", node.path);
      }
    });

    if (node.type === "dir" && node.children && node.children.length > 0) {
      const children = document.createElement("div");
      children.className = "tree-children";
      if (!collapsedDirs.has(node.path)) {
        if (inlineCreateState && inlineCreateState.parentPath === node.path) {
          children.appendChild(createInlineCreateRow(inlineCreateState.parentPath, inlineCreateState.type));
        }
        node.children.forEach((child) => {
          children.appendChild(renderTreeItem(child, node.path));
        });
      }
      const wrapper = document.createElement("div");
      wrapper.appendChild(item);
      wrapper.appendChild(children);
      return wrapper;
    }
    if (node.type === "dir" && inlineCreateState && inlineCreateState.parentPath === node.path) {
      collapsedDirs.delete(node.path);
      const children = document.createElement("div");
      children.className = "tree-children";
      children.appendChild(createInlineCreateRow(inlineCreateState.parentPath, inlineCreateState.type));
      node.children?.forEach((child) => {
        children.appendChild(renderTreeItem(child, node.path));
      });
      const wrapper = document.createElement("div");
      wrapper.appendChild(item);
      wrapper.appendChild(children);
      return wrapper;
    }

    return item;
  }

  function createInlineCreateRow(parentPath, type) {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-item tree-inline-create";
    const field = document.createElement("div");
    field.className = "tree-inline-name-field";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tree-inline-create-input";
    input.placeholder = type === "scene_board" ? "分镜板名称" : type === "folder" ? "新建文件夹" : "新建文件";
    const errorText = document.createElement("div");
    errorText.className = "tree-inline-name-error hidden";
    field.appendChild(input);
    field.appendChild(errorText);
    wrapper.appendChild(field);

    const finish = (submit) => {
      if (!submit) {
        inlineCreateState = null;
        fileTreeContainer.innerHTML = "";
        renderTree(getTreeData(), fileTreeContainer);
        return;
      }
      const name = input.value.trim();
      if (!name) {
        showInlineNameError(errorText, null);
        input.focus();
        return;
      }
      const targetPath =
        type === "scene_board"
          ? joinPath(parentPath, name.endsWith(".scene_board") ? name : name + ".scene_board")
          : joinPath(parentPath, name);
      windowCreez.pathExists(targetPath, getCurrentConfig()?.workDir).then((exists) => {
        if (exists) {
          showInlineNameError(errorText, targetPath.split(/[/\\\\]/).pop());
          input.focus();
          return;
        }
        if (type === "folder") {
          windowCreez.createFolder(targetPath, getCurrentConfig().workDir).then(() => {
            inlineCreateState = null;
            refreshFileTree();
          });
        } else if (type === "scene_board") {
          windowCreez
            .createFile(targetPath, getCurrentConfig().workDir)
            .then(() => windowCreez.writeFile(targetPath, defaultSceneBoardJson, getCurrentConfig().workDir))
            .then(() => {
              inlineCreateState = null;
              refreshFileTree();
            });
        } else {
          windowCreez.createFile(targetPath, getCurrentConfig().workDir).then(() => {
            inlineCreateState = null;
            refreshFileTree();
          });
        }
      });
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("input", () => clearInlineNameError(errorText));
    input.addEventListener("blur", () => finish(input.value.trim() !== ""));
    requestAnimationFrame(() => input.focus());
    return wrapper;
  }

  function clearInlineNameError(errorEl) {
    if (!errorEl) return;
    errorEl.classList.add("hidden");
    errorEl.innerHTML = "";
  }

  function showInlineNameError(errorEl, conflictingName) {
    if (!errorEl) return;
    errorEl.innerHTML = "";
    if (conflictingName != null && conflictingName !== "") {
      errorEl.appendChild(document.createTextNode("A file or folder "));
      const strong = document.createElement("strong");
      strong.textContent = conflictingName;
      errorEl.appendChild(strong);
      errorEl.appendChild(
        document.createTextNode(" already exists at this location. Please choose a different name.")
      );
    } else {
      errorEl.textContent = "请输入文件名。";
    }
    errorEl.classList.remove("hidden");
  }

  function startInlineCreate(type) {
    if (!getCurrentConfig()?.workDir) return;
    const targetPath = contextMenu.dataset.path;
    const targetType = contextMenu.dataset.type;
    const baseDir =
      targetType === "dir" || targetType === "blank"
        ? targetPath || getCurrentConfig().workDir
        : targetPath.split(/[/\\\\]/).slice(0, -1).join(pathSeparator());
    if (targetType === "dir") collapsedDirs.delete(targetPath);
    inlineCreateState = { parentPath: baseDir, type };
    inlineRenameState = null;
    fileTreeContainer.innerHTML = "";
    renderTree(getTreeData(), fileTreeContainer);
  }

  function startInlineRename(path) {
    if (!getCurrentConfig()?.workDir || !path) return;
    inlineCreateState = null;
    inlineRenameState = { path };
    fileTreeContainer.innerHTML = "";
    renderTree(getTreeData(), fileTreeContainer);
    requestAnimationFrame(() => {
      const input = fileTreeContainer.querySelector("[data-inline-rename]");
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function toggleDirectory(path) {
    if (collapsedDirs.has(path)) {
      collapsedDirs.delete(path);
    } else {
      collapsedDirs.add(path);
    }
    fileTreeContainer.innerHTML = "";
    renderTree(getTreeData(), fileTreeContainer);
  }

  function showContextMenu(x, y, targetPath, targetType) {
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.dataset.path = targetPath || "";
    contextMenu.dataset.type = targetType || "file";
    contextMenu.querySelectorAll("[data-show-for]").forEach((el) => {
      const showFor = (el.getAttribute("data-show-for") || "").trim().split(/\s+/);
      el.classList.toggle("context-menu-hidden", !showFor.includes(targetType));
    });
    contextMenu.classList.remove("hidden");
  }

  function hideContextMenu() {
    contextMenu.classList.add("hidden");
  }

  return {
    renderTree,
    startInlineCreate,
    startInlineRename,
    showContextMenu,
    hideContextMenu,
    toggleDirectory,
  };
}
