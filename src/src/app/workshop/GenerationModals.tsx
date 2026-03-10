import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Sparkles,
  ChevronDown,
  Maximize,
  PlayCircle,
  CheckCircle2,
  Image as ImageIcon,
  Video,
  Loader2,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { toast } from "sonner";
import type {
  StoryboardContent,
  ArtAsset,
  SceneImageItem,
  SceneVideoItem,
  AIImageGeneration,
  AIVideoGeneration,
  ImageRefItem,
} from "../../types/storyboard";

function getArtAssetThumbUrl(a: ArtAsset): string | undefined {
  if (a.activeSource === "local_disk") {
    const p = a.localImage || a.localPath || a.uploadUrl;
    if (p && !p.startsWith("http") && !p.startsWith("file:") && !p.startsWith("blob:")) return p;
  }
  const gen = a.activeGenerationId && a.aiImageGenerations?.find((g) => g.id === a.activeGenerationId);
  return gen?.url;
}

function getSceneImageThumbUrl(s: SceneImageItem): string | undefined {
  if (s.activeSource === "local_disk") {
    const p = s.localImage || s.localPath || s.uploadUrl;
    if (p && !p.startsWith("http") && !p.startsWith("file:") && !p.startsWith("blob:")) return p;
  }
  const gen = s.activeGenerationId && s.aiImageGenerations?.find((g) => g.id === s.activeGenerationId);
  return gen?.url;
}

const PROMPT_MAX = 800;

export interface GenerationTask {
  id: string;
  type: "image" | "video";
  resourceType?: "artAsset" | "sceneImage" | "sceneVideo";
  resourceId: string;
  resourceName: string;
  prompt: string;
  status: "running" | "done" | "failed";
  createdAt: number;
  error?: string;
}

export interface GenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: "image" | "video";
  projectId: string;
  resourceType?: "artAsset" | "sceneImage" | "sceneVideo";
  resourceId: string;
  resourceName: string;
  content: StoryboardContent;
  onContentUpdated?: () => void | Promise<void>;
  onTaskCreated?: (task: GenerationTask) => void;
  onTaskUpdated?: (id: string, update: Partial<GenerationTask>) => void;
}

const RATIOS = ["16:9", "9:16", "1:1"];
const DURATIONS = ["5s", "10s"];

export function GenerationModal({
  isOpen,
  onClose,
  type,
  projectId,
  resourceType,
  resourceId,
  resourceName,
  content,
  onContentUpdated,
  onTaskCreated,
  onTaskUpdated,
}: GenerationModalProps) {
  const [selectingAssetFor, setSelectingAssetFor] = useState<"reference" | "start" | "end" | null>(null);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [numImages, setNumImages] = useState(1);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [duration, setDuration] = useState("5s");
  const [imageRefs, setImageRefs] = useState<ImageRefItem[]>([]);
  const [uploadedRefDataUrls, setUploadedRefDataUrls] = useState<string[]>([]);
  const [startFrameRef, setStartFrameRef] = useState<ImageRefItem | null>(null);
  const [startFrameUploadUrl, setStartFrameUploadUrl] = useState<string>("");
  const [endFrameRef, setEndFrameRef] = useState<ImageRefItem | null>(null);
  const [endFrameUploadUrl, setEndFrameUploadUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});

  const rawPreviewItems =
    type === "image"
      ? (resourceType === "artAsset"
          ? content.artAssets?.find((a) => a.id === resourceId)?.aiImageGenerations ?? []
          : content.sceneImages?.find((s) => s.id === resourceId)?.aiImageGenerations ?? []) as AIImageGeneration[]
      : (content.sceneVideos?.find((v) => v.id === resourceId)?.aiVideoGenerations ?? []) as AIVideoGeneration[];

  const previewItems = rawPreviewItems;

  const currentAsset =
    resourceType === "artAsset"
      ? content.artAssets?.find((a) => a.id === resourceId)
      : resourceType === "sceneImage"
        ? content.sceneImages?.find((s) => s.id === resourceId)
        : undefined;
  const currentVideo =
    type === "video" ? content.sceneVideos?.find((v) => v.id === resourceId) : undefined;
  const activeId =
    type === "image"
      ? (currentAsset as ArtAsset | SceneImageItem | undefined)?.activeSource === "ai_generation"
        ? (currentAsset as ArtAsset | SceneImageItem)?.activeGenerationId
        : undefined
      : currentVideo?.activeSource === "ai_generation"
        ? currentVideo?.activeGenerationId
        : undefined;

  const previewKey = rawPreviewItems.map((i) => i.id).join(",");
  useEffect(() => {
    if (!projectId || !window.electron?.storyboard?.getAssetUrl) {
      setResolvedUrls({});
      return;
    }
    const urls: Record<string, string> = {};
    const resolve = async () => {
      for (const item of rawPreviewItems) {
        const u = (item as AIImageGeneration | AIVideoGeneration).url;
        if (!u) continue;
        if (u.startsWith("http://") || u.startsWith("https://")) {
          urls[item.id] = u;
          continue;
        }
        try {
          const res = await window.electron.storyboard.getAssetUrl({ projectId, relativePath: u });
          if (res.ok && res.data?.url) urls[item.id] = res.data.url;
        } catch { /* skip */ }
      }
      setResolvedUrls((prev) => ({ ...prev, ...urls }));
    };
    resolve();
  }, [projectId, previewKey]);

  const resolveRefUrl = useCallback(
    (ref: ImageRefItem): string | undefined => {
      if (ref.artAssetId) {
        const a = content.artAssets?.find((x) => x.id === ref.artAssetId);
        return a ? getArtAssetThumbUrl(a) : undefined;
      }
      if (ref.sceneImageId) {
        const s = content.sceneImages?.find((x) => x.id === ref.sceneImageId);
        return s ? getSceneImageThumbUrl(s) : undefined;
      }
      return undefined;
    },
    [content]
  );

  const handleSetActive = useCallback(
    async (item: AIImageGeneration | AIVideoGeneration) => {
      if (!resourceType) return;
      const electron = window.electron;
      if (!electron?.storyboard?.setActive) return;
      try {
        const res = await electron.storyboard.setActive({
          projectId,
          resourceType,
          resourceId,
          activeSource: "ai_generation",
          activeGenerationId: item.id,
        });
        if (!res.ok) {
          toast.error(res.error?.message ?? "Set active failed");
          return;
        }
        await onContentUpdated?.();
        toast.success("Set as active");
      } catch {
        toast.error("Set active failed");
      }
    },
    [projectId, resourceType, resourceId, onContentUpdated]
  );

  const handleDeleteGeneration = useCallback(
    async (generationId: string) => {
      if (!resourceType) return;
      const electron = window.electron;
      if (!electron?.storyboard?.deleteGeneration) return;
      try {
        const res = await electron.storyboard.deleteGeneration({
          projectId,
          resourceType,
          resourceId,
          generationId,
        });
        if (!res.ok) {
          toast.error(res.error?.message ?? "Delete failed");
          return;
        }
        await onContentUpdated?.();
      } catch {
        toast.error("Delete failed");
      }
    },
    [projectId, resourceType, resourceId, onContentUpdated]
  );

  const handleGenerateImage = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error("Scene description is required");
      return;
    }
    const electron = window.electron;
    if (!electron?.storyboard?.generateImage) {
      toast.error("Generation API not available");
      return;
    }
    const taskId = `task-${Date.now()}`;
    onTaskCreated?.({ id: taskId, type: "image", resourceType, resourceId, resourceName, prompt, status: "running", createdAt: Date.now() });
    setIsGenerating(true);
    try {
      const referenceImageUrls: string[] = imageRefs.map((r) => resolveRefUrl(r)).filter((u): u is string => !!u);
      const referenceImageBase64s: string[] = [...uploadedRefDataUrls];
      const res = await electron.storyboard.generateImage({
        projectId,
        resourceType,
        resourceId,
        prompt,
        ratio,
        numImages: Math.min(10, Math.max(1, numImages)),
        enableWebSearch,
        referenceImageUrls,
        referenceImageBase64s: referenceImageBase64s.length ? referenceImageBase64s : undefined,
      });
      if (!res.ok) {
        const msg = res.error?.message ?? "Image generation failed";
        onTaskUpdated?.(taskId, { status: "failed", error: msg });
        toast.error(msg);
        return;
      }
      onTaskUpdated?.(taskId, { status: "done" });
      toast.success("Image generated successfully");
      await onContentUpdated?.();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || "Image generation failed";
      onTaskUpdated?.(taskId, { status: "failed", error: msg });
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, ratio, numImages, enableWebSearch, imageRefs, uploadedRefDataUrls, projectId, resourceType, resourceId, resourceName, resolveRefUrl, onContentUpdated, onTaskCreated, onTaskUpdated]);

  const handleGenerateVideo = useCallback(async () => {
    const sfUrl = startFrameRef ? resolveRefUrl(startFrameRef) : startFrameUploadUrl;
    if (!sfUrl) {
      toast.error("Start frame is required");
      return;
    }
    const electron = window.electron;
    if (!electron?.storyboard?.generateVideo) {
      toast.error("Generation API not available");
      return;
    }
    const taskId = `task-${Date.now()}`;
    onTaskCreated?.({ id: taskId, type: "video", resourceType: "sceneVideo", resourceId, resourceName, prompt: prompt || "(video)", status: "running", createdAt: Date.now() });
    setIsGenerating(true);
    try {
      const efUrl = endFrameRef ? resolveRefUrl(endFrameRef) : endFrameUploadUrl;
      const res = await electron.storyboard.generateVideo({
        projectId,
        resourceId,
        prompt,
        ratio,
        duration: duration.replace(/\D/g, "") || "5",
        startFrameUrl: sfUrl,
        endFrameUrl: efUrl || undefined,
      });
      if (!res.ok) {
        const msg = res.error?.message ?? "Video generation failed";
        onTaskUpdated?.(taskId, { status: "failed", error: msg });
        toast.error(msg);
        return;
      }
      onTaskUpdated?.(taskId, { status: "done" });
      toast.success("Video generated successfully");
      await onContentUpdated?.();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || "Video generation failed";
      onTaskUpdated?.(taskId, { status: "failed", error: msg });
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, ratio, duration, startFrameRef, startFrameUploadUrl, endFrameRef, endFrameUploadUrl, projectId, resourceId, resourceName, resolveRefUrl, onContentUpdated, onTaskCreated, onTaskUpdated]);

  const handleAssetSelect = useCallback(
    (ref: ImageRefItem) => {
      if (selectingAssetFor === "reference") {
        setImageRefs((prev) => (prev.length >= 5 ? prev : [...prev, ref]));
      } else if (selectingAssetFor === "start") {
        setStartFrameRef(ref);
      } else if (selectingAssetFor === "end") {
        setEndFrameRef(ref);
      }
      setSelectingAssetFor(null);
    },
    [selectingAssetFor]
  );

  const refsDisplayUrls = [
    ...imageRefs.map((r) => resolveRefUrl(r)).filter(Boolean),
    ...uploadedRefDataUrls,
  ] as string[];
  const refsAtLimit = refsDisplayUrls.length >= 5;

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full h-full max-w-[1400px] max-h-[850px] bg-white rounded-xl shadow-2xl flex overflow-hidden relative m-8 animate-in fade-in zoom-in-95 duration-200 border border-[#EBEDF0]">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-50 p-1.5 bg-black/5 hover:bg-black/10 text-gray-500 hover:text-gray-900 rounded-full transition-colors border border-black/5"
        >
          <X size={16} />
        </button>

        {/* Left Sidebar */}
        <div className="w-[360px] bg-[#F7F7F7] border-r border-[#EBEDF0] flex flex-col h-full overflow-y-auto custom-scrollbar shrink-0">
          <div className="px-6 py-5 border-b border-[#EBEDF0] bg-white">
            <h2 className="text-base font-medium text-gray-900">
              {type === "image" ? "Generate Image" : "Generate Scene Video"}
            </h2>
            <p className="mt-1 text-sm text-gray-500 truncate">{resourceName}</p>
          </div>

          <div className="p-6 flex flex-col gap-6">
            {type === "image" ? (
              <>
                {/* Reference Images */}
                <div>
                  <div className="text-sm font-medium text-gray-800 mb-3 flex items-center justify-between">
                    <span>Reference Images</span>
                    <span
                      onClick={() => { if (!refsAtLimit) setSelectingAssetFor("reference"); }}
                      title={refsAtLimit ? "Max 5 reference images reached" : undefined}
                      className={cn(
                        "text-[11px] transition-colors",
                        refsAtLimit
                          ? "text-gray-400 cursor-not-allowed"
                          : "text-[#07C160] hover:text-[#06ad56] cursor-pointer"
                      )}
                    >
                      Pick from assets
                    </span>
                  </div>
                  <label
                    className={cn(
                      "block w-full border border-dashed bg-white rounded-lg relative transition-colors overflow-hidden group",
                      refsDisplayUrls.length > 0 ? "h-[160px] p-4" : "h-[160px] flex flex-col items-center justify-center text-center",
                      refsAtLimit
                        ? "border-[#E5E5E5] cursor-not-allowed opacity-80"
                        : "border-[#D9D9D9] cursor-pointer hover:border-[#07C160]"
                    )}
                    title={refsAtLimit ? "Max 5 reference images reached" : undefined}
                    onClick={(e) => { if (refsAtLimit) e.preventDefault(); }}
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      multiple
                      className="hidden"
                      disabled={refsAtLimit}
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        const remaining = 5 - refsDisplayUrls.length;
                        const toAdd = files.slice(0, remaining);
                        Promise.all(
                          toAdd.map(
                            (file) =>
                              new Promise<string>((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = () => resolve(reader.result as string);
                                reader.onerror = () => reject(reader.error);
                                reader.readAsDataURL(file);
                              })
                          )
                        ).then((dataUrls) => {
                          setUploadedRefDataUrls((prev) => [...prev, ...dataUrls]);
                        });
                        e.target.value = "";
                      }}
                    />
                    {refsDisplayUrls.length > 0 ? (
                      <div className="flex h-full items-center justify-center w-full">
                        {refsDisplayUrls.map((refUrl, index) => (
                          <div
                            key={index}
                            className="relative w-[84px] h-[116px] shrink-0 rounded-md shadow-[0_0_15px_rgba(0,0,0,0.1)] group/item transition-all duration-300 hover:-translate-y-2 hover:z-50"
                            style={{ marginLeft: index === 0 ? 0 : "-36px" }}
                          >
                            <img src={refUrl} alt={`Reference ${index + 1}`} className="w-full h-full object-cover rounded-md border-[1.5px] border-white" />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (index < imageRefs.length) {
                                  setImageRefs((prev) => prev.filter((_, i) => i !== index));
                                } else {
                                  const uploadIdx = index - imageRefs.length;
                                  setUploadedRefDataUrls((prev) => prev.filter((_, i) => i !== uploadIdx));
                                }
                              }}
                              className="absolute -top-2 -right-2 p-1.5 bg-black/60 rounded-full text-white hover:bg-red-500/90 transition-colors opacity-0 group-hover/item:opacity-100 z-10 border border-white/20 shadow-sm"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        <span className="text-sm text-gray-500 group-hover:text-gray-700 mb-1.5">Click or drag to upload</span>
                        <span className="text-xs text-gray-400">JPG, PNG format (max 5)</span>
                      </>
                    )}
                  </label>
                </div>

                {/* Prompt */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-gray-800">Scene Description</div>
                    <button type="button" className="flex items-center gap-1.5 px-2 py-1 bg-white hover:bg-[#F3F3F3] border border-[#E5E5E5] hover:border-[#07C160] text-xs text-gray-600 rounded transition-colors group">
                      <Sparkles size={12} className="text-[#07C160] group-hover:animate-pulse" />
                      AI Polish
                    </button>
                  </div>
                  <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden focus-within:border-[#07C160] transition-colors shadow-sm">
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
                      placeholder="Describe the scene you want to generate in detail..."
                      className="w-full h-[120px] bg-transparent resize-none p-3 text-sm text-gray-900 focus:outline-none placeholder:text-gray-400 custom-scrollbar"
                    />
                    <div className="flex justify-end p-2 border-t border-[#FAFAFA] bg-[#F7F7F7]">
                      <span className="text-xs text-gray-400">{prompt.length}/{PROMPT_MAX}</span>
                    </div>
                  </div>
                </div>

                {/* Ratio */}
                <div>
                  <div className="text-sm font-medium text-gray-800 mb-3">Aspect Ratio</div>
                  <div className="grid grid-cols-3 gap-2">
                    {RATIOS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRatio(r)}
                        className={cn(
                          "py-2.5 rounded-lg border text-sm transition-colors",
                          ratio === r
                            ? "bg-[#07C160]/10 border-[#07C160] text-[#07C160]"
                            : "bg-white border-[#E5E5E5] text-gray-600 hover:border-[#07C160] hover:text-[#07C160]"
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Number of images (1–10) */}
                <div>
                  <div className="text-sm font-medium text-gray-800 mb-3">Number of images</div>
                  <select
                    value={numImages}
                    onChange={(e) => setNumImages(Number(e.target.value))}
                    className="w-full py-2.5 px-3 rounded-lg border border-[#E5E5E5] bg-white text-sm text-gray-800 focus:outline-none focus:border-[#07C160]"
                  >
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

                {/* Enable web search */}
                <div className="flex items-center gap-2">
                  <input
                    id="enable-web-search"
                    type="checkbox"
                    checked={enableWebSearch}
                    onChange={(e) => setEnableWebSearch(e.target.checked)}
                    className="w-4 h-4 rounded border-[#E5E5E5] text-[#07C160] focus:ring-[#07C160]"
                  />
                  <label htmlFor="enable-web-search" className="text-sm text-gray-800 cursor-pointer">Enable web search</label>
                </div>
              </>
            ) : (
              <>
                {/* Video Start/End Frames */}
                <div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-800 mb-3 flex items-center justify-between">
                        <span>Start Frame</span>
                        <span onClick={() => setSelectingAssetFor("start")} className="text-[11px] text-[#07C160] hover:text-[#06ad56] transition-colors cursor-pointer">Pick from assets</span>
                      </div>
                      <label
                        className={cn(
                          "border border-dashed bg-white rounded-lg flex flex-col items-center justify-center text-center transition-colors relative overflow-hidden group h-[120px]",
                          (startFrameRef || startFrameUploadUrl) ? "border-[#E5E5E5]" : "border-[#D9D9D9] hover:border-[#07C160] cursor-pointer"
                        )}
                      >
                        <input
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setStartFrameUploadUrl(URL.createObjectURL(file));
                              setStartFrameRef(null);
                            }
                          }}
                        />
                        {startFrameRef || startFrameUploadUrl ? (
                          <>
                            <img src={startFrameRef ? resolveRefUrl(startFrameRef) : startFrameUploadUrl} alt="Start Frame" className="w-full h-full object-cover opacity-90 group-hover:opacity-70 transition-opacity" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStartFrameRef(null); setStartFrameUploadUrl(""); }}
                                className="p-1.5 bg-black/50 rounded-full text-white hover:bg-red-500/90 transition-colors z-10 shadow-md"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-gray-500 group-hover:text-gray-700 mb-1">Click to upload start frame</span>
                        )}
                      </label>
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-800 mb-3 flex items-center justify-between">
                        <span>End Frame (optional)</span>
                        <span onClick={() => setSelectingAssetFor("end")} className="text-[11px] text-[#07C160] hover:text-[#06ad56] transition-colors cursor-pointer">Pick from assets</span>
                      </div>
                      <label
                        className={cn(
                          "border border-dashed bg-white rounded-lg flex flex-col items-center justify-center text-center transition-colors relative overflow-hidden group h-[120px]",
                          (endFrameRef || endFrameUploadUrl) ? "border-[#E5E5E5]" : "border-[#D9D9D9] hover:border-[#07C160] cursor-pointer"
                        )}
                      >
                        <input
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setEndFrameUploadUrl(URL.createObjectURL(file));
                              setEndFrameRef(null);
                            }
                          }}
                        />
                        {endFrameRef || endFrameUploadUrl ? (
                          <>
                            <img src={endFrameRef ? resolveRefUrl(endFrameRef) : endFrameUploadUrl} alt="End Frame" className="w-full h-full object-cover opacity-90 group-hover:opacity-70 transition-opacity" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEndFrameRef(null); setEndFrameUploadUrl(""); }}
                                className="p-1.5 bg-black/50 rounded-full text-white hover:bg-red-500/90 transition-colors z-10 shadow-md"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-gray-500 group-hover:text-gray-700 mb-1">Click to upload end frame</span>
                        )}
                      </label>
                    </div>
                  </div>
                </div>

                {/* Prompt */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-gray-800">Shot Description</div>
                    <button type="button" className="flex items-center gap-1.5 px-2 py-1 bg-white hover:bg-[#F3F3F3] border border-[#E5E5E5] hover:border-[#07C160] text-xs text-gray-600 rounded transition-colors group">
                      <Sparkles size={12} className="text-[#07C160] group-hover:animate-pulse" />
                      AI Polish
                    </button>
                  </div>
                  <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden focus-within:border-[#07C160] transition-colors shadow-sm">
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
                      placeholder="Describe camera movement, lighting changes..."
                      className="w-full h-[120px] bg-transparent resize-none p-3 text-sm text-gray-900 focus:outline-none placeholder:text-gray-400 custom-scrollbar"
                    />
                    <div className="flex justify-end p-2 border-t border-[#FAFAFA] bg-[#F7F7F7]">
                      <span className="text-xs text-gray-400">{prompt.length}/{PROMPT_MAX}</span>
                    </div>
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <div className="text-sm font-medium text-gray-800 mb-3">Duration</div>
                  <div className="grid grid-cols-2 gap-2">
                    {DURATIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDuration(d)}
                        className={cn(
                          "py-2.5 rounded-lg border text-sm transition-colors",
                          duration === d
                            ? "bg-[#07C160]/10 border-[#07C160] text-[#07C160]"
                            : "bg-white border-[#E5E5E5] text-gray-600 hover:border-[#07C160] hover:text-[#07C160]"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Generate Button */}
            <div className="mt-8 pt-4 pb-2 sticky bottom-0 bg-[#F7F7F7] z-10">
              <button
                type="button"
                onClick={type === "image" ? () => void handleGenerateImage() : () => void handleGenerateVideo()}
                disabled={isGenerating}
                className="w-full py-3 bg-[#07C160] hover:bg-[#06ad56] text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-md shadow-[#07C160]/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    {type === "image" ? "Generate Image" : "Generate Video"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right Preview Area */}
        <div className="flex-1 bg-[#EDEDED] relative flex flex-col overflow-hidden">
          <div className="p-8 h-full overflow-y-auto custom-scrollbar">
            {previewItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <ImageIcon size={48} className="mb-4 opacity-50" />
                <p className="text-sm">No generations yet</p>
                <p className="text-xs mt-1">Fill in the parameters on the left and click generate</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {previewItems.map((item) => {
                  const isActive = item.id === activeId;
                  const url = (item.url?.startsWith("http") ? item.url : resolvedUrls[item.id]) ?? item.url;
                  const isVideo = type === "video";
                  const gen = item as AIImageGeneration | AIVideoGeneration;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "group relative rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-lg transition-all duration-300",
                        isActive ? "ring-2 ring-[#07C160] border-transparent" : "border border-[#EBEDF0] hover:border-[#D9D9D9]"
                      )}
                    >
                      <div className="relative aspect-video bg-[#F7F7F7]">
                        {url ? (
                          isVideo ? (
                            <video src={url} className="w-full h-full object-cover opacity-95 group-hover:opacity-100 transition-opacity" muted playsInline />
                          ) : (
                            <img src={url} alt="Generation result" className="w-full h-full object-cover opacity-95 group-hover:opacity-100 transition-opacity" />
                          )
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            {isVideo ? <Video size={32} /> : <ImageIcon size={32} />}
                          </div>
                        )}

                        {isActive && (
                          <div className="absolute top-3 left-3 bg-[#07C160] text-white rounded-full px-2.5 py-1 flex items-center gap-1.5 shadow-md z-20">
                            <CheckCircle2 size={12} />
                            <span className="text-[10px] font-medium">Active</span>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleDeleteGeneration(item.id); }}
                          className="absolute top-2 right-2 p-0.5 rounded-full bg-black/40 hover:bg-red-500/90 text-white opacity-0 group-hover:opacity-100 transition-all z-20"
                          title="Remove this generation"
                        >
                          <X size={12} />
                        </button>

                        {isVideo && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/5 group-hover:bg-black/10 transition-colors pointer-events-none">
                            <PlayCircle size={48} className="text-white opacity-90 drop-shadow-md" strokeWidth={1.5} />
                          </div>
                        )}

                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 z-20">
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center p-2 bg-white/90 hover:bg-white text-gray-800 rounded-lg transition-colors border border-[#E5E5E5] shadow-lg backdrop-blur-md"
                            >
                              <Maximize size={16} />
                            </a>
                          )}
                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => handleSetActive(gen)}
                              className="flex items-center gap-1.5 px-3 py-2 bg-[#07C160]/90 hover:bg-[#06ad56] text-white rounded-lg text-xs font-medium transition-colors shadow-lg backdrop-blur-md border border-[#07C160]/50"
                            >
                              <CheckCircle2 size={14} />
                              Set Active
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="p-4 bg-white relative z-10 border-t border-[#EBEDF0]">
                        <p className="text-xs text-gray-700 leading-relaxed line-clamp-2 mb-3" title={gen.prompt}>
                          {gen.prompt}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-1 bg-[#F7F7F7] border border-[#E5E5E5] text-gray-600 rounded-md text-[10px] font-medium">
                            {gen.model}
                          </span>
                          <span className="px-2 py-1 bg-[#F7F7F7] border border-[#E5E5E5] text-gray-600 rounded-md text-[10px] font-medium">
                            Ratio: {gen.ratio}
                          </span>
                          {type === "image" && (gen as AIImageGeneration).imageRefs?.length ? (
                            <span className="px-2 py-1 bg-[#07C160]/10 border border-[#07C160]/20 text-[#07C160] rounded-md text-[10px] font-medium flex items-center gap-1">
                              <ImageIcon size={10} />
                              Refs x{(gen as AIImageGeneration).imageRefs?.length}
                            </span>
                          ) : null}
                          {type === "video" && (
                            <span className="px-2 py-1 bg-[#F7F7F7] border border-[#E5E5E5] text-gray-600 rounded-md text-[10px] font-medium">
                              {(gen as AIVideoGeneration).duration}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Asset Selection Modal */}
        {selectingAssetFor && (
          <div className="absolute inset-0 z-[300] bg-black/30 backdrop-blur-sm flex items-center justify-center p-8">
            <div className="w-full max-w-4xl bg-[#F7F7F7] border border-[#EBEDF0] rounded-xl shadow-2xl flex flex-col h-full max-h-[700px] animate-in fade-in zoom-in-95 duration-200">
              <div className="px-6 py-4 border-b border-[#EBEDF0] bg-white rounded-t-xl flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">
                  {selectingAssetFor === "reference" ? "Select Reference Image" : selectingAssetFor === "start" ? "Select Start Frame" : "Select End Frame"}
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectingAssetFor(null)}
                  className="p-2 hover:bg-[#F3F3F3] rounded-full text-gray-500 hover:text-gray-900 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                <div className="grid grid-cols-3 xl:grid-cols-4 gap-4">
                  {(content.artAssets ?? []).map((a) => {
                    const thumb = getArtAssetThumbUrl(a);
                    return (
                      <div
                        key={a.id}
                        onClick={() => handleAssetSelect({ artAssetId: a.id })}
                        className="group relative aspect-video bg-white rounded-lg overflow-hidden border border-[#E5E5E5] hover:border-[#07C160] cursor-pointer transition-all shadow-sm"
                      >
                        {thumb ? (
                          <img src={thumb} alt={a.name} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-[#F5F5F5] text-gray-400 text-xs">No image</div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="px-3 py-1.5 bg-[#07C160] text-white text-xs font-medium rounded-md shadow-lg">Select</span>
                        </div>
                        <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
                          <p className="text-[11px] text-white truncate">{a.name}</p>
                        </div>
                      </div>
                    );
                  })}
                  {(content.sceneImages ?? []).map((s) => {
                    const thumb = getSceneImageThumbUrl(s);
                    return (
                      <div
                        key={s.id}
                        onClick={() => handleAssetSelect({ sceneImageId: s.id })}
                        className="group relative aspect-video bg-white rounded-lg overflow-hidden border border-[#E5E5E5] hover:border-[#07C160] cursor-pointer transition-all shadow-sm"
                      >
                        {thumb ? (
                          <img src={thumb} alt={s.name} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-[#F5F5F5] text-gray-400 text-xs">No image</div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="px-3 py-1.5 bg-[#07C160] text-white text-xs font-medium rounded-md shadow-lg">Select</span>
                        </div>
                        <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
                          <p className="text-[11px] text-white truncate">{s.name}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
