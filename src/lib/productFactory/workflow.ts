import {
  DEFAULT_PRODUCT_FACTORY_PACK,
  PRODUCT_FACTORY_GRAPH_VERSION,
  type ProductFactoryGraph,
  type ProductFactoryGraphNode,
  type ProductFactoryGraphPort,
  type ProductFactoryPack,
} from "@/lib/productFactory/types";

function nodeId(kind: string, slot?: string, ratio?: string) {
  return [kind, slot, ratio].filter(Boolean).join(":");
}

const PORTS: Record<string, { inputs: ProductFactoryGraphPort[]; outputs: ProductFactoryGraphPort[] }> = {
  source: {
    inputs: [],
    outputs: [
      { id: "primary", label: "商品主参考", kind: "reference" },
      { id: "supplemental", label: "补充参考", kind: "reference", multiple: true },
      { id: "brand", label: "品牌参考", kind: "reference", multiple: true },
    ],
  },
  image: {
    inputs: [{ id: "reference", label: "参考图", kind: "image", required: true, multiple: true }],
    outputs: [{ id: "image", label: "图片", kind: "image" }],
  },
  review: {
    inputs: [{ id: "candidate", label: "候选图片", kind: "image", multiple: true }],
    outputs: [{ id: "approved", label: "已批准图片", kind: "review", multiple: true }],
  },
  video: {
    inputs: [
      { id: "primary", label: "主参考", kind: "review", required: true },
      { id: "startFrame", label: "首帧", kind: "review" },
      { id: "endFrame", label: "尾帧", kind: "review" },
      { id: "references", label: "多参考", kind: "review", multiple: true },
    ],
    outputs: [],
  },
  group: { inputs: [], outputs: [] },
  note: { inputs: [], outputs: [] },
};

function portsFor(type: ProductFactoryGraphNode["type"]) {
  const ports = PORTS[type] || PORTS.note;
  return {
    inputs: ports.inputs.map((port) => ({ ...port })),
    outputs: ports.outputs.map((port) => ({ ...port })),
  };
}

function defaultPorts(sourceType: ProductFactoryGraphNode["type"], targetType: ProductFactoryGraphNode["type"]) {
  const sourcePort = sourceType === "source" ? "primary" : sourceType === "review" ? "approved" : "image";
  const targetPort = targetType === "review" ? "candidate" : targetType === "video" ? "primary" : "reference";
  return { sourcePort, targetPort };
}

export function normalizeFactoryPack(value?: Partial<ProductFactoryPack> | null): ProductFactoryPack {
  const requested = value || {};
  const imageSlots = DEFAULT_PRODUCT_FACTORY_PACK.imageSlots.filter((slot) => !requested.imageSlots || requested.imageSlots.includes(slot));
  const videoSlots = DEFAULT_PRODUCT_FACTORY_PACK.videoSlots.filter((slot) => !requested.videoSlots || requested.videoSlots.includes(slot));
  const ratios = DEFAULT_PRODUCT_FACTORY_PACK.ratios.filter((ratio) => !requested.ratios || requested.ratios.includes(ratio));
  return {
    imageSlots: imageSlots.length ? imageSlots : [...DEFAULT_PRODUCT_FACTORY_PACK.imageSlots],
    videoSlots: videoSlots.length ? videoSlots : [...DEFAULT_PRODUCT_FACTORY_PACK.videoSlots],
    ratios: ratios.length ? ratios : [...DEFAULT_PRODUCT_FACTORY_PACK.ratios],
    imageQuality: ["1K", "2K", "4K"].includes(String(requested.imageQuality)) ? requested.imageQuality! : DEFAULT_PRODUCT_FACTORY_PACK.imageQuality,
    videoResolution: String(requested.videoResolution || DEFAULT_PRODUCT_FACTORY_PACK.videoResolution),
    videoDuration: Math.max(1, Math.min(30, Number(requested.videoDuration || DEFAULT_PRODUCT_FACTORY_PACK.videoDuration))),
    videoAudio: Boolean(requested.videoAudio),
  };
}

export function createDefaultProductWorkflow(productId: number, packValue?: Partial<ProductFactoryPack> | null): ProductFactoryGraph {
  const pack = normalizeFactoryPack(packValue);
  const source = nodeId("source");
  const review = nodeId("review");
  const nodes: ProductFactoryGraph["nodes"] = [
    { id: source, type: "source", position: { x: 80, y: 260 }, data: { label: "商品参考图", outputKey: "source", roleKey: "source", system: true, ...portsFor("source") } },
  ];
  const edges: ProductFactoryGraph["edges"] = [];
  let imageIndex = 0;
  for (const ratio of pack.ratios) {
    for (const slot of pack.imageSlots) {
      const id = nodeId("image", slot, ratio);
      nodes.push({
        id,
        type: "image",
        position: { x: 430, y: 80 + imageIndex * 150 },
        data: { label: slot, slotKey: slot, aspectRatio: ratio, outputKey: `${slot}:${ratio}`, roleKey: slot, modelOverride: null, runtime: { quality: pack.imageQuality }, promptOverride: null, promptCustomized: false, ...portsFor("image") },
      });
      edges.push({ id: `edge:${source}:primary:${id}:reference`, source, target: id, sourcePort: "primary", targetPort: "reference" });
      imageIndex += 1;
    }
  }
  nodes.push({ id: review, type: "review", position: { x: 820, y: 260 }, data: { label: "人工审核", outputKey: "review", roleKey: "review", system: true, ...portsFor("review") } });
  for (const node of nodes.filter((item) => item.type === "image")) edges.push({ id: `edge:${node.id}:image:${review}:candidate`, source: node.id, target: review, sourcePort: "image", targetPort: "candidate" });
  let videoIndex = 0;
  for (const ratio of pack.ratios) {
    for (const slot of pack.videoSlots) {
      const id = nodeId("video", slot, ratio);
      nodes.push({
        id,
        type: "video",
        position: { x: 1160, y: 140 + videoIndex * 180 },
        data: { label: slot, slotKey: slot, aspectRatio: ratio, outputKey: `${slot}:${ratio}`, roleKey: slot, modelOverride: null, runtime: { resolution: pack.videoResolution, duration: pack.videoDuration, audio: pack.videoAudio }, promptOverride: null, promptCustomized: false, ...portsFor("video") },
      });
      edges.push({ id: `edge:${review}:approved:${id}:primary`, source: review, target: id, sourcePort: "approved", targetPort: "primary" });
      videoIndex += 1;
    }
  }
  const reviewMappings: Record<string, number | null> = {};
  const reviewBindings: ProductFactoryGraph["reviewBindings"] = {};
  for (const ratio of pack.ratios) {
    reviewMappings[`video_hero:${ratio}`] = null;
    reviewMappings[`video_lifestyle:${ratio}`] = null;
    reviewBindings[nodeId("video", "video_hero", ratio)] = { primary: null };
    reviewBindings[nodeId("video", "video_lifestyle", ratio)] = { primary: null };
  }
  return {
    version: PRODUCT_FACTORY_GRAPH_VERSION,
    productId,
    customized: false,
    nodes,
    edges,
    reviewMappings,
    reviewBindings,
    viewport: { x: 30, y: 30, zoom: 0.75 },
  };
}

export function migrateProductFactoryGraph(value: ProductFactoryGraph | null | undefined, productId: number, pack?: Partial<ProductFactoryPack> | null) {
  const fallback = createDefaultProductWorkflow(productId, pack);
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return { graph: fallback, migrated: true };
  const sourceById = new Map(value.nodes.map((node) => [node.id, node]));
  const graph: ProductFactoryGraph = {
    ...value,
    version: PRODUCT_FACTORY_GRAPH_VERSION,
    productId,
    customized: Boolean(value.customized),
    nodes: value.nodes.map((node) => {
      const slotKey = String(node.data?.slotKey || "");
      const aspectRatio = String(node.data?.aspectRatio || "");
      return {
        ...node,
        position: { x: Number(node.position?.x || 0), y: Number(node.position?.y || 0) },
        data: {
          ...node.data,
          label: String(node.data?.label || slotKey || (node.type === "source" ? "商品参考图" : node.type === "review" ? "人工审核" : node.type)),
          outputKey: String(node.data?.outputKey || [slotKey, aspectRatio].filter(Boolean).join(":") || node.id),
          roleKey: String(node.data?.roleKey || slotKey || node.type),
          modelOverride: node.data?.modelOverride ? String(node.data.modelOverride) : null,
          runtime: node.data?.runtime && typeof node.data.runtime === "object" ? node.data.runtime : {},
          system: node.type === "source" || node.type === "review" ? true : Boolean(node.data?.system),
          ...portsFor(node.type),
        },
      };
    }),
    edges: value.edges.map((edge) => {
      const defaults = defaultPorts(sourceById.get(edge.source)?.type || "source", sourceById.get(edge.target)?.type || "image");
      const sourcePort = edge.sourcePort || defaults.sourcePort;
      const targetPort = edge.targetPort || defaults.targetPort;
      return { ...edge, id: edge.id || `edge:${edge.source}:${sourcePort}:${edge.target}:${targetPort}`, sourcePort, targetPort };
    }),
    reviewMappings: { ...(value.reviewMappings || {}) },
    reviewBindings: { ...(value.reviewBindings || {}) },
    viewport: {
      x: Number(value.viewport?.x || 0),
      y: Number(value.viewport?.y || 0),
      zoom: Math.max(0.25, Math.min(2, Number(value.viewport?.zoom || 0.75))),
    },
  };
  for (const node of graph.nodes.filter((candidate) => candidate.type === "video")) {
    if (graph.reviewBindings[node.id]) continue;
    const legacyKey = `${String(node.data.slotKey || "")}:${String(node.data.aspectRatio || "")}`;
    graph.reviewBindings[node.id] = { primary: graph.reviewMappings[legacyKey] ?? null };
  }
  return { graph, migrated: Number(value.version || 1) < PRODUCT_FACTORY_GRAPH_VERSION };
}

export interface ProductFactoryGraphDiff {
  layoutChanged: boolean;
  semanticChangedNodeIds: string[];
  affectedNodeIds: string[];
  removedNodeIds: string[];
}

function semanticNode(node: ProductFactoryGraphNode) {
  const { label: _label, inputs: _inputs, outputs: _outputs, ...data } = node.data || {};
  return JSON.stringify({ type: node.type, data });
}

export function diffProductFactoryGraphs(previous: ProductFactoryGraph, next: ProductFactoryGraph): ProductFactoryGraphDiff {
  const before = new Map(previous.nodes.map((node) => [node.id, node]));
  const after = new Map(next.nodes.map((node) => [node.id, node]));
  const changed = new Set<string>();
  let layoutChanged = JSON.stringify(previous.viewport) !== JSON.stringify(next.viewport);
  for (const node of next.nodes) {
    const old = before.get(node.id);
    if (!old) changed.add(node.id);
    else {
      if (semanticNode(old) !== semanticNode(node)) changed.add(node.id);
      if (old.position.x !== node.position.x || old.position.y !== node.position.y) layoutChanged = true;
    }
  }
  const removedNodeIds = previous.nodes.filter((node) => !after.has(node.id)).map((node) => node.id);
  const edgeKey = (edge: ProductFactoryGraph["edges"][number]) => `${edge.source}:${edge.sourcePort || ""}>${edge.target}:${edge.targetPort || ""}`;
  const oldEdges = new Set(previous.edges.map(edgeKey));
  const newEdges = new Set(next.edges.map(edgeKey));
  for (const edge of next.edges) if (!oldEdges.has(edgeKey(edge))) changed.add(edge.target);
  for (const edge of previous.edges) if (!newEdges.has(edgeKey(edge))) changed.add(edge.target);
  if (JSON.stringify(previous.reviewBindings || {}) !== JSON.stringify(next.reviewBindings || {})) {
    for (const id of new Set([...Object.keys(previous.reviewBindings || {}), ...Object.keys(next.reviewBindings || {})])) changed.add(id);
  }
  const outgoing = new Map(next.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of next.edges) outgoing.get(edge.source)?.push(edge.target);
  const affected = new Set(changed);
  const queue = [...changed];
  while (queue.length) {
    for (const target of outgoing.get(queue.shift()!) || []) if (!affected.has(target)) { affected.add(target); queue.push(target); }
  }
  return { layoutChanged, semanticChangedNodeIds: [...changed], affectedNodeIds: [...affected], removedNodeIds };
}

export function validateProductWorkflow(graph: ProductFactoryGraph) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length) throw new Error("工作流包含重复节点 ID");
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error("工作流连线引用了不存在的节点");
    if (edge.source === edge.target) throw new Error("工作流节点不能连接自身");
    const sourceNode = graph.nodes.find((node) => node.id === edge.source)!;
    const targetNode = graph.nodes.find((node) => node.id === edge.target)!;
    if (sourceNode.type === "video") throw new Error("视频节点必须是工作流终点");
    if (targetNode.type === "video" && sourceNode.type !== "review") throw new Error("视频节点不能绕过人工审核门");
    if (edge.sourcePort || edge.targetPort) {
      const sourcePort = sourceNode.data.outputs?.find((port) => port.id === edge.sourcePort);
      const targetPort = targetNode.data.inputs?.find((port) => port.id === edge.targetPort);
      if (!sourcePort || !targetPort) throw new Error(`工作流连线 ${edge.id} 使用了无效端口`);
      if (sourcePort.kind !== targetPort.kind && !(sourceNode.type === "source" && targetNode.type === "image")) throw new Error(`工作流连线 ${edge.id} 的端口类型不兼容`);
    }
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const target of outgoing.get(id) || []) {
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (visited !== graph.nodes.length) throw new Error("工作流中存在循环连接");
  if (!graph.nodes.some((node) => node.type === "source")) throw new Error("工作流缺少商品参考图节点");
  if (!graph.nodes.some((node) => node.type === "review")) throw new Error("工作流缺少人工审核节点");
  return true;
}
