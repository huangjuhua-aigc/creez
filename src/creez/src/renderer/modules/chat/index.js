const EXT_TO_LABEL = { ts: "TS", tsx: "TSX", js: "JS", jsx: "JSX", json: "JSON", md: "MD", css: "CSS", html: "HTML", vue: "VUE", py: "PY" };

export function createChatModule({
  chatMessages,
  chatInputArea,
  chatAttachmentsEl,
  chatUploadImage,
  chatUploadVideo,
  btnUploadImage,
  btnUploadVideo,
  chatInputWrap,
  sendMessageButton,
  mentionDropdown,
  renderMarkdownToSafeHtml,
  getWorkspaceFiles,
  getRecentFiles,
  listSkillNames,
  onSendMessage,
}) {
  let attachments = [];
  let dropdownItems = [];
  let dropdownVisible = false;
  let dropdownSelectedIndex = 0;
  let dropdownMode = null;

  function appendMessage(text, type = "assistant") {
    const msg = document.createElement("div");
    msg.className = `chat-message ${type}`;
    if (text != null && String(text).trim() !== "") {
      const contentWrap = document.createElement("div");
      contentWrap.className = "chat-message-content";
      contentWrap.innerHTML = renderMarkdownToSafeHtml(String(text));
      msg.appendChild(contentWrap);
    }
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msg;
  }

  function getFileTypeLabel(filePath) {
    const ext = (filePath.split(/[/\\\\]/).pop() || "").split(".").pop()?.toLowerCase() || "";
    return EXT_TO_LABEL[ext] || ext.toUpperCase().slice(0, 2) || "FILE";
  }

  function createMentionChip(filePath) {
    const chip = document.createElement("span");
    chip.className = "mention-chip";
    chip.contentEditable = "false";
    chip.dataset.path = filePath;
    const name = filePath.split(/[/\\\\]/).pop() || "";
    const displayName = name.length > 10 ? name.slice(0, 10) + "…" : name;
    const label = document.createElement("span");
    label.className = "mention-chip-type";
    label.textContent = getFileTypeLabel(filePath);
    const nameSpan = document.createElement("span");
    nameSpan.className = "mention-chip-name";
    nameSpan.textContent = displayName;
    nameSpan.title = name;
    chip.appendChild(label);
    chip.appendChild(nameSpan);
    return chip;
  }

  function insertChipAtCaret(filePath) {
    if (!chatInputArea) return;
    const chip = createMentionChip(filePath);
    const sel = window.getSelection();
    const range = sel?.getRangeAt(0);
    const zwsp = document.createTextNode("\u200B");

    if (range && chatInputArea.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(chip);
      range.collapse(false);
      range.insertNode(zwsp);
      range.setStartAfter(zwsp);
      range.setEndAfter(zwsp);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      chatInputArea.appendChild(chip);
      chatInputArea.appendChild(zwsp);
      const r = document.createRange();
      r.setStart(zwsp, 1);
      r.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    updateSendButtonState();
    updatePlaceholderVisibility();
  }

  function getInputText() {
    return chatInputArea?.innerText?.replace(/\u200B/g, "") || "";
  }

  function getInputContent() {
    let text = "";
    const paths = [];
    if (!chatInputArea) return { text: "", paths: [] };
    chatInputArea.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent.replace(/\u200B/g, "");
      } else if (node.classList?.contains("mention-chip")) {
        paths.push(node.dataset.path || "");
      }
    });
    return { text: text.trim(), paths: paths.filter(Boolean) };
  }

  function removeChip(chipEl) {
    if (!chipEl) return;
    const next = chipEl.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE && next.textContent === "\u200B") next.remove();
    chipEl.remove();
    updateSendButtonState();
    updatePlaceholderVisibility();
  }

  function renderAttachments() {
    if (!chatAttachmentsEl) return;
    chatAttachmentsEl.innerHTML = "";
    attachments.forEach((att, index) => {
      const wrap = document.createElement("div");
      wrap.className = "chat-attachment-item";
      if (att.type === "image") {
        const img = document.createElement("img");
        img.src = att.dataUrl;
        img.alt = "附件";
        wrap.appendChild(img);
      } else {
        const video = document.createElement("video");
        video.src = att.dataUrl;
        video.controls = true;
        video.playsInline = true;
        video.muted = true;
        video.preload = "metadata";
        wrap.classList.add("chat-attachment-item--video");
        wrap.appendChild(video);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-attachment-remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => removeAttachment(index));
      wrap.appendChild(remove);
      chatAttachmentsEl.appendChild(wrap);
    });
    updateSendButtonState();
  }

  function addAttachment(type, dataUrl) {
    attachments.push({ type, dataUrl });
    renderAttachments();
  }

  function removeAttachment(index) {
    attachments.splice(index, 1);
    renderAttachments();
  }

  function updateSendButtonState() {
    if (!sendMessageButton) return;
    const { text, paths } = getInputContent();
    const hasText = text.length > 0;
    const hasAttachments = attachments.length > 0;
    const hasMentions = paths.length > 0;
    sendMessageButton.classList.toggle("send-disabled", !hasText && !hasAttachments && !hasMentions);
  }

  function hideDropdown() {
    mentionDropdown?.classList.add("hidden");
    dropdownVisible = false;
    dropdownItems = [];
    dropdownMode = null;
    dropdownSelectedIndex = 0;
  }

  function updateDropdownSelection() {
    mentionDropdown?.querySelectorAll(".mention-item").forEach((el, i) => {
      el.classList.toggle("selected", i === dropdownSelectedIndex);
    });
  }

  function removeTrailingAtQuery() {
    if (!chatInputArea) return;
    chatInputArea.focus();
    const text = getInputText();
    const match = text.match(/@[\w\-.\s]*$/);
    if (!match) return;
    const toDelete = match[0].length;
    const textNodes = [];
    chatInputArea.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) textNodes.push(node);
    });
    let totalChars = 0;
    textNodes.forEach((n) => { totalChars += n.textContent.length; });
    let charIndex = 0;
    let startPos = null;
    let endPos = null;
    for (const node of textNodes) {
      const len = node.textContent.length;
      if (!startPos && charIndex + len > totalChars - toDelete) {
        startPos = { node, offset: totalChars - toDelete - charIndex };
      }
      if (!endPos && charIndex + len >= totalChars) {
        endPos = { node, offset: totalChars - charIndex };
        break;
      }
      charIndex += len;
    }
    if (!startPos || !endPos) return;
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    range.deleteContents();
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function applySkillNameAtTail(name) {
    const text = getInputText();
    const match = text.match(/\/skill:[\w\-]*$/);
    if (!match || !chatInputArea) return;
    chatInputArea.focus();
    for (let i = 0; i < match[0].length; i += 1) {
      document.execCommand("deleteContentBackward", false);
    }
    document.execCommand("insertText", false, `/skill:${name}`);
  }

  async function showSkillDropdown(query) {
    if (!mentionDropdown || typeof listSkillNames !== "function") return;
    const names = await listSkillNames(query);
    mentionDropdown.innerHTML = "";
    dropdownMode = "skill";
    dropdownItems = names.map((name) => ({ kind: "skill", value: name, label: `/skill:${name}` }));
    dropdownItems.forEach((item) => {
      const el = document.createElement("div");
      el.className = "mention-item";
      el.textContent = item.label;
      el.addEventListener("click", () => {
        applySkillNameAtTail(item.value);
        hideDropdown();
        updatePlaceholderVisibility();
      });
      mentionDropdown.appendChild(el);
    });
    mentionDropdown.classList.toggle("hidden", dropdownItems.length === 0);
    dropdownVisible = dropdownItems.length > 0;
    dropdownSelectedIndex = 0;
    updateDropdownSelection();
  }

  function showMentionDropdown(query) {
    if (!mentionDropdown) return;
    mentionDropdown.innerHTML = "";
    const normalized = query.toLowerCase();
    const recentPaths = (getRecentFiles?.() || []).filter((path) =>
      path.split(/[/\\\\]/).pop().toLowerCase().includes(normalized)
    );
    const allPaths = (getWorkspaceFiles?.() || [])
      .filter((item) => item.name.toLowerCase().includes(normalized))
      .map((item) => item.path)
      .slice(0, 20);

    const pathSet = new Set([...recentPaths, ...allPaths]);
    dropdownMode = "mention";
    dropdownItems = [...pathSet].map((filePath) => ({ kind: "mention", value: filePath, label: filePath.split(/[/\\\\]/).pop().replace(/^@/, "") }));
    dropdownItems.forEach((item) => {
      const el = document.createElement("div");
      el.className = "mention-item";
      el.textContent = item.label;
      el.addEventListener("click", () => {
        chatInputArea?.focus();
        removeTrailingAtQuery();
        insertChipAtCaret(item.value);
        hideDropdown();
        updatePlaceholderVisibility();
      });
      mentionDropdown.appendChild(el);
    });

    mentionDropdown.classList.toggle("hidden", dropdownItems.length === 0);
    dropdownVisible = dropdownItems.length > 0;
    dropdownSelectedIndex = 0;
    updateDropdownSelection();
  }

  async function handleInput() {
    const value = getInputText();
    const skillMatch = value.match(/\/skill:([\w\-]*)$/);
    if (skillMatch && typeof listSkillNames === "function") {
      await showSkillDropdown(skillMatch[1] || "");
      updateSendButtonState();
      resizeInput();
      updatePlaceholderVisibility();
      return;
    }
    const match = value.match(/@([\w\-.\s]*)$/);
    if (match) showMentionDropdown(match[1] || "");
    else hideDropdown();
    updateSendButtonState();
    resizeInput();
    updatePlaceholderVisibility();
  }

  function selectDropdownByIndex() {
    const item = dropdownItems[dropdownSelectedIndex];
    if (!item) return;
    if (item.kind === "mention") {
      chatInputArea?.focus();
      removeTrailingAtQuery();
      insertChipAtCaret(item.value);
      hideDropdown();
      return;
    }
    if (item.kind === "skill") {
      applySkillNameAtTail(item.value);
      hideDropdown();
    }
  }

  function buildUserMessage(text, paths = []) {
    const mentionText = paths.length ? `\n引用文件: ${paths.join(", ")}` : "";
    return `${(text || "").trim()}${mentionText}`.trim();
  }

  function resizeInput() {
    if (!chatInputArea) return;
    chatInputArea.style.height = "auto";
    chatInputArea.style.height = chatInputArea.scrollHeight + "px";
  }

  function updatePlaceholderVisibility() {
    const { text, paths } = getInputContent();
    const hasContent = text.length > 0 || paths.length > 0;
    chatInputArea?.classList.toggle("has-content", hasContent);
  }

  function addFilesAsAttachments(files, type) {
    Array.from(files || []).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") addAttachment(type, reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function sendFromInput() {
    const { text, paths } = getInputContent();
    const hasAttachments = attachments.length > 0;
    if (!text && !hasAttachments && paths.length === 0) return;
    const finalMessage = buildUserMessage(text, paths);
    const attachmentsToSend = [...attachments];
    appendMessage(finalMessage, "user");
    if (attachmentsToSend.length > 0) {
      const preview = document.createElement("div");
      preview.className = "chat-message-attachments";
      attachmentsToSend.forEach((att) => {
        if (att.type === "image") {
          const img = document.createElement("img");
          img.src = att.dataUrl;
          img.style.maxWidth = "120px";
          img.style.maxHeight = "80px";
          img.style.borderRadius = "8px";
          preview.appendChild(img);
        } else if (att.type === "video") {
          const video = document.createElement("video");
          video.src = att.dataUrl;
          video.controls = true;
          video.playsInline = true;
          video.preload = "metadata";
          video.className = "chat-message-video";
          preview.appendChild(video);
        }
      });
      chatMessages.lastElementChild?.appendChild(preview);
    }
    if (chatInputArea) chatInputArea.innerHTML = "";
    attachments = [];
    renderAttachments();
    updatePlaceholderVisibility();
    onSendMessage?.(finalMessage, attachmentsToSend);
  }

  function bindEvents() {
    sendMessageButton?.addEventListener("click", sendFromInput);

    chatInputArea?.addEventListener("input", () => {
      handleInput();
    });

    chatInputArea?.addEventListener("keydown", (event) => {
      if (dropdownVisible) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          dropdownSelectedIndex = Math.min(dropdownSelectedIndex + 1, dropdownItems.length - 1);
          updateDropdownSelection();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          dropdownSelectedIndex = Math.max(dropdownSelectedIndex - 1, 0);
          updateDropdownSelection();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          selectDropdownByIndex();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          hideDropdown();
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendFromInput();
        return;
      }
      if (event.key === "Backspace") {
        const sel = window.getSelection();
        if (!sel.rangeCount || !chatInputArea) return;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) return;
        let chip = null;
        if (range.startContainer === chatInputArea && range.startOffset > 0) {
          chip = chatInputArea.childNodes[range.startOffset - 1];
        } else if (range.startOffset === 0) {
          const prev = range.startContainer.parentNode === chatInputArea
            ? range.startContainer.previousSibling
            : range.startContainer.parentNode?.previousSibling;
          chip = prev;
        }
        if (chip?.classList?.contains("mention-chip")) {
          event.preventDefault();
          removeChip(chip);
        }
      }
    });

    chatInputArea?.addEventListener("paste", (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.indexOf("image") !== 0) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") addAttachment("image", reader.result);
        };
        reader.readAsDataURL(file);
        break;
      }
    });

    btnUploadImage?.addEventListener("click", () => chatUploadImage?.click());
    btnUploadVideo?.addEventListener("click", () => chatUploadVideo?.click());

    chatUploadImage?.addEventListener("change", (event) => {
      addFilesAsAttachments(event.target.files, "image");
      event.target.value = "";
    });

    chatUploadVideo?.addEventListener("change", (event) => {
      addFilesAsAttachments(event.target.files, "video");
      event.target.value = "";
    });

    chatMessages?.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    chatMessages?.addEventListener("drop", (event) => {
      event.preventDefault();
      const filePath = event.dataTransfer.getData("text/plain");
      if (filePath) {
        chatInputArea?.focus();
        insertChipAtCaret(filePath);
      }
    });

    if (chatInputWrap) {
      chatInputWrap.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      chatInputWrap.addEventListener("drop", (event) => {
        event.preventDefault();
        const filePath = event.dataTransfer.getData("text/plain");
        if (filePath) {
          chatInputArea?.focus();
          insertChipAtCaret(filePath);
        }
      });
    }

    chatInputArea?.addEventListener("dragover", (event) => {
      event.preventDefault();
    });

    mentionDropdown?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
  }

  return {
    init() {
      bindEvents();
      updateSendButtonState();
      resizeInput();
    },
    appendMessage,
    hideDropdown,
  };
}
