(function () {
  if (window.ToonflowStoryboardCanvas) return;

  const VERSION = 4;
  const NODE_WIDTH = { upload: 320, generated: 430 };
  const TYPE_ORDER = { role: 0, scene: 1, tool: 2 };
  const AUTO_PAN_THRESHOLD = 64;
  const AUTO_PAN_MAX_SPEED = 720;
  let activeEditor = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function finiteNumber(value, fallback) {
    if (value == null || value === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function validViewport(value) {
    return !!value
      && Number.isFinite(finiteNumber(value.x, NaN))
      && Number.isFinite(finiteNumber(value.y, NaN))
      && Number.isFinite(finiteNumber(value.zoom, NaN))
      && Number(value.zoom) > 0;
  }

  function apiData(result) {
    return result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
  }

  function normalizeUrl(value) {
    return String(value || "").split("?")[0].replace(/\/smallImage(?=\/)/, "").replace(/^https?:\/\/[^/]+/i, "");
  }

  function uniqueOptions(current, values) {
    return Array.from(new Set([current].concat(values).filter(Boolean)));
  }

  function textPart(text) {
    return { type: "text", text: String(text || "") };
  }

  function normalizePromptDoc(doc, fallback, incomingIds) {
    if (Array.isArray(doc) && doc.length) {
      return doc.map(function (part) {
        return part && part.type === "reference"
          ? { type: "reference", nodeId: String(part.nodeId || "") }
          : textPart(part && part.text);
      });
    }
    const source = String(fallback || "");
    const result = [];
    let cursor = 0;
    source.replace(/@图片(\d+)/g, function (match, number, offset) {
      if (offset > cursor) result.push(textPart(source.slice(cursor, offset)));
      const nodeId = incomingIds[Number(number) - 1];
      result.push(nodeId ? { type: "reference", nodeId: nodeId } : textPart(match));
      cursor = offset + match.length;
      return match;
    });
    if (cursor < source.length) result.push(textPart(source.slice(cursor)));
    return result.length ? result : [textPart(source)];
  }

  function Editor(config) {
    this.config = config;
    this.row = clone(config.row || {});
    this.assets = (config.assets || []).slice().sort(function (a, b) {
      return (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || String(a.name || "").localeCompare(String(b.name || ""));
    });
    this.availableAssets = (config.availableAssets || config.assets || []).slice().sort(function (a, b) {
      return (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || String(a.name || "").localeCompare(String(b.name || ""));
    });
    this.initialAssetIds = new Set(this.assets.map(function (asset) { return Number(asset.id); }).filter(Boolean));
    this.projectId = Number(config.projectId || this.row.projectId || 0);
    this.scriptId = Number(config.scriptId || this.row.scriptId || 0);
    this.graph = { nodes: [], edges: [], viewport: { x: 80, y: 80, zoom: 0.8 }, suppressedAssetIds: [] };
    this.defaults = { model: "", quality: "2K", ratio: "16:9" };
    this.models = [];
    this.history = [];
    this.historyIndex = -1;
    this.dirty = false;
    this.saving = false;
    this.connecting = null;
    this.dragging = null;
    this.panning = null;
    this.selectedEdgeId = null;
    this.historyTimer = 0;
    this.listeners = [];
    this.hasSavedViewport = false;
    this.autoPanFrame = 0;
    this.autoPanTime = 0;
    this.assetPickerSelection = new Set();
  }

  Editor.prototype.listen = function (target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.listeners.push(function () { target.removeEventListener(type, listener, options); });
  };

  Editor.prototype.mount = async function () {
    this.root = document.createElement("div");
    this.root.id = "tf-storyboard-canvas-root";
    this.root.className = "tf-sic-root";
    this.root.innerHTML = [
      '<header class="tf-sic-header">',
      '  <div class="tf-sic-title"><strong>分镜无限画布</strong><span>镜号 ' + escapeHtml(this.row.index || this.row.id || "") + '</span></div>',
      '  <div class="tf-sic-toolbar">',
      '    <button type="button" data-command="add-image">＋ 图片</button>',
      '    <button type="button" data-command="add-generated">＋ 生成节点</button>',
      '    <select data-new-asset-type title="新建资产类型"><option value="role">角色</option><option value="scene">场景</option><option value="tool">道具</option></select>',
      '    <div class="tf-sic-asset-command"><button type="button" data-command="add-asset" aria-expanded="false">＋ 资产</button><div class="tf-sic-asset-action-menu" data-asset-action-menu><button type="button" data-asset-choice="existing"><b>选择已有资产</b><span>从当前批次已生成的资产中选择</span></button><button type="button" data-asset-choice="local"><b>新建画布资产</b><span>仅保存在当前分镜画布</span></button></div></div>',
      '    <i></i>',
      '    <button type="button" data-command="undo" title="撤销 Ctrl+Z">↶</button>',
      '    <button type="button" data-command="redo" title="重做 Ctrl+Y">↷</button>',
      '    <button type="button" data-command="layout">自动布局</button>',
      '    <button type="button" data-command="fit">适配视图</button>',
      '    <button type="button" data-command="zoom-out">−</button>',
      '    <span data-zoom>80%</span>',
      '    <button type="button" data-command="zoom-in">＋</button>',
      '  </div>',
      '  <div class="tf-sic-actions"><span data-status>正在加载画布…</span><button type="button" class="primary" data-command="save" disabled>保存</button><button type="button" data-command="close">关闭</button></div>',
      '</header>',
      '<div class="tf-sic-modal" data-asset-picker hidden>',
      '  <section class="tf-sic-dialog tf-sic-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="tf-sic-picker-title">',
      '    <header><div><strong id="tf-sic-picker-title">选择已有资产</strong><span data-picker-type-label></span></div><button type="button" data-modal-close="picker" aria-label="关闭">×</button></header>',
      '    <div class="tf-sic-dialog-search"><input type="search" data-asset-search placeholder="搜索资产名称"></div>',
      '    <div class="tf-sic-asset-picker-list" data-asset-picker-list></div>',
      '    <footer><span data-asset-picker-count>已选择 0 项</span><button type="button" data-modal-close="picker">取消</button><button type="button" class="primary" data-add-selected-assets disabled>添加到画布</button></footer>',
      '  </section>',
      '</div>',
      '<div class="tf-sic-modal" data-local-asset-dialog hidden>',
      '  <section class="tf-sic-dialog tf-sic-local-dialog" role="dialog" aria-modal="true" aria-labelledby="tf-sic-local-title">',
      '    <header><div><strong id="tf-sic-local-title">新建画布资产</strong><span data-local-type-label></span></div><button type="button" data-modal-close="local" aria-label="关闭">×</button></header>',
      '    <div class="tf-sic-local-form">',
      '      <label><span>资产名称<b>*</b></span><input type="text" data-local-asset-name maxlength="100" placeholder="请输入资产名称"></label>',
      '      <label>资产描述<textarea data-local-asset-describe rows="3" placeholder="描述外观、材质或场景特征"></textarea></label>',
      '      <label>图片提示词<textarea data-local-asset-prompt rows="4" placeholder="用于生成资产候选版本"></textarea></label>',
      '      <div class="tf-sic-form-error" data-local-asset-error></div>',
      '    </div>',
      '    <footer><span>该资产不会写入正式资产库</span><button type="button" data-modal-close="local">取消</button><button type="button" class="primary" data-create-local-asset>创建资产</button></footer>',
      '  </section>',
      '</div>',
      '<main class="tf-sic-stage" tabindex="0">',
      '  <div class="tf-sic-grid"></div>',
      '  <svg class="tf-sic-edges" aria-hidden="true"><g data-edge-viewport><g data-edge-list></g><path data-edge-preview></path></g></svg>',
      '  <div class="tf-sic-world"><div class="tf-sic-nodes" data-nodes></div></div>',
      '  <svg class="tf-sic-edge-controls" aria-hidden="true"><g data-edge-control-viewport><g data-edge-controls></g></g></svg>',
      '  <div class="tf-sic-help">拖动画布平移 · 滚轮缩放 · 从右侧圆点拖到生成节点左侧圆点连线 · 单击连线后点击中间的 × 断开连接（也可双击连线）</div>',
      '</main>'
    ].join("");
    document.body.appendChild(this.root);
    document.body.classList.add("tf-sic-open");
    this.stage = this.root.querySelector(".tf-sic-stage");
    this.grid = this.root.querySelector(".tf-sic-grid");
    this.world = this.root.querySelector(".tf-sic-world");
    this.nodesLayer = this.root.querySelector("[data-nodes]");
    this.edgeViewport = this.root.querySelector("[data-edge-viewport]");
    this.edgeControlViewport = this.root.querySelector("[data-edge-control-viewport]");
    this.edgeList = this.root.querySelector("[data-edge-list]");
    this.edgeControls = this.root.querySelector("[data-edge-controls]");
    this.edgePreview = this.root.querySelector("[data-edge-preview]");
    this.statusNode = this.root.querySelector("[data-status]");
    this.saveButton = this.root.querySelector('[data-command="save"]');
    this.assetActionMenu = this.root.querySelector("[data-asset-action-menu]");
    this.assetPicker = this.root.querySelector("[data-asset-picker]");
    this.localAssetDialog = this.root.querySelector("[data-local-asset-dialog]");
    this.bindShell();

    try {
      await this.load();
      this.render();
      await new Promise(function (resolve) { requestAnimationFrame(resolve); });
      if (this.hasSavedViewport) this.applyViewport();
      else this.fitView(false);
      this.history = [this.snapshot()];
      this.historyIndex = 0;
      this.setStatus("画布已就绪", "success");
      this.updateToolbar();
    } catch (error) {
      this.setStatus(error && error.message ? error.message : String(error), "error");
      this.root.classList.add("tf-sic-load-error");
    }
  };

  Editor.prototype.load = async function () {
    if (!this.projectId || !this.scriptId) throw new Error("缺少项目或分镜表批次信息，无法打开画布");
    const post = this.config.post;
    const optional = function (promise) { return promise.catch(function () { return null; }); };
    const tasks = [
      optional(post("/api/production/editImage/getImageDefaultModle", { projectId: this.projectId })),
      optional(post("/api/project/getProject", { includeCommerce: true })),
      optional(post("/api/productFactory/models/list", { type: "image" }))
    ];
    if (Number(this.row.flowId)) tasks.push(post("/api/production/editImage/getImageFlow", { id: Number(this.row.flowId) }));
    const results = await Promise.all(tasks);
    const defaultData = apiData(results[0]) || {};
    const projects = apiData(results[1]) || [];
    const models = apiData(results[2]) || [];
    const project = Array.isArray(projects) ? projects.find(function (item) { return Number(item.id) === Number(this.projectId); }, this) : null;
    this.models = (Array.isArray(models) ? models : []).map(function (item) {
      return { value: String(item.id || "") + ":" + String(item.value || ""), label: String(item.label || item.value || "") + (item.name ? " · " + item.name : "") };
    }).filter(function (item) { return item.value !== ":"; });
    this.defaults = {
      model: String(defaultData.imageModel || (project && project.imageModel) || (this.models[0] && this.models[0].value) || ""),
      quality: String(defaultData.imageQuality || (project && project.imageQuality) || "2K"),
      ratio: String((project && project.videoRatio) || "16:9")
    };
    const flow = results[3] ? apiData(results[3]) : null;
    this.hasSavedViewport = false;
    this.graph = flow && Array.isArray(flow.nodes) ? this.normalizeSavedGraph(flow) : this.createInitialGraph();
  };

  Editor.prototype.assetImage = function (asset) {
    return String(asset.originalSrc || asset.src || "");
  };

  Editor.prototype.createAssetNode = function (asset, position) {
    const globalImage = this.assetImage(asset);
    const local = asset.localOverride || null;
    const image = String(local && (local.originalSrc || local.src) || globalImage);
    return {
      id: uid("asset"), type: "upload", position: position,
      data: {
        image: image, originalImage: globalImage, globalImage: globalImage,
        assetId: Number(asset.id), assetName: asset.name || "未命名资产", assetType: asset.type || "",
        assetDescribe: String(local && local.describe != null ? local.describe : asset.describe || ""),
        assetPrompt: String(local && local.prompt != null ? local.prompt : asset.prompt || ""),
        globalDescribe: String(asset.describe || ""), globalPrompt: String(asset.prompt || ""),
        revision: Number(asset.revision || 1), baseAssetRevision: Number(local && local.baseAssetRevision || asset.revision || 1),
        referenceEnabled: asset.referenceEnabled !== 0, localSourceNodeId: local && local.sourceNodeId || "",
        assetScope: "global", assetKind: asset.assetsId ? "derived" : "original", localAssetKey: "",
        overridden: !!local, custom: false, draftAsset: false, uploadBusy: false, error: ""
      }
    };
  };

  Editor.prototype.createGeneratedNode = function (position, options) {
    const data = options || {};
    return {
      id: uid("generated"), type: "generated", position: position,
      data: {
        generatedImage: String(data.generatedImage || ""), promptDoc: data.promptDoc || [textPart(data.prompt || "")],
        model: String(data.model || this.defaults.model || ""), quality: String(data.quality || this.defaults.quality || "2K"),
        ratio: String(data.ratio || this.defaults.ratio || "16:9"), isFinal: !!data.isFinal,
        references: [], busy: false, error: "",
        assetVariant: !!data.assetVariant, targetAssetId: Number(data.targetAssetId || 0) || null,
        targetSourceNodeId: String(data.targetSourceNodeId || ""), targetAssetType: String(data.targetAssetType || ""),
        targetAssetName: String(data.targetAssetName || ""), assetDescribe: String(data.assetDescribe || ""),
        assetScope: String(data.assetScope || ""), assetKind: String(data.assetKind || ""),
        localAssetKey: String(data.localAssetKey || ""), draftAsset: !!data.draftAsset
      }
    };
  };

  Editor.prototype.createInitialGraph = function () {
    const nodes = this.assets.map(function (asset, index) {
      return this.createAssetNode(asset, { x: 100 + index % 2 * 370, y: 80 + Math.floor(index / 2) * 390 });
    }, this);
    const generated = this.createGeneratedNode({ x: 900, y: 100 }, {
      generatedImage: this.row.src || "", prompt: this.row.prompt || "", isFinal: true
    });
    nodes.push(generated);
    return {
      nodes: nodes,
      edges: nodes.filter(function (node) { return node.type === "upload" && node.data.referenceEnabled !== false; }).map(function (node, index) {
        return { id: uid("edge"), source: node.id, target: generated.id, order: index };
      }),
      viewport: { x: 80, y: 80, zoom: 0.8 }, suppressedAssetIds: []
    };
  };

  Editor.prototype.normalizeSavedGraph = function (flow) {
    const rawNodes = clone(flow.nodes || []).filter(function (node) { return node && (node.type === "upload" || node.type === "generated"); });
    const rawEdges = clone(flow.edges || []).filter(function (edge) { return edge && edge.source && edge.target; });
    const metaNode = rawNodes.find(function (node) { return node.data && node.data.canvasMeta; });
    const meta = metaNode && metaNode.data.canvasMeta || {};
    this.hasSavedViewport = validViewport(meta.viewport);
    const graph = {
      nodes: rawNodes.map(function (node, index) {
        const data = node.data || {};
        const normalized = {
          id: String(node.id || uid(node.type)), type: node.type,
          position: {
            x: finiteNumber(node.position && node.position.x, 100 + index * 380),
            y: finiteNumber(node.position && node.position.y, 100)
          },
          data: data
        };
        if (node.type === "upload") {
          const assetId = Number(data.assetId || 0) || null;
          const legacyCanvasAsset = !assetId && !!data.assetType && !data.custom && !!data.draftAsset;
          const assetScope = String(data.assetScope || (assetId ? "global" : legacyCanvasAsset ? "canvas" : ""));
          normalized.data = Object.assign({}, data, {
            image: String(data.image || ""), originalImage: String(data.originalImage || ""), assetId: assetId,
            assetName: data.assetName || data.name || data.label || "自定义图片", assetType: data.assetType || "",
            assetDescribe: String(data.assetDescribe || ""), assetPrompt: String(data.assetPrompt || ""),
            globalDescribe: String(data.globalDescribe || ""), globalPrompt: String(data.globalPrompt || ""),
            revision: Number(data.revision || 1), baseAssetRevision: Number(data.baseAssetRevision || data.revision || 1),
            referenceEnabled: data.referenceEnabled !== false, localSourceNodeId: String(data.localSourceNodeId || ""),
            assetScope: assetScope,
            assetKind: String(data.assetKind || (assetScope === "canvas" ? "local" : "")),
            localAssetKey: assetScope === "canvas" ? String(data.localAssetKey || normalized.id) : "",
            overridden: !!data.overridden, custom: data.custom !== false && !data.assetId,
            draftAsset: false, uploadBusy: false, error: ""
          });
        } else {
          const incoming = rawEdges.filter(function (edge) { return String(edge.target) === String(normalized.id); }).sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); }).map(function (edge) { return String(edge.source); });
          const targetAssetId = Number(data.targetAssetId || 0) || null;
          const legacyCanvasVariant = !!data.assetVariant && !targetAssetId && !!data.draftAsset;
          const assetScope = String(data.assetScope || (targetAssetId ? "global" : legacyCanvasVariant ? "canvas" : ""));
          normalized.data = Object.assign({}, data, {
            generatedImage: String(data.generatedImage || data.image || ""),
            promptDoc: normalizePromptDoc(data.promptDoc, data.prompt || data.promptText || this.row.prompt || "", incoming),
            model: String(data.model || this.defaults.model || ""), quality: String(data.quality || this.defaults.quality || "2K"),
            ratio: String(data.ratio || this.defaults.ratio || "16:9"), isFinal: !!data.isFinal,
            references: Array.isArray(data.references) ? data.references : [], busy: false, error: "",
            assetVariant: !!data.assetVariant, targetAssetId: targetAssetId,
            targetSourceNodeId: String(data.targetSourceNodeId || ""), targetAssetType: String(data.targetAssetType || ""),
            targetAssetName: String(data.targetAssetName || ""), assetDescribe: String(data.assetDescribe || ""),
            assetScope: assetScope,
            assetKind: String(data.assetKind || (assetScope === "canvas" ? "local" : "")),
            localAssetKey: assetScope === "canvas" ? String(data.localAssetKey || data.targetSourceNodeId || normalized.id) : "",
            draftAsset: false
          });
        }
        delete normalized.data.canvasMeta;
        return normalized;
      }, this),
      edges: rawEdges.map(function (edge, index) { return { id: String(edge.id || uid("edge")), source: String(edge.source), target: String(edge.target), order: Number(edge.order ?? index) }; }),
      viewport: this.hasSavedViewport
        ? { x: Number(meta.viewport.x), y: Number(meta.viewport.y), zoom: Math.max(0.25, Math.min(2, Number(meta.viewport.zoom))) }
        : { x: 80, y: 80, zoom: 0.8 },
      suppressedAssetIds: (meta.suppressedAssetIds || []).map(Number).filter(Boolean)
    };
    this.reconcileAssets(graph);
    const generated = graph.nodes.filter(function (node) { return node.type === "generated" && !node.data.assetVariant; });
    if (!generated.length) {
      const finalNode = this.createGeneratedNode({ x: 560, y: 100 }, { prompt: this.row.prompt || "", generatedImage: this.row.src || "", isFinal: true });
      graph.nodes.push(finalNode);
    }
    if (!generated.some(function (node) { return node.data.isFinal; })) {
      const finalNode = generated.slice().reverse().find(function (node) { return normalizeUrl(node.data.generatedImage) === normalizeUrl(this.row.src); }, this) || generated.slice().reverse().find(function (node) { return node.data.generatedImage; }) || generated[0];
      if (finalNode) finalNode.data.isFinal = true;
    }
    return graph;
  };

  Editor.prototype.reconcileAssets = function (graph) {
    const currentIds = new Set(this.assets.map(function (asset) { return Number(asset.id); }));
    graph.nodes.forEach(function (node) {
      if (node.type !== "upload") return;
      if (node.data.assetScope === "canvas") return;
      let asset = this.assets.find(function (item) { return Number(item.id) === Number(node.data.assetId); });
      if (!asset) {
        const image = normalizeUrl(node.data.image);
        asset = this.assets.find(function (item) {
          return image && [item.src, item.originalSrc].some(function (url) { return normalizeUrl(url) === image; });
        }) || this.assets.find(function (item) { return String(item.name || "") === String(node.data.assetName || ""); });
      }
      if (asset) {
        const local = asset.localOverride || null;
        node.data.assetId = Number(asset.id);
        node.data.assetName = asset.name || node.data.assetName;
        node.data.assetType = asset.type || node.data.assetType;
        node.data.originalImage = this.assetImage(asset);
        node.data.globalImage = node.data.originalImage;
        node.data.globalDescribe = String(asset.describe || "");
        node.data.globalPrompt = String(asset.prompt || "");
        node.data.revision = Number(asset.revision || 1);
        node.data.referenceEnabled = asset.referenceEnabled !== 0;
        node.data.assetScope = "global";
        node.data.assetKind = asset.assetsId ? "derived" : "original";
        node.data.localAssetKey = "";
        node.data.custom = false;
        node.data.draftAsset = false;
        if (local) {
          node.data.image = String(local.originalSrc || local.src || node.data.image || "");
          node.data.assetDescribe = String(local.describe != null ? local.describe : asset.describe || "");
          node.data.assetPrompt = String(local.prompt != null ? local.prompt : asset.prompt || "");
          node.data.baseAssetRevision = Number(local.baseAssetRevision || asset.revision || 1);
          node.data.localSourceNodeId = String(local.sourceNodeId || node.data.localSourceNodeId || "");
          node.data.overridden = true;
        } else if (!node.data.overridden) {
          node.data.image = node.data.originalImage;
          node.data.assetDescribe = String(asset.describe || "");
          node.data.assetPrompt = String(asset.prompt || "");
          node.data.baseAssetRevision = Number(asset.revision || 1);
        }
      }
    }, this);
    const removedIds = new Set(graph.nodes.filter(function (node) {
      return node.type === "upload" && node.data.assetId && !currentIds.has(Number(node.data.assetId));
    }).map(function (node) { return node.id; }));
    graph.nodes = graph.nodes.filter(function (node) { return !removedIds.has(node.id); });
    graph.edges = graph.edges.filter(function (edge) { return !removedIds.has(edge.source) && !removedIds.has(edge.target); });
    const existingIds = new Set(graph.nodes.map(function (node) { return Number(node.data && node.data.assetId || 0); }));
    const suppressed = new Set(graph.suppressedAssetIds || []);
    let offset = graph.nodes.filter(function (node) { return node.type === "upload"; }).length;
    const target = graph.nodes.find(function (node) { return node.type === "generated" && node.data.isFinal; }) || graph.nodes.find(function (node) { return node.type === "generated"; });
    this.assets.forEach(function (asset) {
      if (!existingIds.has(Number(asset.id)) && !suppressed.has(Number(asset.id))) {
        const added = this.createAssetNode(asset, { x: 100 + offset % 2 * 370, y: 80 + Math.floor(offset++ / 2) * 390 });
        graph.nodes.push(added);
        if (target && asset.referenceEnabled !== 0) graph.edges.push({ id: uid("edge"), source: added.id, target: target.id, order: graph.edges.filter(function (edge) { return edge.target === target.id; }).length });
      }
    }, this);
    this.normalizeFinalReferenceOrder(graph);
  };

  Editor.prototype.assetIdForNode = function (node) {
    return Number(node && (node.data.targetAssetId || node.data.assetId) || 0) || null;
  };

  Editor.prototype.assetIdentityForNode = function (node) {
    const assetId = this.assetIdForNode(node);
    if (assetId) return "global:" + assetId;
    const localAssetKey = String(node && node.data && node.data.localAssetKey || "");
    return localAssetKey ? "canvas:" + localAssetKey : "node:" + String(node && node.id || "");
  };

  Editor.prototype.connectAssetToFinal = function (source, graphValue) {
    const graph = graphValue || this.graph;
    const finalNode = graph.nodes.find(function (node) { return node.type === "generated" && !node.data.assetVariant && node.data.isFinal; });
    if (!source || !finalNode || !this.imageForNode(source)) return false;
    const identity = this.assetIdentityForNode(source);
    const nodeMap = new Map(graph.nodes.map(function (node) { return [node.id, node]; }));
    graph.edges = graph.edges.filter(function (edge) {
      if (edge.target !== finalNode.id) return true;
      const edgeSource = nodeMap.get(edge.source);
      return this.assetIdentityForNode(edgeSource) !== identity || edge.source === source.id;
    }, this);
    if (!graph.edges.some(function (edge) { return edge.source === source.id && edge.target === finalNode.id; })) {
      graph.edges.push({ id: uid("edge"), source: source.id, target: finalNode.id, order: graph.edges.filter(function (edge) { return edge.target === finalNode.id; }).length });
    }
    this.normalizeFinalReferenceOrder(graph);
    return true;
  };

  Editor.prototype.normalizeFinalReferenceOrder = function (graphValue) {
    const graph = graphValue || this.graph;
    const finalNode = graph.nodes.find(function (node) { return node.type === "generated" && node.data.isFinal; });
    if (!finalNode) return;
    const assetIndex = new Map(this.assets.map(function (asset, index) { return [Number(asset.id), index]; }));
    const nodeMap = new Map(graph.nodes.map(function (node) { return [node.id, node]; }));
    const incoming = graph.edges.filter(function (edge) { return edge.target === finalNode.id; });
    incoming.sort(function (left, right) {
      const leftNode = nodeMap.get(left.source); const rightNode = nodeMap.get(right.source);
      const leftId = this.assetIdForNode(leftNode); const rightId = this.assetIdForNode(rightNode);
      const leftType = leftNode && (leftNode.data.targetAssetType || leftNode.data.assetType) || "";
      const rightType = rightNode && (rightNode.data.targetAssetType || rightNode.data.assetType) || "";
      const leftRank = leftId ? (TYPE_ORDER[leftType] ?? 3) : 4;
      const rightRank = rightId ? (TYPE_ORDER[rightType] ?? 3) : 4;
      return leftRank - rightRank || Number(assetIndex.get(leftId) ?? 99999) - Number(assetIndex.get(rightId) ?? 99999) || Number(left.order || 0) - Number(right.order || 0);
    }.bind(this));
    incoming.forEach(function (edge, index) { edge.order = index; });
  };

  Editor.prototype.snapshot = function () {
    const graph = clone(this.graph);
    graph.nodes.forEach(function (node) {
      node.data.busy = false;
      node.data.uploadBusy = false;
      node.data.error = "";
    });
    return graph;
  };

  Editor.prototype.commitHistory = function () {
    clearTimeout(this.historyTimer);
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.snapshot());
    this.historyIndex = this.history.length - 1;
    if (this.history.length > 60) { this.history.shift(); this.historyIndex -= 1; }
    this.dirty = true;
    this.updateToolbar();
  };

  Editor.prototype.scheduleHistory = function () {
    const self = this;
    this.dirty = true;
    this.updateToolbar();
    clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(function () { self.commitHistory(); }, 450);
  };

  Editor.prototype.undo = function () {
    clearTimeout(this.historyTimer);
    if (this.historyIndex <= 0) return;
    this.graph = clone(this.history[--this.historyIndex]);
    this.dirty = true;
    this.render();
  };

  Editor.prototype.redo = function () {
    clearTimeout(this.historyTimer);
    if (this.historyIndex >= this.history.length - 1) return;
    this.graph = clone(this.history[++this.historyIndex]);
    this.dirty = true;
    this.render();
  };

  Editor.prototype.selectedAssetType = function () {
    const field = this.root.querySelector("[data-new-asset-type]");
    return String(field && field.value || "role");
  };

  Editor.prototype.assetTypeLabel = function (type) {
    return { role: "角色", scene: "场景", tool: "道具" }[type] || "资产";
  };

  Editor.prototype.isGeneratedCatalogAsset = function (asset) {
    const state = String(asset && asset.imageState || "").toLowerCase();
    const completed = state === "已完成" || state === "生成成功" || state === "success" || state === "completed";
    return !!asset && asset.validImage === true && completed && !!(asset.originalSrc || asset.src);
  };

  Editor.prototype.assetAlreadyOnCanvas = function (assetId) {
    return this.graph.nodes.some(function (node) { return this.assetIdForNode(node) === Number(assetId); }, this);
  };

  Editor.prototype.closeAssetActionMenu = function () {
    if (this.assetActionMenu) this.assetActionMenu.classList.remove("open");
    const button = this.root.querySelector('[data-command="add-asset"]');
    if (button) button.setAttribute("aria-expanded", "false");
  };

  Editor.prototype.toggleAssetActionMenu = function () {
    if (!this.assetActionMenu) return;
    const open = !this.assetActionMenu.classList.contains("open");
    this.assetActionMenu.classList.toggle("open", open);
    const button = this.root.querySelector('[data-command="add-asset"]');
    if (button) button.setAttribute("aria-expanded", open ? "true" : "false");
  };

  Editor.prototype.openAssetPicker = function () {
    const type = this.selectedAssetType();
    this.assetPickerSelection = new Set();
    const search = this.assetPicker.querySelector("[data-asset-search]");
    if (search) search.value = "";
    this.assetPicker.querySelector("[data-picker-type-label]").textContent = this.assetTypeLabel(type) + " · 当前分镜表批次";
    this.assetPicker.hidden = false;
    this.renderAssetPicker();
    requestAnimationFrame(function () { if (search) search.focus(); });
  };

  Editor.prototype.closeAssetPicker = function () {
    if (this.assetPicker) this.assetPicker.hidden = true;
    this.assetPickerSelection = new Set();
  };

  Editor.prototype.renderAssetPicker = function () {
    if (!this.assetPicker || this.assetPicker.hidden) return;
    const self = this;
    const type = this.selectedAssetType();
    const search = String(this.assetPicker.querySelector("[data-asset-search]").value || "").trim().toLowerCase();
    const matches = this.availableAssets.filter(function (asset) {
      return asset.type === type && self.isGeneratedCatalogAsset(asset) && (!search || String(asset.name || "").toLowerCase().includes(search));
    });
    const list = this.assetPicker.querySelector("[data-asset-picker-list]");
    const renderSection = function (title, values, kind) {
      if (!values.length) return "";
      return '<section class="tf-sic-picker-section"><h3>' + title + '<span>' + values.length + '</span></h3><div class="tf-sic-picker-grid">' + values.map(function (asset) {
        const assetId = Number(asset.id);
        const exists = self.assetAlreadyOnCanvas(assetId);
        const checked = self.assetPickerSelection.has(assetId);
        const image = asset.originalSrc || asset.src;
        return '<label class="tf-sic-picker-card ' + (exists ? "is-disabled" : "") + '"><input type="checkbox" data-picker-asset-id="' + assetId + '" ' + (checked ? "checked" : "") + ' ' + (exists ? "disabled" : "") + '><img src="' + escapeHtml(image) + '" alt=""><span class="tf-sic-picker-card-body"><b>' + escapeHtml(asset.name || "未命名资产") + '</b><small>' + escapeHtml(asset.describe || "暂无描述") + '</small><em class="' + kind + '">' + (kind === "derived" ? "衍生资产" : "原始资产") + '</em></span>' + (exists ? '<i>已在画布</i>' : "") + '</label>';
      }).join("") + '</div></section>';
    };
    const original = matches.filter(function (asset) { return !asset.assetsId; });
    const derived = matches.filter(function (asset) { return !!asset.assetsId; });
    list.innerHTML = renderSection("原始资产", original, "original") + renderSection("衍生资产", derived, "derived") || '<div class="tf-sic-picker-empty">当前类型暂无可选择的已生成资产</div>';
    list.querySelectorAll("[data-picker-asset-id]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        const assetId = Number(checkbox.getAttribute("data-picker-asset-id"));
        if (checkbox.checked) self.assetPickerSelection.add(assetId);
        else self.assetPickerSelection.delete(assetId);
        self.updateAssetPickerCount();
      });
    });
    this.updateAssetPickerCount();
  };

  Editor.prototype.updateAssetPickerCount = function () {
    if (!this.assetPicker) return;
    const count = this.assetPickerSelection.size;
    this.assetPicker.querySelector("[data-asset-picker-count]").textContent = "已选择 " + count + " 项";
    this.assetPicker.querySelector("[data-add-selected-assets]").disabled = count <= 0;
  };

  Editor.prototype.addSelectedAssets = function () {
    const selected = this.availableAssets.filter(function (asset) {
      return this.assetPickerSelection.has(Number(asset.id)) && !this.assetAlreadyOnCanvas(Number(asset.id));
    }, this);
    if (!selected.length) { this.closeAssetPicker(); return; }
    const point = this.centerPoint();
    let connectedCount = 0;
    selected.forEach(function (asset, index) {
      const assetId = Number(asset.id);
      let relationAsset = this.assets.find(function (item) { return Number(item.id) === assetId; });
      if (!relationAsset) {
        relationAsset = Object.assign({}, asset, { referenceEnabled: 1, localOverride: null });
        this.assets.push(relationAsset);
      }
      this.graph.suppressedAssetIds = this.graph.suppressedAssetIds.filter(function (id) { return Number(id) !== assetId; });
      const node = this.createAssetNode(relationAsset, {
        x: point.x - 360 + index % 2 * 350,
        y: point.y - 180 + Math.floor(index / 2) * 390
      });
      this.graph.nodes.push(node);
      if (this.connectAssetToFinal(node)) connectedCount += 1;
    }, this);
    this.commitHistory();
    this.closeAssetPicker();
    this.render();
    this.setStatus("已添加 " + selected.length + " 个资产" + (connectedCount ? "，并连接最终结果" : ""), "success");
  };

  Editor.prototype.openLocalAssetDialog = function () {
    const type = this.selectedAssetType();
    this.pendingLocalAssetType = type;
    this.localAssetDialog.querySelector("[data-local-type-label]").textContent = this.assetTypeLabel(type) + " · 仅当前分镜";
    this.localAssetDialog.querySelector("[data-local-asset-name]").value = "";
    this.localAssetDialog.querySelector("[data-local-asset-describe]").value = "";
    this.localAssetDialog.querySelector("[data-local-asset-prompt]").value = "";
    this.localAssetDialog.querySelector("[data-local-asset-error]").textContent = "";
    this.localAssetDialog.hidden = false;
    const name = this.localAssetDialog.querySelector("[data-local-asset-name]");
    requestAnimationFrame(function () { name.focus(); });
  };

  Editor.prototype.closeLocalAssetDialog = function () {
    if (this.localAssetDialog) this.localAssetDialog.hidden = true;
  };

  Editor.prototype.createLocalAsset = function () {
    const type = String(this.pendingLocalAssetType || this.selectedAssetType());
    const nameField = this.localAssetDialog.querySelector("[data-local-asset-name]");
    const name = String(nameField.value || "").trim();
    const error = this.localAssetDialog.querySelector("[data-local-asset-error]");
    if (!name) { error.textContent = "请输入资产名称"; nameField.focus(); return; }
    const duplicate = this.graph.nodes.some(function (node) {
      return node.type === "upload" && node.data.assetScope === "canvas" && node.data.assetType === type && String(node.data.assetName || "").trim() === name;
    });
    if (duplicate) { error.textContent = "当前画布已存在同类型同名的画布资产"; nameField.focus(); return; }
    const describe = String(this.localAssetDialog.querySelector("[data-local-asset-describe]").value || "");
    const prompt = String(this.localAssetDialog.querySelector("[data-local-asset-prompt]").value || "");
    const point = this.centerPoint();
    const nodeId = uid("canvas-asset");
    this.graph.nodes.push({
      id: nodeId, type: "upload", position: { x: point.x - 160, y: point.y - 200 },
      data: {
        image: "", originalImage: "", globalImage: "", assetId: null, assetName: name, assetType: type,
        assetDescribe: describe, assetPrompt: prompt, globalDescribe: "", globalPrompt: "", revision: 1,
        baseAssetRevision: 1, referenceEnabled: true, localSourceNodeId: nodeId, overridden: true,
        assetScope: "canvas", assetKind: "local", localAssetKey: nodeId,
        custom: false, draftAsset: false, uploadBusy: false, error: ""
      }
    });
    this.commitHistory();
    this.closeLocalAssetDialog();
    this.render();
    this.setStatus("画布资产已创建，可上传图片或生成版本", "success");
  };

  Editor.prototype.bindShell = function () {
    const self = this;
    this.root.querySelectorAll("[data-command]").forEach(function (button) {
      button.addEventListener("click", function () {
        const command = button.getAttribute("data-command");
        if (command === "add-image") self.addImageNode();
        if (command === "add-generated") self.addGeneratedNode();
        if (command === "add-asset") self.toggleAssetActionMenu();
        if (command === "undo") self.undo();
        if (command === "redo") self.redo();
        if (command === "layout") self.autoLayout();
        if (command === "fit") self.fitView(true);
        if (command === "zoom-in") self.setZoom(self.graph.viewport.zoom + 0.1);
        if (command === "zoom-out") self.setZoom(self.graph.viewport.zoom - 0.1);
        if (command === "save") self.save();
        if (command === "close") self.close(false);
      });
    });
    this.root.querySelectorAll("[data-asset-choice]").forEach(function (button) {
      button.addEventListener("click", function () {
        self.closeAssetActionMenu();
        if (button.getAttribute("data-asset-choice") === "existing") self.openAssetPicker();
        else self.openLocalAssetDialog();
      });
    });
    this.root.querySelectorAll("[data-modal-close]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (button.getAttribute("data-modal-close") === "picker") self.closeAssetPicker();
        else self.closeLocalAssetDialog();
      });
    });
    this.root.querySelector("[data-asset-search]").addEventListener("input", function () { self.renderAssetPicker(); });
    this.root.querySelector("[data-add-selected-assets]").addEventListener("click", function () { self.addSelectedAssets(); });
    this.root.querySelector("[data-create-local-asset]").addEventListener("click", function () { self.createLocalAsset(); });
    this.root.querySelector("[data-local-asset-name]").addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); self.createLocalAsset(); }
    });
    [this.assetPicker, this.localAssetDialog].forEach(function (modal) {
      modal.addEventListener("pointerdown", function (event) {
        if (event.target !== modal) return;
        if (modal === self.assetPicker) self.closeAssetPicker();
        else self.closeLocalAssetDialog();
      });
    });
    this.listen(this.root, "click", function (event) {
      if (!event.target.closest(".tf-sic-asset-command")) self.closeAssetActionMenu();
    });
    this.listen(this.root, "click", function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("[data-asset-generate],[data-use-local],[data-asset-publish],[data-restore]");
      if (!button) return;
      const article = button.closest("[data-node-id]");
      const node = article && self.node(article.getAttribute("data-node-id"));
      if (!node) return;
      if (button.matches("[data-asset-generate]")) self.createAssetVariant(node);
      else if (button.matches("[data-use-local]")) self.useAssetVariant(node);
      else if (button.matches("[data-asset-publish]")) self.publishAsset(node);
      else if (button.matches("[data-restore]")) self.restoreGlobalAsset(node);
    });
    this.listen(this.stage, "pointerdown", function (event) {
      if (event.button !== 0 || event.target.closest("[data-edge-id],[data-edge-disconnect]")) return;
      if (self.selectedEdgeId) {
        self.selectedEdgeId = null;
        self.updateEdgeSelection();
      }
    }, true);
    this.listen(this.stage, "pointerdown", function (event) {
      if (event.button !== 0 || event.target.closest(".tf-sic-node,.tf-sic-help,[data-edge-id],[data-edge-disconnect]")) return;
      self.panning = { x: event.clientX, y: event.clientY, viewport: clone(self.graph.viewport) };
      self.stage.setPointerCapture(event.pointerId);
      self.stage.classList.add("is-panning");
    });
    this.listen(this.stage, "pointermove", function (event) {
      if (!self.panning) return;
      self.graph.viewport.x = self.panning.viewport.x + event.clientX - self.panning.x;
      self.graph.viewport.y = self.panning.viewport.y + event.clientY - self.panning.y;
      self.applyViewport();
    });
    const finishPanning = function () {
      if (!self.panning) return;
      self.panning = null;
      self.stage.classList.remove("is-panning");
      self.scheduleHistory();
    };
    this.listen(this.stage, "pointerup", finishPanning);
    this.listen(this.stage, "pointercancel", finishPanning);
    this.listen(this.stage, "wheel", function (event) {
      event.preventDefault();
      const rect = self.stage.getBoundingClientRect();
      self.setZoom(self.graph.viewport.zoom * Math.exp(-event.deltaY * 0.0012), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, { passive: false });
    this.listen(window, "keydown", function (event) {
      if (!self.root.isConnected || event.target.matches("input,textarea,select") || event.target.isContentEditable) return;
      const control = event.ctrlKey || event.metaKey;
      if (control && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? self.redo() : self.undo(); }
      else if (control && event.key.toLowerCase() === "y") { event.preventDefault(); self.redo(); }
      else if (event.key === "Escape" && self.connecting) { event.preventDefault(); self.cancelConnection(); }
      else if (event.key === "Escape" && !self.assetPicker.hidden) { event.preventDefault(); self.closeAssetPicker(); }
      else if (event.key === "Escape" && !self.localAssetDialog.hidden) { event.preventDefault(); self.closeLocalAssetDialog(); }
      else if (event.key === "Escape" && self.assetActionMenu.classList.contains("open")) { event.preventDefault(); self.closeAssetActionMenu(); }
      else if (event.key === "Escape") self.close(false);
    });
    this.listen(window, "pointermove", this.onConnectionMove.bind(this));
    this.listen(window, "pointerup", this.onConnectionEnd.bind(this));
    this.listen(window, "pointercancel", this.cancelConnection.bind(this));
    this.listen(window, "blur", function () {
      if (self.connecting) self.cancelConnection();
      if (self.dragging) self.finishNodeDrag(self.dragging.nodeId);
    });
  };

  Editor.prototype.worldPoint = function (clientX, clientY) {
    const rect = this.stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.graph.viewport.x) / this.graph.viewport.zoom,
      y: (clientY - rect.top - this.graph.viewport.y) / this.graph.viewport.zoom
    };
  };

  Editor.prototype.centerPoint = function () {
    return this.worldPoint(this.stage.getBoundingClientRect().left + this.stage.clientWidth / 2, this.stage.getBoundingClientRect().top + this.stage.clientHeight / 2);
  };

  Editor.prototype.activeAutoPanGesture = function () {
    return this.dragging || this.connecting;
  };

  Editor.prototype.autoPanVelocity = function (position, start, end) {
    if (position < start + AUTO_PAN_THRESHOLD) {
      return AUTO_PAN_MAX_SPEED * Math.max(0, Math.min(1, (start + AUTO_PAN_THRESHOLD - position) / AUTO_PAN_THRESHOLD));
    }
    if (position > end - AUTO_PAN_THRESHOLD) {
      return -AUTO_PAN_MAX_SPEED * Math.max(0, Math.min(1, (position - end + AUTO_PAN_THRESHOLD) / AUTO_PAN_THRESHOLD));
    }
    return 0;
  };

  Editor.prototype.startAutoPan = function () {
    if (this.autoPanFrame) return;
    const self = this;
    this.autoPanTime = performance.now();
    const tick = function (time) {
      const gesture = self.activeAutoPanGesture();
      if (!gesture || !self.root || !self.root.isConnected) {
        self.autoPanFrame = 0;
        self.autoPanTime = 0;
        return;
      }
      const deltaTime = Math.max(0, Math.min(0.05, (time - self.autoPanTime) / 1000 || 0));
      self.autoPanTime = time;
      const rect = self.stage.getBoundingClientRect();
      const velocityX = self.autoPanVelocity(gesture.clientX, rect.left, rect.right);
      const velocityY = self.autoPanVelocity(gesture.clientY, rect.top, rect.bottom);
      if (velocityX || velocityY) {
        self.graph.viewport.x += velocityX * deltaTime;
        self.graph.viewport.y += velocityY * deltaTime;
        gesture.viewportChanged = true;
        if (self.dragging) self.updateDraggedNode();
        if (self.connecting) self.connecting.current = self.worldPoint(self.connecting.clientX, self.connecting.clientY);
        self.applyViewport();
        self.renderEdges();
      }
      self.autoPanFrame = requestAnimationFrame(tick);
    };
    this.autoPanFrame = requestAnimationFrame(tick);
  };

  Editor.prototype.stopAutoPan = function () {
    if (this.autoPanFrame) cancelAnimationFrame(this.autoPanFrame);
    this.autoPanFrame = 0;
    this.autoPanTime = 0;
  };

  Editor.prototype.updateDraggedNode = function () {
    const drag = this.dragging;
    if (!drag) return;
    const node = this.node(drag.nodeId);
    if (!node) return;
    const point = this.worldPoint(drag.clientX, drag.clientY);
    const nextX = point.x - drag.grabOffset.x;
    const nextY = point.y - drag.grabOffset.y;
    const screenDistance = (Math.abs(nextX - drag.position.x) + Math.abs(nextY - drag.position.y)) * this.graph.viewport.zoom;
    node.position.x = nextX;
    node.position.y = nextY;
    drag.moved = drag.moved || screenDistance > 2;
    const article = this.nodesLayer.querySelector('[data-node-id="' + CSS.escape(node.id) + '"]');
    if (article) {
      article.style.left = node.position.x + "px";
      article.style.top = node.position.y + "px";
    }
  };

  Editor.prototype.finishNodeDrag = function (nodeId) {
    const drag = this.dragging;
    if (!drag || drag.nodeId !== nodeId) return;
    this.dragging = null;
    this.stopAutoPan();
    if (drag.moved || drag.viewportChanged) this.commitHistory();
  };

  Editor.prototype.addImageNode = function () {
    const point = this.centerPoint();
    this.graph.nodes.push({
      id: uid("upload"), type: "upload", position: { x: point.x - 160, y: point.y - 160 },
      data: { image: "", originalImage: "", assetId: null, assetName: "本地图片", assetType: "", overridden: true, custom: true, uploadBusy: false, error: "" }
    });
    this.commitHistory();
    this.render();
  };

  Editor.prototype.addGeneratedNode = function () {
    const point = this.centerPoint();
    const hasFinal = this.graph.nodes.some(function (node) { return node.type === "generated" && node.data.isFinal; });
    this.graph.nodes.push(this.createGeneratedNode({ x: point.x - 215, y: point.y - 240 }, { prompt: this.row.prompt || "", isFinal: !hasFinal }));
    this.commitHistory();
    this.render();
  };

  Editor.prototype.createAssetVariant = function (source) {
    if (!source || source.type !== "upload") return;
    const variant = this.createGeneratedNode({ x: source.position.x + 390, y: source.position.y + 30 }, {
      prompt: source.data.assetPrompt || source.data.assetDescribe || "",
      assetVariant: true,
      targetAssetId: source.data.assetId,
      targetSourceNodeId: source.id,
      targetAssetType: source.data.assetType,
      targetAssetName: source.data.assetName,
      assetDescribe: source.data.assetDescribe,
      assetScope: source.data.assetScope || (source.data.assetId ? "global" : "canvas"),
      assetKind: source.data.assetKind || (source.data.assetId ? "original" : "local"),
      localAssetKey: source.data.localAssetKey || "",
      draftAsset: false,
      isFinal: false
    });
    this.graph.nodes.push(variant);
    if (this.imageForNode(source)) this.graph.edges.push({ id: uid("edge"), source: source.id, target: variant.id, order: 0 });
    this.commitHistory(); this.render();
  };

  Editor.prototype.sourceNodeForAssetVersion = function (node) {
    if (!node) return null;
    if (node.type === "upload") return node;
    const targetAssetId = Number(node.data.targetAssetId || 0);
    return this.node(node.data.targetSourceNodeId) || (targetAssetId ? this.graph.nodes.find(function (candidate) {
      return candidate.type === "upload" && Number(candidate.data.assetId || 0) === targetAssetId;
    }) : null) || this.graph.nodes.find(function (candidate) {
      return candidate.type === "upload" && node.data.localAssetKey && candidate.data.localAssetKey === node.data.localAssetKey;
    });
  };

  Editor.prototype.useAssetVariant = function (variant) {
    if (!variant || !variant.data.assetVariant || !variant.data.generatedImage) return;
    const source = this.sourceNodeForAssetVersion(variant);
    if (!source) { this.setStatus("未找到候选版本对应的资产节点", "error"); return; }
    source.data.image = variant.data.generatedImage;
    source.data.assetDescribe = variant.data.assetDescribe || source.data.assetDescribe || "";
    source.data.assetPrompt = this.compiledPrompt(variant);
    source.data.overridden = true;
    source.data.referenceEnabled = true;
    source.data.localSourceNodeId = variant.id;
    this.connectAssetToFinal(variant);
    this.commitHistory(); this.render();
    this.setStatus("已设为当前分镜版本，保存画布后生效", "success");
  };

  Editor.prototype.restoreGlobalAsset = function (source) {
    if (!source || source.type !== "upload" || !source.data.assetId) return;
    source.data.image = source.data.originalImage || source.data.globalImage || "";
    source.data.assetDescribe = source.data.globalDescribe || "";
    source.data.assetPrompt = source.data.globalPrompt || "";
    source.data.baseAssetRevision = Number(source.data.revision || 1);
    source.data.overridden = false;
    source.data.referenceEnabled = true;
    source.data.localSourceNodeId = "";
    source.data.error = "";
    const finalNode = this.finalNode();
    if (finalNode) {
      const assetId = Number(source.data.assetId);
      this.graph.edges = this.graph.edges.filter(function (edge) {
        if (edge.target !== finalNode.id) return true;
        return this.assetIdForNode(this.node(edge.source)) !== assetId;
      }, this);
      if (source.data.image) this.graph.edges.push({ id: uid("edge"), source: source.id, target: finalNode.id, order: 0 });
      this.normalizeFinalReferenceOrder();
    }
    this.commitHistory(); this.render();
  };

  Editor.prototype.publishAsset = async function (versionNode) {
    const source = this.sourceNodeForAssetVersion(versionNode);
    if (!source || !source.data.assetType || source.data.assetScope === "canvas") return;
    const image = this.imageForNode(versionNode);
    if (!image) { this.setStatus("请先上传或生成资产图片", "error"); return; }
    const isExisting = !!source.data.assetId;
    if (!window.confirm(isExisting ? "发布后会更新整部短剧使用的正式资产，但不会自动重生历史分镜。确认发布吗？" : "确认创建正式资产并关联当前分镜吗？")) return;
    versionNode.data.busy = true; this.render();
    try {
      const assetId = Number(source.data.assetId || 0) || null;
      const relatedNodes = this.graph.nodes.filter(function (node) {
        return node.id === source.id || node.data.targetSourceNodeId === source.id || assetId && Number(node.data.targetAssetId || 0) === assetId;
      });
      const relatedIds = new Set(relatedNodes.map(function (node) { return node.id; }));
      const prompt = versionNode.type === "generated" ? this.compiledPrompt(versionNode) : String(source.data.assetPrompt || "");
      const result = apiData(await this.config.post("/api/storyboardImport/canvasAsset/publish", {
        projectId: this.projectId,
        scriptId: this.scriptId,
        storyboardId: Number(this.row.id),
        assetId: assetId,
        expectedRevision: assetId ? Number(source.data.revision || 1) : null,
        type: source.data.assetType,
        name: source.data.assetName,
        describe: versionNode.data.assetDescribe || source.data.assetDescribe || "",
        prompt: prompt,
        imageUrl: image,
        nodes: relatedNodes,
        edges: this.graph.edges.filter(function (edge) { return relatedIds.has(edge.source) && relatedIds.has(edge.target); })
      })) || {};
      source.data.assetId = Number(result.assetId);
      source.data.image = result.originalSrc || result.src || image;
      source.data.originalImage = source.data.image;
      source.data.globalImage = source.data.image;
      source.data.assetDescribe = result.describe || "";
      source.data.assetPrompt = result.prompt || "";
      source.data.globalDescribe = source.data.assetDescribe;
      source.data.globalPrompt = source.data.assetPrompt;
      source.data.revision = Number(result.revision || 1);
      source.data.baseAssetRevision = source.data.revision;
      source.data.overridden = false;
      source.data.custom = false;
      source.data.draftAsset = false;
      source.data.localSourceNodeId = "";
      this.graph.nodes.forEach(function (node) {
        if (node.data.targetSourceNodeId === source.id || Number(node.data.targetAssetId || 0) === Number(assetId || -1)) {
          node.data.targetAssetId = Number(result.assetId);
          node.data.targetAssetName = source.data.assetName;
          node.data.draftAsset = false;
        }
      });
      const existingAsset = this.assets.find(function (asset) { return Number(asset.id) === Number(result.assetId); });
      const nextAsset = Object.assign(existingAsset || {}, result, { id: Number(result.assetId), referenceEnabled: 1, localOverride: null });
      if (!existingAsset) this.assets.push(nextAsset);
      const finalNode = this.finalNode();
      if (finalNode) {
        this.graph.edges = this.graph.edges.filter(function (edge) {
          if (edge.target !== finalNode.id) return true;
          return this.assetIdForNode(this.node(edge.source)) !== Number(result.assetId);
        }, this);
        this.graph.edges.push({ id: uid("edge"), source: source.id, target: finalNode.id, order: 0 });
        this.normalizeFinalReferenceOrder();
      }
      this.commitHistory();
      this.setStatus("正式资产已发布，" + Number(result.affectedStoryboardCount || 0) + " 个其他分镜将显示资产已更新", "success");
    } catch (error) {
      versionNode.data.error = error && error.message ? error.message : String(error);
      this.setStatus(versionNode.data.error, "error");
    } finally {
      versionNode.data.busy = false;
      this.render();
    }
  };

  Editor.prototype.removeNode = function (nodeId) {
    const node = this.node(nodeId);
    if (!node || node.data.busy || node.data.uploadBusy) return;
    if (node.type === "upload" && node.data.assetId) this.graph.suppressedAssetIds = Array.from(new Set(this.graph.suppressedAssetIds.concat(Number(node.data.assetId))));
    this.graph.nodes = this.graph.nodes.filter(function (item) { return item.id !== nodeId; });
    this.graph.edges = this.graph.edges.filter(function (edge) { return edge.source !== nodeId && edge.target !== nodeId; });
    if (node.type === "generated" && node.data.isFinal) {
      const next = this.graph.nodes.find(function (item) { return item.type === "generated" && !item.data.assetVariant && item.data.generatedImage; }) || this.graph.nodes.find(function (item) { return item.type === "generated" && !item.data.assetVariant; });
      if (next) next.data.isFinal = true;
    }
    this.commitHistory();
    this.render();
  };

  Editor.prototype.node = function (nodeId) {
    return this.graph.nodes.find(function (node) { return node.id === nodeId; });
  };

  Editor.prototype.incomingEdges = function (nodeId) {
    return this.graph.edges.filter(function (edge) { return edge.target === nodeId; }).sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); });
  };

  Editor.prototype.imageForNode = function (node) {
    if (!node) return "";
    return String(node.type === "generated" ? node.data.generatedImage || "" : node.data.image || "");
  };

  Editor.prototype.referenceInfo = function (targetId, sourceId) {
    const edges = this.incomingEdges(targetId);
    const index = edges.findIndex(function (edge) { return edge.source === sourceId; });
    const node = this.node(sourceId);
    return {
      valid: index >= 0 && !!node && !!this.imageForNode(node),
      index: index,
      label: index >= 0 ? "@图片" + (index + 1) : "@已失效",
      name: node ? (node.data.assetName || "生成结果") : "已删除图片",
      image: this.imageForNode(node)
    };
  };

  Editor.prototype.promptHtml = function (node) {
    return (node.data.promptDoc || []).map(function (part) {
      if (part.type !== "reference") return escapeHtml(part.text || "");
      const info = this.referenceInfo(node.id, part.nodeId);
      return '<span class="tf-sic-mention ' + (info.valid ? "" : "invalid") + '" contenteditable="false" data-ref-node="' + escapeHtml(part.nodeId) + '">' + escapeHtml(info.label) + '<span class="tf-sic-mention-preview">' + (info.image ? '<img src="' + escapeHtml(info.image) + '" alt="">' : "") + '<b>' + escapeHtml(info.name) + '</b></span></span>';
    }, this).join("");
  };

  Editor.prototype.readPromptDoc = function (editor) {
    const parts = [];
    function appendText(value) {
      if (!value) return;
      const last = parts[parts.length - 1];
      if (last && last.type === "text") last.text += value;
      else parts.push(textPart(value));
    }
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) { appendText(node.nodeValue || ""); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches("[data-ref-node]")) { parts.push({ type: "reference", nodeId: node.getAttribute("data-ref-node") || "" }); return; }
      if (node.tagName === "BR") { appendText("\n"); return; }
      Array.from(node.childNodes).forEach(walk);
      if (node !== editor && (node.tagName === "DIV" || node.tagName === "P")) appendText("\n");
    }
    Array.from(editor.childNodes).forEach(walk);
    return parts.length ? parts : [textPart("")];
  };

  Editor.prototype.compiledPrompt = function (node) {
    return (node.data.promptDoc || []).map(function (part) {
      if (part.type !== "reference") return part.text || "";
      return this.referenceInfo(node.id, part.nodeId).label;
    }, this).join("").trim();
  };

  Editor.prototype.invalidReferences = function (node) {
    return (node.data.promptDoc || []).filter(function (part) {
      return part.type === "reference" && !this.referenceInfo(node.id, part.nodeId).valid;
    }, this);
  };

  Editor.prototype.render = function () {
    if (!this.nodesLayer) return;
    this.nodesLayer.innerHTML = "";
    this.graph.nodes.forEach(this.renderNode.bind(this));
    this.applyViewport();
    this.renderEdges();
    this.updateToolbar();
  };

  Editor.prototype.renderNode = function (node) {
    const article = document.createElement("article");
    article.className = "tf-sic-node tf-sic-node-" + node.type + (node.data.isFinal ? " is-final" : "");
    article.dataset.nodeId = node.id;
    article.style.left = node.position.x + "px";
    article.style.top = node.position.y + "px";
    if (node.type === "upload") this.renderUploadNode(article, node);
    else this.renderGeneratedNode(article, node);
    this.nodesLayer.appendChild(article);
    this.bindNode(article, node);
  };

  Editor.prototype.renderUploadNode = function (article, node) {
    const data = node.data;
    const baseTypeLabel = { role: "角色", scene: "场景", tool: "道具" }[data.assetType] || (data.custom ? "本地图片" : "资产");
    const kindLabel = data.assetScope === "canvas" ? "画布资产" : data.assetKind === "derived" ? "衍生资产" : data.assetKind === "original" ? "原始资产" : "";
    const typeLabel = kindLabel ? baseTypeLabel + " · " + kindLabel : baseTypeLabel;
    const editableAsset = !!data.assetType;
    const canvasAsset = data.assetScope === "canvas";
    article.innerHTML = [
      '<header data-drag-handle><div><span>' + escapeHtml(typeLabel) + '</span><strong>' + escapeHtml(data.assetName || "图片") + '</strong></div><button type="button" data-node-delete title="删除节点">×</button></header>',
      '<div class="tf-sic-image ' + (data.image ? "" : "empty") + '">' + (data.image ? '<img src="' + escapeHtml(data.image) + '" alt="' + escapeHtml(data.assetName) + '">' : '<span>暂无图片<br>请上传本地图片</span>') + '</div>',
      '<div class="tf-sic-node-state">' + (data.uploadBusy ? "正在上传…" : canvasAsset ? "仅保存在当前分镜画布" : data.overridden && !data.custom ? "本分镜版本（不会影响其他分镜）" : data.custom ? "自定义图片" : "正式资产 · v" + Number(data.revision || 1)) + '</div>',
      editableAsset ? '<div class="tf-sic-asset-fields"><label>描述<textarea data-asset-field="assetDescribe" placeholder="本分镜使用的资产描述">' + escapeHtml(data.assetDescribe || "") + '</textarea></label><label>图片提示词<textarea data-asset-field="assetPrompt" placeholder="用于生成资产候选版本">' + escapeHtml(data.assetPrompt || "") + '</textarea></label></div>' : "",
      data.error ? '<div class="tf-sic-node-error">' + escapeHtml(data.error) + '</div>' : "",
      '<footer><label class="tf-sic-upload-button">' + (data.uploadBusy ? "上传中" : data.image ? "替换图片" : "上传图片") + '<input type="file" accept="image/png,image/jpeg" data-upload hidden ' + (data.uploadBusy ? "disabled" : "") + '></label>' + (editableAsset ? '<button type="button" data-asset-generate>生成版本</button>' : "") + (!canvasAsset && !data.custom && data.overridden ? '<button type="button" data-restore>恢复全局</button>' : "") + (!canvasAsset && editableAsset && data.image ? '<button type="button" class="primary" data-asset-publish>发布全局</button>' : "") + '</footer>',
      '<button type="button" class="tf-sic-port tf-sic-port-out" data-port-out title="拖动连接到生成节点"></button>'
    ].join("");
  };

  Editor.prototype.renderGeneratedNode = function (article, node) {
    const data = node.data;
    const isAssetVariant = !!data.assetVariant;
    const incoming = this.incomingEdges(node.id);
    const modelValues = uniqueOptions(data.model, this.models.map(function (item) { return item.value; }));
    const modelLabel = function (value) { const found = this.models.find(function (item) { return item.value === value; }); return found ? found.label : value + " · 当前配置"; }.bind(this);
    const options = function (values, current, labeler) {
      return values.map(function (value) { return '<option value="' + escapeHtml(value) + '" ' + (value === current ? "selected" : "") + '>' + escapeHtml(labeler ? labeler(value) : value) + '</option>'; }).join("");
    };
    const invalidCount = this.invalidReferences(node).length;
    article.innerHTML = [
      '<header data-drag-handle><div><span>' + (isAssetVariant ? "资产版本" : "图片生成") + '</span><strong>' + escapeHtml(isAssetVariant ? (data.targetAssetName || "候选版本") : data.isFinal ? "最终结果" : "生成节点") + '</strong></div><div class="tf-sic-node-head-actions">' + (!isAssetVariant ? '<button type="button" data-final class="' + (data.isFinal ? "active" : "") + '">' + (data.isFinal ? "✓ 已设最终" : "设为最终") + '</button>' : "") + '<button type="button" data-node-delete title="删除节点">×</button></div></header>',
      '<div class="tf-sic-image generated ' + (data.generatedImage ? "" : "empty") + '">' + (data.generatedImage ? '<img src="' + escapeHtml(data.generatedImage) + '" alt="生成结果">' : '<span>生成结果将在这里显示</span>') + (data.busy ? '<em><i></i>正在生成图片…</em>' : "") + '</div>',
      '<div class="tf-sic-ref-strip">' + (incoming.length ? incoming.map(function (edge, index) { const source = this.node(edge.source); const image = this.imageForNode(source); return '<span title="' + escapeHtml(source && (source.data.assetName || "生成结果")) + '">' + (image ? '<img src="' + escapeHtml(image) + '" alt="">' : "!") + '<b>图片' + (index + 1) + '</b></span>'; }, this).join("") : '<small>连接图片节点后，可在提示词中输入 @ 引用</small>') + '</div>',
      '<label class="tf-sic-prompt-label">' + (isAssetVariant ? "资产图片提示词" : "分镜提示词") + (invalidCount ? '<b>' + invalidCount + ' 个引用已失效</b>' : "") + '</label>',
      '<div class="tf-sic-prompt ' + (invalidCount ? "invalid" : "") + '" contenteditable="true" data-prompt role="textbox" aria-multiline="true" data-placeholder="' + (isAssetVariant ? "描述资产外观，可连接其他图片作为参考" : "描述需要生成的分镜，输入 @ 插入图片引用") + '">' + this.promptHtml(node) + '</div>',
      '<div class="tf-sic-mention-menu" data-mention-menu></div>',
      '<div class="tf-sic-generate-controls"><select data-field="model">' + options(modelValues, data.model, modelLabel) + '</select><select data-field="ratio">' + options(uniqueOptions(data.ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"]), data.ratio) + '</select><select data-field="quality">' + options(uniqueOptions(data.quality, ["1K", "2K", "4K"]), data.quality) + '</select></div>',
      data.error ? '<div class="tf-sic-node-error">' + escapeHtml(data.error) + '</div>' : "",
      '<footer><button type="button" class="primary" data-generate ' + (data.busy || !data.model ? "disabled" : "") + '>' + (data.busy ? "生成中…" : "生成图片") + '</button>' + (isAssetVariant && data.generatedImage ? '<button type="button" data-use-local>设为本分镜</button>' + (data.assetScope === "canvas" ? "" : '<button type="button" data-asset-publish>发布全局</button>') : "") + '<span>' + incoming.length + ' 张参考图</span></footer>',
      '<button type="button" class="tf-sic-port tf-sic-port-in" data-port-in title="接收图片连接"></button>',
      '<button type="button" class="tf-sic-port tf-sic-port-out" data-port-out title="将生成结果连接到其他生成节点"></button>'
    ].join("");
  };

  Editor.prototype.bindNode = function (article, node) {
    const self = this;
    const handle = article.querySelector("[data-drag-handle]");
    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || event.target.closest("button")) return;
      const point = self.worldPoint(event.clientX, event.clientY);
      self.dragging = {
        nodeId: node.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
        position: clone(node.position), grabOffset: { x: point.x - node.position.x, y: point.y - node.position.y },
        moved: false, viewportChanged: false
      };
      handle.setPointerCapture(event.pointerId);
      self.startAutoPan();
      event.stopPropagation();
    });
    handle.addEventListener("pointermove", function (event) {
      if (!self.dragging || self.dragging.nodeId !== node.id) return;
      self.dragging.clientX = event.clientX;
      self.dragging.clientY = event.clientY;
      self.updateDraggedNode();
      self.renderEdges();
    });
    handle.addEventListener("pointerup", function () { self.finishNodeDrag(node.id); });
    handle.addEventListener("pointercancel", function () { self.finishNodeDrag(node.id); });
    handle.addEventListener("lostpointercapture", function () { self.finishNodeDrag(node.id); });
    const deleteButton = article.querySelector("[data-node-delete]");
    if (deleteButton) deleteButton.addEventListener("click", function () { self.removeNode(node.id); });
    const output = article.querySelector("[data-port-out]");
    if (output) output.addEventListener("pointerdown", function (event) {
      event.preventDefault(); event.stopPropagation();
      self.connecting = {
        source: node.id, current: self.worldPoint(event.clientX, event.clientY),
        clientX: event.clientX, clientY: event.clientY, viewportChanged: false
      };
      self.root.classList.add("is-connecting");
      self.startAutoPan();
      self.renderEdges();
    });
    if (node.type === "upload") {
      const input = article.querySelector("[data-upload]");
      if (input) input.addEventListener("change", function () { if (input.files && input.files[0]) self.upload(node, input.files[0]); });
      article.querySelectorAll("[data-asset-field]").forEach(function (field) {
        field.addEventListener("input", function () {
          node.data[field.getAttribute("data-asset-field")] = field.value;
          node.data.overridden = true;
          node.data.baseAssetRevision = Number(node.data.revision || node.data.baseAssetRevision || 1);
          if (!node.data.localSourceNodeId) node.data.localSourceNodeId = node.id;
          self.scheduleHistory();
        });
      });
      return;
    }
    const finalButton = article.querySelector("[data-final]");
    if (finalButton) finalButton.addEventListener("click", function () {
      self.graph.nodes.forEach(function (item) { if (item.type === "generated" && !item.data.assetVariant) item.data.isFinal = item.id === node.id; });
      self.commitHistory(); self.render();
    });
    article.querySelectorAll("[data-field]").forEach(function (field) {
      field.addEventListener("change", function () { node.data[field.getAttribute("data-field")] = field.value; self.commitHistory(); self.render(); });
    });
    const prompt = article.querySelector("[data-prompt]");
    prompt.addEventListener("input", function (event) {
      node.data.promptDoc = self.readPromptDoc(prompt);
      self.scheduleHistory();
      self.updateMentionMenu(article, node, prompt, event.data === "@");
      self.updateToolbar();
    });
    prompt.addEventListener("blur", function () { window.setTimeout(function () { const menu = article.querySelector("[data-mention-menu]"); if (menu) menu.classList.remove("open"); }, 180); });
    article.querySelector("[data-generate]").addEventListener("click", function () { self.generate(node); });
  };

  Editor.prototype.updateMentionMenu = function (article, node, prompt, forceOpen) {
    const menu = article.querySelector("[data-mention-menu]");
    const doc = this.readPromptDoc(prompt);
    const last = doc[doc.length - 1];
    const show = !!forceOpen || last && last.type === "text" && /@$/.test(last.text);
    if (!show) { menu.classList.remove("open"); return; }
    const selection = window.getSelection();
    if (selection && selection.rangeCount && prompt.contains(selection.anchorNode)) menu.__tfMentionRange = selection.getRangeAt(0).cloneRange();
    const edges = this.incomingEdges(node.id);
    if (!edges.length) { menu.innerHTML = '<small>请先连接图片节点</small>'; menu.classList.add("open"); return; }
    const self = this;
    menu.innerHTML = edges.map(function (edge, index) {
      const source = self.node(edge.source); const image = self.imageForNode(source);
      return '<button type="button" data-insert-ref="' + escapeHtml(edge.source) + '">' + (image ? '<img src="' + escapeHtml(image) + '" alt="">' : '<i>!</i>') + '<span><b>@图片' + (index + 1) + '</b><small>' + escapeHtml(source && (source.data.assetName || "生成结果")) + '</small></span></button>';
    }).join("");
    menu.classList.add("open");
    menu.querySelectorAll("[data-insert-ref]").forEach(function (button) {
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        const sourceId = button.getAttribute("data-insert-ref") || "";
        const range = menu.__tfMentionRange;
        let inserted = false;
        if (range && prompt.contains(range.startContainer)) {
          const container = range.startContainer;
          let offset = range.startOffset;
          if (container.nodeType === Node.TEXT_NODE && offset > 0 && container.nodeValue.charAt(offset - 1) === "@") {
            container.deleteData(offset - 1, 1);
            offset -= 1;
            range.setStart(container, offset);
            range.collapse(true);
          }
          const mention = document.createElement("span");
          mention.className = "tf-sic-mention";
          mention.contentEditable = "false";
          mention.setAttribute("data-ref-node", sourceId);
          mention.textContent = self.referenceInfo(node.id, sourceId).label;
          range.insertNode(mention);
          const spacer = document.createTextNode(" ");
          mention.after(spacer);
          const nextSelection = window.getSelection();
          const nextRange = document.createRange();
          nextRange.setStartAfter(spacer);
          nextRange.collapse(true);
          nextSelection.removeAllRanges();
          nextSelection.addRange(nextRange);
          inserted = true;
        }
        if (!inserted) {
          const parts = self.readPromptDoc(prompt);
          const tail = parts[parts.length - 1];
          if (tail && tail.type === "text") tail.text = tail.text.replace(/@$/, "");
          parts.push({ type: "reference", nodeId: sourceId }, textPart(" "));
          node.data.promptDoc = parts;
        } else node.data.promptDoc = self.readPromptDoc(prompt);
        self.commitHistory(); self.render();
      });
    });
  };

  Editor.prototype.fileDataUrl = function (file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(reader.error || new Error("读取图片失败")); };
      reader.readAsDataURL(file);
    });
  };

  Editor.prototype.upload = async function (node, file) {
    if (!/^image\/(png|jpeg)$/i.test(file.type)) { node.data.error = "仅支持 PNG、JPEG 图片"; this.render(); return; }
    if (file.size > 20 * 1024 * 1024) { node.data.error = "图片不能超过 20MB"; this.render(); return; }
    node.data.uploadBusy = true; node.data.error = ""; this.render();
    try {
      const result = await this.config.post("/api/production/editImage/uploadImage", {
        projectId: this.projectId, scriptId: this.scriptId, base64Data: await this.fileDataUrl(file)
      });
      const url = apiData(result);
      if (!url || typeof url !== "string") throw new Error("上传接口未返回图片地址");
      node.data.image = url;
      node.data.overridden = true;
      if (node.data.assetType) {
        node.data.referenceEnabled = true;
        node.data.localSourceNodeId = node.id;
      }
      if (node.data.custom) node.data.assetName = file.name || "本地图片";
      if (node.data.assetScope === "canvas") this.connectAssetToFinal(node);
      this.commitHistory();
    } catch (error) {
      node.data.error = error && error.message ? error.message : String(error);
    } finally {
      node.data.uploadBusy = false;
      this.render();
    }
  };

  Editor.prototype.generate = async function (node) {
    const prompt = this.compiledPrompt(node);
    const invalid = this.invalidReferences(node);
    const missingRoles = node.data.isFinal ? this.incomingEdges(node.id).map(function (edge) { return this.node(edge.source); }, this).filter(function (source) {
      return source && (source.data.assetType || source.data.targetAssetType) === "role" && !this.imageForNode(source);
    }, this).map(function (source) { return source.data.assetName || source.data.targetAssetName || "未命名角色"; }) : [];
    if (!prompt) { node.data.error = "请先填写提示词"; this.render(); return; }
    if (invalid.length) { node.data.error = "提示词中存在失效图片引用，请先修复"; this.render(); return; }
    if (missingRoles.length) { node.data.error = "缺少角色参考图：" + missingRoles.join("、") + "。请上传、设置本分镜版本或断开参考。"; this.render(); return; }
    const references = this.incomingEdges(node.id).map(function (edge) { return this.imageForNode(this.node(edge.source)); }, this).filter(Boolean);
    node.data.busy = true; node.data.error = ""; this.render();
    try {
      const result = await this.config.post("/api/production/editImage/generateFlowImage", {
        model: node.data.model, references: references, quality: node.data.quality, ratio: node.data.ratio,
        prompt: prompt, projectId: this.projectId
      });
      const data = apiData(result) || {};
      if (!data.url) throw new Error("生成接口未返回图片地址");
      node.data.generatedImage = data.url;
      this.commitHistory();
      this.setStatus("图片生成完成", "success");
    } catch (error) {
      node.data.error = error && error.message ? error.message : String(error);
      this.setStatus("图片生成失败", "error");
    } finally {
      node.data.busy = false;
      this.render();
    }
  };

  Editor.prototype.hasPath = function (from, to) {
    const queue = [from]; const visited = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (id === to) return true;
      if (visited.has(id)) continue;
      visited.add(id);
      this.graph.edges.filter(function (edge) { return edge.source === id; }).forEach(function (edge) { queue.push(edge.target); });
    }
    return false;
  };

  Editor.prototype.addEdge = function (sourceId, targetId) {
    const source = this.node(sourceId); const target = this.node(targetId);
    if (!source || !target || target.type !== "generated" || sourceId === targetId) { this.setStatus("连接目标必须是另一个生成节点", "error"); return false; }
    if (!this.imageForNode(source)) { this.setStatus("请先为来源节点准备图片", "error"); return false; }
    if (this.graph.edges.some(function (edge) { return edge.source === sourceId && edge.target === targetId; })) { this.setStatus("这两个节点已经连接", "error"); return false; }
    if (this.hasPath(targetId, sourceId)) { this.setStatus("不能创建循环连接", "error"); return false; }
    if (target.data.isFinal) {
      const identity = this.assetIdentityForNode(source);
      this.graph.edges = this.graph.edges.filter(function (edge) {
        if (edge.target !== targetId) return true;
        return this.assetIdentityForNode(this.node(edge.source)) !== identity;
      }, this);
    }
    const order = this.incomingEdges(targetId).reduce(function (max, edge) { return Math.max(max, Number(edge.order || 0)); }, -1) + 1;
    this.graph.edges.push({ id: uid("edge"), source: sourceId, target: targetId, order: order });
    if (target.data.isFinal) this.normalizeFinalReferenceOrder();
    this.commitHistory(); this.render();
    return true;
  };

  Editor.prototype.removeEdge = function (edgeId) {
    if (!this.graph.edges.some(function (edge) { return edge.id === edgeId; })) return;
    this.graph.edges = this.graph.edges.filter(function (edge) { return edge.id !== edgeId; });
    this.normalizeFinalReferenceOrder();
    this.selectedEdgeId = null;
    this.commitHistory();
    this.render();
  };

  Editor.prototype.onConnectionMove = function (event) {
    if (!this.connecting) return;
    this.connecting.clientX = event.clientX;
    this.connecting.clientY = event.clientY;
    this.connecting.current = this.worldPoint(event.clientX, event.clientY);
    this.renderEdges();
  };

  Editor.prototype.onConnectionEnd = function (event) {
    if (!this.connecting) return;
    const connecting = this.connecting;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const input = target && target.closest && target.closest("[data-port-in]");
    const article = input && input.closest("[data-node-id]");
    this.connecting = null;
    this.stopAutoPan();
    this.root.classList.remove("is-connecting");
    const added = article && this.addEdge(connecting.source, article.getAttribute("data-node-id"));
    if (!added) {
      this.renderEdges();
      if (connecting.viewportChanged) this.commitHistory();
    }
  };

  Editor.prototype.cancelConnection = function () {
    if (!this.connecting) return;
    const connecting = this.connecting;
    this.connecting = null;
    this.stopAutoPan();
    if (this.root) this.root.classList.remove("is-connecting");
    this.renderEdges();
    if (connecting.viewportChanged) this.commitHistory();
  };

  Editor.prototype.portPoint = function (nodeId, selector) {
    const article = this.nodesLayer.querySelector('[data-node-id="' + CSS.escape(nodeId) + '"]');
    const port = article && article.querySelector(selector);
    const node = this.node(nodeId);
    if (!article || !port || !node) return { x: node ? node.position.x : 0, y: node ? node.position.y : 0 };
    return { x: node.position.x + port.offsetLeft + port.offsetWidth / 2, y: node.position.y + port.offsetTop + port.offsetHeight / 2 };
  };

  Editor.prototype.edgeGeometry = function (source, target) {
    const deltaX = target.x - source.x;
    const deltaY = target.y - source.y;
    if (deltaX < 0) {
      const bend = Math.max(96, Math.min(260, 96 + Math.abs(deltaX) * 0.12 + Math.abs(deltaY) * 0.08));
      const routeY = Math.min(source.y, target.y) - bend;
      const midpoint = { x: (source.x + target.x) / 2, y: routeY };
      return {
        path: "M" + source.x + " " + source.y
          + " C" + (source.x + bend) + " " + source.y + "," + (source.x + bend) + " " + routeY + "," + midpoint.x + " " + midpoint.y
          + " C" + (target.x - bend) + " " + routeY + "," + (target.x - bend) + " " + target.y + "," + target.x + " " + target.y,
        midpoint: midpoint
      };
    }
    const bend = Math.max(72, Math.min(320, deltaX * 0.45));
    const control1 = { x: source.x + bend, y: source.y };
    const control2 = { x: target.x - bend, y: target.y };
    const t = 0.5;
    const inverse = 1 - t;
    return {
      path: "M" + source.x + " " + source.y + " C" + control1.x + " " + control1.y + "," + control2.x + " " + control2.y + "," + target.x + " " + target.y,
      midpoint: {
        x: inverse * inverse * inverse * source.x + 3 * inverse * inverse * t * control1.x + 3 * inverse * t * t * control2.x + t * t * t * target.x,
        y: inverse * inverse * inverse * source.y + 3 * inverse * inverse * t * control1.y + 3 * inverse * t * t * control2.y + t * t * t * target.y
      }
    };
  };

  Editor.prototype.edgePath = function (source, target) {
    return this.edgeGeometry(source, target).path;
  };

  Editor.prototype.updateEdgeControlScale = function () {
    if (!this.edgeControls) return;
    const scale = 1 / Math.max(0.25, Math.min(2, Number(this.graph.viewport.zoom || 0.8)));
    this.edgeControls.querySelectorAll("[data-edge-disconnect]").forEach(function (control) {
      control.setAttribute("transform", "translate(" + control.getAttribute("data-edge-x") + " " + control.getAttribute("data-edge-y") + ") scale(" + scale + ")");
    });
  };

  Editor.prototype.updateEdgeSelection = function () {
    if (this.selectedEdgeId && !this.graph.edges.some(function (edge) { return edge.id === this.selectedEdgeId; }, this)) {
      this.selectedEdgeId = null;
    }
    const selectedEdgeId = this.selectedEdgeId;
    this.edgeList.querySelectorAll("[data-edge-group]").forEach(function (group) {
      group.classList.toggle("is-selected", group.getAttribute("data-edge-group") === selectedEdgeId);
    });
    this.edgeControls.querySelectorAll("[data-edge-disconnect]").forEach(function (control) {
      control.classList.toggle("is-selected", control.getAttribute("data-edge-disconnect") === selectedEdgeId);
    });
  };

  Editor.prototype.renderEdges = function () {
    if (!this.edgeList || !this.edgeControls) return;
    const self = this;
    const controls = [];
    const edges = this.graph.edges.map(function (edge) {
      const source = self.portPoint(edge.source, "[data-port-out]");
      const target = self.portPoint(edge.target, "[data-port-in]");
      const geometry = self.edgeGeometry(source, target);
      const edgeId = escapeHtml(edge.id);
      controls.push('<g class="tf-sic-edge-disconnect" data-edge-disconnect="' + edgeId + '" data-edge-x="' + geometry.midpoint.x + '" data-edge-y="' + geometry.midpoint.y + '"><circle r="14"></circle><path d="M-5 -5L5 5M5 -5L-5 5"></path></g>');
      return '<g class="tf-sic-edge-group" data-edge-group="' + edgeId + '"><path class="tf-sic-edge-hit" data-edge-id="' + edgeId + '" d="' + geometry.path + '"></path><path class="tf-sic-edge" d="' + geometry.path + '"></path></g>';
    });
    this.edgeList.innerHTML = edges.join("");
    this.edgeControls.innerHTML = controls.join("");
    this.edgeList.querySelectorAll("[data-edge-id]").forEach(function (path) {
      path.addEventListener("pointerdown", function (event) {
        event.stopPropagation();
      });
      path.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        self.selectedEdgeId = path.getAttribute("data-edge-id");
        self.updateEdgeSelection();
      });
      path.addEventListener("dblclick", function (event) {
        event.preventDefault();
        event.stopPropagation();
        self.removeEdge(path.getAttribute("data-edge-id"));
      });
    });
    this.edgeControls.querySelectorAll("[data-edge-disconnect]").forEach(function (control) {
      control.addEventListener("pointerdown", function (event) {
        event.stopPropagation();
      });
      control.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        self.removeEdge(control.getAttribute("data-edge-disconnect"));
      });
    });
    this.updateEdgeSelection();
    this.updateEdgeControlScale();
    if (this.connecting) {
      const source = this.portPoint(this.connecting.source, "[data-port-out]");
      this.edgePreview.setAttribute("d", this.edgePath(source, this.connecting.current));
      this.edgePreview.style.display = "block";
    } else {
      this.edgePreview.style.display = "none";
    }
  };

  Editor.prototype.applyViewport = function () {
    const viewport = this.graph.viewport;
    viewport.x = finiteNumber(viewport.x, 0);
    viewport.y = finiteNumber(viewport.y, 0);
    viewport.zoom = Math.max(0.25, Math.min(2, finiteNumber(viewport.zoom, 0.8)));
    this.world.style.transform = "translate(" + viewport.x + "px," + viewport.y + "px) scale(" + viewport.zoom + ")";
    const svgTransform = "translate(" + viewport.x + " " + viewport.y + ") scale(" + viewport.zoom + ")";
    if (this.edgeViewport) this.edgeViewport.setAttribute("transform", svgTransform);
    if (this.edgeControlViewport) this.edgeControlViewport.setAttribute("transform", svgTransform);
    if (this.grid) {
      let worldSpacing = 20;
      while (worldSpacing * viewport.zoom < 12) worldSpacing *= 2;
      const spacing = worldSpacing * viewport.zoom;
      const gridX = (viewport.x % spacing + spacing) % spacing;
      const gridY = (viewport.y % spacing + spacing) % spacing;
      this.grid.style.backgroundSize = spacing + "px " + spacing + "px";
      this.grid.style.backgroundPosition = gridX + "px " + gridY + "px";
    }
    this.updateEdgeControlScale();
    const zoom = this.root.querySelector("[data-zoom]");
    if (zoom) zoom.textContent = Math.round(viewport.zoom * 100) + "%";
  };

  Editor.prototype.setZoom = function (nextZoom, anchor) {
    const viewport = this.graph.viewport;
    const oldZoom = viewport.zoom;
    const zoom = Math.max(0.25, Math.min(2, nextZoom));
    const point = anchor || { x: this.stage.clientWidth / 2, y: this.stage.clientHeight / 2 };
    const worldX = (point.x - viewport.x) / oldZoom;
    const worldY = (point.y - viewport.y) / oldZoom;
    viewport.zoom = zoom;
    viewport.x = point.x - worldX * zoom;
    viewport.y = point.y - worldY * zoom;
    this.applyViewport();
    this.scheduleHistory();
  };

  Editor.prototype.fitView = function (markDirty) {
    if (!this.graph.nodes.length) return;
    const minX = Math.min.apply(null, this.graph.nodes.map(function (node) { return node.position.x; }));
    const minY = Math.min.apply(null, this.graph.nodes.map(function (node) { return node.position.y; }));
    const maxX = Math.max.apply(null, this.graph.nodes.map(function (node) { return node.position.x + (NODE_WIDTH[node.type] || 340); }));
    const maxY = Math.max.apply(null, this.graph.nodes.map(function (node) {
      const element = this.nodesLayer.querySelector('[data-node-id="' + CSS.escape(node.id) + '"]');
      return node.position.y + (element ? element.offsetHeight : node.type === "generated" ? 600 : 360);
    }, this));
    const zoom = Math.max(0.25, Math.min(1.1, Math.min((this.stage.clientWidth - 140) / Math.max(1, maxX - minX), (this.stage.clientHeight - 140) / Math.max(1, maxY - minY))));
    this.graph.viewport = { zoom: zoom, x: (this.stage.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: (this.stage.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom };
    this.applyViewport();
    if (markDirty) this.scheduleHistory();
  };

  Editor.prototype.autoLayout = function () {
    const memo = new Map(); const self = this;
    function depth(nodeId, stack) {
      if (memo.has(nodeId)) return memo.get(nodeId);
      if (stack.has(nodeId)) return 0;
      const next = new Set(stack); next.add(nodeId);
      const incoming = self.incomingEdges(nodeId);
      const value = incoming.length ? Math.max.apply(null, incoming.map(function (edge) { return depth(edge.source, next) + 1; })) : 0;
      memo.set(nodeId, value); return value;
    }
    const columns = {};
    this.graph.nodes.forEach(function (node) { const column = depth(node.id, new Set()); (columns[column] || (columns[column] = [])).push(node); });
    Object.keys(columns).forEach(function (key) {
      const depthValue = Number(key);
      columns[key].forEach(function (node, index) {
        node.position = depthValue === 0
          ? { x: 100 + index % 2 * 370, y: 80 + Math.floor(index / 2) * 430 }
          : { x: 900 + (depthValue - 1) * 540, y: 80 + index * 660 };
      });
    });
    this.commitHistory(); this.render();
    requestAnimationFrame(this.fitView.bind(this, false));
  };

  Editor.prototype.finalNode = function () {
    return this.graph.nodes.find(function (node) { return node.type === "generated" && !node.data.assetVariant && node.data.isFinal; });
  };

  Editor.prototype.updateToolbar = function () {
    if (!this.saveButton) return;
    const finalNode = this.finalNode();
    const busy = this.graph.nodes.some(function (node) { return node.data.busy || node.data.uploadBusy; });
    const valid = finalNode && this.imageForNode(finalNode) && !this.invalidReferences(finalNode).length && this.compiledPrompt(finalNode);
    this.saveButton.disabled = !!this.saving || !!busy || !valid;
    this.root.querySelector('[data-command="undo"]').disabled = this.historyIndex <= 0;
    this.root.querySelector('[data-command="redo"]').disabled = this.historyIndex >= this.history.length - 1;
    if (!this.saving && !valid && this.history.length) {
      this.setStatus(!finalNode ? "请指定最终结果节点" : !this.imageForNode(finalNode) ? "最终结果节点还没有图片" : "最终提示词存在失效引用", "warning");
    }
  };

  Editor.prototype.persistedGraph = function () {
    const graph = this.snapshot();
    const finalNode = graph.nodes.find(function (node) { return node.type === "generated" && node.data.isFinal; });
    graph.nodes.forEach(function (node) {
      node.data.error = ""; node.data.busy = false; node.data.uploadBusy = false;
      if (node.type === "upload" && node.data.assetId) node.data.originalImage = "";
      if (node.type === "generated") {
        const sourceEdges = graph.edges.filter(function (edge) { return edge.target === node.id; }).sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); });
        node.data.references = sourceEdges.map(function (edge) {
          const source = graph.nodes.find(function (item) { return item.id === edge.source; });
          const image = source && (source.type === "generated" ? source.data.generatedImage : source.data.image);
          return image ? { image: image, nodeId: edge.source } : null;
        }).filter(Boolean);
        node.data.prompt = this.compiledPrompt(this.node(node.id));
      }
      delete node.data.canvasMeta;
    }, this);
    if (finalNode) finalNode.data.canvasMeta = {
      version: VERSION, viewport: clone(this.graph.viewport), suppressedAssetIds: this.graph.suppressedAssetIds.slice(),
      assetSnapshot: this.assets.map(function (asset) { return { id: Number(asset.id), name: asset.name, type: asset.type }; })
    };
    return { nodes: graph.nodes, edges: graph.edges };
  };

  Editor.prototype.assetSelections = function () {
    const finalNode = this.finalNode();
    const selectedNodes = finalNode ? this.incomingEdges(finalNode.id).map(function (edge) { return this.node(edge.source); }, this).filter(Boolean) : [];
    return this.assets.filter(function (asset) {
      const assetId = Number(asset.id);
      return this.initialAssetIds.has(assetId) || this.graph.nodes.some(function (node) { return this.assetIdForNode(node) === assetId; }, this);
    }, this).map(function (asset) {
      const assetId = Number(asset.id);
      const source = this.graph.nodes.find(function (node) { return node.type === "upload" && Number(node.data.assetId || 0) === assetId; });
      const selected = selectedNodes.find(function (node) { return this.assetIdForNode(node) === assetId; }, this);
      const savedLocal = asset.localOverride || null;
      const local = !!(selected && selected.data.assetVariant) || (source ? !!source.data.overridden : !!savedLocal);
      const filePath = selected ? this.imageForNode(selected) : source && source.data.image || savedLocal && (savedLocal.originalSrc || savedLocal.src || savedLocal.filePath) || "";
      const describe = selected && selected.data.assetDescribe || source && source.data.assetDescribe || savedLocal && savedLocal.describe || asset.describe || "";
      const prompt = selected && selected.data.assetVariant ? this.compiledPrompt(selected) : source && source.data.assetPrompt || savedLocal && savedLocal.prompt || asset.prompt || "";
      return {
        assetId: assetId,
        sourceNodeId: local ? selected && selected.id || source && source.data.localSourceNodeId || source && source.id || savedLocal && savedLocal.sourceNodeId || null : null,
        referenceEnabled: !!selected,
        mode: local ? "local" : "global",
        filePath: local ? filePath : null,
        describe: describe,
        prompt: prompt,
        baseAssetRevision: Number(source && source.data.baseAssetRevision || savedLocal && savedLocal.baseAssetRevision || asset.revision || 1)
      };
    }, this);
  };

  Editor.prototype.save = async function () {
    const finalNode = this.finalNode();
    if (!finalNode || !this.imageForNode(finalNode) || this.invalidReferences(finalNode).length) return;
    this.saving = true; this.updateToolbar(); this.setStatus("正在保存画布和分镜图…", "loading");
    try {
      const graph = this.persistedGraph();
      const prompt = this.compiledPrompt(finalNode);
      const saved = apiData(await this.config.post("/api/storyboardImport/canvas/save", {
        projectId: this.projectId,
        scriptId: this.scriptId,
        storyboardId: Number(this.row.id),
        flowId: Number(this.row.flowId || 0) || null,
        nodes: graph.nodes,
        edges: graph.edges,
        prompt: prompt,
        finalImageUrl: this.imageForNode(finalNode),
        assetSelections: this.assetSelections()
      })) || {};
      const flowId = Number(saved.flowId || 0);
      if (!flowId) throw new Error("画布保存接口未返回 flowId");
      this.row.flowId = flowId; this.row.prompt = prompt; this.row.src = this.imageForNode(finalNode);
      if (this.config.onSaved) await this.config.onSaved({ flowId: flowId, prompt: prompt, url: this.row.src });
      this.dirty = false;
      this.setStatus("保存成功", "success");
      this.close(true);
    } catch (error) {
      this.setStatus(error && error.message ? error.message : String(error), "error");
    } finally {
      this.saving = false;
      this.updateToolbar();
    }
  };

  Editor.prototype.setStatus = function (message, type) {
    if (!this.statusNode) return;
    this.statusNode.textContent = message || "";
    this.statusNode.className = type ? "is-" + type : "";
  };

  Editor.prototype.close = function (force) {
    if (this.connecting) this.cancelConnection();
    if (this.dragging) this.finishNodeDrag(this.dragging.nodeId);
    if (!force && this.dirty && !window.confirm("画布有未保存的修改，确认关闭吗？")) return false;
    this.closeAssetActionMenu();
    this.closeAssetPicker();
    this.closeLocalAssetDialog();
    this.stopAutoPan();
    clearTimeout(this.historyTimer);
    this.listeners.splice(0).forEach(function (dispose) { dispose(); });
    if (this.root) this.root.remove();
    document.body.classList.remove("tf-sic-open");
    if (activeEditor === this) activeEditor = null;
    if (this.config.onClose) this.config.onClose();
    return true;
  };

  window.ToonflowStoryboardCanvas = {
    open: async function (config) {
      if (!config || typeof config.post !== "function") throw new Error("无限画布缺少请求适配器");
      if (activeEditor && !activeEditor.close(false)) return activeEditor;
      activeEditor = new Editor(config);
      await activeEditor.mount();
      return activeEditor;
    },
    close: function () { return activeEditor ? activeEditor.close(false) : true; }
  };
})();
