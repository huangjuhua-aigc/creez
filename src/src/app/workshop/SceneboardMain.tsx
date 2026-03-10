import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlaySquare, Paperclip, History, Loader2, X } from "lucide-react";
import { cn } from "../../utils/cn";
import { formatFileSize, fileExtLabel } from "../../utils/fileDisplay";
import { saveAttachment } from "../services/chat";
import { toast } from "sonner";
import {
  getRunningStoryboardTask,
  setRunningStoryboardTask,
} from "./sceneboardRunningTask";

interface ProjectItem {
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  createdAt: number;
  updatedAt: number;
}

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

function getFileSignature(file: File): string {
  return `${file.name}__${file.size}__${file.lastModified}__${file.type}`;
}

export function SceneboardMain() {
  const navigate = useNavigate();
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const previewUrlsRef = useRef(new Set<string>());

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  /** 当前正在生成的任务名与开始时间，用于主页面展示「正在运行」卡片 */
  const [runningTask, setRunningTask] = useState<{ title: string; startedAt: number } | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isDragOverInput, setIsDragOverInput] = useState(false);
  const [composerVersion, setComposerVersion] = useState(0);
  const [showPlaceholder, setShowPlaceholder] = useState(true);

  const loadProjects = useCallback(async () => {
    const electron = window.electron;
    if (!electron?.storyboard?.list) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await electron.storyboard.list();
      if (res.ok && res.data?.items) {
        setProjects(res.data.items);
      }
    } catch {
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  /** 从其他页面回到本页时恢复「正在运行」任务卡片 */
  useEffect(() => {
    const stored = getRunningStoryboardTask();
    if (stored) {
      setRunningTask({ title: stored.title, startedAt: stored.startedAt });
      setCreating(stored.inFlight);
    }
  }, []);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const createAttachment = (file: File): PendingAttachment => {
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (previewUrl) previewUrlsRef.current.add(previewUrl);
    return {
      id: `${getFileSignature(file)}__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl,
    };
  };

  const updatePlaceholderVisibility = () => {
    const root = composerRef.current;
    if (!root) return;
    const hasText = (root.textContent ?? "").trim().length > 0;
    const hasChips = root.querySelectorAll("[data-attachment-id]").length > 0;
    setShowPlaceholder(!hasText && !hasChips);
  };

  const saveSelectionInComposer = () => {
    const root = composerRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return;
    savedRangeRef.current = range.cloneRange();
  };

  const focusInputToEnd = () => {
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
  };

  const placeCaretAfterNode = (node: Node) => {
    const root = composerRef.current;
    if (!root) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const insertNodeAtCaret = (node: Node) => {
    const root = composerRef.current;
    if (!root) return;
    root.focus();
    const selection = window.getSelection();
    let range: Range;
    if (savedRangeRef.current && root.contains(savedRangeRef.current.startContainer)) {
      range = savedRangeRef.current.cloneRange();
    } else if (selection && selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).startContainer)) {
      range = selection.getRangeAt(0).cloneRange();
    } else {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);
    placeCaretAfterNode(node);
  };

  const insertTextAtCaret = (text: string) => {
    const textNode = document.createTextNode(text);
    insertNodeAtCaret(textNode);
    setComposerVersion((v) => v + 1);
  };

  const serializeComposer = () => {
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
  };

  const revokeAttachment = (attachment: PendingAttachment) => {
    if (!attachment.previewUrl) return;
    URL.revokeObjectURL(attachment.previewUrl);
    previewUrlsRef.current.delete(attachment.previewUrl);
  };

  const removeAttachmentById = (id: string) => {
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
      updatePlaceholderVisibility();
    }, 0);
  };

  const makeAttachmentChip = (attachment: PendingAttachment) => {
    const chip = document.createElement("span");
    chip.dataset.attachmentId = attachment.id;
    chip.contentEditable = "false";
    chip.className = "inline-flex items-center gap-3 px-3 py-2 mr-1 mb-1 bg-[#F0F0F0] border border-gray-200 rounded-xl align-middle max-w-[520px]";

    if (attachment.previewUrl) {
      const img = document.createElement("img");
      img.src = attachment.previewUrl;
      img.alt = attachment.file.name;
      img.className = "w-14 h-14 rounded-lg object-cover bg-white";
      chip.appendChild(img);
    } else {
      const icon = document.createElement("div");
      icon.className = "w-10 h-12 rounded-md bg-[#F25F3A] text-white text-xs font-bold flex items-center justify-center";
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
  };

  const appendFiles = (files: File[]) => {
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
      updatePlaceholderVisibility();
    }, 0);
  };

  const handleSubmit = async () => {
    const composedContent = serializeComposer();
    if (!composedContent && pendingAttachments.length === 0) return;
    const electron = window.electron;
    if (!electron?.storyboard?.agentCreate) {
      toast.error("Storyboard not available");
      return;
    }
    const taskTitle = composedContent.slice(0, 80).replace(/\s+/g, " ").trim() || "Untitled";
    const startedAt = Date.now();
    setRunningTask({ title: taskTitle, startedAt });
    setCreating(true);
    setRunningStoryboardTask({ title: taskTitle, startedAt, inFlight: true });
    try {
      let promptWithAttachments = composedContent;
      if (pendingAttachments.length > 0) {
        const savedResults = await Promise.all(
          pendingAttachments.map(async (att) => {
            const buf = await att.file.arrayBuffer();
            const res = await saveAttachment(buf, att.file.name);
            const type = att.file.type.startsWith("image/") ? "Image" : "File";
            return { type, path: res.ok ? res.path : null };
          })
        );
        let idx = 0;
        promptWithAttachments = composedContent.replace(
          /\[(Image|File):[^\]]+\]/g,
          (match) => {
            const r = savedResults[idx++];
            return r?.path != null ? `[${r.type}: ##${r.path}##]` : match;
          }
        );
      }

      const res = await electron.storyboard.agentCreate({
        title: taskTitle,
        prompt: promptWithAttachments,
      });

      console.log("[SceneboardMain] agentCreate 返回:", res?.ok, "res.data:", res?.ok ? res.data : (res as { error?: unknown })?.error);

      if (!res.ok) {
        const errObj = res as { error?: { message?: string } };
        toast.error(errObj.error?.message ?? "Failed to create");
        return;
      }

      const { projectId } = res.data;

      if (composerRef.current) composerRef.current.innerHTML = "";
      setPendingAttachments((prev) => {
        prev.forEach(revokeAttachment);
        return [];
      });
      setComposerVersion((v) => v + 1);
      setShowPlaceholder(true);

      toast.success("Storyboard generated");
      navigate(`/workshop/sceneboard/timeline?projectId=${encodeURIComponent(projectId)}`);
    } catch {
      toast.error("Failed to create project");
    } finally {
      setCreating(false);
      setRunningTask(null);
      setRunningStoryboardTask(null);
    }
  };

  const canSend = () => {
    const root = composerRef.current;
    const text = root?.textContent?.trim() ?? "";
    return text.length > 0 || pendingAttachments.length > 0;
  };

  const handleProjectClick = (projectId: string) => {
    navigate(`/workshop/sceneboard/timeline?projectId=${encodeURIComponent(projectId)}`);
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    const electron = window.electron;
    if (!electron?.storyboard?.deleteProject) return;
    try {
      const res = await electron.storyboard.deleteProject({ projectId });
      if (res.ok) {
        toast.success("Project deleted");
        loadProjects();
      } else {
        const errObj = res as { error?: { message?: string } };
        toast.error(errObj.error?.message ?? "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete project");
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto w-full max-w-4xl mx-auto">
      <div className="w-full flex-1 flex flex-col justify-center items-center">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20">
            <PlaySquare className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Sceneboard Creator</h1>
          <p className="text-gray-500 text-sm">Upload media and describe your video sequence.</p>
        </div>

        <div className="w-full bg-white rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-gray-100 p-4 transition-all focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
          <div
            className={cn(
              "relative flex-1 min-h-0 flex flex-col rounded-md transition-colors",
              isDragOverInput ? "bg-[#eaf7ef] ring-1 ring-[#07C160]/30" : ""
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOverInput(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setIsDragOverInput(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOverInput(false);
              const files = Array.from(e.dataTransfer.files || []);
              appendFiles(files);
            }}
            onClick={focusInputToEnd}
          >
            {showPlaceholder && (
              <div
                className="absolute left-0 top-0 text-base leading-6 text-gray-400 font-sans whitespace-pre-wrap pointer-events-none select-none"
                aria-hidden
              >
                describe your storyboard, or paste your script
              </div>
            )}
            <div
              ref={composerRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => {
                saveSelectionInComposer();
                setComposerVersion((v) => v + 1);
                updatePlaceholderVisibility();
              }}
              onClick={saveSelectionInComposer}
              onKeyUp={saveSelectionInComposer}
              onMouseUp={saveSelectionInComposer}
              onBlur={saveSelectionInComposer}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSubmit();
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
              }}
              className="w-full flex-1 min-h-[96px] bg-transparent outline-none text-base leading-6 text-gray-800 font-sans whitespace-pre-wrap break-words"
              data-version={composerVersion}
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  saveSelectionInComposer();
                  fileInputRef.current?.click();
                }}
                className="flex items-center justify-center w-9 h-9 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                title="Upload file"
              >
                <Paperclip size={20} />
              </button>
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
              onClick={() => void handleSubmit()}
              disabled={!canSend() || creating}
              className={cn(
                "flex items-center gap-2 px-5 py-1.5 rounded-lg text-sm font-medium transition-colors",
                canSend() && !creating
                  ? "bg-[#07C160] hover:bg-[#06ad56] text-white"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              )}
            >
              {creating ? (
                <>
                  <Loader2 size={14} className="animate-spin shrink-0" />
                  <span>Generating...</span>
                  <span className="text-[11px] font-normal opacity-90">（预计约 10 分钟）</span>
                </>
              ) : (
                "Create"
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="w-full mt-12 mb-4">
        <div className="flex items-center gap-2 mb-4 text-gray-500">
          <History size={16} />
          <h3 className="text-sm font-medium">Recent Projects</h3>
        </div>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-gray-500">No projects yet. Create one above.</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {projects.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => handleProjectClick(p.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleProjectClick(p.id); } }}
                className="relative flex-shrink-0 w-36 group text-left cursor-pointer transition-transform hover:scale-[1.02]"
              >
                <div className="w-36 h-36 rounded-xl overflow-hidden mb-2 bg-gray-100 shadow-sm border border-gray-200">
                  {p.thumbnailUrl ? (
                    <img src={p.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                      No thumb
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDeleteProject(e, p.id)}
                  className="absolute top-0 right-0 w-6 h-6 flex items-center justify-center rounded-full bg-black/50 hover:bg-red-500 text-white text-sm transition-colors"
                  title="Delete project"
                  aria-label="Delete project"
                >
                  <X size={14} />
                </button>
                <div className="text-[13px] font-medium text-gray-800 truncate">{p.title || p.id}</div>
                <div className="text-[11px] text-gray-400">
                  {new Date(p.updatedAt * 1000).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 正在生成任务卡片：与 Timeline 任务面板同款样式 */}
      {creating && runningTask && (
        <div className="fixed bottom-4 right-4 z-[100] w-[360px] bg-white border border-[#EBEDF0] rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-start gap-3 px-4 py-3 border-b border-[#F3F3F3] last:border-b-0">
            <div className="mt-0.5 shrink-0">
              <Loader2 size={14} className="animate-spin text-[#07C160]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-medium text-gray-500 uppercase">Storyboard</span>
              </div>
              <p className="text-xs text-gray-700 truncate">{runningTask.title}</p>
              <span className="text-[10px] text-gray-400 mt-0.5 block">
                {new Date(runningTask.startedAt).toLocaleTimeString()}
              </span>
            </div>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 mt-0.5 bg-blue-100 text-blue-600">
              正在运行
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
