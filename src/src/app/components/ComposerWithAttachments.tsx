/**
 * 与对话输入框一致的 contenteditable + 附件内联展示，可复用。
 * 对话 (ChatWindow) 与 Sceneboard 共用此组件，保证行为一致。
 */
import React, { useCallback, useImperativeHandle, useRef, useState } from "react";
import { formatFileSize, fileExtLabel } from "../../utils/fileDisplay";
import { cn } from "../../utils/cn";

export type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

export type ComposerWithAttachmentsRef = {
  clear: () => void;
  getContent: () => string;
  getPendingAttachments: () => PendingAttachment[];
  appendFiles: (files: File[]) => void;
};

function getFileSignature(file: File): string {
  return `${file.name}__${file.size}__${file.lastModified}__${file.type}`;
}

function createAttachment(file: File): PendingAttachment {
  const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
  return {
    id: `${getFileSignature(file)}__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl,
  };
}

const ComposerEditor = React.memo(
  React.forwardRef<
    HTMLDivElement,
    {
      onInput: () => void;
      onClick: () => void;
      onKeyUp: () => void;
      onMouseUp: () => void;
      onBlur: () => void;
      onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
      className?: string;
    }
  >(function ComposerEditor(
    { onInput, onClick, onKeyUp, onMouseUp, onBlur, onKeyDown, className },
    ref
  ) {
    return (
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onClick={onClick}
        onKeyUp={onKeyUp}
        onMouseUp={onMouseUp}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={cn(
          "w-full flex-1 min-h-[96px] bg-transparent outline-none text-base leading-6 text-gray-800 font-sans whitespace-pre-wrap break-words",
          className
        )}
      />
    );
  })
);

export interface ComposerWithAttachmentsProps {
  onSend: (content: string, attachments: PendingAttachment[]) => void | Promise<void>;
  placeholder?: string;
  sendButtonLabel?: string;
  /** 左侧工具栏，例如曲别针按钮。若不传则使用默认的 file 按钮 */
  leftToolbar?: React.ReactNode;
  /** 是否禁用发送 */
  disabled?: boolean;
  /** 外层 className */
  className?: string;
  /** 是否支持拖拽上传 */
  dragDrop?: boolean;
}

export const ComposerWithAttachments = React.forwardRef<
  ComposerWithAttachmentsRef,
  ComposerWithAttachmentsProps
>(function ComposerWithAttachments(
  {
    onSend,
    placeholder = "输入内容…",
    sendButtonLabel = "发送",
    leftToolbar,
    disabled = false,
    className,
    dragDrop = true,
  },
  ref
) {
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isDragOverInput, setIsDragOverInput] = useState(false);
  const [composerVersion, setComposerVersion] = useState(0);

  const saveSelectionInComposer = useCallback(() => {
    const root = composerRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return;
    savedRangeRef.current = range.cloneRange();
  }, []);

  const focusInputToEnd = useCallback(() => {
    const root = composerRef.current;
    if (!root) return;
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRangeRef.current = range.cloneRange();
  }, []);

  const placeCaretAfterNode = useCallback((node: Node) => {
    const root = composerRef.current;
    if (!root) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRangeRef.current = range.cloneRange();
  }, []);

  const insertNodeAtCaret = useCallback(
    (node: Node) => {
      const root = composerRef.current;
      if (!root) return;
      root.focus();
      const selection = window.getSelection();
      let range: Range;
      if (savedRangeRef.current && root.contains(savedRangeRef.current.startContainer)) {
        range = savedRangeRef.current.cloneRange();
      } else if (
        selection &&
        selection.rangeCount > 0 &&
        root.contains(selection.getRangeAt(0).startContainer)
      ) {
        range = selection.getRangeAt(0).cloneRange();
      } else {
        range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
      }
      range.deleteContents();
      range.insertNode(node);
      placeCaretAfterNode(node);
    },
    [placeCaretAfterNode]
  );

  const insertTextAtCaret = useCallback(
    (text: string) => {
      const textNode = document.createTextNode(text);
      insertNodeAtCaret(textNode);
      setComposerVersion((v) => v + 1);
    },
    [insertNodeAtCaret]
  );

  const serializeComposer = useCallback(() => {
    const root = composerRef.current;
    if (!root) return "";
    let output = "";
    for (const node of Array.from(root.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        output += node.textContent || "";
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const attachmentId = el.dataset.attachmentId;
        if (attachmentId) {
          const attachment = pendingAttachments.find((item) => item.id === attachmentId);
          if (attachment) {
            const tag = attachment.file.type.startsWith("image/") ? "Image" : "File";
            output += `[${tag}:${attachment.file.name}] `;
          }
          continue;
        }
        output += el.textContent || "";
      }
    }
    return output.trim();
  }, [pendingAttachments]);

  const revokeAttachment = useCallback((attachment: PendingAttachment) => {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }, []);

  const removeAttachmentById = useCallback(
    (id: string) => {
      const root = composerRef.current;
      if (root) {
        root.querySelectorAll(`[data-attachment-id="${id}"]`).forEach((n) => n.remove());
      }
      setPendingAttachments((prev) => {
        const target = prev.find((item) => item.id === id);
        if (target) revokeAttachment(target);
        return prev.filter((item) => item.id !== id);
      });
      setComposerVersion((v) => v + 1);
      setTimeout(() => {
        root?.focus();
        saveSelectionInComposer();
      }, 0);
    },
    [revokeAttachment, saveSelectionInComposer]
  );

  const makeAttachmentChip = useCallback(
    (attachment: PendingAttachment) => {
      const chip = document.createElement("span");
      chip.dataset.attachmentId = attachment.id;
      chip.contentEditable = "false";
      chip.className =
        "inline-flex items-center gap-3 px-3 py-2 mr-1 mb-1 bg-[#F0F0F0] border border-gray-200 rounded-xl align-middle max-w-[520px]";

      if (attachment.previewUrl) {
        const img = document.createElement("img");
        img.src = attachment.previewUrl;
        img.alt = attachment.file.name;
        img.className = "w-14 h-14 rounded-lg object-cover bg-white";
        chip.appendChild(img);
      } else {
        const icon = document.createElement("div");
        icon.className =
          "w-10 h-12 rounded-md bg-[#F25F3A] text-white text-xs font-bold flex items-center justify-center";
        icon.textContent = fileExtLabel(attachment.file.name);
        chip.appendChild(icon);
      }

      const meta = document.createElement("div");
      meta.className = "min-w-0";
      const name = document.createElement("div");
      name.className = "text-[12px] text-gray-800 truncate max-w-[320px]";
      name.textContent = attachment.file.name;
      const size = document.createElement("div");
      size.className = "text-[11px] text-gray-500 mt-0.5";
      size.textContent = formatFileSize(attachment.file.size);
      meta.appendChild(name);
      meta.appendChild(size);
      chip.appendChild(meta);

      const close = document.createElement("button");
      close.type = "button";
      close.className = "w-5 h-5 rounded text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-700";
      close.textContent = "x";
      close.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeAttachmentById(attachment.id);
      };
      chip.appendChild(close);

      return chip;
    },
    [removeAttachmentById]
  );

  const appendFiles = useCallback(
    (files: File[]) => {
      if (!Array.isArray(files) || files.length === 0) return;

      const existingSignatures = new Set(pendingAttachments.map((a) => getFileSignature(a.file)));
      const newAttachments: PendingAttachment[] = [];
      for (const file of files) {
        const signature = getFileSignature(file);
        if (existingSignatures.has(signature)) continue;
        newAttachments.push(createAttachment(file));
        existingSignatures.add(signature);
      }
      if (newAttachments.length === 0) return;

      setPendingAttachments((prev) => [...prev, ...newAttachments]);

      for (const item of newAttachments) {
        const chip = makeAttachmentChip(item);
        insertNodeAtCaret(chip);
        insertTextAtCaret(" ");
      }
      setTimeout(() => {
        composerRef.current?.focus();
        saveSelectionInComposer();
      }, 0);
    },
    [pendingAttachments, makeAttachmentChip, insertNodeAtCaret, insertTextAtCaret, saveSelectionInComposer]
  );

  const clear = useCallback(() => {
    if (composerRef.current) composerRef.current.innerHTML = "";
    setPendingAttachments((prev) => {
      prev.forEach(revokeAttachment);
      return [];
    });
    setComposerVersion((v) => v + 1);
  }, [revokeAttachment]);

  const handleSend = useCallback(() => {
    const content = serializeComposer();
    if (!content && pendingAttachments.length === 0) return;
    void Promise.resolve(onSend(content, pendingAttachments)).then(() => {
      clear();
    });
  }, [serializeComposer, pendingAttachments, onSend, clear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }
      if (e.key === "Backspace") {
        setTimeout(() => {
          const root = composerRef.current;
          if (!root) return;
          const alive = new Set<string>();
          root.querySelectorAll("[data-attachment-id]").forEach((el) => {
            const id = (el as HTMLElement).dataset.attachmentId;
            if (id) alive.add(id);
          });
          setPendingAttachments((prev) => {
            const next = prev.filter((item) => alive.has(item.id));
            for (const removed of prev) {
              if (!alive.has(removed.id)) revokeAttachment(removed);
            }
            return next;
          });
          setComposerVersion((v) => v + 1);
        }, 0);
      }
    },
    [revokeAttachment, handleSend]
  );

  useImperativeHandle(
    ref,
    () => ({
      clear,
      getContent: serializeComposer,
      getPendingAttachments: () => pendingAttachments,
      appendFiles,
    }),
    [clear, serializeComposer, pendingAttachments, appendFiles]
  );

  const onComposerInput = useCallback(() => {
    saveSelectionInComposer();
    setComposerVersion((v) => v + 1);
  }, [saveSelectionInComposer]);

  const canSend = serializeComposer().trim().length > 0 || pendingAttachments.length > 0;

  return (
    <div className={cn("flex flex-col flex-1 min-h-0", className)}>
      <style>{`.composer-with-attachments [data-attachment-id] { display: inline-flex !important; vertical-align: middle !important; }`}</style>
      <div
        className={cn(
          "composer-with-attachments flex-1 min-h-0 flex flex-col rounded-md transition-colors",
          isDragOverInput && dragDrop ? "bg-[#eaf7ef] ring-1 ring-[#07C160]/30" : ""
        )}
        onDragOver={
          dragDrop
            ? (e) => {
                e.preventDefault();
                setIsDragOverInput(true);
              }
            : undefined
        }
        onDragLeave={
          dragDrop
            ? (e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setIsDragOverInput(false);
              }
            : undefined
        }
        onDrop={
          dragDrop
            ? (e) => {
                e.preventDefault();
                setIsDragOverInput(false);
                const files = Array.from(e.dataTransfer.files || []);
                appendFiles(files);
              }
            : undefined
        }
        onClick={focusInputToEnd}
      >
        <ComposerEditor
          ref={composerRef}
          onInput={onComposerInput}
          onClick={saveSelectionInComposer}
          onKeyUp={saveSelectionInComposer}
          onMouseUp={saveSelectionInComposer}
          onBlur={saveSelectionInComposer}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-2">
        <div className="flex items-center gap-2">
          {leftToolbar ?? (
            <button
              type="button"
              onClick={() => {
                saveSelectionInComposer();
                fileInputRef.current?.click();
              }}
              className="flex items-center justify-center w-9 h-9 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="上传文件"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept="*"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              appendFiles(files);
              e.currentTarget.value = "";
            }}
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !canSend}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            canSend && !disabled
              ? "bg-[#07C160] hover:bg-[#06ad56] text-white"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          )}
        >
          {sendButtonLabel}
        </button>
      </div>
    </div>
  );
});
