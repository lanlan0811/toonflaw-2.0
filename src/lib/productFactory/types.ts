export const PRODUCT_FACTORY_MARKER = "__TOONFLOW_PRODUCT_FACTORY_V1__";
export const LEGACY_PROMO_MARKER = "__TOONFLOW_PRODUCT_PROMO_V1__";
export const PRODUCT_FACTORY_SCHEMA_VERSION = 2;
export const PRODUCT_FACTORY_GRAPH_VERSION = 2;
export const PRODUCT_PROMPT_TEMPLATE_VERSION = 2;

export const IMAGE_SLOTS = ["main_clean", "scene_studio", "scene_lifestyle", "scene_detail"] as const;
export const VIDEO_SLOTS = ["video_hero", "video_lifestyle"] as const;
export const FACTORY_RATIOS = ["9:16", "16:9"] as const;

export type ImageSlot = (typeof IMAGE_SLOTS)[number];
export type VideoSlot = (typeof VIDEO_SLOTS)[number];
export type ArtifactSlot = ImageSlot | VideoSlot | "legacy";
export type FactoryRatio = (typeof FACTORY_RATIOS)[number];
export type ProductFactoryPhase = "image" | "video";
export type PromptLanguage = "zh" | "en" | "bilingual";
export type ProductFactoryJobState = "queued" | "running" | "paused" | "success" | "failed" | "cancelled" | "interrupted";
export type ProductFactoryItemState =
  | "draft"
  | "ready"
  | "image_generating"
  | "awaiting_review"
  | "video_ready"
  | "video_generating"
  | "completed"
  | "partial_failed";

export interface ProductFactoryPack {
  imageSlots: ImageSlot[];
  videoSlots: VideoSlot[];
  ratios: FactoryRatio[];
  imageQuality: "1K" | "2K" | "4K";
  videoResolution: string;
  videoDuration: number;
  videoAudio: boolean;
}

export type ProductFactoryNodeType = "source" | "image" | "review" | "video" | "group" | "note";
export type ProductFactoryPortKind = "reference" | "image" | "review" | "video";

export interface ProductFactoryGraphPort {
  id: string;
  label: string;
  kind: ProductFactoryPortKind;
  required?: boolean;
  multiple?: boolean;
}

export interface ProductFactoryGraphNode {
  id: string;
  type: ProductFactoryNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown> & {
    label?: string;
    outputKey?: string;
    roleKey?: string;
    modelOverride?: string | null;
    runtime?: Record<string, unknown>;
    inputs?: ProductFactoryGraphPort[];
    outputs?: ProductFactoryGraphPort[];
    system?: boolean;
  };
}

export interface ProductFactoryGraphEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
}

export type ProductFactoryReviewBindings = Record<string, Record<string, number | number[] | null>>;

export interface ProductFactoryGraph {
  version: number;
  productId: number;
  customized: boolean;
  nodes: ProductFactoryGraphNode[];
  edges: ProductFactoryGraphEdge[];
  /** @deprecated v1 compatibility. Canonical v2 data lives in reviewBindings. */
  reviewMappings: Record<string, number | null>;
  reviewBindings: ProductFactoryReviewBindings;
  viewport: { x: number; y: number; zoom: number };
}

export interface ProductFactoryPromptSections {
  goal: string;
  facts: string;
  identity: string;
  creative: string;
  craft: string;
  brand: string;
  quality: string;
}

export interface ProductFactoryPromptResult {
  templateId: string;
  templateVersion: number;
  language: PromptLanguage;
  sections: ProductFactoryPromptSections;
  editableSectionKeys: (keyof ProductFactoryPromptSections)[];
  lockedSectionKeys: (keyof ProductFactoryPromptSections)[];
  compiledPrompt: string;
}

export const DEFAULT_PRODUCT_FACTORY_PACK: ProductFactoryPack = {
  imageSlots: [...IMAGE_SLOTS],
  videoSlots: [...VIDEO_SLOTS],
  ratios: [...FACTORY_RATIOS],
  imageQuality: "2K",
  videoResolution: "720p",
  videoDuration: 5,
  videoAudio: false,
};

export function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function now() {
  return Date.now();
}
