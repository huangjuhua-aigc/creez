/**
 * Storyboard data types. Aligned with docs/storyboard-feature-plan.md §2.
 * Root path: <workspaceRoot>/.creez/storyboard/
 */

/** Reference to an art asset or scene image by id; url is resolved at runtime. */
export interface ImageRefItem {
  artAssetId?: string;
  sceneImageId?: string;
}

export interface AIImageGeneration {
  id: string;
  url: string;
  prompt: string;
  model: string;
  ratio: string;
  createdAt: number;
  taskId?: string;
  imageRefs?: ImageRefItem[];
}

export interface AIVideoGeneration {
  id: string;
  url: string;
  prompt: string;
  model: string;
  ratio: string;
  duration: string;
  createdAt: number;
  taskId?: string;
  keyframes?: ImageRefItem[];
}

export type ActiveSource = "upload" | "ai_generation" | "local_disk";

export interface ArtAsset {
  id: string;
  name: string;
  details?: string;
  uploadUrl?: string;
  /** Relative path in project assets when activeSource === "local_disk" */
  localPath?: string;
  /** Relative path to uploaded image when activeSource === "local_disk" (preferred for display) */
  localImage?: string;
  aiImageGenerations: AIImageGeneration[];
  activeSource: ActiveSource;
  activeGenerationId?: string;
}

export interface SceneImageItem {
  id: string;
  name: string;
  text?: string;
  details?: string;
  uploadUrl?: string;
  /** Relative path in project assets when activeSource === "local_disk" */
  localPath?: string;
  /** Relative path to uploaded image when activeSource === "local_disk" (preferred for display) */
  localImage?: string;
  aiImageGenerations: AIImageGeneration[];
  activeSource: ActiveSource;
  activeGenerationId?: string;
}

export interface SceneVideoItem {
  id: string;
  name: string;
  text?: string;
  details?: string;
  uploadUrl?: string;
  aiVideoGenerations: AIVideoGeneration[];
  activeSource: ActiveSource;
  activeGenerationId?: string;
}

export interface AudioItem {
  id: string;
  name: string;
  duration: string;
  timelineTime: string;
  text?: string;
  url: string;
}

export interface TimelineClip {
  resourceType: "sceneImage" | "sceneVideo" | "artAsset" | "audioBgm" | "audioVoiceover";
  id: string;
  startTime: number;
  duration: number;
}

export interface TimelineTrack {
  id: string;
  type: string;
  clips: TimelineClip[];
}

export interface TimelineData {
  tracks: TimelineTrack[];
}

export interface StoryboardContent {
  script: string;
  artAssets: ArtAsset[];
  sceneImages: SceneImageItem[];
  sceneVideos: SceneVideoItem[];
  audioBgm: AudioItem[];
  audioVoiceover: AudioItem[];
  timeline: TimelineData;
}

export interface StoryboardProjectMeta {
  title: string;
  prompt: string;
  supplementPayload?: unknown;
  createdAt: number;
  updatedAt: number;
  thumbnailPath?: string;
}

export interface StoryboardProject {
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  createdAt: number;
  updatedAt: number;
  prompt: string;
  supplementPayload?: unknown;
  content: StoryboardContent;
}

// ── Supplement Form Types ────────────────────────────────────────────

export interface SupplementOption {
  value: string;
  label: string;
}

export interface SupplementGroup {
  id: string;
  question: string;
  inputType: "text" | "select";
  placeholder?: string;
  options?: SupplementOption[];
}

export interface SupplementSchema {
  message: string;
  groups: SupplementGroup[];
}

export type StoryboardAgentStatus = "need_supplement" | "ready" | "error";

export interface AgentCreateResult {
  projectId: string;
  status: StoryboardAgentStatus;
  supplement?: SupplementSchema;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Default empty content for new projects. */
export function emptyStoryboardContent(): StoryboardContent {
  return {
    script: "",
    artAssets: [],
    sceneImages: [],
    sceneVideos: [],
    audioBgm: [],
    audioVoiceover: [],
    timeline: { tracks: [] },
  };
}
