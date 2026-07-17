(function productPromoStudioBootstrap() {
  "use strict";

  if (window.__TOONFLOW_PRODUCT_PROMO_STUDIO__) return;
  window.__TOONFLOW_PRODUCT_PROMO_STUDIO__ = true;

  const PROMO_MARKER = "__TOONFLOW_PRODUCT_PROMO_V1__";
  const WORKSPACE_SCRIPT_NAME = "__TF_PROMO_WORKSPACE_V1__";
  const STORAGE_PREFIX = "toonflow.productPromo.v1.";
  const STORAGE_VERSION = 1;
  const ROOT_ID = "tf-product-promo-root";
  const MENU_ID = "tf-product-promo-menu";
  const ROUTE_PATH = "/product-promo";
  const POLL_INTERVAL = 3000;
  const STAGE_WIDTH = 3200;
  const STAGE_HEIGHT = 2200;

  const ICONS = {
    promo: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 15.5V8.7a1 1 0 0 1 1-1h3.2l7-3.2a1 1 0 0 1 1.4.9v13.4a1 1 0 0 1-1.4.9l-7-3.2H5a1 1 0 0 1-1-1Z" stroke-width="1.8"/><path d="m8.2 16.5 1.2 3H6.5l-1-3M19 9.2c1.3 1.2 1.3 4.4 0 5.6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke-width="2" stroke-linecap="round"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke-width="1.7"/><circle cx="9" cy="10" r="1.5" stroke-width="1.7"/><path d="m5.5 17 4-4 3 3 2.3-2.3 3.7 3.3" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none"><path d="m12 3 1.2 4.1a5.1 5.1 0 0 0 3.5 3.5l4.1 1.2-4.1 1.2a5.1 5.1 0 0 0-3.5 3.5L12 20.6l-1.2-4.1A5.1 5.1 0 0 0 7.3 13l-4.1-1.2 4.1-1.2a5.1 5.1 0 0 0 3.5-3.5L12 3Z" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="13" height="14" rx="2" stroke-width="1.7"/><path d="m16.5 10 4-2v8l-4-2" stroke-width="1.7" stroke-linejoin="round"/><path d="m8.5 9 4 3-4 3V9Z" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V4.8h6V7m2.5 0-.7 12H7.2L6.5 7M10 10v6M14 10v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none"><path d="m4.5 16.5-.5 3.4 3.4-.5L18.8 8 16 5.2 4.5 16.5Z" stroke-width="1.7" stroke-linejoin="round"/><path d="m14.5 6.7 2.8 2.8" stroke-width="1.7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke-width="1.8" stroke-linecap="round"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none"><path d="m15 5-7 7 7 7" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    layout: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="5" height="5" rx="1" stroke-width="1.6"/><rect x="15.5" y="14" width="5" height="5" rx="1" stroke-width="1.6"/><path d="M8.5 7.5h3a3 3 0 0 1 3 3v1a3 3 0 0 0 3 3" stroke-width="1.6" stroke-linecap="round"/><path d="m15.5 12.5 2 2-2 2" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fit: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    zoomIn: '<svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke-width="1.7"/><path d="m15.2 15.2 4.3 4.3M10.5 7.5v6M7.5 10.5h6" stroke-width="1.7" stroke-linecap="round"/></svg>',
    zoomOut: '<svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke-width="1.7"/><path d="m15.2 15.2 4.3 4.3M7.5 10.5h6" stroke-width="1.7" stroke-linecap="round"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke-width="1.7"/><path d="M19 13.5v-3l-2-.6a7 7 0 0 0-.7-1.7l1-1.9-2.1-2.1-1.9 1a7 7 0 0 0-1.7-.7L11 2.5H8l-.6 2a7 7 0 0 0-1.7.7l-1.9-1-2.1 2.1 1 1.9a7 7 0 0 0-.7 1.7l-2 .6v3l2 .6a7 7 0 0 0 .7 1.7l-1 1.9 2.1 2.1 1.9-1a7 7 0 0 0 1.7.7l.6 2h3l.6-2a7 7 0 0 0 1.7-.7l1.9 1 2.1-2.1-1-1.9a7 7 0 0 0 .7-1.7l2-.6Z" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" transform="translate(2 0) scale(.83)"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5H5v14h14v-7M14 4h6v6M20 4l-9 9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  const app = {
    root: null,
    host: null,
    projects: [],
    imageModels: [],
    videoModels: [],
    modelDetails: new Map(),
    currentProject: null,
    canvas: null,
    routeKey: "",
    loading: false,
    generating: false,
    selectedEdgeId: null,
    connecting: null,
    saveTimer: null,
    pollTimer: null,
    renderTimer: null,
    observer: null,
    apiRoot: null,
    apiRootPromise: null,
    scriptPromise: null
  };

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function button(label, className, icon) {
    const node = make("button", `tf-promo-button${className ? ` ${className}` : ""}`);
    node.type = "button";
    if (label) node.setAttribute("aria-label", label);
    if (icon) node.insertAdjacentHTML("beforeend", ICONS[icon] || icon);
    if (label) node.appendChild(make("span", "", label));
    return node;
  }

  function iconButton(title, icon) {
    const node = make("button", "tf-promo-icon-button");
    node.type = "button";
    node.title = title;
    node.setAttribute("aria-label", title);
    node.innerHTML = ICONS[icon] || icon;
    return node;
  }

  function uid(prefix) {
    const random = window.crypto && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `${prefix}_${random}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function localKey(projectId) {
    return `${STORAGE_PREFIX}${projectId}`;
  }

  function getProjectDescription(project) {
    const intro = String(project && project.intro || "");
    if (!intro.startsWith(PROMO_MARKER)) return intro;
    const newline = intro.indexOf("\n");
    return newline >= 0 ? intro.slice(newline + 1) : "";
  }

  function isPromoProject(project) {
    if (!project) return false;
    return String(project.type || "") === PROMO_MARKER || String(project.intro || "").startsWith(PROMO_MARKER);
  }

  function modelKey(model) {
    if (!model) return "";
    return model.id && model.value ? `${model.id}:${model.value}` : String(model.value || model.modelName || "");
  }

  function modelLabel(model) {
    return String(model && (model.label || model.name || model.value) || "未命名模型");
  }

  function getToken() {
    return localStorage.getItem("token") || localStorage.getItem("Authorization") || sessionStorage.getItem("token") || sessionStorage.getItem("Authorization") || "";
  }

  function normalizeApiRoot(value) {
    const root = String(value || "").trim().replace(/\/+$/, "");
    if (!root) throw new Error("未取得后端服务地址");
    return /\/api$/i.test(root) ? root : `${root}/api`;
  }

  async function getApiRoot() {
    if (app.apiRoot) return app.apiRoot;
    if (app.apiRootPromise) return app.apiRootPromise;
    const configured = window.__TOONFLOW_API_BASE__ || localStorage.getItem("apiBaseUrl") || "";
    if (configured) {
      app.apiRoot = normalizeApiRoot(configured);
      return app.apiRoot;
    }
    if (location.protocol !== "file:") {
      app.apiRoot = normalizeApiRoot(location.origin);
      return app.apiRoot;
    }
    app.apiRootPromise = fetch("toonflow://getAppUrl")
      .then((response) => {
        if (!response.ok) throw new Error(`获取后端服务地址失败（${response.status}）`);
        return response.json();
      })
      .then((result) => {
        app.apiRoot = normalizeApiRoot(result && result.url);
        return app.apiRoot;
      })
      .catch((error) => {
        app.apiRootPromise = null;
        throw error;
      });
    return app.apiRootPromise;
  }

  async function apiUrl(path) {
    const root = await getApiRoot();
    const suffix = String(path || "").trim().replace(/^\/?api(?:\/|$)/i, "").replace(/^\/+/, "");
    return `${root.replace(/\/+$/, "")}${suffix ? `/${suffix}` : ""}`;
  }

  async function apiPost(path, payload) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = token;
    let response;
    try {
      response = await fetch(await apiUrl(path), {
        method: "POST",
        headers,
        body: JSON.stringify(payload || {})
      });
    } catch (error) {
      throw new Error(`网络请求失败：${error && error.message ? error.message : "无法连接服务"}`);
    }
    let result;
    try {
      result = await response.json();
    } catch (_error) {
      result = null;
    }
    if (!response.ok) {
      throw new Error(result && (result.message || result.msg) || `请求失败（${response.status}）`);
    }
    if (result && result.code !== undefined && ![0, 200].includes(Number(result.code))) {
      throw new Error(result.message || result.msg || "请求失败");
    }
    if (result && result.success === false) throw new Error(result.message || result.msg || "请求失败");
    return result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
  }

  function toast(message, type) {
    if (!app.root) return;
    let stack = app.root.querySelector(".tf-promo-toast-stack");
    if (!stack) {
      stack = make("div", "tf-promo-toast-stack");
      app.root.appendChild(stack);
    }
    const item = make("div", `tf-promo-toast tf-promo-toast-${type || "info"}`, message);
    stack.appendChild(item);
    window.setTimeout(() => item.remove(), 3300);
  }

  function errorMessage(error) {
    return error && error.message ? error.message : String(error || "未知错误");
  }

  function isPromoRoute() {
    return location.pathname.includes(ROUTE_PATH) || location.hash.includes(ROUTE_PATH);
  }

  function routeProjectId() {
    try {
      if (location.hash.includes(ROUTE_PATH)) {
        const query = location.hash.split("?")[1] || "";
        return new URLSearchParams(query).get("projectId") || "";
      }
      return new URL(location.href).searchParams.get("projectId") || "";
    } catch (_error) {
      return "";
    }
  }

  function navigatePromo(projectId, replace) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    if (location.protocol === "file:") {
      const target = `#${ROUTE_PATH}${query}`;
      if (replace) location.replace(target);
      else location.hash = target;
    } else {
      const target = `${ROUTE_PATH}${query}`;
      if (replace) history.replaceState({}, "", target);
      else history.pushState({}, "", target);
      window.dispatchEvent(new Event("tf-product-promo-navigation"));
    }
    scheduleRouteRender();
  }

  function hidePromoCardsFromOrdinaryProjects() {
    if (isPromoRoute()) return;
    const onProjectPage = location.pathname.includes("/project") || location.hash.includes("/project");
    document.querySelectorAll(".card").forEach((card) => {
      const hidden = onProjectPage && String(card.textContent || "").includes(PROMO_MARKER);
      card.classList.toggle("tf-product-promo-hidden-card", hidden);
    });
  }

  function injectMenu() {
    const itemBox = document.querySelector(".menu .itemBox");
    if (!itemBox) return null;
    let item = document.getElementById(MENU_ID);
    if (!item) {
      item = make("div", "");
      item.id = MENU_ID;
      item.title = "产品宣传片";
      item.innerHTML = `<button type="button" class="tf-promo-menu-button" aria-label="产品宣传片">${ICONS.promo}</button><span class="tf-promo-menu-label">产品宣传片</span>`;
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        navigatePromo("");
      });
      itemBox.appendChild(item);
    }
    item.classList.toggle("tf-promo-menu-active", isPromoRoute());
    return item;
  }

  function ensureRoot() {
    const host = document.querySelector(".viewBox");
    if (!host) return null;
    let root = document.getElementById(ROOT_ID);
    if (!root || root.parentElement !== host) {
      if (root) root.remove();
      root = make("div", "");
      root.id = ROOT_ID;
      host.appendChild(root);
    }
    host.classList.add("tf-promo-host-active");
    app.host = host;
    app.root = root;
    return root;
  }

  function cleanupPromoView() {
    stopPolling();
    app.routeKey = "";
    app.currentProject = null;
    app.canvas = null;
    if (app.root) app.root.remove();
    if (app.host) app.host.classList.remove("tf-promo-host-active");
    app.root = null;
    app.host = null;
  }

  function scheduleRouteRender() {
    if (app.renderTimer) return;
    app.renderTimer = window.setTimeout(() => {
      app.renderTimer = null;
      renderForCurrentRoute();
    }, 30);
  }

  async function renderForCurrentRoute() {
    injectMenu();
    hidePromoCardsFromOrdinaryProjects();
    if (!isPromoRoute()) {
      if (app.root) cleanupPromoView();
      return;
    }
    const root = ensureRoot();
    if (!root) return;
    const projectId = routeProjectId();
    const routeKey = projectId ? `editor:${projectId}` : "projects";
    if (app.routeKey === routeKey && root.childElementCount) return;
    app.routeKey = routeKey;
    stopPolling();
    if (projectId) await openProject(projectId);
    else await renderProjectPage();
  }

  async function loadModels(force) {
    if (!force && app.imageModels.length && app.videoModels.length) return;
    const [images, videos] = await Promise.all([
      apiPost("/api/modelSelect/getModelList", { type: "image" }),
      apiPost("/api/modelSelect/getModelList", { type: "video" })
    ]);
    app.imageModels = Array.isArray(images) ? images : [];
    app.videoModels = Array.isArray(videos) ? videos : [];
  }

  async function loadProjects() {
    const projects = await apiPost("/api/project/getProject", {});
    app.projects = (Array.isArray(projects) ? projects : []).filter(isPromoProject);
    return app.projects;
  }

  function formatDate(value) {
    if (!value) return "最近更新";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "最近更新";
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function renderPageTopbar(title, subtitle, actions) {
    const bar = make("header", "tf-promo-topbar");
    const main = make("div", "tf-promo-topbar-main");
    const mark = make("div", "tf-promo-brand-mark");
    mark.innerHTML = ICONS.promo;
    const heading = make("div", "tf-promo-heading");
    heading.appendChild(make("h1", "", title));
    heading.appendChild(make("p", "", subtitle));
    main.append(mark, heading);
    bar.appendChild(main);
    const actionBox = make("div", "tf-promo-topbar-actions");
    (actions || []).forEach((action) => actionBox.appendChild(action));
    bar.appendChild(actionBox);
    return bar;
  }

  function renderLoading(message) {
    if (!app.root) return;
    app.root.innerHTML = "";
    const page = make("div", "tf-promo-page");
    const loading = make("div", "tf-promo-loading");
    const box = make("div", "tf-promo-loading-box");
    box.appendChild(make("div", "tf-promo-spinner"));
    box.appendChild(make("div", "", message || "正在加载…"));
    loading.appendChild(box);
    page.appendChild(loading);
    app.root.appendChild(page);
  }

  function renderFatalError(title, error, retry) {
    if (!app.root) return;
    app.root.innerHTML = "";
    const page = make("div", "tf-promo-page");
    const panel = make("div", "tf-promo-error-panel");
    const box = make("div", "tf-promo-error-box");
    box.appendChild(make("h3", "", title));
    box.appendChild(make("p", "", errorMessage(error)));
    const retryButton = button("重新加载", "tf-promo-button-primary");
    retryButton.addEventListener("click", retry);
    box.appendChild(retryButton);
    panel.appendChild(box);
    page.appendChild(panel);
    app.root.appendChild(page);
  }

  async function renderProjectPage() {
    app.currentProject = null;
    app.canvas = null;
    renderLoading("正在加载宣传片项目…");
    try {
      await Promise.all([loadProjects(), loadModels(false)]);
    } catch (error) {
      renderFatalError("宣传片项目加载失败", error, () => renderProjectPage());
      return;
    }
    if (!app.root || routeProjectId()) return;
    app.root.innerHTML = "";
    const page = make("div", "tf-promo-page");
    const createTop = button("新建宣传片", "tf-promo-button-primary", "plus");
    createTop.addEventListener("click", () => showProjectModal());
    page.appendChild(renderPageTopbar("产品宣传片", "独立节点工作区 · 一键生成产品成片", [createTop]));

    const main = make("main", "tf-promo-project-main");
    const intro = make("section", "tf-promo-project-intro");
    const introText = make("div");
    introText.appendChild(make("h2", "", "宣传片项目"));
    introText.appendChild(make("p", "", "每个项目拥有独立画布，图片素材、生成链路和成片结果会自动保存。"));
    intro.appendChild(introText);
    main.appendChild(intro);

    if (!app.projects.length) {
      const empty = make("div", "tf-promo-empty");
      const box = make("div", "tf-promo-empty-box");
      const graphic = make("div", "tf-promo-empty-graphic");
      graphic.innerHTML = ICONS.promo;
      box.append(graphic, make("h3", "", "还没有产品宣传片"), make("p", "", "创建第一个宣传片项目，默认画布会准备好“上传图片 → 图片生成 → 最终视频”的工作流。"));
      const createEmpty = button("创建项目", "tf-promo-button-primary", "plus");
      createEmpty.addEventListener("click", () => showProjectModal());
      box.appendChild(createEmpty);
      empty.appendChild(box);
      main.appendChild(empty);
    } else {
      const grid = make("section", "tf-promo-project-grid");
      app.projects.forEach((project) => grid.appendChild(renderProjectCard(project)));
      main.appendChild(grid);
    }
    page.appendChild(main);
    app.root.appendChild(page);
  }

  function renderProjectCard(project) {
    const card = make("article", "tf-promo-project-card");
    card.tabIndex = 0;
    const top = make("div", "tf-promo-project-card-top");
    const icon = make("div", "tf-promo-project-icon");
    icon.innerHTML = ICONS.video;
    const title = make("div", "tf-promo-project-card-title");
    title.appendChild(make("h3", "", project.name || "未命名宣传片"));
    title.appendChild(make("span", "", formatDate(project.updateTime || project.updatedAt || project.createTime)));
    top.append(icon, title);
    card.appendChild(top);
    card.appendChild(make("div", "tf-promo-project-desc", getProjectDescription(project) || "暂无产品描述"));
    const tags = make("div", "tf-promo-project-tags");
    tags.append(make("span", "tf-promo-tag", project.videoRatio || "16:9"));
    tags.append(make("span", "tf-promo-tag", project.imageQuality || "2K"));
    tags.append(make("span", "tf-promo-tag", project.videoModel || "视频模型未设置"));
    card.appendChild(tags);

    const actions = make("div", "tf-promo-project-actions");
    const edit = iconButton("编辑项目设置", "edit");
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      showProjectModal(project);
    });
    const remove = iconButton("删除项目", "trash");
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteProject(project);
    });
    actions.append(edit, remove);
    card.appendChild(actions);
    const open = () => navigatePromo(project.id);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open();
    });
    return card;
  }

  function appendSelectOptions(select, values, selected, getValue, getLabel) {
    select.innerHTML = "";
    if (!values.length) {
      const option = make("option", "", "暂无可用模型");
      option.value = "";
      select.appendChild(option);
      return;
    }
    values.forEach((item) => {
      const option = make("option", "", getLabel(item));
      option.value = getValue(item);
      option.selected = option.value === String(selected || "");
      select.appendChild(option);
    });
    if (selected && !Array.from(select.options).some((option) => option.value === String(selected))) {
      const legacy = make("option", "", `${selected}（当前）`);
      legacy.value = String(selected);
      legacy.selected = true;
      select.appendChild(legacy);
    }
  }

  function normalizeModes(detail) {
    const modes = detail && Array.isArray(detail.mode) ? detail.mode : [];
    return modes.map((mode) => {
      if (Array.isArray(mode)) {
        const label = mode.map((entry) => {
          const match = String(entry).match(/^(imageReference|videoReference|audioReference):(\d+)$/);
          if (!match) return String(entry);
          const kind = match[1] === "imageReference" ? "图片" : match[1] === "videoReference" ? "视频" : "音频";
          return `${kind}最多${match[2]}个`;
        }).join("、");
        return { value: JSON.stringify(mode), label: `多参考（${label || "按模型限制"}）`, raw: mode };
      }
      const labels = {
        text: "纯文本生成",
        singleImage: "单图参考",
        startEndRequired: "首尾帧（必须两张）",
        endFrameOptional: "首帧必选，尾帧可选",
        startFrameOptional: "尾帧必选，首帧可选"
      };
      return { value: String(mode), label: labels[mode] || String(mode), raw: mode };
    });
  }

  async function getVideoDetail(key) {
    if (!key) return null;
    if (app.modelDetails.has(key)) return app.modelDetails.get(key);
    const detail = await apiPost("/api/modelSelect/getModelDetail", { modelId: key });
    app.modelDetails.set(key, detail || {});
    return detail || {};
  }

  async function populateModeSelect(select, videoModel, selectedMode) {
    select.disabled = true;
    try {
      const detail = await getVideoDetail(videoModel);
      const modes = normalizeModes(detail);
      appendSelectOptions(select, modes, selectedMode, (item) => item.value, (item) => item.label);
      if (!select.value && select.options.length) select.selectedIndex = 0;
    } catch (error) {
      select.innerHTML = "";
      const option = make("option", "", "模型详情加载失败");
      option.value = String(selectedMode || "");
      select.appendChild(option);
      toast(errorMessage(error), "error");
    } finally {
      select.disabled = false;
    }
  }

  async function showProjectModal(project) {
    try {
      await loadModels(false);
    } catch (error) {
      toast(errorMessage(error), "error");
      return;
    }
    if (!app.root) return;
    const isEdit = Boolean(project);
    const layer = make("div", "tf-promo-modal-layer");
    const modal = make("form", "tf-promo-modal");
    const header = make("div", "tf-promo-modal-header");
    header.appendChild(make("h2", "", isEdit ? "编辑宣传片项目" : "新建宣传片项目"));
    const close = iconButton("关闭", "close");
    header.appendChild(close);
    modal.appendChild(header);
    const body = make("div", "tf-promo-modal-body");

    const fields = {};
    function addField(key, label, control, wide, required) {
      const field = make("div", `tf-promo-field${wide ? " tf-promo-field-wide" : ""}`);
      const fieldLabel = make("label", required ? "tf-promo-required" : "", label);
      field.append(fieldLabel, control);
      body.appendChild(field);
      fields[key] = control;
    }

    const name = make("input", "tf-promo-input");
    name.maxLength = 80;
    name.placeholder = "例如：夏季新品发布片";
    name.value = project && project.name || "";
    addField("name", "项目名称", name, true, true);

    const description = make("textarea", "tf-promo-textarea");
    description.maxLength = 1000;
    description.placeholder = "描述产品卖点、目标受众和想呈现的氛围…";
    description.value = getProjectDescription(project);
    addField("description", "产品描述", description, true, true);

    const ratio = make("select", "tf-promo-select");
    appendSelectOptions(ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"], project && project.videoRatio || "16:9", (item) => item, (item) => item);
    addField("ratio", "画面比例", ratio);

    const quality = make("select", "tf-promo-select");
    appendSelectOptions(quality, ["1K", "2K", "4K"], project && project.imageQuality || "2K", (item) => item, (item) => item);
    addField("quality", "图片画质", quality);

    const imageModel = make("select", "tf-promo-select");
    appendSelectOptions(imageModel, app.imageModels, project && project.imageModel, modelKey, modelLabel);
    addField("imageModel", "图片模型", imageModel, false, true);

    const videoModel = make("select", "tf-promo-select");
    appendSelectOptions(videoModel, app.videoModels, project && project.videoModel, modelKey, modelLabel);
    addField("videoModel", "视频模型", videoModel, false, true);

    const mode = make("select", "tf-promo-select");
    addField("mode", "视频模式", mode, true, true);
    await populateModeSelect(mode, videoModel.value, project && project.mode);
    videoModel.addEventListener("change", () => populateModeSelect(mode, videoModel.value, ""));

    modal.appendChild(body);
    const footer = make("div", "tf-promo-modal-footer");
    const cancel = button("取消");
    const submit = button(isEdit ? "保存修改" : "创建并打开", "tf-promo-button-primary");
    submit.type = "submit";
    footer.append(cancel, submit);
    modal.appendChild(footer);
    layer.appendChild(modal);
    app.root.appendChild(layer);

    const dismiss = () => layer.remove();
    close.addEventListener("click", dismiss);
    cancel.addEventListener("click", dismiss);
    layer.addEventListener("mousedown", (event) => {
      if (event.target === layer) dismiss();
    });
    window.setTimeout(() => name.focus(), 20);

    modal.addEventListener("submit", async (event) => {
      event.preventDefault();
      const trimmedName = name.value.trim();
      const trimmedDescription = description.value.trim();
      if (!trimmedName || !trimmedDescription) {
        toast("请填写项目名称和产品描述", "error");
        return;
      }
      if (!imageModel.value || !videoModel.value || !mode.value) {
        toast("请选择可用的图片和视频模型", "error");
        return;
      }
      const duplicate = app.projects.find((item) => item.id !== (project && project.id) && String(item.name || "").trim() === trimmedName);
      if (duplicate) {
        toast("已存在同名宣传片项目，请更换名称", "error");
        return;
      }
      const instance = isEdit
        ? String(project.intro || "").split("\n")[0].slice(PROMO_MARKER.length + 1) || uid("project")
        : uid("project");
      const payload = {
        projectType: "script",
        name: trimmedName,
        intro: `${PROMO_MARKER}:${instance}\n${trimmedDescription}`,
        type: PROMO_MARKER,
        artStyle: "",
        directorManual: "",
        videoRatio: ratio.value,
        imageModel: imageModel.value,
        videoModel: videoModel.value,
        imageQuality: quality.value,
        mode: mode.value
      };
      if (isEdit) payload.id = Number(project.id);
      submit.disabled = true;
      submit.querySelector("span").textContent = isEdit ? "保存中…" : "创建中…";
      try {
        await apiPost(isEdit ? "/api/project/editProject" : "/api/project/addProject", payload);
        await loadProjects();
        dismiss();
        toast(isEdit ? "项目设置已保存" : "宣传片项目已创建", "success");
        if (isEdit) {
          const updated = app.projects.find((item) => String(item.id) === String(project.id));
          if (app.currentProject && updated) {
            app.currentProject = updated;
            renderEditor();
          } else {
            renderProjectPage();
          }
        } else {
          const marker = `${PROMO_MARKER}:${instance}`;
          const created = app.projects.find((item) => String(item.intro || "").startsWith(marker));
          if (!created) throw new Error("项目已创建，但未能定位新项目，请返回列表后重试");
          navigatePromo(created.id, true);
        }
      } catch (error) {
        toast(errorMessage(error), "error");
        submit.disabled = false;
        submit.querySelector("span").textContent = isEdit ? "保存修改" : "创建并打开";
      }
    });
  }

  async function deleteProject(project) {
    const confirmed = window.confirm(`确认删除宣传片项目“${project.name || "未命名"}”吗？\n\n项目、内部剧本和历史生成资源将一并删除，此操作不可恢复。`);
    if (!confirmed) return;
    try {
      await apiPost("/api/project/delProject", { id: Number(project.id) });
      localStorage.removeItem(localKey(project.id));
      toast("宣传片项目已删除", "success");
      if (app.currentProject && String(app.currentProject.id) === String(project.id)) navigatePromo("", true);
      else await renderProjectPage();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  function createDefaultCanvas(project) {
    const uploadId = uid("upload");
    const imageId = uid("image");
    const videoId = uid("video");
    return {
      version: STORAGE_VERSION,
      projectId: project.id,
      scriptId: null,
      nodes: [
        {
          id: uploadId,
          type: "upload",
          position: { x: 100, y: 180 },
          data: { url: "", status: "idle", error: "", storyboardId: null, registeredUrl: "" }
        },
        {
          id: imageId,
          type: "image",
          position: { x: 470, y: 145 },
          data: {
            prompt: getProjectDescription(project) || "突出产品主体，商业摄影质感，细节清晰，光影高级",
            model: project.imageModel || modelKey(app.imageModels[0]),
            ratio: project.videoRatio || "16:9",
            quality: project.imageQuality || "2K",
            resultUrl: "",
            status: "idle",
            error: "",
            inputSignature: "",
            storyboardId: null,
            registeredUrl: ""
          }
        },
        {
          id: videoId,
          type: "video",
          position: { x: 880, y: 120 },
          data: {
            prompt: `${getProjectDescription(project) || "产品展示"}。镜头运动自然，突出产品卖点，商业宣传片质感。`,
            model: project.videoModel || modelKey(app.videoModels[0]),
            mode: project.mode || "singleImage",
            resolution: "",
            duration: 5,
            audio: false,
            trackId: null,
            videoId: null,
            resultUrl: "",
            status: "idle",
            error: ""
          }
        }
      ],
      edges: [
        { id: uid("edge"), source: uploadId, target: imageId },
        { id: uid("edge"), source: imageId, target: videoId }
      ],
      viewport: { x: 40, y: 40, zoom: 0.9 },
      selectedVideoNodeId: videoId,
      updatedAt: Date.now()
    };
  }

  function normalizeCanvas(raw, project) {
    if (!raw || Number(raw.version) !== STORAGE_VERSION || String(raw.projectId) !== String(project.id)) {
      return createDefaultCanvas(project);
    }
    const validTypes = new Set(["upload", "image", "video"]);
    const nodes = Array.isArray(raw.nodes)
      ? raw.nodes.filter((node) => node && node.id && validTypes.has(node.type)).map((node) => ({
          id: String(node.id),
          type: node.type,
          position: {
            x: clamp(toNumber(node.position && node.position.x, 100), -1000, STAGE_WIDTH - 100),
            y: clamp(toNumber(node.position && node.position.y, 100), -1000, STAGE_HEIGHT - 100)
          },
          data: Object.assign({}, node.data || {})
        }))
      : [];
    if (!nodes.length) return createDefaultCanvas(project);
    const ids = new Set(nodes.map((node) => node.id));
    const edges = Array.isArray(raw.edges)
      ? raw.edges.filter((edge) => edge && ids.has(String(edge.source)) && ids.has(String(edge.target)) && edge.source !== edge.target).map((edge) => ({
          id: String(edge.id || uid("edge")),
          source: String(edge.source),
          target: String(edge.target)
        }))
      : [];
    const firstVideo = nodes.find((node) => node.type === "video");
    return {
      version: STORAGE_VERSION,
      projectId: project.id,
      scriptId: raw.scriptId || null,
      nodes,
      edges,
      viewport: {
        x: toNumber(raw.viewport && raw.viewport.x, 40),
        y: toNumber(raw.viewport && raw.viewport.y, 40),
        zoom: clamp(toNumber(raw.viewport && raw.viewport.zoom, 0.9), 0.25, 1.8)
      },
      selectedVideoNodeId: raw.selectedVideoNodeId || (firstVideo && firstVideo.id) || null,
      updatedAt: toNumber(raw.updatedAt, Date.now())
    };
  }

  function loadCanvas(project) {
    let raw = null;
    try {
      const saved = localStorage.getItem(localKey(project.id));
      raw = saved ? JSON.parse(saved) : null;
    } catch (_error) {
      localStorage.removeItem(localKey(project.id));
    }
    const canvas = normalizeCanvas(raw, project);
    if (!raw || raw.version !== STORAGE_VERSION) {
      try {
        localStorage.setItem(localKey(project.id), JSON.stringify(canvas));
      } catch (_error) {
        // The editor remains usable even when local storage is unavailable.
      }
    }
    return canvas;
  }

  function saveCanvas(immediate) {
    if (!app.canvas || !app.currentProject) return;
    const commit = () => {
      app.saveTimer = null;
      app.canvas.updatedAt = Date.now();
      try {
        localStorage.setItem(localKey(app.currentProject.id), JSON.stringify(app.canvas));
        const status = app.root && app.root.querySelector(".tf-promo-canvas-status");
        if (status) status.textContent = `已自动保存 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
      } catch (error) {
        toast(`画布保存失败：${errorMessage(error)}`, "error");
      }
    };
    if (app.saveTimer) clearTimeout(app.saveTimer);
    if (immediate) commit();
    else app.saveTimer = window.setTimeout(commit, 280);
  }

  function findNode(nodeId) {
    return app.canvas && app.canvas.nodes.find((node) => node.id === nodeId);
  }

  function nodeOutputUrl(node) {
    if (!node) return "";
    if (node.type === "upload") return String(node.data.url || "");
    if (node.type === "image") return String(node.data.resultUrl || "");
    if (node.type === "video") return String(node.data.resultUrl || "");
    return "";
  }

  function incomingNodes(nodeId) {
    if (!app.canvas) return [];
    return app.canvas.edges
      .filter((edge) => edge.target === nodeId)
      .map((edge) => findNode(edge.source))
      .filter(Boolean);
  }

  function outgoingNodes(nodeId) {
    if (!app.canvas) return [];
    return app.canvas.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => findNode(edge.target))
      .filter(Boolean);
  }

  async function ensureInternalScript(force) {
    if (!app.currentProject || !app.canvas) throw new Error("项目画布尚未准备完成");
    const canvas = app.canvas;
    const project = app.currentProject;
    const projectId = Number(project.id);
    if (!force && canvas.scriptId) return Number(canvas.scriptId);
    if (app.scriptPromise && app.scriptPromise.projectId === projectId) return app.scriptPromise.promise;
    const task = {
      projectId,
      promise: (async () => {
        const scripts = await apiPost("/api/script/getScrptApi", { projectId, name: WORKSPACE_SCRIPT_NAME });
        let script = (Array.isArray(scripts) ? scripts : []).find((item) => item.name === WORKSPACE_SCRIPT_NAME);
        if (!script) {
          await apiPost("/api/script/addScript", {
            name: WORKSPACE_SCRIPT_NAME,
            content: `产品宣传片内部工作区：${project.name || "未命名项目"}`,
            projectId,
            assets: []
          });
          const created = await apiPost("/api/script/getScrptApi", { projectId, name: WORKSPACE_SCRIPT_NAME });
          script = (Array.isArray(created) ? created : []).find((item) => item.name === WORKSPACE_SCRIPT_NAME);
        }
        if (!script || !script.id) throw new Error("无法创建宣传片内部工作区");
        canvas.scriptId = script.id;
        canvas.updatedAt = Date.now();
        if (app.canvas === canvas && app.currentProject === project) saveCanvas(true);
        else localStorage.setItem(localKey(projectId), JSON.stringify(canvas));
        return Number(script.id);
      })()
    };
    app.scriptPromise = task;
    try {
      return await task.promise;
    } finally {
      if (app.scriptPromise === task) app.scriptPromise = null;
    }
  }

  function durationResolutionOptions(detail) {
    const maps = detail && Array.isArray(detail.durationResolutionMap) ? detail.durationResolutionMap : [];
    const pairs = [];
    maps.forEach((entry) => {
      const durations = Array.isArray(entry.duration) ? entry.duration : [entry.duration].filter(Boolean);
      const resolutions = Array.isArray(entry.resolution) ? entry.resolution : [entry.resolution].filter(Boolean);
      durations.forEach((duration) => resolutions.forEach((resolution) => pairs.push({ duration: Number(duration), resolution: String(resolution) })));
    });
    return pairs.filter((item) => Number.isFinite(item.duration) && item.resolution);
  }

  async function applyVideoDefaults(node, force) {
    if (!node || node.type !== "video" || !node.data.model) return;
    const detail = await getVideoDetail(node.data.model);
    const modes = normalizeModes(detail);
    if (force || !modes.some((item) => item.value === String(node.data.mode || ""))) {
      const preferred = modes.find((item) => item.value === "singleImage") || modes[0];
      node.data.mode = preferred ? preferred.value : "";
    }
    const pairs = durationResolutionOptions(detail);
    if (pairs.length && (force || !pairs.some((item) => item.duration === Number(node.data.duration) && item.resolution === String(node.data.resolution || "")))) {
      node.data.duration = pairs[0].duration;
      node.data.resolution = pairs[0].resolution;
    }
    if (detail.audio === false) node.data.audio = false;
    if (detail.audio === true) node.data.audio = true;
  }

  async function openProject(projectId) {
    renderLoading("正在准备宣传片工作区…");
    try {
      await Promise.all([loadProjects(), loadModels(false)]);
      const project = app.projects.find((item) => String(item.id) === String(projectId));
      if (!project) throw new Error("宣传片项目不存在或已被删除");
      app.currentProject = project;
      app.canvas = loadCanvas(project);
      const videoNodes = app.canvas.nodes.filter((node) => node.type === "video");
      await Promise.all(videoNodes.map((node) => applyVideoDefaults(node, false).catch(() => null)));
      renderEditor();
      ensureInternalScript(true).catch((error) => toast(errorMessage(error), "error"));
      const unfinished = videoNodes.find((node) => node.data.videoId && ["generating", "queued", "running"].includes(node.data.status));
      if (unfinished) startPolling(unfinished.id);
    } catch (error) {
      renderFatalError("工作区打开失败", error, () => openProject(projectId));
    }
  }

  function renderEditor() {
    if (!app.root || !app.currentProject || !app.canvas) return;
    app.root.innerHTML = "";
    const page = make("div", "tf-promo-page");

    const back = iconButton("返回宣传片项目", "back");
    back.addEventListener("click", () => navigatePromo(""));
    const settings = button("项目设置", "", "settings");
    settings.addEventListener("click", () => showProjectModal(app.currentProject));
    const generate = button(app.generating ? "生成中…" : "一键生成", "tf-promo-button-primary", "spark");
    generate.disabled = app.generating;
    generate.dataset.action = "generate-all";
    generate.addEventListener("click", () => generateAll());
    const topbar = renderPageTopbar(app.currentProject.name || "产品宣传片", "节点工作区 · 画布按项目自动保存", [settings, generate]);
    topbar.querySelector(".tf-promo-topbar-main").prepend(back);
    page.appendChild(topbar);

    const editor = make("div", "tf-promo-editor");
    const workspace = make("section", "tf-promo-workspace");
    workspace.appendChild(renderCanvasToolbar());
    const viewport = make("div", "tf-promo-viewport");
    const stage = make("div", "tf-promo-stage");
    const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    edgeLayer.classList.add("tf-promo-edge-layer");
    edgeLayer.setAttribute("viewBox", `0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`);
    stage.appendChild(edgeLayer);
    viewport.appendChild(stage);
    workspace.appendChild(viewport);
    workspace.appendChild(make("div", "tf-promo-canvas-status", "已自动保存"));
    editor.append(workspace, renderPreview());
    page.appendChild(editor);
    app.root.appendChild(page);
    applyViewport();
    bindViewportEvents(viewport);
    renderNodes();
    requestAnimationFrame(renderEdges);
  }

  function renderCanvasToolbar() {
    const toolbar = make("div", "tf-promo-canvas-toolbar");
    const addUpload = button("上传图片", "", "image");
    addUpload.addEventListener("click", () => addNode("upload"));
    const addImage = button("生成图片", "", "spark");
    addImage.addEventListener("click", () => addNode("image"));
    const addVideo = button("最终视频", "", "video");
    addVideo.addEventListener("click", () => addNode("video"));
    toolbar.append(addUpload, addImage, addVideo, make("span", "tf-promo-toolbar-divider"));
    const zoomOut = iconButton("缩小", "zoomOut");
    zoomOut.addEventListener("click", () => setZoom(app.canvas.viewport.zoom - 0.1));
    const zoomLabel = make("span", "tf-promo-zoom-label", `${Math.round(app.canvas.viewport.zoom * 100)}%`);
    const zoomIn = iconButton("放大", "zoomIn");
    zoomIn.addEventListener("click", () => setZoom(app.canvas.viewport.zoom + 0.1));
    const fit = iconButton("适配视图", "fit");
    fit.addEventListener("click", fitView);
    const layout = button("自动排版", "", "layout");
    layout.addEventListener("click", autoLayout);
    toolbar.append(zoomOut, zoomLabel, zoomIn, fit, layout);
    return toolbar;
  }

  function applyViewport() {
    if (!app.root || !app.canvas) return;
    const stage = app.root.querySelector(".tf-promo-stage");
    if (stage) {
      const view = app.canvas.viewport;
      stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    }
    const label = app.root.querySelector(".tf-promo-zoom-label");
    if (label) label.textContent = `${Math.round(app.canvas.viewport.zoom * 100)}%`;
  }

  function setZoom(value, anchor) {
    if (!app.canvas || !app.root) return;
    const viewport = app.root.querySelector(".tf-promo-viewport");
    if (!viewport) return;
    const oldZoom = app.canvas.viewport.zoom;
    const nextZoom = clamp(value, 0.25, 1.8);
    if (Math.abs(oldZoom - nextZoom) < 0.001) return;
    const rect = viewport.getBoundingClientRect();
    const point = anchor || { x: rect.width / 2, y: rect.height / 2 };
    const worldX = (point.x - app.canvas.viewport.x) / oldZoom;
    const worldY = (point.y - app.canvas.viewport.y) / oldZoom;
    app.canvas.viewport.x = point.x - worldX * nextZoom;
    app.canvas.viewport.y = point.y - worldY * nextZoom;
    app.canvas.viewport.zoom = nextZoom;
    applyViewport();
    saveCanvas();
  }

  function bindViewportEvents(viewport) {
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      setZoom(app.canvas.viewport.zoom + (event.deltaY < 0 ? 0.08 : -0.08), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, { passive: false });
    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".tf-promo-node") || event.target.closest(".tf-promo-canvas-toolbar")) return;
      const start = { x: event.clientX, y: event.clientY, vx: app.canvas.viewport.x, vy: app.canvas.viewport.y };
      viewport.classList.add("tf-promo-panning");
      viewport.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        app.canvas.viewport.x = start.vx + moveEvent.clientX - start.x;
        app.canvas.viewport.y = start.vy + moveEvent.clientY - start.y;
        applyViewport();
      };
      const end = () => {
        viewport.classList.remove("tf-promo-panning");
        viewport.removeEventListener("pointermove", move);
        viewport.removeEventListener("pointerup", end);
        viewport.removeEventListener("pointercancel", end);
        saveCanvas();
      };
      viewport.addEventListener("pointermove", move);
      viewport.addEventListener("pointerup", end);
      viewport.addEventListener("pointercancel", end);
    });
    viewport.addEventListener("click", (event) => {
      if (!event.target.closest(".tf-promo-edge-delete") && !event.target.closest(".tf-promo-edge-path")) {
        app.selectedEdgeId = null;
        renderEdges();
      }
    });
  }

  function addNode(type) {
    if (!app.canvas || !app.currentProject) return;
    if (type === "video" && app.canvas.nodes.some((node) => node.type === "video")) {
      toast("一个宣传片项目最多只能有一个最终视频节点", "error");
      return;
    }
    const count = app.canvas.nodes.length;
    const worldCenter = {
      x: (260 - app.canvas.viewport.x) / app.canvas.viewport.zoom + (count % 3) * 35,
      y: (180 - app.canvas.viewport.y) / app.canvas.viewport.zoom + (count % 4) * 35
    };
    const node = {
      id: uid(type),
      type,
      position: { x: clamp(worldCenter.x, 20, STAGE_WIDTH - 400), y: clamp(worldCenter.y, 80, STAGE_HEIGHT - 500) },
      data: {}
    };
    if (type === "upload") {
      node.data = { url: "", status: "idle", error: "", storyboardId: null, registeredUrl: "" };
    } else if (type === "image") {
      node.data = {
        prompt: getProjectDescription(app.currentProject) || "商业产品摄影，主体清晰，光影精致",
        model: app.currentProject.imageModel || modelKey(app.imageModels[0]),
        ratio: app.currentProject.videoRatio || "16:9",
        quality: app.currentProject.imageQuality || "2K",
        resultUrl: "",
        status: "idle",
        error: "",
        inputSignature: "",
        storyboardId: null,
        registeredUrl: ""
      };
    } else {
      node.data = {
        prompt: `${getProjectDescription(app.currentProject) || "产品展示"}。镜头运动流畅，突出产品主体与质感。`,
        model: app.currentProject.videoModel || modelKey(app.videoModels[0]),
        mode: app.currentProject.mode || "singleImage",
        resolution: "",
        duration: 5,
        audio: false,
        trackId: null,
        videoId: null,
        resultUrl: "",
        status: "idle",
        error: ""
      };
      app.canvas.selectedVideoNodeId = node.id;
      applyVideoDefaults(node, false).then(() => {
        saveCanvas();
        renderNodes();
        refreshPreview();
      }).catch((error) => toast(errorMessage(error), "error"));
    }
    app.canvas.nodes.push(node);
    saveCanvas();
    renderNodes();
    requestAnimationFrame(renderEdges);
    toast(type === "upload" ? "已添加上传图片节点" : type === "image" ? "已添加图片生成节点" : "已添加最终视频节点", "success");
  }

  function deleteNode(nodeId) {
    const node = findNode(nodeId);
    if (!node) return;
    const label = node.type === "upload" ? "上传图片" : node.type === "image" ? "图片生成" : "最终视频";
    if (!window.confirm(`确认从画布移除“${label}”节点吗？\n历史生成记录不会被删除。`)) return;
    if (node.type === "video" && app.pollTimer) stopPolling();
    app.canvas.nodes = app.canvas.nodes.filter((item) => item.id !== nodeId);
    app.canvas.edges = app.canvas.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    if (app.canvas.selectedVideoNodeId === nodeId) app.canvas.selectedVideoNodeId = null;
    saveCanvas(true);
    renderNodes();
    renderEdges();
    refreshPreview();
  }

  function autoLayout() {
    if (!app.canvas || !app.canvas.nodes.length) return;
    const nodes = app.canvas.nodes;
    const indegree = new Map(nodes.map((node) => [node.id, 0]));
    app.canvas.edges.forEach((edge) => indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1));
    const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
    const depth = new Map(queue.map((id) => [id, 0]));
    const ordered = [];
    while (queue.length) {
      const id = queue.shift();
      ordered.push(id);
      app.canvas.edges.filter((edge) => edge.source === id).forEach((edge) => {
        depth.set(edge.target, Math.max(depth.get(edge.target) || 0, (depth.get(id) || 0) + 1));
        indegree.set(edge.target, (indegree.get(edge.target) || 0) - 1);
        if (indegree.get(edge.target) === 0) queue.push(edge.target);
      });
    }
    nodes.forEach((node) => {
      if (!depth.has(node.id)) depth.set(node.id, 0);
    });
    const maxDepth = Math.max(0, ...Array.from(depth.values()));
    nodes.filter((node) => node.type === "video").forEach((node) => depth.set(node.id, Math.max(depth.get(node.id), maxDepth)));
    const levels = new Map();
    nodes.forEach((node) => {
      const level = depth.get(node.id) || 0;
      if (!levels.has(level)) levels.set(level, []);
      levels.get(level).push(node);
    });
    Array.from(levels.keys()).sort((a, b) => a - b).forEach((level) => {
      levels.get(level).forEach((node, index) => {
        node.position.x = 90 + level * 430;
        node.position.y = 115 + index * 430;
      });
    });
    saveCanvas(true);
    renderNodes();
    requestAnimationFrame(() => {
      renderEdges();
      fitView();
    });
  }

  function fitView() {
    if (!app.canvas || !app.root || !app.canvas.nodes.length) return;
    const viewport = app.root.querySelector(".tf-promo-viewport");
    if (!viewport) return;
    const nodeElements = Array.from(app.root.querySelectorAll(".tf-promo-node"));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    app.canvas.nodes.forEach((node) => {
      const element = nodeElements.find((item) => item.dataset.nodeId === node.id);
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + (element ? element.offsetWidth : 340));
      maxY = Math.max(maxY, node.position.y + (element ? element.offsetHeight : 360));
    });
    const rect = viewport.getBoundingClientRect();
    const padding = 90;
    const zoom = clamp(Math.min((rect.width - padding * 2) / Math.max(300, maxX - minX), (rect.height - padding * 2) / Math.max(260, maxY - minY)), 0.25, 1.15);
    app.canvas.viewport.zoom = zoom;
    app.canvas.viewport.x = (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom;
    app.canvas.viewport.y = (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom;
    applyViewport();
    saveCanvas();
  }

  function nodeStatus(node) {
    const status = String(node.data.status || "idle");
    if (status === "uploading") return { text: "上传中…", kind: "running" };
    if (["generating", "queued", "running"].includes(status)) return { text: node.type === "video" ? "视频生成中…" : "图片生成中…", kind: "running" };
    if (status === "success") return { text: "已完成", kind: "success" };
    if (status === "failed") return { text: node.data.error || "生成失败", kind: "error" };
    return { text: node.type === "upload" ? "等待上传" : "等待生成", kind: "idle" };
  }

  function createNodeShell(node, title, icon) {
    const element = make("article", "tf-promo-node");
    element.dataset.nodeId = node.id;
    element.dataset.nodeType = node.type;
    element.style.left = `${node.position.x}px`;
    element.style.top = `${node.position.y}px`;
    if (["uploading", "generating", "queued", "running"].includes(node.data.status)) element.classList.add("tf-promo-node-running");
    if (node.data.status === "failed") element.classList.add("tf-promo-node-error");
    const header = make("header", "tf-promo-node-header");
    const kind = make("span", "tf-promo-node-kind");
    kind.innerHTML = ICONS[icon];
    const heading = make("strong", "", title);
    const remove = iconButton("移除节点", "trash");
    remove.addEventListener("pointerdown", (event) => event.stopPropagation());
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteNode(node.id);
    });
    header.append(kind, heading, remove);
    element.appendChild(header);
    bindNodeDrag(element, header, node);
    return element;
  }

  function addNodeHandle(element, node, kind) {
    const handle = make("span", `tf-promo-handle tf-promo-handle-${kind}`);
    handle.dataset.nodeId = node.id;
    handle.title = kind === "source" ? "拖动连接到下游节点" : "接收上游图片";
    element.appendChild(handle);
    if (kind === "source") bindSourceHandle(handle, node);
  }

  function bindNodeDrag(element, header, node) {
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      event.stopPropagation();
      const zoom = app.canvas.viewport.zoom;
      const start = { x: event.clientX, y: event.clientY, nx: node.position.x, ny: node.position.y };
      header.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        node.position.x = clamp(start.nx + (moveEvent.clientX - start.x) / zoom, -500, STAGE_WIDTH - 80);
        node.position.y = clamp(start.ny + (moveEvent.clientY - start.y) / zoom, -500, STAGE_HEIGHT - 80);
        element.style.left = `${node.position.x}px`;
        element.style.top = `${node.position.y}px`;
        renderEdges();
      };
      const end = () => {
        header.removeEventListener("pointermove", move);
        header.removeEventListener("pointerup", end);
        header.removeEventListener("pointercancel", end);
        saveCanvas();
      };
      header.addEventListener("pointermove", move);
      header.addEventListener("pointerup", end);
      header.addEventListener("pointercancel", end);
    });
  }

  function createMedia(url, emptyText) {
    const media = make("div", "tf-promo-media");
    if (url) {
      const image = document.createElement("img");
      image.alt = emptyText || "节点图片";
      image.src = url;
      image.addEventListener("error", () => {
        image.remove();
        const placeholder = make("div", "tf-promo-media-placeholder");
        placeholder.innerHTML = `${ICONS.image}<span>图片加载失败</span>`;
        media.appendChild(placeholder);
      }, { once: true });
      media.appendChild(image);
    } else {
      const placeholder = make("div", "tf-promo-media-placeholder");
      placeholder.innerHTML = `${ICONS.image}<span>${emptyText || "暂无图片"}</span>`;
      media.appendChild(placeholder);
    }
    return media;
  }

  function createSelect(values, selected, getValue, getLabel) {
    const select = make("select", "tf-promo-select");
    appendSelectOptions(select, values, selected, getValue || ((item) => item), getLabel || ((item) => item));
    return select;
  }

  function addLabeledControl(container, label, control) {
    const field = make("div", "tf-promo-field");
    field.append(make("label", "", label), control);
    container.appendChild(field);
    return field;
  }

  function renderNodes() {
    if (!app.root || !app.canvas) return;
    const stage = app.root.querySelector(".tf-promo-stage");
    if (!stage) return;
    stage.querySelectorAll(".tf-promo-node").forEach((node) => node.remove());
    app.canvas.nodes.forEach((node) => {
      const element = node.type === "upload"
        ? renderUploadNode(node)
        : node.type === "image"
          ? renderImageNode(node)
          : renderVideoNode(node);
      stage.appendChild(element);
    });
    requestAnimationFrame(renderEdges);
  }

  function renderUploadNode(node) {
    const element = createNodeShell(node, "上传图片", "image");
    const body = make("div", "tf-promo-node-body");
    const media = createMedia(node.data.url, "点击上传 JPEG / PNG");
    const upload = make("label", `tf-promo-upload-label${node.data.url ? " tf-promo-upload-has-image" : ""}`, node.data.url ? "更换图片" : "");
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/jpeg,image/png";
    upload.appendChild(file);
    media.appendChild(upload);
    file.addEventListener("change", () => {
      if (file.files && file.files[0]) uploadImageNode(node.id, file.files[0]);
    });
    body.appendChild(media);
    const footer = make("div", "tf-promo-node-footer");
    const status = nodeStatus(node);
    footer.appendChild(make("span", `tf-promo-node-state tf-promo-node-state-${status.kind}`, status.text));
    body.appendChild(footer);
    element.appendChild(body);
    addNodeHandle(element, node, "source");
    return element;
  }

  function renderImageNode(node) {
    const element = createNodeShell(node, "图片生成", "spark");
    const body = make("div", "tf-promo-node-body");
    body.appendChild(createMedia(node.data.resultUrl, "生成结果将在这里显示"));
    const prompt = make("textarea", "tf-promo-textarea");
    prompt.placeholder = "描述希望生成的产品图片…";
    prompt.value = node.data.prompt || "";
    addLabeledControl(body, "图片提示词", prompt);
    prompt.addEventListener("input", () => {
      node.data.prompt = prompt.value;
      saveCanvas();
    });

    const row = make("div", "tf-promo-node-row tf-promo-node-row-three");
    const model = createSelect(app.imageModels, node.data.model, modelKey, modelLabel);
    const ratio = createSelect(["16:9", "9:16", "1:1", "4:3", "3:4"], node.data.ratio || "16:9");
    const quality = createSelect(["1K", "2K", "4K"], node.data.quality || "2K");
    addLabeledControl(row, "模型", model);
    addLabeledControl(row, "比例", ratio);
    addLabeledControl(row, "画质", quality);
    body.appendChild(row);
    model.addEventListener("change", () => { node.data.model = model.value; saveCanvas(); });
    ratio.addEventListener("change", () => { node.data.ratio = ratio.value; saveCanvas(); });
    quality.addEventListener("change", () => { node.data.quality = quality.value; saveCanvas(); });

    const footer = make("div", "tf-promo-node-footer");
    const status = nodeStatus(node);
    footer.appendChild(make("span", `tf-promo-node-state tf-promo-node-state-${status.kind}`, status.text));
    const generate = button(node.data.resultUrl ? "重新生成" : "生成图片", "tf-promo-button-primary", "spark");
    generate.disabled = ["generating", "uploading"].includes(node.data.status);
    generate.addEventListener("click", () => generateImageNode(node.id, false));
    footer.appendChild(generate);
    body.appendChild(footer);
    element.appendChild(body);
    addNodeHandle(element, node, "target");
    addNodeHandle(element, node, "source");
    return element;
  }

  function renderVideoNode(node) {
    const element = createNodeShell(node, "最终视频", "video");
    const body = make("div", "tf-promo-node-body");
    const prompt = make("textarea", "tf-promo-textarea");
    prompt.placeholder = "描述镜头运动、产品展示重点和宣传片氛围…";
    prompt.value = node.data.prompt || "";
    addLabeledControl(body, "视频提示词", prompt);
    prompt.addEventListener("input", () => { node.data.prompt = prompt.value; saveCanvas(); });

    const firstRow = make("div", "tf-promo-node-row");
    const model = createSelect(app.videoModels, node.data.model, modelKey, modelLabel);
    const detail = app.modelDetails.get(node.data.model) || {};
    const modes = normalizeModes(detail);
    const mode = createSelect(modes, node.data.mode, (item) => item.value, (item) => item.label);
    addLabeledControl(firstRow, "视频模型", model);
    addLabeledControl(firstRow, "生成模式", mode);
    body.appendChild(firstRow);

    const pairs = durationResolutionOptions(detail);
    const durations = Array.from(new Set(pairs.map((item) => item.duration)));
    if (!durations.length && node.data.duration) durations.push(Number(node.data.duration));
    const resolutionValues = Array.from(new Set(pairs.filter((item) => !node.data.duration || item.duration === Number(node.data.duration)).map((item) => item.resolution)));
    if (!resolutionValues.length && node.data.resolution) resolutionValues.push(String(node.data.resolution));
    const secondRow = make("div", "tf-promo-node-row tf-promo-node-row-three");
    const resolution = createSelect(resolutionValues, node.data.resolution);
    const duration = createSelect(durations, String(node.data.duration || ""), (item) => String(item), (item) => `${item} 秒`);
    const audioValues = detail.audio === false
      ? [{ value: "false", label: "不支持" }]
      : detail.audio === true
        ? [{ value: "true", label: "必须开启" }]
        : [{ value: "false", label: "关闭" }, { value: "true", label: "开启" }];
    const audio = createSelect(audioValues, String(Boolean(node.data.audio)), (item) => item.value, (item) => item.label);
    audio.disabled = detail.audio === false || detail.audio === true;
    addLabeledControl(secondRow, "分辨率", resolution);
    addLabeledControl(secondRow, "时长", duration);
    addLabeledControl(secondRow, "音频", audio);
    body.appendChild(secondRow);

    model.addEventListener("change", async () => {
      node.data.model = model.value;
      node.data.status = node.data.videoId ? node.data.status : "idle";
      try {
        await applyVideoDefaults(node, true);
        saveCanvas(true);
        renderNodes();
        refreshPreview();
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    });
    mode.addEventListener("change", () => { node.data.mode = mode.value; saveCanvas(); });
    duration.addEventListener("change", () => {
      node.data.duration = Number(duration.value);
      const allowed = pairs.filter((item) => item.duration === node.data.duration).map((item) => item.resolution);
      if (allowed.length && !allowed.includes(node.data.resolution)) node.data.resolution = allowed[0];
      saveCanvas(true);
      renderNodes();
    });
    resolution.addEventListener("change", () => { node.data.resolution = resolution.value; saveCanvas(); });
    audio.addEventListener("change", () => { node.data.audio = audio.value === "true"; saveCanvas(); });

    const footer = make("div", "tf-promo-node-footer");
    const status = nodeStatus(node);
    footer.appendChild(make("span", `tf-promo-node-state tf-promo-node-state-${status.kind}`, status.text));
    const generate = button(node.data.videoId ? "重新生成" : "生成视频", "tf-promo-button-primary", "video");
    generate.disabled = app.generating || ["generating", "queued", "running"].includes(node.data.status);
    generate.addEventListener("click", () => generateVideoFromNode(node.id));
    footer.appendChild(generate);
    body.appendChild(footer);
    element.appendChild(body);
    addNodeHandle(element, node, "target");
    return element;
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("无法读取图片文件"));
      reader.readAsDataURL(file);
    });
  }

  async function uploadImageNode(nodeId, file) {
    const node = findNode(nodeId);
    if (!node || node.type !== "upload") return;
    if (!file || !["image/jpeg", "image/png"].includes(file.type)) {
      toast("仅支持 JPEG 或 PNG 图片", "error");
      return;
    }
    node.data.status = "uploading";
    node.data.error = "";
    renderNodes();
    try {
      const scriptId = app.canvas.scriptId || await ensureInternalScript();
      const base64Data = await fileToDataUrl(file);
      const result = await apiPost("/api/production/editImage/uploadImage", {
        projectId: app.currentProject.id,
        scriptId,
        base64Data
      });
      const url = typeof result === "string" ? result : result && (result.url || result.src || result.filePath);
      if (!url) throw new Error("上传成功但未返回图片地址");
      node.data.url = url;
      node.data.status = "success";
      node.data.error = "";
      if (node.data.registeredUrl !== url) node.data.registeredUrl = "";
      saveCanvas(true);
      renderNodes();
      toast("图片上传成功", "success");
    } catch (error) {
      node.data.status = "failed";
      node.data.error = errorMessage(error);
      saveCanvas(true);
      renderNodes();
      toast(node.data.error, "error");
    }
  }

  function graphHasPath(startId, targetId) {
    const seen = new Set();
    const stack = [startId];
    while (stack.length) {
      const current = stack.pop();
      if (current === targetId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      app.canvas.edges.filter((edge) => edge.source === current).forEach((edge) => stack.push(edge.target));
    }
    return false;
  }

  function validateEdge(sourceId, targetId) {
    if (sourceId === targetId) return "节点不能连接自身";
    const source = findNode(sourceId);
    const target = findNode(targetId);
    if (!source || !target) return "连接节点不存在";
    if (source.type === "video") return "最终视频节点不能连接到其他节点";
    if (target.type === "upload") return "上传图片节点不能接收输入";
    if (app.canvas.edges.some((edge) => edge.source === sourceId && edge.target === targetId)) return "这条连接已经存在";
    if (graphHasPath(targetId, sourceId)) return "该连接会形成循环，已阻止";
    return "";
  }

  function addEdge(sourceId, targetId) {
    const invalid = validateEdge(sourceId, targetId);
    if (invalid) {
      toast(invalid, "error");
      return false;
    }
    app.canvas.edges.push({ id: uid("edge"), source: sourceId, target: targetId });
    saveCanvas(true);
    renderEdges();
    return true;
  }

  function removeEdge(edgeId) {
    if (!app.canvas) return;
    app.canvas.edges = app.canvas.edges.filter((edge) => edge.id !== edgeId);
    if (app.selectedEdgeId === edgeId) app.selectedEdgeId = null;
    saveCanvas(true);
    renderEdges();
  }

  function edgePoint(node, kind) {
    const element = app.root && Array.from(app.root.querySelectorAll(".tf-promo-node")).find((item) => item.dataset.nodeId === node.id);
    const width = element ? element.offsetWidth : node.type === "video" ? 360 : node.type === "image" ? 340 : 300;
    const height = element ? element.offsetHeight : 260;
    return { x: node.position.x + (kind === "source" ? width : 0), y: node.position.y + height / 2 };
  }

  function bezierPath(from, to) {
    const distance = Math.max(70, Math.abs(to.x - from.x) * 0.48);
    return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`;
  }

  function svgElement(tag, attributes) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes || {}).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function renderEdges() {
    if (!app.root || !app.canvas) return;
    const layer = app.root.querySelector(".tf-promo-edge-layer");
    if (!layer) return;
    layer.innerHTML = "";
    app.canvas.edges.forEach((edge) => {
      const source = findNode(edge.source);
      const target = findNode(edge.target);
      if (!source || !target) return;
      const from = edgePoint(source, "source");
      const to = edgePoint(target, "target");
      const path = svgElement("path", { d: bezierPath(from, to), class: `tf-promo-edge-path${app.selectedEdgeId === edge.id ? " tf-promo-edge-selected" : ""}` });
      path.addEventListener("click", (event) => {
        event.stopPropagation();
        app.selectedEdgeId = edge.id;
        renderEdges();
      });
      layer.appendChild(path);
      if (app.selectedEdgeId === edge.id) {
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const group = svgElement("g", { class: "tf-promo-edge-delete", transform: `translate(${mid.x} ${mid.y})` });
        group.append(svgElement("circle", { cx: 0, cy: 0, r: 10 }), svgElement("text", { x: 0, y: 5 }));
        group.querySelector("text").textContent = "×";
        group.addEventListener("click", (event) => {
          event.stopPropagation();
          removeEdge(edge.id);
        });
        layer.appendChild(group);
      }
    });
    if (app.connecting) {
      const source = findNode(app.connecting.sourceId);
      if (source) {
        const live = svgElement("path", { d: bezierPath(edgePoint(source, "source"), app.connecting.point), class: "tf-promo-edge-live" });
        layer.appendChild(live);
      }
    }
  }

  function clientToWorld(clientX, clientY) {
    const viewport = app.root.querySelector(".tf-promo-viewport");
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - app.canvas.viewport.x) / app.canvas.viewport.zoom,
      y: (clientY - rect.top - app.canvas.viewport.y) / app.canvas.viewport.zoom
    };
  }

  function bindSourceHandle(handle, node) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      app.connecting = { sourceId: node.id, point: clientToWorld(event.clientX, event.clientY) };
      renderEdges();
      const move = (moveEvent) => {
        if (!app.connecting) return;
        app.connecting.point = clientToWorld(moveEvent.clientX, moveEvent.clientY);
        renderEdges();
      };
      const end = (endEvent) => {
        const sourceId = app.connecting && app.connecting.sourceId;
        app.connecting = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        const targetHandle = document.elementFromPoint(endEvent.clientX, endEvent.clientY);
        const target = targetHandle && targetHandle.closest(".tf-promo-handle-target");
        if (sourceId && target) addEdge(sourceId, target.dataset.nodeId);
        else renderEdges();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
    });
  }

  function renderPreview() {
    const panel = make("aside", "tf-promo-preview");
    const header = make("div", "tf-promo-preview-header");
    header.appendChild(make("h2", "", "成片预览"));
    const videoNode = app.canvas && (findNode(app.canvas.selectedVideoNodeId) || app.canvas.nodes.find((node) => node.type === "video"));
    const status = videoNode ? nodeStatus(videoNode) : { text: "未添加", kind: "idle" };
    header.appendChild(make("span", "tf-promo-preview-badge", status.text));
    panel.appendChild(header);
    const player = make("div", "tf-promo-preview-player");
    if (videoNode && videoNode.data.resultUrl && videoNode.data.status === "success") {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.src = videoNode.data.resultUrl;
      player.appendChild(video);
    } else {
      const placeholder = make("div", "tf-promo-preview-placeholder");
      placeholder.innerHTML = ICONS.video;
      const running = videoNode && ["generating", "queued", "running"].includes(videoNode.data.status);
      const failed = videoNode && videoNode.data.status === "failed";
      placeholder.appendChild(make("strong", failed ? "tf-promo-preview-error" : "", running ? "视频正在生成" : failed ? "视频生成失败" : "等待生成成片"));
      placeholder.appendChild(make("span", failed ? "tf-promo-preview-error" : "", failed ? (videoNode.data.error || "请检查配置后重试") : running ? "任务已提交，页面会每 3 秒自动更新状态。" : "连接参考图片并配置最终视频节点，然后点击一键生成。"));
      if (running) placeholder.appendChild(make("div", "tf-promo-preview-progress"));
      player.appendChild(placeholder);
    }
    panel.appendChild(player);
    if (videoNode) {
      const actions = make("div", "tf-promo-preview-actions");
      const regenerate = button(videoNode.data.videoId ? "重新生成" : "开始生成", videoNode.data.resultUrl ? "" : "tf-promo-button-primary", "spark");
      regenerate.disabled = app.generating || ["generating", "queued", "running"].includes(videoNode.data.status);
      regenerate.addEventListener("click", () => generateVideoFromNode(videoNode.id));
      actions.appendChild(regenerate);
      if (videoNode.data.resultUrl) {
        const open = button("打开", "", "open");
        open.addEventListener("click", () => window.open(videoNode.data.resultUrl, "_blank", "noopener,noreferrer"));
        const download = button("下载", "", "download");
        download.addEventListener("click", () => {
          const anchor = document.createElement("a");
          anchor.href = videoNode.data.resultUrl;
          anchor.download = `${app.currentProject.name || "产品宣传片"}.mp4`;
          anchor.target = "_blank";
          anchor.rel = "noopener";
          anchor.click();
        });
        actions.append(open, download);
      }
      panel.appendChild(actions);
    }
    const info = make("div", "tf-promo-preview-info");
    info.textContent = videoNode
      ? `模型：${videoNode.data.model || "未选择"}\n模式：${modeDisplayName(videoNode.data.mode)}\n规格：${videoNode.data.resolution || "按模型默认"} · ${videoNode.data.duration || "-"} 秒`
      : "画布中添加最终视频节点后，生成状态与最新成片会显示在这里。";
    info.style.whiteSpace = "pre-line";
    panel.appendChild(info);
    return panel;
  }

  function refreshPreview() {
    if (!app.root) return;
    const previous = app.root.querySelector(".tf-promo-preview");
    if (previous) previous.replaceWith(renderPreview());
  }

  function modeDisplayName(mode) {
    const names = {
      text: "纯文本生成",
      singleImage: "单图参考",
      startEndRequired: "首尾帧",
      endFrameOptional: "首帧必选",
      startFrameOptional: "尾帧必选"
    };
    if (names[mode]) return names[mode];
    if (String(mode || "").startsWith("[")) return "多参考";
    return mode || "未选择";
  }

  function imageInputSignature(node, references) {
    return JSON.stringify({
      prompt: String(node.data.prompt || "").trim(),
      model: node.data.model || "",
      ratio: node.data.ratio || "",
      quality: node.data.quality || "",
      references
    });
  }

  async function validateImageInputs(node, references) {
    if (!node.data.prompt || !String(node.data.prompt).trim()) throw new Error("图片生成节点缺少提示词");
    if (!node.data.model) throw new Error("图片生成节点未选择模型");
    let detail = null;
    try {
      detail = await getVideoDetail(node.data.model);
    } catch (_error) {
      // The generation endpoint remains the source of truth when a provider does not expose details.
    }
    const modes = detail && Array.isArray(detail.mode) ? detail.mode.map(String) : [];
    if (modes.length) {
      if (!references.length && !modes.includes("text")) throw new Error("所选图片模型不支持无参考图生成");
      if (references.length === 1 && !modes.includes("singleImage") && !modes.includes("multiReference")) throw new Error("所选图片模型不支持参考图生成");
      if (references.length > 1 && !modes.includes("multiReference")) throw new Error("所选图片模型不支持多参考图生成");
    }
  }

  async function generateImageNode(nodeId, fromPipeline) {
    const node = findNode(nodeId);
    if (!node || node.type !== "image") {
      const error = new Error("图片生成节点不存在");
      if (fromPipeline) throw error;
      toast(error.message, "error");
      return "";
    }
    const inputs = incomingNodes(node.id);
    const missing = inputs.find((item) => !nodeOutputUrl(item));
    if (missing) {
      const error = new Error("图片生成节点的上游图片尚未准备完成");
      node.data.status = "failed";
      node.data.error = error.message;
      saveCanvas(true);
      renderNodes();
      if (fromPipeline) throw error;
      toast(error.message, "error");
      return "";
    }
    const references = inputs.map(nodeOutputUrl);
    const signature = imageInputSignature(node, references);
    if (fromPipeline && node.data.resultUrl && node.data.inputSignature === signature && node.data.status === "success") {
      return node.data.resultUrl;
    }
    node.data.status = "generating";
    node.data.error = "";
    renderNodes();
    try {
      await validateImageInputs(node, references);
      const result = await apiPost("/api/production/editImage/generateFlowImage", {
        model: node.data.model,
        references,
        quality: node.data.quality || app.currentProject.imageQuality || "2K",
        ratio: node.data.ratio || app.currentProject.videoRatio || "16:9",
        prompt: String(node.data.prompt || "").trim(),
        projectId: Number(app.currentProject.id)
      });
      const url = result && (result.url || result.src || result.filePath) || (typeof result === "string" ? result : "");
      if (!url) throw new Error("图片生成完成，但没有返回结果地址");
      node.data.resultUrl = url;
      node.data.status = "success";
      node.data.error = "";
      node.data.inputSignature = signature;
      if (node.data.registeredUrl !== url) node.data.registeredUrl = "";
      saveCanvas(true);
      renderNodes();
      if (!fromPipeline) toast("图片生成完成", "success");
      return url;
    } catch (error) {
      node.data.status = "failed";
      node.data.error = errorMessage(error);
      saveCanvas(true);
      renderNodes();
      if (fromPipeline) throw error;
      toast(node.data.error, "error");
      return "";
    }
  }

  function collectAncestors(nodeId) {
    const result = new Set([nodeId]);
    const visit = (id) => {
      app.canvas.edges.filter((edge) => edge.target === id).forEach((edge) => {
        if (!result.has(edge.source)) {
          result.add(edge.source);
          visit(edge.source);
        }
      });
    };
    visit(nodeId);
    return result;
  }

  function topologicalOrder(nodeIds) {
    const ids = new Set(nodeIds);
    const indegree = new Map(Array.from(ids).map((id) => [id, 0]));
    app.canvas.edges.forEach((edge) => {
      if (ids.has(edge.source) && ids.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    });
    const queue = app.canvas.nodes.filter((node) => ids.has(node.id) && indegree.get(node.id) === 0).map((node) => node.id);
    const result = [];
    while (queue.length) {
      const id = queue.shift();
      result.push(id);
      app.canvas.edges.filter((edge) => edge.source === id && ids.has(edge.target)).forEach((edge) => {
        indegree.set(edge.target, indegree.get(edge.target) - 1);
        if (indegree.get(edge.target) === 0) queue.push(edge.target);
      });
    }
    if (result.length !== ids.size) throw new Error("画布中存在循环连接，请删除异常连线后重试");
    return result;
  }

  function validateVideoReferenceCount(mode, count) {
    if (mode === "text") {
      if (count !== 0) throw new Error("纯文本视频模式不能连接参考图片，请先移除视频节点的输入连线");
      return;
    }
    if (mode === "singleImage") {
      if (count !== 1) throw new Error("单图参考模式需要且只能连接 1 张图片");
      return;
    }
    if (mode === "startEndRequired") {
      if (count !== 2) throw new Error("首尾帧模式需要连接 2 张图片");
      return;
    }
    if (mode === "endFrameOptional" || mode === "startFrameOptional") {
      if (count < 1 || count > 2) throw new Error("当前首尾帧模式需要连接 1 至 2 张图片");
      return;
    }
    if (String(mode || "").startsWith("[")) {
      let rules;
      try {
        rules = JSON.parse(mode);
      } catch (_error) {
        throw new Error("多参考模式配置无效，请重新选择视频模式");
      }
      const imageRule = Array.isArray(rules) && rules.find((rule) => String(rule).startsWith("imageReference:"));
      if (!imageRule) {
        if (count) throw new Error("当前多参考模式不支持图片输入");
        return;
      }
      const maximum = Number(String(imageRule).split(":")[1]);
      if (count < 1 || (Number.isFinite(maximum) && count > maximum)) throw new Error(`当前多参考模式支持 1 至 ${maximum || 1} 张图片`);
      return;
    }
    if (!mode) throw new Error("请选择视频生成模式");
  }

  async function registerReferenceNode(node, scriptId, duration) {
    const url = nodeOutputUrl(node);
    if (!url) throw new Error("参考图片尚未准备完成");
    if (node.data.storyboardId) {
      if (node.data.registeredUrl !== url) {
        await apiPost("/api/production/storyboard/updateStoryboardUrl", {
          id: Number(node.data.storyboardId),
          url,
          flowId: 0
        });
        node.data.registeredUrl = url;
        saveCanvas(true);
      }
      return Number(node.data.storyboardId);
    }
    const prompt = String(node.data.prompt || getProjectDescription(app.currentProject) || "产品宣传片参考图");
    const result = await apiPost("/api/production/storyboard/addStoryboard", {
      prompt,
      duration: Number(duration) || 5,
      state: "已完成",
      videoDesc: prompt,
      shouldGenerateImage: 1,
      src: url,
      scriptId: Number(scriptId),
      projectId: Number(app.currentProject.id)
    });
    const id = Number(result && result.id !== undefined ? result.id : result);
    if (!Number.isFinite(id)) throw new Error("参考图片登记失败：未返回分镜 ID");
    node.data.storyboardId = id;
    node.data.registeredUrl = url;
    saveCanvas(true);
    return id;
  }

  function setGenerating(value) {
    app.generating = value;
    if (!app.root) return;
    const headerButton = app.root.querySelector('[data-action="generate-all"]');
    if (headerButton) {
      headerButton.disabled = value;
      const label = headerButton.querySelector("span");
      if (label) label.textContent = value ? "生成中…" : "一键生成";
    }
  }

  async function generateAll() {
    if (!app.canvas) return;
    const video = app.canvas.nodes.find((node) => node.type === "video");
    if (!video) {
      toast("请先添加最终视频节点", "error");
      return;
    }
    await runGenerationPipeline(video.id);
  }

  async function generateVideoFromNode(nodeId) {
    await runGenerationPipeline(nodeId);
  }

  async function runGenerationPipeline(videoNodeId) {
    if (app.generating) return;
    const video = findNode(videoNodeId);
    if (!video || video.type !== "video") {
      toast("最终视频节点不存在", "error");
      return;
    }
    setGenerating(true);
    video.data.error = "";
    try {
      const dependencyIds = collectAncestors(video.id);
      validateVideoReferenceCount(video.data.mode, incomingNodes(video.id).length);
      const order = topologicalOrder(dependencyIds);
      for (const id of order) {
        const node = findNode(id);
        if (!node || node.type === "video") continue;
        if (node.type === "upload" && !node.data.url) {
          node.data.status = "failed";
          node.data.error = "请先上传图片";
          throw new Error("生成已暂停：依赖链中有上传图片节点尚未上传素材");
        }
        if (node.type === "image") await generateImageNode(node.id, true);
      }
      await submitVideoTask(video);
    } catch (error) {
      video.data.status = "failed";
      video.data.error = errorMessage(error);
      saveCanvas(true);
      renderNodes();
      refreshPreview();
      toast(video.data.error, "error");
    } finally {
      setGenerating(false);
      renderNodes();
      refreshPreview();
    }
  }

  async function submitVideoTask(video) {
    if (!video.data.prompt || !String(video.data.prompt).trim()) throw new Error("请填写最终视频节点的提示词");
    if (!video.data.model) throw new Error("请选择视频模型");
    const detail = await getVideoDetail(video.data.model);
    const availableModes = normalizeModes(detail);
    if (availableModes.length && !availableModes.some((item) => item.value === String(video.data.mode || ""))) {
      throw new Error("当前视频模式不受所选模型支持，请重新选择");
    }
    const pairs = durationResolutionOptions(detail);
    if (pairs.length && !pairs.some((item) => item.duration === Number(video.data.duration) && item.resolution === String(video.data.resolution || ""))) {
      throw new Error("当前分辨率和时长组合不受所选视频模型支持");
    }
    if (!video.data.resolution) throw new Error("请选择视频分辨率");
    if (detail.audio === true && !video.data.audio) throw new Error("所选视频模型要求开启音频");
    const directInputs = incomingNodes(video.id);
    directInputs.forEach((node) => {
      if (!nodeOutputUrl(node)) throw new Error("最终视频节点存在尚未生成的参考图片");
    });
    validateVideoReferenceCount(video.data.mode, directInputs.length);
    const scriptId = app.canvas.scriptId || await ensureInternalScript();
    const storyboardIds = [];
    for (const sourceNode of directInputs) {
      storyboardIds.push(await registerReferenceNode(sourceNode, scriptId, video.data.duration));
    }
    if (!video.data.trackId) {
      const trackResult = await apiPost("/api/production/workbench/addTrack", {
        projectId: Number(app.currentProject.id),
        scriptId: Number(scriptId),
        duration: Number(video.data.duration)
      });
      const trackId = Number(trackResult && trackResult.id !== undefined ? trackResult.id : trackResult);
      if (!Number.isFinite(trackId)) throw new Error("创建视频轨道失败：未返回轨道 ID");
      video.data.trackId = trackId;
    }
    video.data.status = "generating";
    video.data.error = "";
    video.data.resultUrl = "";
    saveCanvas(true);
    renderNodes();
    refreshPreview();
    const result = await apiPost("/api/production/workbench/generateVideo", {
      projectId: Number(app.currentProject.id),
      scriptId: Number(scriptId),
      uploadData: storyboardIds.map((id) => ({ id: Number(id), sources: "storyboard" })),
      prompt: String(video.data.prompt).trim(),
      model: video.data.model,
      mode: video.data.mode,
      resolution: video.data.resolution,
      duration: Number(video.data.duration),
      audio: Boolean(video.data.audio),
      trackId: Number(video.data.trackId)
    });
    const videoId = Number(result && result.videoId !== undefined ? result.videoId : result);
    if (!Number.isFinite(videoId)) throw new Error("视频任务提交失败：未返回任务 ID");
    video.data.videoId = videoId;
    video.data.status = "generating";
    video.data.error = "";
    saveCanvas(true);
    renderNodes();
    refreshPreview();
    toast("视频任务已提交，将自动更新生成状态", "success");
    startPolling(video.id);
  }

  function stopPolling() {
    if (app.pollTimer) clearInterval(app.pollTimer);
    app.pollTimer = null;
  }

  function startPolling(videoNodeId) {
    stopPolling();
    let consecutiveErrors = 0;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      if (!isPromoRoute() || !app.canvas || !app.currentProject) {
        stopPolling();
        return;
      }
      const video = findNode(videoNodeId);
      if (!video || !video.data.videoId) {
        stopPolling();
        return;
      }
      polling = true;
      try {
        const result = await apiPost("/api/production/workbench/checkVideoStateList", {
          projectId: Number(app.currentProject.id),
          scriptId: Number(app.canvas.scriptId),
          videoIds: [Number(video.data.videoId)]
        });
        consecutiveErrors = 0;
        const list = Array.isArray(result) ? result : [];
        const task = list.find((item) => Number(item.id) === Number(video.data.videoId));
        if (!task) return;
        const state = String(task.state || "");
        if (state === "生成失败") {
          video.data.status = "failed";
          video.data.error = task.errorReason || "视频生成失败";
          stopPolling();
          saveCanvas(true);
          renderNodes();
          refreshPreview();
          toast(video.data.error, "error");
          return;
        }
        if (state === "已完成" || state === "生成成功") {
          const url = task.src || task.url || task.filePath;
          if (!url) throw new Error("视频任务已完成，但没有返回可播放地址");
          video.data.status = "success";
          video.data.resultUrl = url;
          video.data.error = "";
          stopPolling();
          saveCanvas(true);
          renderNodes();
          refreshPreview();
          toast("产品宣传片生成完成", "success");
        }
      } catch (error) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) {
          const video = findNode(videoNodeId);
          if (video) {
            video.data.status = "failed";
            video.data.error = `视频状态查询失败：${errorMessage(error)}`;
            saveCanvas(true);
            renderNodes();
            refreshPreview();
          }
          stopPolling();
          toast(`视频状态查询失败：${errorMessage(error)}`, "error");
        }
      } finally {
        polling = false;
      }
    };
    poll();
    app.pollTimer = window.setInterval(poll, POLL_INTERVAL);
  }

  function installNavigationHooks() {
    if (window.__TOONFLOW_PRODUCT_PROMO_HISTORY_HOOK__) return;
    window.__TOONFLOW_PRODUCT_PROMO_HISTORY_HOOK__ = true;
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function patchedHistoryState() {
        const result = original.apply(this, arguments);
        window.dispatchEvent(new Event("tf-product-promo-navigation"));
        return result;
      };
    });
    window.addEventListener("popstate", scheduleRouteRender);
    window.addEventListener("hashchange", scheduleRouteRender);
    window.addEventListener("tf-product-promo-navigation", scheduleRouteRender);
  }

  function bootstrap() {
    installNavigationHooks();
    app.observer = new MutationObserver(scheduleRouteRender);
    app.observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("keydown", (event) => {
      if (!isPromoRoute() || !app.selectedEdgeId || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeEdge(app.selectedEdgeId);
      }
    });
    scheduleRouteRender();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  else bootstrap();
})();
