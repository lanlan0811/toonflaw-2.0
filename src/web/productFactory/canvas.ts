import type { Artifact, FactoryGraph, FactoryGraphEdge, FactoryGraphNode, FactoryPort } from "./types";

const NODE_WIDTH = 208;
const NODE_HEIGHT = 104;
const MIN_ZOOM = .25;
const MAX_ZOOM = 2;
const labels: Record<string, string> = {
  source: "商品参考图", review: "人工审核门", main_clean: "干净主图", scene_studio: "棚拍场景",
  scene_lifestyle: "生活场景", scene_detail: "材质特写", video_hero: "英雄镜头", video_lifestyle: "生活镜头",
};

function h(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

function clone(graph: FactoryGraph) { return structuredClone(graph); }
function uid(prefix: string) { return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`; }
function nodeLabel(node: FactoryGraphNode) { return String(node.data.label || labels[String(node.data.roleKey || node.data.slotKey || node.type)] || node.id); }
function executable(node: FactoryGraphNode) { return node.type === "image" || node.type === "video"; }

export interface CanvasOptions {
  artifacts?: Artifact[];
  onChange: (graph: FactoryGraph) => Promise<void>;
  onSelectionChange?: (nodeIds: string[]) => void;
  onRun?: (nodeId: string, includeDownstream: boolean) => void;
  onStatus?: (status: "saving" | "saved" | "error", message?: string) => void;
}

export interface CanvasController {
  getGraph(): FactoryGraph;
  fitView(): void;
  select(nodeIds: string[]): void;
  updateNode(nodeId: string, patch: Partial<FactoryGraphNode["data"]>): void;
  destroy(): void;
}

export function renderCanvas(host: HTMLElement, initialGraph: FactoryGraph, options: CanvasOptions): CanvasController {
  let graph = clone(initialGraph);
  let selected = new Set<string>();
  let copied: FactoryGraphNode[] = [];
  let history: FactoryGraph[] = [clone(graph)];
  let historyIndex = 0;
  let saveTimer = 0;
  let spacePressed = false;
  let connection: { nodeId: string; portId: string } | null = null;
  let destroyed = false;

  host.innerHTML = `<div class="pf-canvas" tabindex="0">
    <div class="pf-canvas-toolbar" aria-label="画布工具栏">
      <button data-cmd="undo" title="撤销 Ctrl+Z">↶</button><button data-cmd="redo" title="重做 Ctrl+Shift+Z">↷</button><i></i>
      <button data-cmd="fit">适配视图</button><button data-cmd="layout">自动排版</button><button data-cmd="group">分组框</button><button data-cmd="note">便签</button>
      <span data-canvas-hint>滚轮缩放 · 空白/空格拖动画布 · Shift 框选</span>
    </div>
    <div class="pf-canvas-stage" data-stage>
      <div class="pf-canvas-world" data-world><svg class="pf-canvas-edges" data-edges></svg><div data-nodes></div></div>
      <div class="pf-selection-rect" data-selection-rect hidden></div>
      <div class="pf-canvas-zoom"><button data-cmd="zoom-out">−</button><b data-zoom></b><button data-cmd="zoom-in">＋</button></div>
      <div class="pf-minimap" data-minimap><div data-minimap-nodes></div><span data-minimap-view></span></div>
    </div>
  </div>`;
  const root = host.querySelector<HTMLElement>(".pf-canvas")!;
  const stage = host.querySelector<HTMLElement>("[data-stage]")!;
  const world = host.querySelector<HTMLElement>("[data-world]")!;
  const nodesHost = host.querySelector<HTMLElement>("[data-nodes]")!;
  const svg = host.querySelector<SVGElement>("[data-edges]")!;
  const zoomLabel = host.querySelector<HTMLElement>("[data-zoom]")!;
  const selectionRect = host.querySelector<HTMLElement>("[data-selection-rect]")!;
  const minimap = host.querySelector<HTMLElement>("[data-minimap]")!;
  const minimapNodes = host.querySelector<HTMLElement>("[data-minimap-nodes]")!;
  const minimapView = host.querySelector<HTMLElement>("[data-minimap-view]")!;

  const artifactFor = (nodeId: string) => (options.artifacts || []).find((artifact) => artifact.workflowNodeId === nodeId && artifact.isCurrent);
  const stagePoint = (event: { clientX: number; clientY: number }) => {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const worldPoint = (point: { x: number; y: number }) => ({ x: (point.x - graph.viewport.x) / graph.viewport.zoom, y: (point.y - graph.viewport.y) / graph.viewport.zoom });

  function applyViewport() {
    graph.viewport.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, graph.viewport.zoom || .75));
    world.style.transform = `translate(${graph.viewport.x}px,${graph.viewport.y}px) scale(${graph.viewport.zoom})`;
    zoomLabel.textContent = `${Math.round(graph.viewport.zoom * 100)}%`;
    updateMinimap();
  }

  function edgePath(edge: FactoryGraphEdge) {
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);
    if (!source || !target) return "";
    const outputIndex = Math.max(0, (source.data.outputs || []).findIndex((port: FactoryPort) => port.id === edge.sourcePort));
    const inputIndex = Math.max(0, (target.data.inputs || []).findIndex((port: FactoryPort) => port.id === edge.targetPort));
    const x1 = source.position.x + NODE_WIDTH, y1 = source.position.y + 46 + outputIndex * 19;
    const x2 = target.position.x, y2 = target.position.y + 46 + inputIndex * 19;
    const bend = Math.max(54, Math.abs(x2 - x1) * .44);
    return `<path data-edge="${h(edge.id)}" d="M${x1} ${y1} C${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}"/><path class="pf-edge-hit" data-edge-remove="${h(edge.id)}" d="M${x1} ${y1} C${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}"/>`;
  }

  function drawEdges() {
    svg.innerHTML = graph.edges.map(edgePath).join("");
    svg.querySelectorAll<SVGPathElement>("[data-edge-remove]").forEach((path) => path.addEventListener("dblclick", () => {
      graph.edges = graph.edges.filter((edge) => edge.id !== path.dataset.edgeRemove);
      commit(true); render();
    }));
  }

  function portMarkup(node: FactoryGraphNode, side: "inputs" | "outputs") {
    return (node.data[side] || []).map((port: FactoryPort) => `<button class="pf-port pf-port-${side}" data-node="${h(node.id)}" data-port="${h(port.id)}" title="${h(port.label)}"><span>${h(port.label)}</span></button>`).join("");
  }

  function renderNode(node: FactoryGraphNode) {
    const element = document.createElement("article");
    const artifact = artifactFor(node.id);
    element.className = `pf-canvas-node pf-node-${node.type}${selected.has(node.id) ? " selected" : ""}${node.data.system ? " protected" : ""}`;
    element.dataset.nodeId = node.id;
    element.style.left = `${node.position.x}px`; element.style.top = `${node.position.y}px`;
    const status = artifact?.state || (node.type === "review" ? "gate" : node.type === "source" ? "ready" : "idle");
    const preview = artifact?.url ? `<img src="${h(artifact.url)}" alt="">` : `<div class="pf-node-icon">${node.type === "video" ? "▶" : node.type === "image" ? "◇" : node.type === "review" ? "✓" : node.type === "note" ? "T" : "◆"}</div>`;
    element.innerHTML = `${portMarkup(node, "inputs")}<header><small>${h(node.type)} · ${h(node.data.aspectRatio || "")}</small><em class="pf-node-state state-${h(status)}">${h(status)}</em></header><div class="pf-node-main">${preview}<div><strong>${h(nodeLabel(node))}</strong><span>${h(node.data.modelOverride || (node.type === "image" || node.type === "video" ? "继承项目模型" : node.data.outputKey || ""))}</span></div></div>${artifact?.inputChanged ? `<mark>输入已变化</mark>` : ""}${executable(node) ? `<footer><button data-run-node="${h(node.id)}">运行</button><button data-run-downstream="${h(node.id)}">运行下游</button></footer>` : ""}${portMarkup(node, "outputs")}`;
    nodesHost.appendChild(element);
    bindNode(element, node);
  }

  function render() {
    nodesHost.innerHTML = "";
    for (const node of graph.nodes) renderNode(node);
    drawEdges(); applyViewport();
  }

  function updateMinimap() {
    if (!graph.nodes.length) return;
    const minX = Math.min(...graph.nodes.map((node) => node.position.x)) - 80;
    const minY = Math.min(...graph.nodes.map((node) => node.position.y)) - 80;
    const maxX = Math.max(...graph.nodes.map((node) => node.position.x + NODE_WIDTH)) + 80;
    const maxY = Math.max(...graph.nodes.map((node) => node.position.y + NODE_HEIGHT)) + 80;
    const scale = Math.min(156 / Math.max(1, maxX - minX), 96 / Math.max(1, maxY - minY));
    minimap.dataset.minX = String(minX); minimap.dataset.minY = String(minY); minimap.dataset.scale = String(scale);
    minimapNodes.innerHTML = graph.nodes.map((node) => `<i class="type-${node.type}" style="left:${(node.position.x - minX) * scale}px;top:${(node.position.y - minY) * scale}px;width:${NODE_WIDTH * scale}px;height:${NODE_HEIGHT * scale}px"></i>`).join("");
    const rect = stage.getBoundingClientRect();
    minimapView.style.left = `${(-graph.viewport.x / graph.viewport.zoom - minX) * scale}px`;
    minimapView.style.top = `${(-graph.viewport.y / graph.viewport.zoom - minY) * scale}px`;
    minimapView.style.width = `${rect.width / graph.viewport.zoom * scale}px`;
    minimapView.style.height = `${rect.height / graph.viewport.zoom * scale}px`;
  }

  function paintSelection() { nodesHost.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => element.classList.toggle("selected", selected.has(element.dataset.nodeId || ""))); }
  function notifySelection(rerender = true) { options.onSelectionChange?.([...selected]); rerender ? render() : paintSelection(); }
  function select(ids: string[]) { selected = new Set(ids.filter((id) => graph.nodes.some((node) => node.id === id))); notifySelection(); }

  function snapshot() {
    history = history.slice(0, historyIndex + 1); history.push(clone(graph)); historyIndex = history.length - 1;
    if (history.length > 80) { history.shift(); historyIndex -= 1; }
  }

  function scheduleSave() {
    clearTimeout(saveTimer); options.onStatus?.("saving");
    saveTimer = window.setTimeout(async () => {
      try { await options.onChange(clone(graph)); options.onStatus?.("saved"); }
      catch (error) { options.onStatus?.("error", error instanceof Error ? error.message : String(error)); }
    }, 420);
  }

  function commit(addHistory = false) { if (addHistory) snapshot(); scheduleSave(); }

  function bindNode(element: HTMLElement, node: FactoryGraphNode) {
    element.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      if (event.ctrlKey || event.metaKey) selected.has(node.id) ? selected.delete(node.id) : selected.add(node.id); else if (!selected.has(node.id)) selected = new Set([node.id]);
      notifySelection();
    });
    let drag: { start: { x: number; y: number }; positions: Map<string, { x: number; y: number }> } | null = null;
    element.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button") || event.button !== 0) return;
      if (spacePressed) {
        const point = stagePoint(event);
        stageDrag = { mode: "pan", start: point, current: point, viewport: { x: graph.viewport.x, y: graph.viewport.y } };
        stage.classList.add("is-panning"); stage.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation(); return;
      }
      if (!selected.has(node.id)) selected = new Set([node.id]);
      drag = { start: stagePoint(event), positions: new Map(graph.nodes.filter((candidate) => selected.has(candidate.id)).map((candidate) => [candidate.id, { ...candidate.position }])) };
      element.setPointerCapture(event.pointerId); notifySelection(false); event.stopPropagation();
    });
    element.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const point = stagePoint(event); const dx = (point.x - drag.start.x) / graph.viewport.zoom; const dy = (point.y - drag.start.y) / graph.viewport.zoom;
      for (const [id, origin] of drag.positions) {
        const target = graph.nodes.find((candidate) => candidate.id === id);
        if (target) { target.position = { x: origin.x + dx, y: origin.y + dy }; const targetElement = nodesHost.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`); if (targetElement) { targetElement.style.left = `${target.position.x}px`; targetElement.style.top = `${target.position.y}px`; } }
      }
      drawEdges(); updateMinimap();
    });
    element.addEventListener("pointerup", () => { if (drag) { drag = null; snapshot(); scheduleSave(); } });
    element.querySelectorAll<HTMLElement>(".pf-port-outputs").forEach((port) => port.addEventListener("click", (event) => {
      event.stopPropagation(); connection = { nodeId: node.id, portId: port.dataset.port! }; root.classList.add("is-connecting");
    }));
    element.querySelectorAll<HTMLElement>(".pf-port-inputs").forEach((port) => port.addEventListener("click", (event) => {
      event.stopPropagation(); if (!connection) return;
      const source = graph.nodes.find((candidate) => candidate.id === connection!.nodeId);
      const sourcePort = source?.data.outputs?.find((candidate: FactoryPort) => candidate.id === connection!.portId);
      const targetPort = node.data.inputs?.find((candidate: FactoryPort) => candidate.id === port.dataset.port);
      if (!source || !sourcePort || !targetPort || source.id === node.id) return;
      const compatible = sourcePort.kind === targetPort.kind || (source.type === "source" && node.type === "image");
      const outgoing = new Map(graph.nodes.map((candidate) => [candidate.id, [] as string[]]));
      for (const edge of graph.edges) outgoing.get(edge.source)?.push(edge.target);
      const pending = [node.id]; const visited = new Set<string>(); let createsCycle = false;
      while (pending.length) { const id = pending.shift()!; if (id === source.id) { createsCycle = true; break; } if (visited.has(id)) continue; visited.add(id); pending.push(...(outgoing.get(id) || [])); }
      const occupied = !targetPort.multiple && graph.edges.some((edge) => edge.target === node.id && edge.targetPort === targetPort.id);
      if (!compatible || createsCycle || occupied || source.type === "video" || (node.type === "video" && source.type !== "review")) { connection = null; root.classList.remove("is-connecting"); return; }
      graph.edges.push({ id: uid("edge"), source: source.id, target: node.id, sourcePort: sourcePort.id, targetPort: targetPort.id });
      connection = null; root.classList.remove("is-connecting"); commit(true); render();
    }));
    element.querySelector<HTMLElement>("[data-run-node]")?.addEventListener("click", (event) => { event.stopPropagation(); options.onRun?.(node.id, false); });
    element.querySelector<HTMLElement>("[data-run-downstream]")?.addEventListener("click", (event) => { event.stopPropagation(); options.onRun?.(node.id, true); });
  }

  function zoomAt(nextZoom: number, anchor = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }) {
    const before = worldPoint(anchor); graph.viewport.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    graph.viewport.x = anchor.x - before.x * graph.viewport.zoom; graph.viewport.y = anchor.y - before.y * graph.viewport.zoom;
    applyViewport(); scheduleSave();
  }

  function fitView() {
    if (!graph.nodes.length) return;
    const minX = Math.min(...graph.nodes.map((node) => node.position.x)); const minY = Math.min(...graph.nodes.map((node) => node.position.y));
    const maxX = Math.max(...graph.nodes.map((node) => node.position.x + NODE_WIDTH)); const maxY = Math.max(...graph.nodes.map((node) => node.position.y + NODE_HEIGHT));
    const zoom = Math.max(MIN_ZOOM, Math.min(1.15, Math.min((stage.clientWidth - 120) / Math.max(1, maxX - minX), (stage.clientHeight - 120) / Math.max(1, maxY - minY))));
    graph.viewport = { zoom, x: (stage.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: (stage.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom };
    applyViewport(); scheduleSave();
  }

  function autoLayout() {
    const rank = new Map<string, number>();
    const visit = (id: string): number => { if (rank.has(id)) return rank.get(id)!; const incoming = graph.edges.filter((edge) => edge.target === id); const value = incoming.length ? Math.max(...incoming.map((edge) => visit(edge.source) + 1)) : 0; rank.set(id, value); return value; };
    for (const node of graph.nodes) visit(node.id);
    const columns = Map.groupBy(graph.nodes.filter((node) => node.type !== "group" && node.type !== "note"), (node) => rank.get(node.id) || 0);
    for (const [column, nodes] of columns) nodes.forEach((node, index) => { node.position = { x: 100 + column * 330, y: 90 + index * 150 }; });
    commit(true); render(); setTimeout(fitView);
  }

  function addDecoration(type: "group" | "note") {
    const center = worldPoint({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
    graph.nodes.push({ id: uid(type), type, position: center, data: { label: type === "group" ? "新分组" : "双击检查器编辑便签", outputKey: uid(type), roleKey: type, runtime: {}, inputs: [], outputs: [] } });
    commit(true); render();
  }

  function removeSelected() {
    const removable = graph.nodes.filter((node) => selected.has(node.id) && !node.data.system).map((node) => node.id);
    if (!removable.length) return;
    graph.nodes = graph.nodes.filter((node) => !removable.includes(node.id)); graph.edges = graph.edges.filter((edge) => !removable.includes(edge.source) && !removable.includes(edge.target));
    selected.clear(); commit(true); notifySelection();
  }

  function copySelected() { copied = graph.nodes.filter((node) => selected.has(node.id) && !node.data.system).map((node) => structuredClone(node)); }
  function paste() {
    if (!copied.length) return;
    const ids: string[] = []; for (const source of copied) { const node = structuredClone(source); node.id = uid(node.type); node.data.outputKey = uid(String(node.data.outputKey || node.type)); node.position.x += 36; node.position.y += 36; graph.nodes.push(node); ids.push(node.id); }
    selected = new Set(ids); commit(true); notifySelection();
  }

  function undo() { if (historyIndex <= 0) return; historyIndex -= 1; graph = clone(history[historyIndex]); selected.clear(); render(); scheduleSave(); options.onSelectionChange?.([]); }
  function redo() { if (historyIndex >= history.length - 1) return; historyIndex += 1; graph = clone(history[historyIndex]); selected.clear(); render(); scheduleSave(); options.onSelectionChange?.([]); }

  let stageDrag: { mode: "pan" | "select"; start: { x: number; y: number }; viewport?: { x: number; y: number }; current?: { x: number; y: number } } | null = null;
  stage.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest(".pf-canvas-node,.pf-canvas-zoom,.pf-minimap") || event.button !== 0) return;
    const point = stagePoint(event); const mode = event.shiftKey ? "select" : "pan";
    stageDrag = { mode, start: point, current: point, viewport: { x: graph.viewport.x, y: graph.viewport.y } };
    if (mode === "select") { selectionRect.hidden = false; selectionRect.style.left = `${point.x}px`; selectionRect.style.top = `${point.y}px`; selectionRect.style.width = "0"; selectionRect.style.height = "0"; }
    else stage.classList.add("is-panning");
    stage.setPointerCapture(event.pointerId); root.focus();
  });
  stage.addEventListener("pointermove", (event) => {
    if (!stageDrag) return; const point = stagePoint(event); stageDrag.current = point;
    if (stageDrag.mode === "pan") { graph.viewport.x = stageDrag.viewport!.x + point.x - stageDrag.start.x; graph.viewport.y = stageDrag.viewport!.y + point.y - stageDrag.start.y; applyViewport(); }
    else { const x = Math.min(point.x, stageDrag.start.x), y = Math.min(point.y, stageDrag.start.y); selectionRect.style.left = `${x}px`; selectionRect.style.top = `${y}px`; selectionRect.style.width = `${Math.abs(point.x - stageDrag.start.x)}px`; selectionRect.style.height = `${Math.abs(point.y - stageDrag.start.y)}px`; }
  });
  stage.addEventListener("pointerup", () => {
    if (!stageDrag) return;
    if (stageDrag.mode === "select") {
      const a = worldPoint(stageDrag.start), b = worldPoint(stageDrag.current || stageDrag.start); const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), right = Math.max(a.x, b.x), bottom = Math.max(a.y, b.y);
      selected = new Set(graph.nodes.filter((node) => node.position.x + NODE_WIDTH >= left && node.position.x <= right && node.position.y + NODE_HEIGHT >= top && node.position.y <= bottom).map((node) => node.id));
      selectionRect.hidden = true; notifySelection();
    } else { stage.classList.remove("is-panning"); scheduleSave(); }
    stageDrag = null;
  });
  stage.addEventListener("wheel", (event) => { event.preventDefault(); zoomAt(graph.viewport.zoom * Math.exp(-event.deltaY * .0012), stagePoint(event)); }, { passive: false });
  minimap.addEventListener("click", (event) => {
    const rect = minimap.getBoundingClientRect(); const scale = Number(minimap.dataset.scale || 1); const minX = Number(minimap.dataset.minX || 0); const minY = Number(minimap.dataset.minY || 0);
    const worldX = minX + (event.clientX - rect.left) / scale; const worldY = minY + (event.clientY - rect.top) / scale;
    graph.viewport.x = stage.clientWidth / 2 - worldX * graph.viewport.zoom; graph.viewport.y = stage.clientHeight / 2 - worldY * graph.viewport.zoom; applyViewport(); scheduleSave();
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement; if (target.matches("input,textarea,select") || destroyed || !host.isConnected) return;
    if (event.code === "Space") { spacePressed = true; event.preventDefault(); }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    else if (modifier && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    else if (modifier && event.key.toLowerCase() === "c") copySelected();
    else if (modifier && event.key.toLowerCase() === "v") { event.preventDefault(); paste(); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); }
    else if (event.key === "Escape") { connection = null; root.classList.remove("is-connecting"); selected.clear(); notifySelection(); }
    void spacePressed;
  };
  const onKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") spacePressed = false; };
  window.addEventListener("keydown", onKeyDown); window.addEventListener("keyup", onKeyUp);

  host.querySelectorAll<HTMLElement>("[data-cmd]").forEach((button) => button.addEventListener("click", () => {
    const command = button.dataset.cmd;
    if (command === "undo") undo(); else if (command === "redo") redo(); else if (command === "fit") fitView(); else if (command === "layout") autoLayout();
    else if (command === "group") addDecoration("group"); else if (command === "note") addDecoration("note");
    else if (command === "zoom-in") zoomAt(graph.viewport.zoom + .1); else if (command === "zoom-out") zoomAt(graph.viewport.zoom - .1);
  }));

  render(); requestAnimationFrame(() => { if (!Number.isFinite(graph.viewport.x)) fitView(); else applyViewport(); });
  return {
    getGraph: () => clone(graph), fitView, select,
    updateNode: (nodeId, patch) => { const node = graph.nodes.find((candidate) => candidate.id === nodeId); if (!node) return; node.data = { ...node.data, ...patch }; commit(true); render(); options.onSelectionChange?.([...selected]); },
    destroy: () => { destroyed = true; window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); },
  };
}
