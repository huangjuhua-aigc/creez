export function mountModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove("hidden");
}

export function unmountModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
}

export function showPrompt({ title, defaultValue = "" }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("prompt-modal");
    const titleEl = document.getElementById("prompt-modal-title");
    const inputEl = document.getElementById("prompt-modal-input");
    const okBtn = document.getElementById("prompt-modal-ok");
    const cancelBtn = document.getElementById("prompt-modal-cancel");
    const errorEl = document.getElementById("prompt-modal-error");
    const card = modal?.querySelector(".prompt-modal-card");
    if (!modal || !titleEl || !inputEl || !okBtn || !cancelBtn) {
      resolve(null);
      return;
    }

    titleEl.textContent = title || "输入";
    inputEl.value = defaultValue;
    errorEl?.classList.add("hidden");
    card?.classList.remove("has-error");
    mountModal(modal);
    inputEl.focus();
    inputEl.select();

    const finish = (value) => {
      unmountModal(modal);
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      inputEl.removeEventListener("keydown", onKey);
      resolve(value);
    };

    const onOk = () => finish(inputEl.value.trim());
    const onCancel = () => finish(null);
    const onKey = (e) => {
      if (e.key === "Enter") onOk();
      else if (e.key === "Escape") onCancel();
    };

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    inputEl.addEventListener("keydown", onKey);
  });
}

export function showPromptWithDuplicateCheck({
  title,
  defaultValue,
  getTargetPath,
  excludePath = null,
  pathExists,
}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("prompt-modal");
    const titleEl = document.getElementById("prompt-modal-title");
    const inputEl = document.getElementById("prompt-modal-input");
    const okBtn = document.getElementById("prompt-modal-ok");
    const cancelBtn = document.getElementById("prompt-modal-cancel");
    const errorEl = document.getElementById("prompt-modal-error");
    const errorNameEl = document.getElementById("prompt-modal-error-name");
    const card = modal?.querySelector(".prompt-modal-card");
    if (!modal || !titleEl || !inputEl || !okBtn || !cancelBtn) {
      resolve(null);
      return;
    }

    const hideError = () => {
      errorEl?.classList.add("hidden");
      card?.classList.remove("has-error");
    };
    const showError = (name) => {
      if (errorNameEl) errorNameEl.textContent = name || "";
      errorEl?.classList.remove("hidden");
      card?.classList.add("has-error");
    };
    const finish = (value) => {
      unmountModal(modal);
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      inputEl.removeEventListener("keydown", onKey);
      resolve(value);
    };

    titleEl.textContent = title || "输入";
    inputEl.value = defaultValue;
    hideError();
    mountModal(modal);
    inputEl.focus();
    inputEl.select();

    const onOk = async () => {
      const value = inputEl.value.trim();
      if (!value) {
        finish(null);
        return;
      }
      const targetPath = getTargetPath(value);
      if (!targetPath) {
        finish(value);
        return;
      }
      const exists = await pathExists(targetPath);
      const isExcluded = excludePath && targetPath === excludePath;
      if (exists && !isExcluded) {
        const name = targetPath.split(/[/\\\\]/).pop() || value;
        showError(name);
        inputEl.focus();
      } else {
        finish(value);
      }
    };
    const onCancel = () => finish(null);
    const onKey = (e) => {
      if (e.key === "Enter") onOk();
      else if (e.key === "Escape") onCancel();
    };

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    inputEl.addEventListener("keydown", onKey);
  });
}

export function showConfirm({ message }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    const messageEl = document.getElementById("confirm-modal-message");
    const okBtn = document.getElementById("confirm-modal-ok");
    const cancelBtn = document.getElementById("confirm-modal-cancel");
    if (!modal || !messageEl || !okBtn || !cancelBtn) {
      resolve(false);
      return;
    }

    messageEl.textContent = message || "确认吗？";
    mountModal(modal);

    const finish = (result) => {
      unmountModal(modal);
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };

    const onOk = () => finish(true);
    const onCancel = () => finish(false);

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}
