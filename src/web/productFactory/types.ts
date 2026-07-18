export interface ModelOption { id: string | number; label: string; value: string; type: string; name?: string; }
export interface Project { id: number; name: string; intro?: string; projectType?: string; type?: string; artStyle?: string; directorManual?: string; imageModel?: string; videoModel?: string; imageQuality?: string; videoRatio?: string; mode?: string; createTime?: number; }
export interface Reference { id: number; url: string; fileName: string; isPrimary: number; width?: number; height?: number; }
export interface Artifact { id: number; workflowNodeId?: string; mediaType: "image" | "video"; slotKey: string; aspectRatio: string; version: number; url?: string; state: string; approved: number; inputChanged?: number; isCurrent?: number; detached?: number; prompt?: string; errorReason?: string; model?: string; params?: Record<string, unknown>; }
export interface FactorySummary { id: number; sku: string; name: string; category?: string; state: string; updateTime?: number; thumbnailUrl?: string; referenceCount: number; imageCount: number; videoCount: number; }
export interface FactoryItem { id: number; sku: string; name: string; category?: string; description?: string; sellingPoints: string[]; attributes: Record<string, unknown>; state: string; references: Reference[]; artifacts: Artifact[]; workflow: FactoryWorkflow; }
export type NodeType = "source" | "image" | "review" | "video" | "group" | "note";
export interface FactoryPort { id: string; label: string; kind: "reference" | "image" | "review" | "video"; required?: boolean; multiple?: boolean; }
export interface FactoryGraphNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, any> & { label?: string; outputKey?: string; roleKey?: string; modelOverride?: string | null; runtime?: Record<string, unknown>; inputs?: FactoryPort[]; outputs?: FactoryPort[]; system?: boolean };
}
export interface FactoryGraphEdge { id: string; source: string; target: string; sourcePort?: string; targetPort?: string; }
export interface FactoryGraph { productId: number; nodes: FactoryGraphNode[]; edges: FactoryGraphEdge[]; reviewMappings: Record<string, number | null>; reviewBindings: Record<string, Record<string, number | number[] | null>>; viewport: { x: number; y: number; zoom: number }; customized: boolean; version: number; }
export interface FactoryWorkflow { graph: FactoryGraph; customized: number; revision: number; templateRevision?: number; version: number; }
export interface Workspace { project: Project; config: any; brandReferences: Reference[]; counts: Record<string, number>; aiPolishAvailable: boolean; }
