import "./styles.css";
import { apiDownload, apiPost, fileAsDataUrl } from "./api";
import { renderCanvas, type CanvasController } from "./canvas";
import type { Artifact, FactoryGraph, FactoryGraphNode, FactoryItem, FactorySummary, ModelOption, Project, Workspace } from "./types";

declare global {
  interface Window {
    __TOONFLOW_PRODUCT_FACTORY__?: boolean;
    __TOONFLOW_NORMALIZE_PRODUCT_PROMO_URL__?: () => boolean;
  }
}

const shouldBootstrap = !window.__TOONFLOW_PRODUCT_FACTORY__;
if (shouldBootstrap) window.__TOONFLOW_PRODUCT_FACTORY__ = true;
const ROUTE = "/product-factory";
const LEGACY_ROUTE = "/product-promo";
const HOME_ROUTE = "/project";
const MARKER = "__TOONFLOW_PRODUCT_FACTORY_V1__";
const LEGACY_MARKER = "__TOONFLOW_PRODUCT_PROMO_V1__";
const ROOT_ID = "tf-product-factory-root";
const PAGE_SIZE = 50;
const imageSlotNames: Record<string, string> = { main_clean: "干净主图", scene_studio: "棚拍场景", scene_lifestyle: "生活场景", scene_detail: "材质特写" };
const videoSlotNames: Record<string, string> = { video_hero: "英雄镜头", video_lifestyle: "生活镜头" };
const statusNames: Record<string, string> = { draft: "待补参考", ready: "可生成", image_generating: "图片生成中", awaiting_review: "待审核", video_ready: "视频就绪", video_generating: "视频生成中", completed: "已完成", partial_failed: "部分失败" };

const state = {
  root: null as HTMLElement | null,
  host: null as HTMLElement | null,
  projects: [] as Project[],
  imageModels: [] as ModelOption[],
  videoModels: [] as ModelOption[],
  workspace: null as Workspace | null,
  summaries: [] as FactorySummary[],
  current: null as FactoryItem | null,
  currentId: 0,
  projectId: 0,
  selected: new Set<number>(),
  selectedNodes: [] as string[],
  page: 1,
  total: 0,
  search: "",
  filter: "all",
  pollTimer: 0,
  renderTimer: 0,
  searchTimer: 0,
  canvas: null as CanvasController | null,
  saveChain: Promise.resolve() as Promise<unknown>,
};

function h(value: unknown) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)); }
function eventForm(event: Event) { return new FormData(event.currentTarget as HTMLFormElement); }
function routeInfo() { const raw = location.hash.replace(/^#/, ""); const [path, query = ""] = raw.split("?"); const params = new URLSearchParams(query); return { path: (path || "/").replace(/\/+$/, "") || "/", projectId: Number(params.get("projectId") || 0) }; }
function navigate(projectId?: number) { location.hash = `${ROUTE}${projectId ? `?projectId=${projectId}` : ""}`; }
function navigateHome() { location.hash = HOME_ROUTE; }
function isFactoryRoute() { return [ROUTE, LEGACY_ROUTE].includes(routeInfo().path); }
function modelKey(model?: ModelOption) { return model ? `${model.id}:${model.value}` : ""; }
function modelLabel(model?: ModelOption) { return model ? `${model.label || model.value}${model.name ? ` · ${model.name}` : ""}` : "未命名模型"; }
function modelOptions(models: ModelOption[], selected = "", inherit = false) {
  const options = models.map((model) => `<option value="${h(modelKey(model))}" ${modelKey(model) === selected ? "selected" : ""}>${h(modelLabel(model))}</option>`).join("");
  const missing = selected && !models.some((model) => modelKey(model) === selected) ? `<option value="${h(selected)}" selected>${h(selected)} · 配置已失效</option>` : "";
  return `${inherit ? `<option value="" ${selected ? "" : "selected"}>继承项目默认模型</option>` : ""}${missing}${options}`;
}

function toast(message: string, type = "info") {
  if (!state.root) return;
  let stack = state.root.querySelector<HTMLElement>(".pf-toasts");
  if (!stack) { stack = document.createElement("div"); stack.className = "pf-toasts"; state.root.appendChild(stack); }
  const item = document.createElement("div"); item.className = `pf-toast pf-${type}`; item.textContent = message; stack.appendChild(item); setTimeout(() => item.remove(), 4200);
}

function ensureVueRoute() {
  const root: any = document.querySelector("#app") || document.body.firstElementChild;
  const router = root?.__vue_app__?.config?.globalProperties?.$router;
  if (!router?.getRoutes || !router?.addRoute) return true;
  if (!router.hasRoute?.("toonflow-product-factory")) {
    const workbench = router.getRoutes().find((record: any) => record.path === "/workbench");
    if (!workbench?.components?.default) return false;
    router.addRoute({ path: ROUTE, name: "toonflow-product-factory", component: workbench.components.default, meta: { title: "商品视觉工厂" } });
  }
  if (routeInfo().path === ROUTE && router.currentRoute?.value?.name !== "toonflow-product-factory") { void router.replace(location.hash.replace(/^#/, "")).catch(() => undefined); return false; }
  return true;
}

function injectMenu() {
  const box = document.querySelector(".menu .itemBox"); if (!box) return;
  let item = document.getElementById("tf-product-factory-menu"); document.getElementById("tf-product-promo-menu")?.remove();
  if (!item) { item = document.createElement("div"); item.id = "tf-product-factory-menu"; item.innerHTML = `<button type="button" aria-label="商品视觉工厂"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4.5 7.5 7.5 4.2 7.5-4.2M12 12v8.5M8 5l8 4.5"/></svg></button><span>商品视觉工厂</span>`; item.addEventListener("click", () => navigate()); box.appendChild(item); }
  item.classList.toggle("active", routeInfo().path === ROUTE);
}

function ensureRoot() {
  const host = document.querySelector<HTMLElement>(".viewBox") || document.querySelector<HTMLElement>("#app"); if (!host) return null;
  if (host.id === "app") host.classList.add("pf-standalone-host");
  let root = document.getElementById(ROOT_ID); if (!root) { root = document.createElement("div"); root.id = ROOT_ID; host.appendChild(root); }
  host.classList.add("pf-host-active"); state.root = root; state.host = host; return root;
}

function cleanup() {
  clearInterval(state.pollTimer); state.pollTimer = 0; state.canvas?.destroy(); state.canvas = null;
  document.getElementById(ROOT_ID)?.remove(); state.host?.classList.remove("pf-host-active", "pf-standalone-host");
  state.root = null; state.host = null; state.projectId = 0; state.current = null;
}
function scheduleRender() { if (state.renderTimer) return; state.renderTimer = window.setTimeout(() => { state.renderTimer = 0; void renderRoute(); }, 40); }

async function renderRoute() {
  injectMenu();
  document.querySelectorAll(".card").forEach((card) => card.classList.toggle("pf-hidden-native", !isFactoryRoute() && String(card.textContent || "").includes("__TOONFLOW_PRODUCT_")));
  if (routeInfo().path === LEGACY_ROUTE) { navigate(routeInfo().projectId || undefined); return; }
  if (routeInfo().path !== ROUTE) { cleanup(); return; }
  if (!ensureVueRoute()) { setTimeout(scheduleRender, 100); return; }
  const root = ensureRoot(); if (!root) return;
  root.innerHTML = `<div class="pf-loading"><span></span>正在加载商品视觉工厂…</div>`;
  try { routeInfo().projectId ? await openWorkspace(routeInfo().projectId) : await renderProjects(); }
  catch (error) { root.innerHTML = `<div class="pf-error"><h2>加载失败</h2><p>${h(error instanceof Error ? error.message : error)}</p><button class="pf-btn pf-primary" data-retry>重新加载</button></div>`; root.querySelector("[data-retry]")?.addEventListener("click", scheduleRender); }
}

async function loadModels() {
  if (state.imageModels.length || state.videoModels.length) return;
  [state.imageModels, state.videoModels] = await Promise.all([apiPost("/api/productFactory/models/list", { type: "image" }), apiPost("/api/productFactory/models/list", { type: "video" })]);
}
function projectDescription(project: Project) { const intro = String(project.intro || ""); return intro.includes("\n") ? intro.split("\n").slice(1).join("\n") : intro.startsWith("__TOONFLOW_") ? "" : intro; }

async function renderProjects() {
  await loadModels(); const projects = await apiPost<Project[]>("/api/project/getProject", { includeCommerce: true });
  state.projects = projects.filter((project) => project.projectType === "commerce" || String(project.intro || "").includes(LEGACY_MARKER));
  state.root!.innerHTML = `<div class="pf-page"><header class="pf-top"><div class="pf-project-heading"><button class="pf-btn pf-home" type="button" data-home>← 返回主页</button><div><span class="pf-eyebrow">PRODUCT CONTENT OPERATIONS</span><h1>商品视觉工厂</h1><p>一个项目管理全部 SKU，画布逐个加载，批量任务统一预览。</p></div></div><button class="pf-btn pf-primary" data-new>＋ 新建工厂项目</button></header><main class="pf-projects">${state.projects.length ? state.projects.map((project) => `<article class="pf-project" data-open="${project.id}"><button class="pf-project-delete" type="button" data-delete-project="${project.id}" aria-label="删除项目 ${h(project.name || `#${project.id}`)}" title="删除项目">删除</button><div class="pf-project-icon">◆</div><div><small>${project.projectType === "commerce" ? "视觉工厂" : "待迁移的旧宣传片"}</small><h3>${h(project.name || "未命名项目")}</h3><p>${h(projectDescription(project) || "尚未填写活动简介")}</p><div class="pf-tags"><span>${h(project.imageQuality || "2K")}</span><span>${h(project.imageModel || "图片模型未配置")}</span><span>${h(project.videoModel || "视频模型未配置")}</span></div></div></article>`).join("") : `<div class="pf-empty"><div>◇</div><h2>从第一个商品活动开始</h2><p>共享品牌约束和默认模板，同时保留每个 SKU 的节点定制。</p><button class="pf-btn pf-primary" data-new>创建项目</button></div>`}</main></div>`;
  state.root!.querySelector("[data-home]")?.addEventListener("click", navigateHome);
  state.root!.querySelectorAll<HTMLElement>("[data-open]").forEach((card) => card.addEventListener("click", () => navigate(Number(card.dataset.open))));
  state.root!.querySelectorAll<HTMLButtonElement>("[data-delete-project]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    const project = state.projects.find((item) => Number(item.id) === Number(button.dataset.deleteProject));
    if (project) showProjectDeleteModal(project);
  }));
  state.root!.querySelectorAll("[data-new]").forEach((button) => button.addEventListener("click", showProjectModal));
}

function overlay(title: string, body: string, side = false) {
  const layer = document.createElement("div"); layer.className = side ? "pf-drawer-layer" : "pf-modal-layer";
  layer.innerHTML = `<section class="${side ? "pf-drawer" : "pf-modal"}"><header><div><small>商品视觉工厂</small><h2>${h(title)}</h2></div><button data-close aria-label="关闭">×</button></header><div class="${side ? "pf-drawer-body" : "pf-modal-body"}">${body}</div></section>`;
  state.root!.appendChild(layer); layer.querySelector("[data-close]")?.addEventListener("click", () => layer.remove()); layer.addEventListener("pointerdown", (event) => { if (event.target === layer) layer.remove(); }); return layer;
}
function showProjectDeleteModal(project: Project) {
  const confirmationToken = String(project.name || "").trim() || `#${project.id}`;
  const layer = overlay("永久删除工厂项目", `<form class="pf-form pf-delete-form" data-delete-project-form><div class="pf-delete-warning"><strong>此操作不可撤销</strong><p>将永久删除项目“${h(project.name || "未命名项目")}”及其全部 SKU、参考图、工作流、生成产物和任务记录。</p></div><label>请输入 <b>${h(confirmationToken)}</b> 确认删除<input name="confirmationName" autocomplete="off" required placeholder="输入项目名称"></label><div class="pf-actions"><button class="pf-btn" type="button" data-cancel-delete>取消</button><button class="pf-btn danger" type="submit" data-confirm-delete disabled>永久删除项目</button></div></form>`);
  const form = layer.querySelector<HTMLFormElement>("[data-delete-project-form]")!;
  const input = form.elements.namedItem("confirmationName") as HTMLInputElement;
  const submit = layer.querySelector<HTMLButtonElement>("[data-confirm-delete]")!;
  input.addEventListener("input", () => { submit.disabled = input.value.trim() !== confirmationToken; });
  layer.querySelector("[data-cancel-delete]")?.addEventListener("click", () => layer.remove());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (input.value.trim() !== confirmationToken) return;
    submit.disabled = true; submit.textContent = "正在删除…";
    let result: any;
    try {
      result = await apiPost("/api/productFactory/projects/delete", { projectId: project.id, confirmationName: input.value.trim() });
    } catch (error) {
      submit.disabled = false; submit.textContent = "永久删除项目"; toast((error as Error).message, "error"); return;
    }
    layer.remove(); localStorage.removeItem(`toonflow.productPromo.v1.${project.id}`); await renderProjects();
    const warnings = Array.isArray(result?.storageWarnings) ? result.storageWarnings.length : 0;
    toast(warnings ? `项目已删除；${warnings} 项本地文件需手动清理` : `项目“${confirmationToken}”已永久删除`, warnings ? "info" : "success");
  });
  input.focus();
}
function showProjectModal() {
  const layer = overlay("新建商品视觉工厂", `<form class="pf-form" data-project-form><label>项目名称<input name="name" required placeholder="例如：秋季新品首发"></label><label>活动简介<textarea name="intro" placeholder="这次活动要解决什么传播目标？"></textarea></label><div class="pf-grid2"><label>图片模型<select name="imageModel" required>${modelOptions(state.imageModels)}</select></label><label>视频模型<select name="videoModel" required>${modelOptions(state.videoModels)}</select></label></div><div class="pf-grid2"><label>图片画质<select name="imageQuality"><option>2K</option><option>1K</option><option>4K</option></select></label><label>视频输入模式<input name="mode" value="singleImage"></label></div><button class="pf-btn pf-primary" type="submit">创建并进入</button></form>`);
  layer.querySelector("form")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement)); try { const created = await apiPost<{ id: number }>("/api/project/addProject", { ...data, projectType: "commerce", intro: `${MARKER}\n${data.intro || ""}`, type: "商品", artStyle: "", directorManual: "", videoRatio: "16:9" }); layer.remove(); navigate(created.id); } catch (error) { toast((error as Error).message, "error"); } });
}

async function openWorkspace(projectId: number) {
  state.projectId = projectId; state.page = 1; state.selected.clear(); state.currentId = 0; state.current = null; state.search = ""; state.filter = "all";
  await loadModels(); const projects = await apiPost<Project[]>("/api/project/getProject", { includeCommerce: true }); const project = projects.find((item) => Number(item.id) === projectId); if (!project) throw new Error("项目不存在");
  if (String(project.intro || "").includes(LEGACY_MARKER)) { let legacyCanvas: unknown = null; try { legacyCanvas = JSON.parse(localStorage.getItem(`toonflow.productPromo.v1.${projectId}`) || "null"); } catch { /* keep legacy source untouched */ } const migration = await apiPost<any>("/api/productFactory/migration/importLegacy", { projectId, legacyCanvas }); toast(migration.warning || "旧产品宣传片已迁移，旧本地画布仍保留", migration.warning ? "info" : "success"); }
  state.workspace = await apiPost<Workspace>("/api/productFactory/workspace/get", { projectId }); await loadSummaries(1);
  if (state.summaries.length) await loadProduct(state.summaries[0].id); renderWorkspace(); startPolling();
}

async function loadSummaries(page = state.page) {
  const result = await apiPost<{ items: FactorySummary[]; total: number; page: number }>("/api/productFactory/products/list", { projectId: state.projectId, page, pageSize: PAGE_SIZE, search: state.search, state: state.filter, summary: true });
  state.summaries = result.items; state.total = Number(result.total || 0); state.page = Number(result.page || page);
  const valid = new Set(state.summaries.map((item) => item.id)); for (const id of state.selected) if (!valid.has(id) && state.selected.size <= PAGE_SIZE) state.selected.delete(id);
}
async function loadProduct(productId: number) { state.current = await apiPost<FactoryItem>("/api/productFactory/products/get", { projectId: state.projectId, productId }); state.currentId = productId; state.selectedNodes = []; }
async function reloadCurrentAndSummary() { await Promise.all([loadSummaries(), state.currentId ? loadProduct(state.currentId) : Promise.resolve()]); }

function summaryMarkup(item: FactorySummary) {
  return `<article class="pf-sku ${item.id === state.currentId ? "active" : ""}" data-sku="${item.id}"><label><input type="checkbox" data-select-sku="${item.id}" ${state.selected.has(item.id) ? "checked" : ""}><span></span></label><div class="pf-sku-thumb">${item.thumbnailUrl ? `<img src="${h(item.thumbnailUrl)}" alt="">` : "◇"}</div><div class="pf-sku-copy"><strong>${h(item.sku)}</strong><span>${h(item.name)}</span><small><i class="state-${h(item.state)}"></i>${h(statusNames[item.state] || item.state)} · ${item.imageCount} 图 / ${item.videoCount} 视频</small></div></article>`;
}

function renderWorkspace() {
  state.canvas?.destroy(); state.canvas = null; const workspace = state.workspace!; const pageCount = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  state.root!.innerHTML = `<div class="pf-studio">
    <header class="pf-studio-top"><button class="pf-icon-btn" data-back title="返回项目">←</button><div class="pf-title"><small>PRODUCT FACTORY V2</small><strong>${h(workspace.project.name)}</strong></div><div class="pf-current">${state.current ? `<span>${h(state.current.sku)}</span><b>${h(state.current.name)}</b>` : `<span>尚无 SKU</span>`}</div><div class="pf-autosave" data-save-state><i></i><span>已保存</span></div><div class="pf-top-actions"><button data-top="fit">适配视图</button><button data-top="jobs">任务中心</button><button data-top="batch">批量中心</button><button data-top="settings">项目设置</button><button class="primary" data-top="export">导出</button></div></header>
    <aside class="pf-sku-sidebar"><div class="pf-side-head"><div><strong>SKU</strong><span>${state.total} 个商品</span></div><button data-import title="导入或新建">＋</button></div><div class="pf-sku-search"><input data-search value="${h(state.search)}" placeholder="搜索 SKU 或名称"><select data-filter><option value="all">全部状态</option>${Object.entries(statusNames).map(([key, label]) => `<option value="${key}" ${state.filter === key ? "selected" : ""}>${label}</option>`).join("")}</select></div><label class="pf-select-page"><input type="checkbox" data-select-page ${state.summaries.length && state.summaries.every((item) => state.selected.has(item.id)) ? "checked" : ""}> 选择本页 <span>${state.selected.size ? `已选 ${state.selected.size}` : ""}</span></label><div class="pf-sku-list">${state.summaries.map(summaryMarkup).join("") || `<div class="pf-side-empty"><b>还没有 SKU</b><span>导入 CSV 或新建第一个商品</span><button data-import>开始添加</button></div>`}</div><footer class="pf-pagination"><button data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>‹</button><span>${state.page} / ${pageCount}</span><button data-page="${state.page + 1}" ${state.page >= pageCount ? "disabled" : ""}>›</button></footer></aside>
    <main class="pf-canvas-area"><div data-canvas-host>${state.current ? "" : `<div class="pf-canvas-empty"><div>◇</div><h2>建立第一条生产工作流</h2><p>创建 SKU 后会自动生成来源、8 个图片节点、审核门和 4 个视频节点。</p><button class="pf-btn pf-primary" data-import>导入或新建商品</button></div>`}</div></main>
    <aside class="pf-inspector" data-inspector></aside>
  </div>`;
  bindWorkspace();
  if (state.current) {
    const canvasItem = state.current;
    const canvasProjectId = state.projectId;
    state.canvas = renderCanvas(state.root!.querySelector<HTMLElement>("[data-canvas-host]")!, structuredClone(state.current.workflow.graph), {
      artifacts: state.current.artifacts,
      onChange: (graph) => saveGraph(graph, canvasProjectId, canvasItem),
      onSelectionChange: (ids) => { state.selectedNodes = ids; renderInspector(); },
      onRun: (nodeId, includeDownstream) => void previewAndStart({ type: "node", productId: state.currentId, nodeId, includeDownstream }),
      onStatus: updateSaveState,
    });
    const first = state.current.workflow.graph.nodes.find((node) => node.type === "source")?.id; if (first) state.canvas.select([first]);
  } else renderInspector();
}

function bindWorkspace() {
  const root = state.root!;
  root.querySelector("[data-back]")?.addEventListener("click", () => navigate());
  root.querySelectorAll<HTMLElement>("[data-import]").forEach((button) => button.addEventListener("click", showImportDrawer));
  root.querySelector<HTMLInputElement>("[data-search]")?.addEventListener("input", (event) => { state.search = (event.currentTarget as HTMLInputElement).value; clearTimeout(state.searchTimer); state.searchTimer = window.setTimeout(async () => { await loadSummaries(1); renderWorkspace(); }, 280); });
  root.querySelector<HTMLSelectElement>("[data-filter]")?.addEventListener("change", async (event) => { state.filter = (event.currentTarget as HTMLSelectElement).value; await loadSummaries(1); renderWorkspace(); });
  root.querySelector<HTMLInputElement>("[data-select-page]")?.addEventListener("change", (event) => { const checked = (event.currentTarget as HTMLInputElement).checked; for (const item of state.summaries) checked ? state.selected.add(item.id) : state.selected.delete(item.id); renderWorkspace(); });
  root.querySelectorAll<HTMLElement>("[data-select-sku]").forEach((input) => input.addEventListener("click", (event) => event.stopPropagation()));
  root.querySelectorAll<HTMLInputElement>("[data-select-sku]").forEach((input) => input.addEventListener("change", () => { const id = Number(input.dataset.selectSku); input.checked ? state.selected.add(id) : state.selected.delete(id); root.querySelector(".pf-select-page span")!.textContent = state.selected.size ? `已选 ${state.selected.size}` : ""; }));
  root.querySelectorAll<HTMLElement>("[data-sku]").forEach((card) => card.addEventListener("click", async () => { const id = Number(card.dataset.sku); if (id === state.currentId) return; await loadProduct(id); renderWorkspace(); }));
  root.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((button) => button.addEventListener("click", async () => { if (button.disabled) return; await loadSummaries(Number(button.dataset.page)); if (!state.summaries.some((item) => item.id === state.currentId) && state.summaries[0]) await loadProduct(state.summaries[0].id); renderWorkspace(); }));
  root.querySelector('[data-top="fit"]')?.addEventListener("click", () => state.canvas?.fitView());
  root.querySelector('[data-top="jobs"]')?.addEventListener("click", showJobsDrawer);
  root.querySelector('[data-top="batch"]')?.addEventListener("click", showBatchDrawer);
  root.querySelector('[data-top="settings"]')?.addEventListener("click", showSettingsDrawer);
  root.querySelector('[data-top="export"]')?.addEventListener("click", showExportDrawer);
}

function updateSaveState(status: "saving" | "saved" | "error", message?: string) {
  const host = state.root?.querySelector<HTMLElement>("[data-save-state]"); if (!host) return; host.className = `pf-autosave ${status}`; host.querySelector("span")!.textContent = status === "saving" ? "保存中…" : status === "saved" ? "已保存" : message || "保存失败";
}
function saveGraph(graph: FactoryGraph, projectId: number, item: FactoryItem) {
  const productId = item.id;
  const task = state.saveChain.catch(() => undefined).then(async () => {
    const workflow = await apiPost<any>("/api/productFactory/workflow/update", { projectId, productId, graph, baseRevision: item.workflow.revision });
    item.workflow = workflow;
    if (state.current?.id === productId) state.current.workflow = workflow;
  });
  state.saveChain = task; return task.then(() => undefined);
}

function selectedNode() { return state.canvas?.getGraph().nodes.find((node) => node.id === state.selectedNodes[0]) || state.current?.workflow.graph.nodes.find((node) => node.id === state.selectedNodes[0]); }
function nodeArtifacts(node: FactoryGraphNode) { return (state.current?.artifacts || []).filter((artifact) => artifact.workflowNodeId === node.id || (!artifact.workflowNodeId && artifact.slotKey === node.data.slotKey && artifact.aspectRatio === node.data.aspectRatio)); }

function renderInspector() {
  const host = state.root?.querySelector<HTMLElement>("[data-inspector]"); if (!host) return;
  if (!state.current) { host.innerHTML = `<div class="pf-inspector-empty"><span>INSPECTOR</span><h3>选择或创建 SKU</h3><p>节点配置、候选结果和执行操作会显示在这里。</p></div>`; return; }
  if (state.selectedNodes.length > 1) { host.innerHTML = `<header class="pf-inspector-head"><div><small>MULTI SELECT</small><h2>${state.selectedNodes.length} 个节点</h2></div></header><div class="pf-inspector-section"><p>拖动任一节点可整体移动；Ctrl/Cmd+C、V 可复制粘贴，Delete 删除非系统节点。</p><button class="pf-btn" data-layout>自动排版全部节点</button></div>`; host.querySelector("[data-layout]")?.addEventListener("click", () => state.root?.querySelector<HTMLElement>('[data-cmd="layout"]')?.click()); return; }
  const node = selectedNode(); if (!node) { host.innerHTML = `<div class="pf-inspector-empty"><span>INSPECTOR</span><h3>选择画布节点</h3><p>点击节点查看输入、模型、提示词、参数、候选和错误。</p></div>`; return; }
  if (node.type === "source") { renderSourceInspector(host, node); return; }
  if (node.type === "review") { renderReviewInspector(host, node); return; }
  if (node.type === "group" || node.type === "note") { host.innerHTML = `<header class="pf-inspector-head"><div><small>${h(node.type)}</small><h2>${h(node.data.label)}</h2></div></header><form class="pf-inspector-form" data-node-form><label>显示名称<input name="label" value="${h(node.data.label)}"></label><button class="pf-btn pf-primary">保存</button></form>`; bindNodeForm(host, node); return; }
  const artifacts = nodeArtifacts(node); const current = artifacts.find((artifact) => artifact.isCurrent) || artifacts[0]; const incoming = (state.canvas?.getGraph() || state.current.workflow.graph).edges.filter((edge) => edge.target === node.id);
  const models = node.type === "image" ? state.imageModels : state.videoModels; const runtime = node.data.runtime || {};
  host.innerHTML = `<header class="pf-inspector-head"><div><small>${h(node.type)} · ${h(node.data.outputKey)}</small><h2>${h(node.data.label || node.data.roleKey)}</h2></div><em class="state-${h(current?.state || "idle")}">${h(current?.state || "idle")}</em></header>
    <form class="pf-inspector-form" data-node-form><label>显示名称<input name="label" value="${h(node.data.label || "")}"></label><label>节点模型<select name="modelOverride">${modelOptions(models, String(node.data.modelOverride || ""), true)}</select></label><div class="pf-grid2"><label>角色键<input value="${h(node.data.roleKey)}" disabled></label><label>画幅<input value="${h(node.data.aspectRatio)}" disabled></label></div>${node.type === "image" ? `<label>画质<select name="quality"><option ${runtime.quality === "1K" ? "selected" : ""}>1K</option><option ${runtime.quality === "2K" || !runtime.quality ? "selected" : ""}>2K</option><option ${runtime.quality === "4K" ? "selected" : ""}>4K</option></select></label>` : `<div class="pf-grid2"><label>分辨率<input name="resolution" value="${h(runtime.resolution || "720p")}"></label><label>时长<input type="number" name="duration" min="1" max="30" value="${h(runtime.duration || 5)}"></label></div><label class="pf-check"><input type="checkbox" name="audio" ${runtime.audio ? "checked" : ""}> 生成音频</label>`}<button class="pf-btn pf-primary">保存节点配置</button></form>
    <section class="pf-inspector-section"><header><strong>真实输入</strong><span>${incoming.length}</span></header>${incoming.length ? incoming.map((edge) => `<div class="pf-input-row"><i></i><span>${h(edge.sourcePort)} → ${h(edge.targetPort)}</span><small>${h(edge.source)}</small></div>`).join("") : `<p>当前节点没有连线输入。</p>`}${node.type === "video" ? videoBindingsMarkup(node) : ""}</section>
    <section class="pf-inspector-section"><header><strong>提示词与执行</strong></header><div class="pf-button-grid"><button class="pf-btn" data-prompt>编辑提示词</button><button class="pf-btn" data-run>预览并运行</button><button class="pf-btn" data-run-down>运行下游</button></div></section>
    <section class="pf-inspector-section"><header><strong>候选与历史</strong><span>${artifacts.length}</span></header><div class="pf-candidate-grid">${artifacts.slice(0, 12).map((artifact) => artifact.url ? `<figure class="${artifact.approved ? "approved" : ""}"><img src="${h(artifact.url)}" alt=""><figcaption>v${artifact.version} · ${h(artifact.state)}${artifact.inputChanged ? " · 已失效" : ""}</figcaption></figure>` : `<div class="pf-candidate-error">${h(artifact.errorReason || artifact.state)}</div>`).join("") || `<p>尚无候选结果。</p>`}</div>${current?.errorReason ? `<div class="pf-node-error">${h(current.errorReason)}</div>` : ""}</section>`;
  bindNodeForm(host, node);
  host.querySelector("[data-prompt]")?.addEventListener("click", () => showPromptDrawer(node));
  host.querySelector("[data-run]")?.addEventListener("click", () => void previewAndStart({ type: "node", productId: state.currentId, nodeId: node.id, includeDownstream: false }));
  host.querySelector("[data-run-down]")?.addEventListener("click", () => void previewAndStart({ type: "node", productId: state.currentId, nodeId: node.id, includeDownstream: true }));
  bindVideoInputs(host, node);
}

function bindNodeForm(host: HTMLElement, node: FactoryGraphNode) {
  host.querySelector<HTMLFormElement>("[data-node-form]")?.addEventListener("submit", (event) => { event.preventDefault(); const values: any = Object.fromEntries(eventForm(event)); const runtime = { ...(node.data.runtime || {}) }; if (node.type === "image") runtime.quality = values.quality; if (node.type === "video") { runtime.resolution = values.resolution; runtime.duration = Number(values.duration); runtime.audio = values.audio === "on"; } state.canvas?.updateNode(node.id, { label: values.label, modelOverride: values.modelOverride || null, runtime }); toast("节点配置将在自动保存后生效", "success"); });
}

function renderSourceInspector(host: HTMLElement, node: FactoryGraphNode) {
  const item = state.current!;
  host.innerHTML = `<header class="pf-inspector-head"><div><small>SOURCE · PROTECTED</small><h2>${h(node.data.label)}</h2></div><em class="state-${item.references.some((ref) => ref.isPrimary) ? "ready" : "draft"}">${item.references.some((ref) => ref.isPrimary) ? "ready" : "draft"}</em></header><section class="pf-inspector-section"><header><strong>商品身份</strong></header><dl class="pf-details"><dt>SKU</dt><dd>${h(item.sku)}</dd><dt>名称</dt><dd>${h(item.name)}</dd><dt>类目</dt><dd>${h(item.category || "—")}</dd></dl></section><section class="pf-inspector-section"><header><strong>商品参考图</strong><button data-upload-ref>＋ 上传</button></header><div class="pf-source-refs">${item.references.map((ref) => `<figure class="${ref.isPrimary ? "primary" : ""}"><img src="${h(ref.url)}"><figcaption>${h(ref.fileName)}</figcaption></figure>`).join("") || `<p>请上传至少一张主参考图后再运行图片节点。</p>`}</div></section><section class="pf-inspector-section"><header><strong>独立输出端口</strong></header><div class="pf-port-list">${(node.data.outputs || []).map((port: any) => `<span>${h(port.label)}<small>${h(port.id)}</small></span>`).join("")}</div></section>`;
  host.querySelector("[data-upload-ref]")?.addEventListener("click", () => chooseReferences(item.id));
}

function renderReviewInspector(host: HTMLElement, node: FactoryGraphNode) {
  const images = state.current!.artifacts.filter((artifact) => artifact.mediaType === "image" && artifact.state === "success" && !artifact.detached);
  host.innerHTML = `<header class="pf-inspector-head"><div><small>REVIEW · PROTECTED</small><h2>${h(node.data.label)}</h2></div><em class="state-gate">费用边界</em></header><section class="pf-review-warning">审核不会自动提交视频。只有显式批准并绑定输入端口后，视频节点才能执行。</section><form data-review-form class="pf-inspector-section"><header><strong>图片节点候选</strong><span>${images.length}</span></header><div class="pf-review-candidates">${images.map((artifact) => `<label class="${artifact.approved ? "approved" : ""}"><input type="radio" name="review-${h(artifact.workflowNodeId || `${artifact.slotKey}:${artifact.aspectRatio}`)}" value="${artifact.id}" data-node-id="${h(artifact.workflowNodeId || "")}" ${artifact.approved ? "checked" : ""}><img src="${h(artifact.url)}"><span>${h(imageSlotNames[artifact.slotKey] || artifact.slotKey)} · ${h(artifact.aspectRatio)} · v${artifact.version}</span></label>`).join("") || `<p>尚无成功图片候选。</p>`}</div><button class="pf-btn pf-primary" ${images.length ? "" : "disabled"}>批准选择并配置默认视频输入</button></form>`;
  host.querySelector<HTMLFormElement>("[data-review-form]")?.addEventListener("submit", async (event) => { event.preventDefault(); const selections = [...host.querySelectorAll<HTMLInputElement>("input[type=radio]:checked")].map((input) => ({ artifactId: Number(input.value), nodeId: input.dataset.nodeId || undefined })); try { await apiPost("/api/productFactory/review/submit", { projectId: state.projectId, productId: state.currentId, selections }); await reloadCurrentAndSummary(); renderWorkspace(); toast("审核结果和默认视频输入已保存", "success"); } catch (error) { toast((error as Error).message, "error"); } });
}

function approvedOptions(selected: number | number[] | null | undefined) {
  const selectedId = Number(Array.isArray(selected) ? selected[0] : selected || 0); const artifacts = state.current!.artifacts.filter((artifact) => artifact.mediaType === "image" && artifact.approved && artifact.state === "success");
  return `<option value="">未绑定</option>${artifacts.map((artifact) => `<option value="${artifact.id}" ${artifact.id === selectedId ? "selected" : ""}>${h(imageSlotNames[artifact.slotKey] || artifact.slotKey)} · ${h(artifact.aspectRatio)} · v${artifact.version}</option>`).join("")}`;
}
function videoBindingsMarkup(node: FactoryGraphNode) { const bindings = state.current!.workflow.graph.reviewBindings?.[node.id] || {}; return `<form class="pf-port-bindings" data-bindings>${(node.data.inputs || []).map((port: any) => `<label>${h(port.label)}${port.required ? " *" : ""}<select name="${h(port.id)}">${approvedOptions(bindings[port.id])}</select></label>`).join("")}<button class="pf-btn">保存审核端口绑定</button></form>`; }
function bindVideoInputs(host: HTMLElement, node: FactoryGraphNode) { if (node.type !== "video") return; host.querySelector<HTMLFormElement>("[data-bindings]")?.addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(eventForm(event)); const bindings = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ? Number(value) : null])); try { await apiPost("/api/productFactory/review/submit", { projectId: state.projectId, productId: state.currentId, selections: [], reviewBindings: { [node.id]: bindings } }); await loadProduct(state.currentId); renderWorkspace(); toast("视频输入端口已保存", "success"); } catch (error) { toast((error as Error).message, "error"); } }); }

async function previewAndStart(scope: { type: "node"; productId: number; nodeId: string; includeDownstream: boolean } | { type: "batch"; productIds: number[]; phases: Array<"image" | "video">; roleKeys?: string[] }, regenerate = false) {
  try {
    const plan = await apiPost<any>("/api/productFactory/jobs/preview", { projectId: state.projectId, scope, regenerate });
    const skipped = plan.skipped?.slice(0, 4).map((item: any) => item.reason).join("；"); const warnings = plan.warnings?.join("；");
    if (!plan.summary.taskCount) { toast(skipped || "没有需要执行的新任务", "info"); return; }
    if (!confirm(`执行预览\n\n任务：${plan.summary.taskCount}（图片 ${plan.summary.imageCount} / 视频 ${plan.summary.videoCount}）\n跳过：${plan.summary.skippedCount}${skipped ? `\n原因：${skipped}` : ""}${warnings ? `\n提示：${warnings}` : ""}\n\n任务会调用项目模型并可能产生费用，确认入队？`)) return;
    const result = await apiPost<any>("/api/productFactory/jobs/start", { projectId: state.projectId, scope, regenerate, confirmed: true }); toast(`已加入 ${result.jobIds.length} 个任务`, "success"); void refreshProgress();
  } catch (error) { toast((error as Error).message, "error"); }
}

function showPromptDrawer(node: FactoryGraphNode) {
  const layer = overlay(`提示词 · ${node.data.label || node.data.roleKey}`, `<div data-prompt-content class="pf-loading compact">正在按节点编译提示词…</div>`, true);
  const load = async () => {
    try {
      const preview = await apiPost<any>("/api/productFactory/prompts/preview", { projectId: state.projectId, productId: state.currentId, nodeId: node.id, mediaType: node.type, slotKey: node.data.slotKey, aspectRatio: node.data.aspectRatio }); const content = layer.querySelector<HTMLElement>("[data-prompt-content]")!;
      content.className = "pf-prompt-editor"; content.innerHTML = `<div class="pf-prompt-meta"><span>${h(preview.result.templateId)}</span><span>语言 ${h(preview.result.language)}</span><span>签名 ${h(preview.signature.slice(0, 12))}</span></div>${["goal", "creative", "craft"].map((key) => `<label>${key}<textarea data-section="${key}">${h(preview.result.sections[key])}</textarea></label>`).join("")}<details><summary>锁定区段与最终编译文本</summary><pre>${h(preview.result.compiledPrompt)}</pre></details><div class="pf-actions"><button class="pf-btn" data-polish ${state.workspace?.aiPolishAvailable ? "" : "disabled"}>AI 润色</button><button class="pf-btn" data-reset>恢复模板</button><button class="pf-btn pf-primary" data-save>保存覆盖</button></div>`;
      content.querySelector("[data-save]")?.addEventListener("click", async () => { const overrides = Object.fromEntries([...content.querySelectorAll<HTMLTextAreaElement>("[data-section]")].map((area) => [area.dataset.section, area.value])); await apiPost("/api/productFactory/prompts/saveOverride", { projectId: state.projectId, productId: state.currentId, nodeId: node.id, mediaType: node.type, slotKey: node.data.slotKey, aspectRatio: node.data.aspectRatio, overrides }); await loadProduct(state.currentId); toast("节点提示词覆盖已保存", "success"); });
      content.querySelector("[data-reset]")?.addEventListener("click", async () => { if (!confirm("清除该节点的自定义创意区段？")) return; await apiPost("/api/productFactory/prompts/reset", { projectId: state.projectId, productId: state.currentId, nodeId: node.id, mediaType: node.type, slotKey: node.data.slotKey, aspectRatio: node.data.aspectRatio }); await load(); toast("已恢复内置模板", "success"); });
      content.querySelector("[data-polish]")?.addEventListener("click", async () => { try { const result = await apiPost<any>("/api/productFactory/prompts/polish", { projectId: state.projectId, productId: state.currentId, nodeId: node.id, mediaType: node.type, slotKey: node.data.slotKey, aspectRatio: node.data.aspectRatio }); for (const [key, value] of Object.entries(result.candidate)) { const area = content.querySelector<HTMLTextAreaElement>(`[data-section="${key}"]`); if (area) area.value = String(value); } toast("润色候选已填入，请检查后保存", "success"); } catch (error) { toast((error as Error).message, "error"); } });
    } catch (error) { layer.querySelector<HTMLElement>("[data-prompt-content]")!.innerHTML = `<div class="pf-node-error">${h((error as Error).message)}</div>`; }
  }; void load();
}

function showImportDrawer() {
  const layer = overlay("导入与新建商品", `<section class="pf-drawer-section"><h3>新增单个 SKU</h3><form class="pf-form" data-product-form><div class="pf-grid2"><label>SKU<input name="sku" required></label><label>商品名称<input name="name" required></label></div><label>类目<input name="category"></label><label>商品描述<textarea name="description"></textarea></label><label>卖点（每行一条）<textarea name="sellingPoints"></textarea></label><button class="pf-btn pf-primary">创建 SKU</button></form></section><section class="pf-drawer-section"><h3>批量导入</h3><p>CSV 支持 sku、name、category、description、selling_points、image_files；随后可选择图片文件夹按 SKU 匹配。</p><div class="pf-button-grid"><button class="pf-btn" data-csv>选择 CSV</button><button class="pf-btn" data-folder>选择图片文件夹</button></div></section>`, true);
  layer.querySelector<HTMLFormElement>("[data-product-form]")?.addEventListener("submit", async (event) => { event.preventDefault(); try { const item = await apiPost<FactoryItem>("/api/productFactory/products/upsert", { projectId: state.projectId, ...Object.fromEntries(eventForm(event)) }); await loadSummaries(1); await loadProduct(item.id); layer.remove(); renderWorkspace(); toast("SKU 已创建并生成默认工作流", "success"); } catch (error) { toast((error as Error).message, "error"); } });
  layer.querySelector("[data-csv]")?.addEventListener("click", chooseCsv); layer.querySelector("[data-folder]")?.addEventListener("click", chooseFolder);
}

async function uploadFiles(productId: number, files: File[]) { for (const [index, file] of files.slice(0, 12).entries()) await apiPost("/api/productFactory/references/upload", { projectId: state.projectId, productId, scope: "product", fileName: file.name, mimeType: file.type, dataBase64: await fileAsDataUrl(file), isPrimary: index === 0 }); }
function chooseReferences(productId: number) { const input = document.createElement("input"); input.type = "file"; input.accept = "image/jpeg,image/png,image/webp"; input.multiple = true; input.onchange = async () => { try { await uploadFiles(productId, [...(input.files || [])]); await reloadCurrentAndSummary(); renderWorkspace(); toast("商品参考图已上传", "success"); } catch (error) { toast((error as Error).message, "error"); } }; input.click(); }
function chooseCsv() { const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,text/csv"; input.onchange = async () => { const file = input.files?.[0]; if (!file) return; try { const result = await apiPost<any>("/api/productFactory/products/import", { projectId: state.projectId, csvText: await file.text() }); await loadSummaries(1); if (!state.currentId && state.summaries[0]) await loadProduct(state.summaries[0].id); renderWorkspace(); toast(`已导入/更新 ${result.imported} 个 SKU，${result.errors.length} 行失败`, result.errors.length ? "info" : "success"); } catch (error) { toast((error as Error).message, "error"); } }; input.click(); }
function chooseFolder() { const input = document.createElement("input"); input.type = "file"; input.multiple = true; input.setAttribute("webkitdirectory", ""); input.accept = "image/jpeg,image/png,image/webp"; input.onchange = async () => { const files = [...(input.files || [])]; let matched = 0; try { for (const item of state.summaries) { const sku = item.sku.toLowerCase(); const candidates = files.filter((file) => { const path = String((file as any).webkitRelativePath || file.name).replace(/\\/g, "/").toLowerCase(); return path.split("/").slice(0, -1).includes(sku) || file.name.toLowerCase().startsWith(`${sku}_`); }); if (candidates.length) { await uploadFiles(item.id, candidates); matched += candidates.length; } } await reloadCurrentAndSummary(); renderWorkspace(); toast(`已匹配并上传 ${matched} 张参考图`, matched ? "success" : "info"); } catch (error) { toast((error as Error).message, "error"); } }; input.click(); }

function showBatchDrawer() {
  const ids = state.selected.size ? [...state.selected] : state.currentId ? [state.currentId] : [];
  const layer = overlay("跨 SKU 批量中心", `<div class="pf-scope-summary"><b>${ids.length}</b><span>个 SKU 在本次范围内</span></div><form class="pf-form" data-batch><fieldset><legend>生成阶段</legend><label class="pf-check"><input type="checkbox" name="phase" value="image" checked> 图片节点</label><label class="pf-check"><input type="checkbox" name="phase" value="video"> 视频节点（仅已通过审核）</label></fieldset><fieldset><legend>角色筛选（不选则运行全部）</legend>${Object.entries({ ...imageSlotNames, ...videoSlotNames }).map(([key, label]) => `<label class="pf-check"><input type="checkbox" name="role" value="${key}"> ${label}</label>`).join("")}</fieldset><label class="pf-check danger"><input type="checkbox" name="regenerate"> 重新生成已有成功签名（会产生新版本和费用）</label><button class="pf-btn pf-primary" ${ids.length ? "" : "disabled"}>预览任务与费用风险</button></form>`, true);
  layer.querySelector<HTMLFormElement>("[data-batch]")?.addEventListener("submit", (event) => { event.preventDefault(); const phases = [...layer.querySelectorAll<HTMLInputElement>('input[name="phase"]:checked')].map((input) => input.value as "image" | "video"); const roleKeys = [...layer.querySelectorAll<HTMLInputElement>('input[name="role"]:checked')].map((input) => input.value); if (!phases.length) return toast("请至少选择一个生成阶段", "info"); void previewAndStart({ type: "batch", productIds: ids, phases, roleKeys }, Boolean(layer.querySelector<HTMLInputElement>('input[name="regenerate"]')?.checked)); });
}

function showSettingsDrawer() {
  const { config, project } = state.workspace!; const pack = config.defaultPack;
  const layer = overlay("项目设置与模板", `<form class="pf-form" data-settings><h3>品牌与活动</h3><label>品牌名称<input name="brandName" value="${h(config.brandName)}"></label><label>活动目标<textarea name="campaignBrief">${h(config.campaignBrief)}</textarea></label><label>视觉基调<textarea name="visualTone">${h(config.visualTone)}</textarea></label><label>禁止内容<textarea name="forbiddenContent">${h(config.forbiddenContent)}</textarea></label><h3>项目模型</h3><label>图片模型<select name="imageModel">${modelOptions(state.imageModels, project.imageModel)}</select></label><label>视频模型<select name="videoModel">${modelOptions(state.videoModels, project.videoModel)}</select></label><div class="pf-grid2"><label>图片并发<input type="number" name="imageConcurrency" min="1" max="5" value="${config.imageConcurrency}"></label><label>视频并发<input type="number" name="videoConcurrency" min="1" max="2" value="${config.videoConcurrency}"></label></div><h3>默认运行参数</h3><div class="pf-grid2"><label>图片画质<select name="imageQuality"><option ${pack.imageQuality === "1K" ? "selected" : ""}>1K</option><option ${pack.imageQuality === "2K" ? "selected" : ""}>2K</option><option ${pack.imageQuality === "4K" ? "selected" : ""}>4K</option></select></label><label>视频分辨率<input name="videoResolution" value="${h(pack.videoResolution)}"></label><label>视频时长<input type="number" name="videoDuration" min="1" max="30" value="${pack.videoDuration}"></label><label class="pf-check"><input type="checkbox" name="videoAudio" ${pack.videoAudio ? "checked" : ""}> 生成音频</label></div><button class="pf-btn pf-primary">保存项目设置</button></form><section class="pf-drawer-section"><h3>项目工作流模板 <small>r${config.templateRevision || 1}</small></h3><p>模板不会实时覆盖 SKU。先预览差异，再保留自定义或明确强制覆盖。</p><div class="pf-button-grid"><button class="pf-btn" data-save-template ${state.currentId ? "" : "disabled"}>将当前 SKU 保存为模板</button><button class="pf-btn" data-apply-template>预览并应用到选中 SKU</button><button class="pf-btn danger" data-force-template>强制覆盖选中 SKU</button></div></section>`, true);
  layer.querySelector<HTMLFormElement>("[data-settings]")?.addEventListener("submit", async (event) => { event.preventDefault(); const values: any = Object.fromEntries(eventForm(event)); try { await apiPost("/api/productFactory/workspace/update", { projectId: state.projectId, brandName: values.brandName, campaignBrief: values.campaignBrief, visualTone: values.visualTone, forbiddenContent: values.forbiddenContent, imageConcurrency: Number(values.imageConcurrency), videoConcurrency: Number(values.videoConcurrency), defaultPack: { ...pack, imageQuality: values.imageQuality, videoResolution: values.videoResolution, videoDuration: Number(values.videoDuration), videoAudio: values.videoAudio === "on" } }); await apiPost("/api/project/editProject", { ...project, id: state.projectId, projectType: "commerce", imageModel: values.imageModel, videoModel: values.videoModel, intro: project.intro || MARKER, type: project.type || "商品", artStyle: project.artStyle || "", directorManual: project.directorManual || "", videoRatio: project.videoRatio || "16:9", imageQuality: project.imageQuality || "2K", mode: project.mode || "singleImage" }); state.workspace = await apiPost("/api/productFactory/workspace/get", { projectId: state.projectId }); layer.remove(); renderWorkspace(); toast("项目设置已保存；模板更新仍需预览应用", "success"); } catch (error) { toast((error as Error).message, "error"); } });
  layer.querySelector("[data-save-template]")?.addEventListener("click", async () => { if (!confirm("将当前 SKU 工作流保存为新的项目模板修订？")) return; const result = await apiPost<any>("/api/productFactory/workflow/saveTemplate", { projectId: state.projectId, productId: state.currentId }); state.workspace!.config.templateRevision = result.templateRevision; toast(`已保存项目模板 r${result.templateRevision}`, "success"); });
  const apply = async (force: boolean) => { const productIds = state.selected.size ? [...state.selected] : state.currentId ? [state.currentId] : []; if (!productIds.length) return toast("请选择 SKU", "info"); try { const preview = await apiPost<any>("/api/productFactory/workflow/templatePreview", { projectId: state.projectId, productIds, preserveCustom: !force }); const text = `${preview.summary.skuCount} 个 SKU：新增 ${preview.summary.addedNodes}、删除 ${preview.summary.removedNodes}、参数变化 ${preview.summary.changedNodes}，影响 ${preview.summary.affectedArtifacts} 个历史产物。`; if (!confirm(`${text}\n\n${force ? "强制覆盖会清除 SKU 自定义节点与覆盖。" : "默认保留 SKU 自定义节点、提示词、模型和布局。"}\n确认应用？`)) return; if (force && !confirm("再次确认强制覆盖：此操作会按差异使相关节点及下游产物失效。")) return; await apiPost("/api/productFactory/workflow/templateApply", { projectId: state.projectId, productIds, preserveCustom: !force, force, confirmed: force }); await reloadCurrentAndSummary(); layer.remove(); renderWorkspace(); toast("模板差异已应用", "success"); } catch (error) { toast((error as Error).message, "error"); } };
  layer.querySelector("[data-apply-template]")?.addEventListener("click", () => void apply(false)); layer.querySelector("[data-force-template]")?.addEventListener("click", () => void apply(true));
}

function showExportDrawer() {
  const ids = state.selected.size ? [...state.selected] : state.currentId ? [state.currentId] : [];
  const layer = overlay("导出商品素材", `<div class="pf-scope-summary"><b>${ids.length}</b><span>个 SKU 将按目录打包</span></div><p>仅导出已批准图片、成功视频和 manifest.csv；脱离工作流的历史产物仍保留，但不会默认进入导出包。</p><button class="pf-btn pf-primary" data-export ${ids.length ? "" : "disabled"}>下载 ZIP 素材包</button>`, true);
  layer.querySelector("[data-export]")?.addEventListener("click", async () => { try { await apiDownload("/api/productFactory/export/create", { projectId: state.projectId, productIds: ids }, `product-factory-${state.projectId}.zip`); toast("素材包已开始下载", "success"); } catch (error) { toast((error as Error).message, "error"); } });
}

function showJobsDrawer() { overlay("任务中心", `<div data-job-content class="pf-loading compact">正在读取任务队列…</div>`, true); void refreshProgress(); }
async function refreshProgress() {
  if (!state.projectId) return;
  try {
    const progress = await apiPost<any>("/api/productFactory/jobs/progress", { projectId: state.projectId, ...(state.selected.size ? { productIds: [...state.selected] } : {}) }); const host = state.root?.querySelector<HTMLElement>("[data-job-content]"); if (!host) return;
    host.className = "pf-jobs"; host.innerHTML = `<div class="pf-stat-grid">${["queued", "running", "success", "failed", "paused", "interrupted"].map((key) => `<div><b>${progress.counts[key] || 0}</b><span>${key}</span></div>`).join("")}</div><div class="pf-job-list">${progress.jobs.map((job: any) => `<div><span><b>${h(job.slotKey)}</b><small>${h(job.workflowNodeId || "")} · ${h(job.aspectRatio)}</small></span><em class="state-${h(job.state)}">${h(job.state)}</em><p>${h(job.errorReason || "")}</p></div>`).join("") || `<p>尚无任务。</p>`}</div><div class="pf-actions"><button class="pf-btn" data-resume>恢复暂停/中断</button><button class="pf-btn" data-retry-failed>重试失败任务</button></div>`;
    host.querySelector("[data-resume]")?.addEventListener("click", async () => { await apiPost("/api/productFactory/jobs/resume", { projectId: state.projectId }); toast("可恢复任务已重新入队", "success"); void refreshProgress(); });
    host.querySelector("[data-retry-failed]")?.addEventListener("click", async () => { const ids = progress.jobs.filter((job: any) => ["failed", "interrupted"].includes(job.state)).map((job: any) => job.id); if (!ids.length) return toast("没有可重试任务", "info"); await apiPost("/api/productFactory/jobs/retry", { projectId: state.projectId, jobIds: ids }); toast("失败任务已重试", "success"); void refreshProgress(); });
  } catch { /* polling is non-blocking */ }
}

function startPolling() { clearInterval(state.pollTimer); state.pollTimer = window.setInterval(() => void refreshProgress(), 3000); }
function bootstrap() {
  window.__TOONFLOW_NORMALIZE_PRODUCT_PROMO_URL__?.(); const originalPush = history.pushState.bind(history); const originalReplace = history.replaceState.bind(history);
  history.pushState = (...args) => { originalPush(...args); scheduleRender(); }; history.replaceState = (...args) => { originalReplace(...args); scheduleRender(); };
  window.addEventListener("hashchange", scheduleRender); window.addEventListener("popstate", scheduleRender);
  new MutationObserver(() => { injectMenu(); if (isFactoryRoute() && !document.getElementById(ROOT_ID)) scheduleRender(); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleRender); else scheduleRender();
}
if (shouldBootstrap) bootstrap();
