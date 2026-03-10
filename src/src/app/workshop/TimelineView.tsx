import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  Layers,
  Clapperboard,
  Music,
  Pencil,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Video,
  Image as ImageIcon,
  Plus,
  Sparkles,
  Paperclip,
  Save,
  RefreshCw,
  X,
  Mic,
  MousePointer2,
  Scissors,
  ZoomIn,
  ZoomOut,
  Type,
  SplitSquareHorizontal,
  ChevronUp,
  ChevronDown,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Upload,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { toast } from "sonner";
import { GenerationModal } from "./GenerationModals";
import type { GenerationTask } from "./GenerationModals";
import type {
  StoryboardProject,
  StoryboardContent,
  ArtAsset,
  SceneImageItem,
  SceneVideoItem,
  TimelineTrack,
  TimelineClip,
} from "../../types/storyboard";

function getArtAssetThumbUrl(a: ArtAsset): string | undefined {
  if (a.activeSource === "local_disk") {
    const p = a.localImage || a.localPath || a.uploadUrl;
    if (p && !p.startsWith("http") && !p.startsWith("file:") && !p.startsWith("blob:")) return p;
  }
  const gen = a.activeGenerationId ? a.aiImageGenerations?.find((g) => g.id === a.activeGenerationId) : undefined;
  return gen && typeof gen.url === "string" ? gen.url : undefined;
}

function getSceneImageThumbUrl(s: SceneImageItem): string | undefined {
  if (s.activeSource === "local_disk") {
    const p = s.localImage || s.localPath || s.uploadUrl;
    if (p && !p.startsWith("http") && !p.startsWith("file:") && !p.startsWith("blob:")) return p;
  }
  const gen = s.activeGenerationId ? s.aiImageGenerations?.find((g) => g.id === s.activeGenerationId) : undefined;
  return gen && typeof gen.url === "string" ? gen.url : undefined;
}

function getSceneVideoThumbUrl(v: SceneVideoItem): string | undefined {
  const gen = v.activeGenerationId ? v.aiVideoGenerations?.find((g) => g.id === v.activeGenerationId) : undefined;
  return gen && typeof gen.url === "string" ? gen.url : undefined;
}

type GenerationModalState = {
  isOpen: boolean;
  type: "image" | "video";
  resourceType?: "artAsset" | "sceneImage" | "sceneVideo";
  resourceId: string;
  resourceName: string;
};

const TABS = [
  { id: "script", label: "Script", icon: FileText },
  { id: "asset", label: "Asset", icon: Layers },
  { id: "footage", label: "Video Clips", icon: Clapperboard },
  { id: "audio", label: "Audio", icon: Music },
] as const;

export function TimelineView() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("projectId");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const pendingUploadRef = React.useRef<{ name: string; category: "asset" | "footage"; assetTab: "art" | "scene_image" } | null>(null);
  const [project, setProject] = useState<StoryboardProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"script" | "asset" | "footage" | "audio">("script");
  const [assetTab, setAssetTab] = useState<"art" | "scene_image">("art");
  const [audioTab, setAudioTab] = useState<"bgm" | "voiceover">("bgm");
  const [addResourceDialog, setAddResourceDialog] = useState<{
    open: boolean;
    category: "asset" | "footage";
    nameInput: string;
  }>({ open: false, category: "asset", nameInput: "" });
  const [scriptDraft, setScriptDraft] = useState("");
  const [isSavingScript, setIsSavingScript] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [generationModal, setGenerationModal] = useState<GenerationModalState>({
    isOpen: false,
    type: "image",
    resourceId: "",
    resourceName: "",
  });

  const loadProject = useCallback(async (id: string, silent = false) => {
    const electron = window.electron;
    if (!electron?.storyboard?.get) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res = await electron.storyboard.get({ projectId: id });
      if (res.ok && res.data) {
        const p = res.data as StoryboardProject;
        setProject(p);
      } else if (!silent) {
        const err = res && "error" in res ? (res as { error?: { message?: string } }).error : undefined;
        toast.error(err?.message ?? "Load failed");
        setProject(null);
      }
    } catch {
      if (!silent) {
        toast.error("Load failed");
        setProject(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProject = useCallback(() => {
    if (projectId?.trim()) return loadProject(projectId.trim(), true);
  }, [projectId, loadProject]);

  useEffect(() => {
    if (!projectId?.trim()) {
      setLoading(false);
      setProject(null);
      return;
    }
    loadProject(projectId.trim());
  }, [projectId, loadProject]);

  const content = project?.content as StoryboardContent | undefined;
  useEffect(() => {
    if (content?.script != null) setScriptDraft(content.script);
  }, [project?.id, content?.script]);

  const allRelativeUrls = useMemo(() => {
    if (!content) return [] as string[];
    const urls: string[] = [];
    const collect = (u: string | undefined | null) => {
      if (u && !u.startsWith("http://") && !u.startsWith("https://") && !u.startsWith("file:") && !u.startsWith("blob:")) urls.push(u);
    };
    for (const a of content.artAssets ?? []) {
      for (const g of a.aiImageGenerations ?? []) collect(g.url);
      if (a.activeSource === "local_disk" && (a.localImage || a.localPath || a.uploadUrl)) collect(a.localImage || a.localPath || a.uploadUrl);
    }
    for (const s of content.sceneImages ?? []) {
      for (const g of s.aiImageGenerations ?? []) collect(g.url);
      if (s.activeSource === "local_disk" && (s.localImage || s.localPath || s.uploadUrl)) collect(s.localImage || s.localPath || s.uploadUrl);
    }
    for (const v of content.sceneVideos ?? []) {
      for (const g of v.aiVideoGenerations ?? []) collect(g.url);
    }
    return urls;
  }, [content]);

  useEffect(() => {
    if (!projectId || !allRelativeUrls.length) return;
    const electron = window.electron;
    if (!electron?.storyboard?.getAssetUrl) return;
    let cancelled = false;
    (async () => {
      const resolved: Record<string, string> = {};
      for (const relPath of allRelativeUrls) {
        if (cancelled) return;
        try {
          const res = await electron.storyboard.getAssetUrl({ projectId, relativePath: relPath });
          if (res.ok && res.data?.url) resolved[relPath] = res.data.url;
        } catch { /* skip */ }
      }
      if (!cancelled) setResolvedUrls((prev) => ({ ...prev, ...resolved }));
    })();
    return () => { cancelled = true; };
  }, [projectId, allRelativeUrls]);

  const resolveUrl = useCallback((rawUrl: string | undefined): string | undefined => {
    if (!rawUrl) return undefined;
    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://") || rawUrl.startsWith("file:") || rawUrl.startsWith("blob:")) return rawUrl;
    return resolvedUrls[rawUrl] || undefined;
  }, [resolvedUrls]);

  const thumbUrl = useCallback((raw: string | undefined): string | undefined => {
    return resolveUrl(raw);
  }, [resolveUrl]);

  const handleSaveScript = useCallback(async () => {
    if (!projectId || !content) return;
    const electron = window.electron;
    if (!electron?.storyboard?.update) return;
    setIsSavingScript(true);
    try {
      const res = await electron.storyboard.update({
        projectId,
        content: { ...content, script: scriptDraft },
      });
      if (res.ok) {
        setShowUpdateModal(true);
        setProject((prev) =>
          prev && content
            ? { ...prev, content: { ...content, script: scriptDraft } }
            : prev
        );
      } else {
        toast.error("Save script failed");
      }
    } catch {
      toast.error("Save script failed");
    } finally {
      setIsSavingScript(false);
    }
  }, [projectId, content, scriptDraft]);

  const openGenerationModal = useCallback(
    (type: "image" | "video", resourceType: "artAsset" | "sceneImage" | "sceneVideo", resourceId: string, resourceName: string) => {
      setGenerationModal({ isOpen: true, type, resourceType, resourceId, resourceName });
    },
    []
  );

  const handleAddResourceConfirm = useCallback(
    async (action: "ai" | "upload") => {
      const { category, nameInput } = addResourceDialog;
      const name = nameInput.trim();
      if (!name || !projectId?.trim()) {
        if (!projectId?.trim()) toast.error("No project selected");
        return;
      }
      const electron = window.electron;
      if (!electron?.storyboard?.addResource) {
        toast.error("Add resource is not available");
        return;
      }

      const resourceType: "artAsset" | "sceneImage" | "sceneVideo" =
        category === "footage" ? "sceneVideo" : assetTab === "scene_image" ? "sceneImage" : "artAsset";

      if (action === "upload") {
        pendingUploadRef.current = { name, category, assetTab };
        setAddResourceDialog({ open: false, category: "asset", nameInput: "" });
        fileInputRef.current?.click();
        return;
      }

      try {
        const res = await electron.storyboard.addResource({ projectId, resourceType, name });
        if (!res.ok || !res.data?.id) {
          const errMsg = !res.ok && "error" in res ? (res as { error?: { message?: string } }).error?.message : undefined;
          toast.error(errMsg ?? "Failed to add resource");
          return;
        }
        const newId = res.data.id;
        setAddResourceDialog({ open: false, category: "asset", nameInput: "" });
        await refreshProject();
        const modalType = category === "footage" ? "video" : "image";
        setTimeout(() => {
          openGenerationModal(modalType, resourceType, newId, name);
        }, 0);
      } catch (e) {
        toast.error("Failed to add resource");
      }
    },
    [addResourceDialog, projectId, assetTab, refreshProject, openGenerationModal]
  );

  const handleDeleteResource = useCallback(
    async (resourceType: "artAsset" | "sceneImage" | "sceneVideo", resourceId: string) => {
      if (!projectId?.trim()) return;
      const electron = window.electron;
      if (!electron?.storyboard?.deleteResource) return;
      try {
        const res = await electron.storyboard.deleteResource({ projectId, resourceType, resourceId });
        if (res.ok) {
          toast.success("Removed");
          await loadProject(projectId);
        } else {
          toast.error(res.error?.message ?? "Failed to remove");
        }
      } catch {
        toast.error("Failed to remove");
      }
    },
    [projectId, loadProject]
  );

  const timelineTracks: TimelineTrack[] = useMemo(() => {
    const vClips: TimelineClip[] = [];
    const DEFAULT_CLIP_DURATION = 5;
    let cursor = 0;
    for (const v of content?.sceneVideos ?? []) {
      vClips.push({
        id: v.id,
        startTime: cursor,
        duration: DEFAULT_CLIP_DURATION,
        resourceType: "sceneVideo",
      });
      cursor += DEFAULT_CLIP_DURATION;
    }
    return [
      { id: "track-v2", type: "V2 (Overlay)", clips: [] },
      { id: "track-v1", type: "V1 (Main)", clips: vClips },
      { id: "track-a1", type: "A1 (Audio)", clips: [] },
    ];
  }, [content?.sceneVideos]);

  function getClipLabel(clip: TimelineClip, c: StoryboardContent | undefined): string {
    if (!c) return clip.id;
    if (clip.resourceType === "artAsset") return c.artAssets?.find((a) => a.id === clip.id)?.name ?? clip.id;
    if (clip.resourceType === "sceneImage") return c.sceneImages?.find((s) => s.id === clip.id)?.name ?? clip.id;
    if (clip.resourceType === "sceneVideo") return c.sceneVideos?.find((v) => v.id === clip.id)?.name ?? clip.id;
    if (clip.resourceType === "audioBgm") return c.audioBgm?.find((a) => a.id === clip.id)?.name ?? clip.id;
    if (clip.resourceType === "audioVoiceover") return c.audioVoiceover?.find((a) => a.id === clip.id)?.name ?? clip.id;
    return clip.id;
  }

  function getClipThumb(clip: TimelineClip, c: StoryboardContent | undefined): string | undefined {
    if (!c) return undefined;
    if (clip.resourceType === "artAsset") {
      const a = c.artAssets?.find((x) => x.id === clip.id);
      return a ? thumbUrl(getArtAssetThumbUrl(a)) : undefined;
    }
    if (clip.resourceType === "sceneImage") {
      const s = c.sceneImages?.find((x) => x.id === clip.id);
      return s ? thumbUrl(getSceneImageThumbUrl(s)) : undefined;
    }
    if (clip.resourceType === "sceneVideo") {
      const v = c.sceneVideos?.find((x) => x.id === clip.id);
      return v ? thumbUrl(getSceneVideoThumbUrl(v)) : undefined;
    }
    return undefined;
  }

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>No project selected. <Link to="/workshop/sceneboard" className="text-[#07C160] hover:underline">Back to list</Link></p>
      </div>
    );
  }

  if (loading || !project) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        {loading ? "Loading..." : "Project not found."}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#F3F3F3] text-gray-800 font-sans overflow-hidden">
      {/* Top Header - match design */}
      <div className="h-14 bg-white border-b border-[#EBEDF0] flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/workshop/sceneboard"
            className="p-1.5 hover:bg-[#F3F3F3] rounded-md transition-colors text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900 truncate">{project.title || projectId}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#07C160]/10 border border-[#07C160]/20 text-[#07C160]">AI Storyboard</span>
          </div>
        </div>
      </div>

      {/* Main Workspace - match design */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel: Assets / Storyboard - w-[340px] design */}
        <div className="w-[340px] bg-white border-r border-[#EBEDF0] flex flex-col h-full shrink-0">
          <div className="flex w-full border-b border-[#EBEDF0]">
            {[
              { id: "script", icon: FileText, label: "Script" },
              { id: "asset", icon: Layers, label: "Asset" },
              { id: "footage", icon: Clapperboard, label: "Video Clips" },
              { id: "audio", icon: Music, label: "Audio" },
            ].map((tab) => {
              const isDisabled = tab.id === "audio";
              return (
                <button
                  key={tab.id}
                  type="button"
                  title={isDisabled ? "Coming soon" : undefined}
                  onClick={() => !isDisabled && setActiveTab(tab.id as typeof activeTab)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1.5 py-3 text-xs font-medium transition-colors border-b-2",
                    isDisabled && "opacity-50 cursor-not-allowed",
                    activeTab === tab.id
                      ? "text-[#07C160] border-[#07C160] bg-[#F9F9F9]"
                      : "text-gray-500 border-transparent hover:text-gray-900 hover:bg-[#F9F9F9]"
                  )}
                >
                  <tab.icon size={18} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {activeTab === "script" && (
              <div className="flex flex-col h-full gap-4">
                <textarea
                  value={scriptDraft}
                  onChange={(e) => setScriptDraft(e.target.value)}
                  className="flex-1 w-full bg-[#F9F9F9] border border-[#E5E5E5] rounded-lg p-3 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#07C160] transition-colors custom-scrollbar shadow-inner"
                  placeholder="Enter your script here..."
                />
                <button
                  type="button"
                  onClick={() => void handleSaveScript()}
                  disabled={isSavingScript}
                  className="flex items-center justify-center gap-2 bg-[#07C160] hover:bg-[#06ad56] text-white py-2 rounded-lg font-medium transition-colors disabled:opacity-50 text-sm shadow-md"
                >
                  {isSavingScript ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  {isSavingScript ? "Saving..." : "Save Script"}
                </button>
              </div>
            )}

            {activeTab === "asset" && (
              <div className="flex flex-col h-full gap-4">
                <div className="flex p-1 bg-[#F3F3F3] rounded-lg shrink-0 border border-[#EBEDF0]">
                  <button
                    type="button"
                    onClick={() => setAssetTab("art")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-md transition-all",
                      assetTab === "art" ? "bg-white text-gray-900 shadow-sm border border-[#E5E5E5]" : "text-gray-500 hover:text-gray-800"
                    )}
                  >
                    Art
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssetTab("scene_image")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-md transition-all",
                      assetTab === "scene_image" ? "bg-white text-gray-900 shadow-sm border border-[#E5E5E5]" : "text-gray-500 hover:text-gray-800"
                    )}
                  >
                    Scene Image
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                  <div className="grid grid-cols-2 gap-3 content-start w-full">
                  {assetTab === "art" &&
                    (content?.artAssets ?? []).map((a) => {
                      const thumb = thumbUrl(getArtAssetThumbUrl(a));
                      const isLocalDisk = a.activeSource === "local_disk";
                      return (
                        <div key={a.id} className="group relative rounded-lg overflow-hidden bg-white border border-[#E5E5E5] cursor-pointer hover:border-[#07C160] transition-colors shadow-sm hover:shadow-md">
                          <div className="aspect-video relative">
                            {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" /> : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs"><ImageIcon size={24} /></div>}
                            <div className="absolute top-1 right-1 bg-black/50 rounded px-1.5 py-0.5 text-[10px] text-white flex items-center gap-1 backdrop-blur-sm">
                              {isLocalDisk ? <Upload size={10} /> : <Sparkles size={10} />}
                            </div>
                          </div>
                          <div className="p-2 text-xs text-gray-600 truncate group-hover:text-gray-900 font-medium">{a.name}</div>
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center p-3 z-20 backdrop-blur-[2px]">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void handleDeleteResource("artAsset", a.id); }}
                              className="absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-red-500/90 text-white transition-colors"
                              title="Remove from project"
                            >
                              <X size={12} />
                            </button>
                            <div className="text-[11px] font-medium text-white mb-1 truncate">{a.name}</div>
                            <div className="flex items-center justify-end mt-auto">
                              {isLocalDisk ? (
                                <span className="bg-[#07C160] text-white p-1.5 rounded-full shadow-lg" title="Uploaded from local">
                                  <Upload size={14} />
                                </span>
                              ) : (
                                <button type="button" onClick={() => openGenerationModal("image", "artAsset", a.id, a.name)} className="bg-[#07C160] hover:bg-[#06ad56] text-white p-1.5 rounded-full hover:scale-110 transition-transform shadow-lg">
                                  <Pencil size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  {assetTab === "scene_image" &&
                    (content?.sceneImages ?? []).map((s) => {
                      const thumb = thumbUrl(getSceneImageThumbUrl(s));
                      const isLocalDisk = s.activeSource === "local_disk";
                      return (
                        <div key={s.id} className="group relative rounded-lg overflow-hidden bg-white border border-[#E5E5E5] cursor-pointer hover:border-[#07C160] transition-colors shadow-sm hover:shadow-md">
                          <div className="aspect-video relative">
                            {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" /> : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs"><ImageIcon size={24} /></div>}
                            <div className="absolute top-1 right-1 bg-black/50 rounded px-1.5 py-0.5 text-[10px] text-white flex items-center gap-1 backdrop-blur-sm">
                              {isLocalDisk ? <Upload size={10} /> : <Sparkles size={10} />}
                            </div>
                          </div>
                          <div className="p-2 text-xs text-gray-600 truncate group-hover:text-gray-900 font-medium">{s.name}</div>
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center p-3 z-20 backdrop-blur-[2px]">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void handleDeleteResource("sceneImage", s.id); }}
                              className="absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-red-500/90 text-white transition-colors"
                              title="Remove from project"
                            >
                              <X size={12} />
                            </button>
                            <div className="text-[11px] font-medium text-white mb-1 truncate">{s.name}</div>
                            <div className="flex items-center justify-end mt-auto">
                              {isLocalDisk ? (
                                <span className="bg-[#07C160] text-white p-1.5 rounded-full shadow-lg" title="Uploaded from local">
                                  <Upload size={14} />
                                </span>
                              ) : (
                                <button type="button" onClick={() => openGenerationModal("image", "sceneImage", s.id, s.name)} className="bg-[#07C160] hover:bg-[#06ad56] text-white p-1.5 rounded-full hover:scale-110 transition-transform shadow-lg">
                                  <Pencil size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setAddResourceDialog({ open: true, category: "asset", nameInput: "" })}
                    className="flex items-center justify-center gap-2 w-full bg-[#F9F9F9] hover:bg-[#F0F0F0] border border-dashed border-[#D9D9D9] hover:border-[#07C160] text-gray-600 hover:text-[#07C160] py-3 rounded-lg transition-colors text-sm font-medium"
                  >
                    <Plus size={16} />
                    Add Asset
                  </button>
                </div>
              </div>
            )}

            {activeTab === "footage" && (
              <div className="flex flex-col h-full gap-4">
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                  <div className="grid grid-cols-2 gap-3 content-start w-full">
                  {(content?.sceneVideos ?? []).map((v) => {
                    const thumb = thumbUrl(getSceneVideoThumbUrl(v));
                    return (
                      <div key={v.id} className="group flex flex-col rounded-lg overflow-hidden bg-white border border-[#E5E5E5] hover:border-[#07C160] transition-colors relative shadow-sm hover:shadow-md">
                        <div className="aspect-video relative cursor-pointer">
                          {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" /> : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs"><Video size={24} /></div>}
                          <div className="absolute top-1 right-1 bg-black/50 rounded px-1.5 py-0.5 text-[10px] text-white flex items-center gap-1 backdrop-blur-sm">
                            <Video size={10} />
                          </div>
                        </div>
                        <div className="p-2 text-xs border-t border-[#EBEDF0] bg-[#FAFAFA]">
                          <div className="font-medium text-gray-700 truncate">{v.name}</div>
                        </div>
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col p-3 z-20 backdrop-blur-[2px]">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleDeleteResource("sceneVideo", v.id); }}
                            className="absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-red-500/90 text-white transition-colors"
                            title="Remove from project"
                          >
                            <X size={12} />
                          </button>
                          <div className="text-[11px] font-medium text-white mb-1 truncate">{v.name}</div>
                          <div className="flex items-center justify-end mt-auto">
                            <button type="button" onClick={() => openGenerationModal("video", "sceneVideo", v.id, v.name)} className="bg-[#07C160] hover:bg-[#06ad56] text-white p-1.5 rounded-full hover:scale-110 transition-transform shadow-lg">
                              <Pencil size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setAddResourceDialog({ open: true, category: "footage", nameInput: "" })}
                    className="flex items-center justify-center gap-2 w-full bg-[#F9F9F9] hover:bg-[#F0F0F0] border border-dashed border-[#D9D9D9] hover:border-[#07C160] text-gray-600 hover:text-[#07C160] py-3 rounded-lg transition-colors text-sm font-medium"
                  >
                    <Plus size={16} />
                    Add Video Clip
                  </button>
                </div>
              </div>
            )}

            {activeTab === "audio" && (
              <div className="flex flex-col h-full">
                <div className="flex p-1 bg-[#F3F3F3] rounded-lg mb-4 shrink-0 border border-[#EBEDF0]">
                  <button
                    type="button"
                    onClick={() => setAudioTab("bgm")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-md transition-all",
                      audioTab === "bgm" ? "bg-white text-gray-900 shadow-sm border border-[#E5E5E5]" : "text-gray-500 hover:text-gray-800"
                    )}
                  >
                    BGM
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudioTab("voiceover")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-md transition-all",
                      audioTab === "voiceover" ? "bg-white text-gray-900 shadow-sm border border-[#E5E5E5]" : "text-gray-500 hover:text-gray-800"
                    )}
                  >
                    Voiceover
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                  <div className="flex flex-col gap-2">
                    {audioTab === "bgm" &&
                      (content?.audioBgm ?? []).map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 p-3 bg-white rounded-lg border border-[#E5E5E5] hover:border-[#07C160] transition-colors group cursor-pointer shadow-sm hover:shadow-md"
                        >
                          <button
                            type="button"
                            className="w-8 h-8 rounded-full bg-[#F3F3F3] group-hover:bg-[#07C160] text-gray-500 group-hover:text-white flex items-center justify-center transition-colors shrink-0 border border-[#E5E5E5] group-hover:border-transparent"
                          >
                            <Play size={14} className="translate-x-[1px]" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-800 truncate">{item.name}</div>
                            <div className="text-[10px] text-gray-500 mt-0.5 flex gap-2">
                              <span>{item.duration}</span>
                              <span className="text-[#07C160] font-medium">• {item.timelineTime}</span>
                            </div>
                          </div>
                          <button type="button" className="text-gray-400 hover:text-[#07C160] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <Plus size={18} />
                          </button>
                        </div>
                      ))}
                    {audioTab === "voiceover" &&
                      (content?.audioVoiceover ?? []).map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col p-3 bg-white rounded-lg border border-[#E5E5E5] hover:border-[#07C160] transition-colors group cursor-pointer shadow-sm hover:shadow-md"
                        >
                          <div className="flex items-center gap-3 mb-2">
                            <button
                              type="button"
                              className="w-8 h-8 rounded-full bg-[#F3F3F3] group-hover:bg-[#07C160] text-gray-500 group-hover:text-white flex items-center justify-center transition-colors shrink-0 border border-[#E5E5E5] group-hover:border-transparent"
                            >
                              <Play size={14} className="translate-x-[1px]" />
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-800 truncate flex items-center gap-2">
                                {item.name}
                                <Mic size={12} className="text-[#07C160]" />
                              </div>
                              <div className="text-[10px] text-gray-500 mt-0.5 flex gap-2">
                                <span>{item.duration}</span>
                                <span className="text-[#07C160] font-medium">• {item.timelineTime}</span>
                              </div>
                            </div>
                            <button type="button" className="text-gray-400 hover:text-[#07C160] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <Plus size={18} />
                            </button>
                          </div>
                          {item.text && (
                            <div className="text-xs text-gray-600 bg-[#F9F9F9] p-2 rounded border border-[#EBEDF0] italic">
                              &quot;{item.text}&quot;
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Video Preview - match design */}
        <div className="flex-1 bg-[#F0F0F0] flex flex-col items-center justify-center p-6 relative min-w-0">
          <div className="w-full max-w-3xl aspect-video bg-black rounded-lg shadow-2xl overflow-hidden border border-[#D9D9D9] relative flex flex-col">
            <div className="flex-1 relative bg-[#111]">
              {content?.sceneVideos?.[0] && (() => {
                const t = thumbUrl(getSceneVideoThumbUrl(content.sceneVideos[0]));
                return t ? <img src={t} alt="" className="w-full h-full object-cover opacity-95" /> : null;
              })()}
              {(!content?.sceneVideos?.length || !thumbUrl(getSceneVideoThumbUrl(content.sceneVideos[0]))) && (
                <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">Preview</div>
              )}
            </div>
            <div className="h-14 bg-white flex items-center justify-between px-4 border-t border-[#EBEDF0]">
              <div className="text-xs font-mono text-gray-500 font-medium">00:00 / 00:00</div>
              <div className="flex items-center gap-4">
                <button type="button" className="text-gray-500 hover:text-gray-900 transition-colors">
                  <SkipBack size={20} />
                </button>
                <button type="button" onClick={() => setIsPlaying(!isPlaying)} className="w-10 h-10 rounded-full bg-[#07C160] text-white flex items-center justify-center hover:bg-[#06ad56] transition-colors shadow-md shadow-[#07C160]/20">
                  {isPlaying ? <Pause size={20} className="fill-white" /> : <Play size={20} className="fill-white translate-x-0.5" />}
                </button>
                <button type="button" className="text-gray-500 hover:text-gray-900 transition-colors">
                  <SkipForward size={20} />
                </button>
              </div>
              <div className="flex items-center gap-3 text-gray-500">
                <button type="button" className="hover:text-gray-900 transition-colors text-xs font-medium bg-[#F3F3F3] px-2 py-1 rounded">1080p</button>
                <button type="button" className="hover:text-gray-900 transition-colors bg-[#F3F3F3] p-1.5 rounded"><SplitSquareHorizontal size={16} /></button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Timeline (read-only) */}
      <div className="h-[280px] bg-white border-t border-[#EBEDF0] flex flex-col shrink-0 opacity-50 pointer-events-none select-none relative">
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <span className="text-sm font-medium text-gray-400 bg-white/90 px-4 py-2 rounded-lg border border-[#EBEDF0] shadow-sm">
            Coming soon
          </span>
        </div>
        {/* Toolbar */}
        <div className="h-10 border-b border-[#EBEDF0] flex items-center justify-between px-4 bg-[#F9F9F9]">
          <div className="flex items-center gap-4">
            <button type="button" className="p-1.5 text-gray-500 hover:text-gray-900 rounded hover:bg-[#E5E5E5] transition-colors" title="Select">
              <MousePointer2 size={16} />
            </button>
            <button type="button" className="p-1.5 text-gray-500 hover:text-gray-900 rounded hover:bg-[#E5E5E5] transition-colors" title="Split">
              <Scissors size={16} />
            </button>
            <div className="w-px h-4 bg-[#D9D9D9]" />
            <span className="text-xs text-gray-500 font-medium">Track Magnet</span>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="p-1.5 text-gray-500 hover:text-gray-900 rounded hover:bg-[#E5E5E5] transition-colors">
              <ZoomOut size={16} />
            </button>
            <div className="w-32 h-1 bg-[#D9D9D9] rounded-full relative">
              <div className="absolute left-1/4 w-1/2 h-full bg-[#07C160] rounded-full" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow border border-[#E5E5E5]" />
            </div>
            <button type="button" className="p-1.5 text-gray-500 hover:text-gray-900 rounded hover:bg-[#E5E5E5] transition-colors">
              <ZoomIn size={16} />
            </button>
          </div>
        </div>

        {/* Tracks Area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Track Headers */}
          <div className="w-[180px] bg-[#FAFAFA] border-r border-[#EBEDF0] flex flex-col z-10 shrink-0 shadow-[4px_0_12px_rgba(0,0,0,0.03)]">
            <div className="h-6 border-b border-[#EBEDF0] bg-[#F3F3F3]" />
            {timelineTracks.map((t) => {
              const IconForTrack = t.type.startsWith("V2") ? Layers : t.type.startsWith("V1") ? Video : Music;
              return (
                <div key={t.id} className="h-16 border-b border-[#EBEDF0] flex items-center px-3 gap-2">
                  <IconForTrack size={14} className="text-gray-400" />
                  <span className="text-xs font-medium text-gray-600">{t.type}</span>
                </div>
              );
            })}
          </div>

          {/* Track Content (scrollable) */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden relative bg-white">
            {/* Time ruler */}
            <div className="h-6 border-b border-[#EBEDF0] bg-[#F9F9F9] sticky top-0 flex items-end px-4 whitespace-nowrap overflow-hidden z-0">
              {Array.from({ length: 30 }).map((_, i) => (
                <div key={i} className="inline-block w-[100px] flex-shrink-0 relative h-full">
                  <span className="text-[10px] text-gray-400 absolute bottom-1 left-0 font-mono">{`00:00:${(i * 5).toString().padStart(2, "0")}`}</span>
                  <div className="absolute bottom-0 left-0 w-px h-1.5 bg-[#D9D9D9]" />
                  <div className="absolute bottom-0 left-[25px] w-px h-1 bg-[#E5E5E5]" />
                  <div className="absolute bottom-0 left-[50px] w-px h-1.5 bg-[#D9D9D9]" />
                  <div className="absolute bottom-0 left-[75px] w-px h-1 bg-[#E5E5E5]" />
                </div>
              ))}
            </div>

            {/* Playhead */}
            <div className="absolute top-0 bottom-0 left-[250px] w-px bg-red-500 z-20 pointer-events-none">
              <div className="absolute -top-0 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500" />
            </div>

            {/* Track rows */}
            <div className="relative w-[3000px]">
              {timelineTracks.map((track) => {
                const isAudio = track.type.startsWith("A");
                const isOverlay = track.type.startsWith("V2");
                return (
                  <div key={track.id} className="h-16 border-b border-[#EBEDF0] relative bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNFQkVERjAiLz48L3N2Zz4=')]">
                    {track.clips.map((clip) => {
                      const pxPerSec = 20;
                      const left = clip.startTime * pxPerSec + 50;
                      const width = clip.duration * pxPerSec;
                      const label = getClipLabel(clip, content);
                      const thumb = getClipThumb(clip, content);

                      if (isAudio) {
                        return (
                          <div
                            key={clip.id}
                            className="absolute top-2 bottom-2 bg-[#E8F8F0] border border-[#07C160]/30 rounded flex items-center px-2 cursor-pointer hover:bg-[#D1F1E1] transition-colors shadow-sm overflow-hidden"
                            style={{ left, width }}
                          >
                            <Music size={12} className="text-[#07C160] mr-2 shrink-0" />
                            <div className="flex-1 h-full flex items-center gap-[2px] opacity-60">
                              {Array.from({ length: Math.max(1, Math.floor(width / 6)) }).map((_, i) => (
                                <div key={i} className="w-1 bg-[#07C160] rounded-full" style={{ height: `${((Math.sin(i * 0.7) + 1) / 2) * 60 + 20}%` }} />
                              ))}
                            </div>
                            <span className="absolute left-8 text-[11px] text-[#05964B] font-medium truncate max-w-[80%]">{label}</span>
                          </div>
                        );
                      }

                      if (isOverlay) {
                        return (
                          <div
                            key={clip.id}
                            className="absolute top-2 bottom-2 bg-purple-100 border border-purple-300 rounded flex items-center px-2 cursor-pointer hover:bg-purple-200 transition-colors shadow-sm"
                            style={{ left, width }}
                          >
                            <Type size={12} className="text-purple-600 mr-2 shrink-0" />
                            <span className="text-[11px] text-purple-800 font-medium truncate">{label}</span>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={clip.id}
                          className="absolute top-1 bottom-1 bg-blue-50 border border-blue-200 rounded flex items-center px-1 cursor-pointer hover:bg-blue-100 transition-colors overflow-hidden shadow-sm"
                          style={{ left, width }}
                        >
                          {thumb && <div className="w-12 h-full bg-cover bg-center flex-shrink-0 rounded-sm" style={{ backgroundImage: `url(${thumb})` }} />}
                          <span className="text-[11px] text-blue-800 font-medium truncate ml-2">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,video/*"
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          e.currentTarget.value = "";
          const pending = pendingUploadRef.current;
          if (pending && files.length > 0 && projectId?.trim()) {
            pendingUploadRef.current = null;
            const electron = window.electron;
            const resourceType: "artAsset" | "sceneImage" | "sceneVideo" =
              pending.category === "footage" ? "sceneVideo" : pending.assetTab === "scene_image" ? "sceneImage" : "artAsset";
            if (!electron?.storyboard?.addResource) {
              toast.error("Add resource is not available");
              return;
            }
            try {
              const addPayload = {
                projectId: projectId.trim(),
                resourceType,
                name: pending.name,
                activeSource: "local_disk" as const,
              };
              const res = await electron.storyboard.addResource(addPayload);
              if (!res.ok || !res.data?.id) {
                toast.error("Failed to create resource");
                return;
              }
              const resourceId = res.data.id;
              const isImageAsset = resourceType === "artAsset" || resourceType === "sceneImage";
              if (isImageAsset && electron.storyboard.uploadLocalAsset && files[0]) {
                const file = files[0];
                const fileData = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = () => reject(new Error("Read failed"));
                  reader.readAsDataURL(file);
                });
                const up = await electron.storyboard.uploadLocalAsset({
                  projectId: projectId.trim(),
                  resourceType,
                  resourceId,
                  fileData,
                  filename: file.name || "image.jpg",
                });
                if (up.ok) {
                  await refreshProject();
                  toast.success(`Created "${pending.name}" and saved image.`);
                } else {
                  await refreshProject();
                  toast.warning(`Created "${pending.name}" but saving image failed.`);
                }
              } else {
                await refreshProject();
                if (isImageAsset) toast.success(`Created "${pending.name}".`);
                else toast.info(`Created "${pending.name}". Video upload coming soon.`);
              }
            } catch {
              toast.error("Failed to add resource");
            }
            return;
          }
          if (files.length) toast.info("Upload from local: save to project coming soon");
        }}
      />

      {showUpdateModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white border border-[#EBEDF0] rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Update Project?</h3>
              <button
                type="button"
                onClick={() => setShowUpdateModal(false)}
                className="text-gray-400 hover:text-gray-900 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-6 leading-relaxed">
              Your script has been saved. Would you like AI to automatically generate and update the <strong className="text-gray-900">Assets</strong>, <strong className="text-gray-900">Video Clips</strong>, and <strong className="text-gray-900">Audio</strong> based on your new script?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowUpdateModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-[#F3F3F3] rounded-lg transition-colors border border-[#E5E5E5]"
              >
                Not Now
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUpdateModal(false);
                }}
                className="px-4 py-2 bg-[#07C160] hover:bg-[#06ad56] text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 shadow-sm shadow-[#07C160]/20"
              >
                <RefreshCw size={16} />
                Update All
              </button>
            </div>
          </div>
        </div>
      )}

      {addResourceDialog.open && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white border border-[#EBEDF0] rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {addResourceDialog.category === "footage" ? "Add Video Clip" : "Add Asset"}
              </h3>
              <button type="button" onClick={() => setAddResourceDialog((p) => ({ ...p, open: false }))} className="text-gray-400 hover:text-gray-900 transition-colors">
                <X size={20} />
              </button>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
            <input
              autoFocus
              value={addResourceDialog.nameInput}
              onChange={(e) => setAddResourceDialog((p) => ({ ...p, nameInput: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter" && addResourceDialog.nameInput.trim()) void handleAddResourceConfirm("ai"); }}
              placeholder="Enter resource name..."
              className="w-full px-3 py-2 border border-[#D9D9D9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#07C160]/30 focus:border-[#07C160] mb-4"
            />
            <div className="flex gap-3">
              <button
                type="button"
                disabled={!addResourceDialog.nameInput.trim()}
                onClick={() => void handleAddResourceConfirm("ai")}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[#07C160] hover:bg-[#06ad56] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={14} />
                AI Generate
              </button>
              <button
                type="button"
                disabled={!addResourceDialog.nameInput.trim()}
                onClick={() => void handleAddResourceConfirm("upload")}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-[#D9D9D9] hover:border-[#07C160] text-gray-700 hover:text-[#07C160] text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Paperclip size={14} />
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {projectId && generationModal.isOpen && content && (
        <GenerationModal
          isOpen={generationModal.isOpen}
          onClose={() => setGenerationModal((prev) => ({ ...prev, isOpen: false }))}
          type={generationModal.type}
          projectId={projectId}
          resourceType={generationModal.resourceType}
          resourceId={generationModal.resourceId}
          resourceName={generationModal.resourceName}
          content={content}
          onContentUpdated={async () => { await refreshProject(); }}
          onTaskCreated={(task) => {
            setTasks((prev) => [task, ...prev]);
            setTaskPanelOpen(true);
          }}
          onTaskUpdated={(id, update) => {
            setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...update } : t)));
          }}
        />
      )}

      {/* Task Status Panel */}
      {tasks.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] w-[360px] bg-white border border-[#EBEDF0] rounded-xl shadow-2xl overflow-hidden">
          {/* Header - always visible */}
          <button
            type="button"
            onClick={() => setTaskPanelOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 bg-[#F9F9F9] border-b border-[#EBEDF0] hover:bg-[#F3F3F3] transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              {tasks[0].status === "running" ? (
                <Loader2 size={14} className="animate-spin text-[#07C160] shrink-0" />
              ) : tasks[0].status === "done" ? (
                <CheckCircle2 size={14} className="text-[#07C160] shrink-0" />
              ) : (
                <AlertCircle size={14} className="text-red-500 shrink-0" />
              )}
              <span className="text-xs font-medium text-gray-800 truncate">
                {tasks[0].type === "image" ? "Image" : "Video"}: {tasks[0].prompt.slice(0, 40)}{tasks[0].prompt.length > 40 ? "..." : ""}
              </span>
              <span className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0",
                tasks[0].status === "running" ? "bg-blue-100 text-blue-600" :
                tasks[0].status === "done" ? "bg-green-100 text-green-600" :
                "bg-red-100 text-red-600"
              )}>
                {tasks[0].status}
              </span>
            </div>
            {taskPanelOpen ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronUp size={16} className="text-gray-400 shrink-0" />}
          </button>

          {/* Expanded list */}
          {taskPanelOpen && (
            <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 px-4 py-3 border-b border-[#F3F3F3] last:border-b-0 cursor-pointer hover:bg-[#F9F9F9] transition-colors"
                  onClick={() => {
                    if (task.resourceId && task.resourceType) {
                      setGenerationModal({ isOpen: true, type: task.type, resourceType: task.resourceType, resourceId: task.resourceId, resourceName: task.resourceName });
                    }
                  }}
                >
                  <div className="mt-0.5 shrink-0">
                    {task.status === "running" ? (
                      <Loader2 size={14} className="animate-spin text-[#07C160]" />
                    ) : task.status === "done" ? (
                      <CheckCircle2 size={14} className="text-[#07C160]" />
                    ) : (
                      <AlertCircle size={14} className="text-red-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-medium text-gray-500 uppercase">{task.type}</span>
                      <span className="text-[10px] text-gray-400">{task.resourceName}</span>
                    </div>
                    <p className="text-xs text-gray-700 truncate">{task.prompt}</p>
                    {task.error && <p className="text-[10px] text-red-500 mt-0.5 truncate">{task.error}</p>}
                    <span className="text-[10px] text-gray-400 mt-0.5 block">
                      {new Date(task.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <span className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 mt-0.5",
                    task.status === "running" ? "bg-blue-100 text-blue-600" :
                    task.status === "done" ? "bg-green-100 text-green-600" :
                    "bg-red-100 text-red-600"
                  )}>
                    {task.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
