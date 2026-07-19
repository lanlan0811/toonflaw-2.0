(function () {
  if (window.ToonflowStoryboardCanvas) return;

  const VERSION = 2;
  const NODE_WIDTH = { upload: 320, generated: 430 };
  const TYPE_ORDER = { role: 0, scene: 1, tool: 2 };
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
      '<main class="tf-sic-stage" tabindex="0">',
      '  <div class="tf-sic-grid"></div>',
      '  <div class="tf-sic-world"><svg class="tf-sic-edges" aria-hidden="true"><g data-edge-list></g><path data-edge-preview></path></svg><div class="tf-sic-nodes" data-nodes></div><svg class="tf-sic-edge-controls" aria-hidden="true"><g data-edge-controls></g></svg></div>',
      '  <div class="tf-sic-help">拖动画布平移 · 滚轮缩放 · 从右侧圆点拖到生成节点左侧圆点连线 · 单击连线后点击中间的 × 断开连接（也可双击连线）</div>',
      '</main>'
    ].join("");
    document.body.appendChild(this.root);
    document.body.classList.add("tf-sic-open");
    this.stage = this.root.querySelector(".tf-sic-stage");
    this.world = this.root.querySelector(".tf-sic-world");
    this.nodesLayer = this.root.querySelector("[data-nodes]");
    this.edgeList = this.root.querySelector("[data-edge-list]");
    this.edgeControls = this.root.querySelector("[data-edge-controls]");
    this.edgePreview = this.root.querySelector("[data-edge-preview]");
    this.statusNode = this.root.querySelector("[data-status]");
    this.saveButton = this.root.querySelector('[data-command="save"]');
    this.bindShell();

    try {
      await this.load();
      this.history = [this.snapshot()];
      this.historyIndex = 0;
      this.render();
      requestAnimationFrame(this.fitView.bind(this, false));
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
    this.graph = flow && Array.isArray(flow.nodes) ? this.normalizeSavedGraph(flow) : this.createInitialGraph();
  };

  Editor.prototype.assetImage = function (asset) {
    return String(asset.originalSrc || asset.src || "");
  };

  Editor.prototype.createAssetNode = function (asset, position) {
    const image = this.assetImage(asset);
    return {
      id: uid("asset"), type: "upload", position: position,
      data: {
        image: image, originalImage: image, assetId: Number(asset.id), assetName: asset.name || "未命名资产",
        assetType: asset.type || "", overridden: false, custom: false, uploadBusy: false, error: ""
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
        references: [], busy: false, error: ""
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
      edges: nodes.filter(function (node) { return node.type === "upload"; }).map(function (node, index) {
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
    const graph = {
      nodes: rawNodes.map(function (node, index) {
        const data = node.data || {};
        const normalized = {
          id: String(node.id || uid(node.type)), type: node.type,
          position: { x: Number(node.position && node.position.x || 100 + index * 380), y: Number(node.position && node.position.y || 100) },
          data: data
        };
        if (node.type === "upload") {
          normalized.data = Object.assign({}, data, {
            image: String(data.image || ""), originalImage: String(data.originalImage || ""), assetId: Number(data.assetId || 0) || null,
            assetName: data.assetName || data.name || data.label || "自定义图片", assetType: data.assetType || "",
            overridden: !!data.overridden, custom: data.custom !== false && !data.assetId, uploadBusy: false, error: ""
          });
        } else {
          const incoming = rawEdges.filter(function (edge) { return String(edge.target) === String(normalized.id); }).sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); }).map(function (edge) { return String(edge.source); });
          normalized.data = Object.assign({}, data, {
            generatedImage: String(data.generatedImage || data.image || ""),
            promptDoc: normalizePromptDoc(data.promptDoc, data.prompt || data.promptText || this.row.prompt || "", incoming),
            model: String(data.model || this.defaults.model || ""), quality: String(data.quality || this.defaults.quality || "2K"),
            ratio: String(data.ratio || this.defaults.ratio || "16:9"), isFinal: !!data.isFinal,
            references: Array.isArray(data.references) ? data.references : [], busy: false, error: ""
          });
        }
        delete normalized.data.canvasMeta;
        return normalized;
      }, this),
      edges: rawEdges.map(function (edge, index) { return { id: String(edge.id || uid("edge")), source: String(edge.source), target: String(edge.target), order: Number(edge.order ?? index) }; }),
      viewport: meta.viewport && Number.isFinite(Number(meta.viewport.zoom)) ? clone(meta.viewport) : { x: 80, y: 80, zoom: 0.8 },
      suppressedAssetIds: (meta.suppressedAssetIds || []).map(Number).filter(Boolean)
    };
    this.reconcileAssets(graph);
    const generated = graph.nodes.filter(function (node) { return node.type === "generated"; });
    if (!generated.length) graph.nodes.push(this.createGeneratedNode({ x: 560, y: 100 }, { prompt: this.row.prompt || "", generatedImage: this.row.src || "", isFinal: true }));
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
      let asset = this.assets.find(function (item) { return Number(item.id) === Number(node.data.assetId); });
      if (!asset) {
        const image = normalizeUrl(node.data.image);
        asset = this.assets.find(function (item) {
          return image && [item.src, item.originalSrc].some(function (url) { return normalizeUrl(url) === image; });
        }) || this.assets.find(function (item) { return String(item.name || "") === String(node.data.assetName || ""); });
      }
      if (asset) {
        node.data.assetId = Number(asset.id);
        node.data.assetName = asset.name || node.data.assetName;
        node.data.assetType = asset.type || node.data.assetType;
        node.data.originalImage = this.assetImage(asset);
        node.data.custom = false;
        if (!node.data.overridden) node.data.image = node.data.originalImage;
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
        if (target) graph.edges.push({ id: uid("edge"), source: added.id, target: target.id, order: graph.edges.filter(function (edge) { return edge.target === target.id; }).length });
      }
    }, this);
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

  Editor.prototype.bindShell = function () {
    const self = this;
    this.root.querySelectorAll("[data-command]").forEach(function (button) {
      button.addEventListener("click", function () {
        const command = button.getAttribute("data-command");
        if (command === "add-image") self.addImageNode();
        if (command === "add-generated") self.addGeneratedNode();
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
    this.listen(this.stage, "pointerup", function () {
      if (!self.panning) return;
      self.panning = null;
      self.stage.classList.remove("is-panning");
      self.scheduleHistory();
    });
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
      else if (event.key === "Escape") self.close(false);
    });
    this.listen(window, "pointermove", this.onConnectionMove.bind(this));
    this.listen(window, "pointerup", this.onConnectionEnd.bind(this));
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

  Editor.prototype.removeNode = function (nodeId) {
    const node = this.node(nodeId);
    if (!node || node.data.busy || node.data.uploadBusy) return;
    if (node.type === "upload" && node.data.assetId) this.graph.suppressedAssetIds = Array.from(new Set(this.graph.suppressedAssetIds.concat(Number(node.data.assetId))));
    this.graph.nodes = this.graph.nodes.filter(function (item) { return item.id !== nodeId; });
    this.graph.edges = this.graph.edges.filter(function (edge) { return edge.source !== nodeId && edge.target !== nodeId; });
    if (node.type === "generated" && node.data.isFinal) {
      const next = this.graph.nodes.find(function (item) { return item.type === "generated" && item.data.generatedImage; }) || this.graph.nodes.find(function (item) { return item.type === "generated"; });
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
    const typeLabel = { role: "角色", scene: "场景", tool: "道具" }[data.assetType] || (data.custom ? "本地图片" : "资产");
    article.innerHTML = [
      '<header data-drag-handle><div><span>' + escapeHtml(typeLabel) + '</span><strong>' + escapeHtml(data.assetName || "图片") + '</strong></div><button type="button" data-node-delete title="删除节点">×</button></header>',
      '<div class="tf-sic-image ' + (data.image ? "" : "empty") + '">' + (data.image ? '<img src="' + escapeHtml(data.image) + '" alt="' + escapeHtml(data.assetName) + '">' : '<span>暂无图片<br>请上传本地图片</span>') + '</div>',
      '<div class="tf-sic-node-state">' + (data.uploadBusy ? "正在上传…" : data.overridden && !data.custom ? "已在画布中覆盖原资产" : data.custom ? "自定义图片" : "使用原资产图") + '</div>',
      data.error ? '<div class="tf-sic-node-error">' + escapeHtml(data.error) + '</div>' : "",
      '<footer><label class="tf-sic-upload-button">' + (data.uploadBusy ? "上传中" : data.image ? "替换图片" : "上传图片") + '<input type="file" accept="image/png,image/jpeg" data-upload hidden ' + (data.uploadBusy ? "disabled" : "") + '></label>' + (!data.custom && data.overridden ? '<button type="button" data-restore>恢复原资产</button>' : "") + '</footer>',
      '<button type="button" class="tf-sic-port tf-sic-port-out" data-port-out title="拖动连接到生成节点"></button>'
    ].join("");
  };

  Editor.prototype.renderGeneratedNode = function (article, node) {
    const data = node.data;
    const incoming = this.incomingEdges(node.id);
    const modelValues = uniqueOptions(data.model, this.models.map(function (item) { return item.value; }));
    const modelLabel = function (value) { const found = this.models.find(function (item) { return item.value === value; }); return found ? found.label : value + " · 当前配置"; }.bind(this);
    const options = function (values, current, labeler) {
      return values.map(function (value) { return '<option value="' + escapeHtml(value) + '" ' + (value === current ? "selected" : "") + '>' + escapeHtml(labeler ? labeler(value) : value) + '</option>'; }).join("");
    };
    const invalidCount = this.invalidReferences(node).length;
    article.innerHTML = [
      '<header data-drag-handle><div><span>图片生成</span><strong>' + (data.isFinal ? "最终结果" : "生成节点") + '</strong></div><div class="tf-sic-node-head-actions"><button type="button" data-final class="' + (data.isFinal ? "active" : "") + '">' + (data.isFinal ? "✓ 已设最终" : "设为最终") + '</button><button type="button" data-node-delete title="删除节点">×</button></div></header>',
      '<div class="tf-sic-image generated ' + (data.generatedImage ? "" : "empty") + '">' + (data.generatedImage ? '<img src="' + escapeHtml(data.generatedImage) + '" alt="生成结果">' : '<span>生成结果将在这里显示</span>') + (data.busy ? '<em><i></i>正在生成图片…</em>' : "") + '</div>',
      '<div class="tf-sic-ref-strip">' + (incoming.length ? incoming.map(function (edge, index) { const source = this.node(edge.source); const image = this.imageForNode(source); return '<span title="' + escapeHtml(source && (source.data.assetName || "生成结果")) + '">' + (image ? '<img src="' + escapeHtml(image) + '" alt="">' : "!") + '<b>图片' + (index + 1) + '</b></span>'; }, this).join("") : '<small>连接图片节点后，可在提示词中输入 @ 引用</small>') + '</div>',
      '<label class="tf-sic-prompt-label">分镜提示词' + (invalidCount ? '<b>' + invalidCount + ' 个引用已失效</b>' : "") + '</label>',
      '<div class="tf-sic-prompt ' + (invalidCount ? "invalid" : "") + '" contenteditable="true" data-prompt role="textbox" aria-multiline="true" data-placeholder="描述需要生成的分镜，输入 @ 插入图片引用">' + this.promptHtml(node) + '</div>',
      '<div class="tf-sic-mention-menu" data-mention-menu></div>',
      '<div class="tf-sic-generate-controls"><select data-field="model">' + options(modelValues, data.model, modelLabel) + '</select><select data-field="ratio">' + options(uniqueOptions(data.ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"]), data.ratio) + '</select><select data-field="quality">' + options(uniqueOptions(data.quality, ["1K", "2K", "4K"]), data.quality) + '</select></div>',
      data.error ? '<div class="tf-sic-node-error">' + escapeHtml(data.error) + '</div>' : "",
      '<footer><button type="button" class="primary" data-generate ' + (data.busy || !data.model ? "disabled" : "") + '>' + (data.busy ? "生成中…" : "生成图片") + '</button><span>' + incoming.length + ' 张参考图</span></footer>',
      '<button type="button" class="tf-sic-port tf-sic-port-in" data-port-in title="接收图片连接"></button>',
      '<button type="button" class="tf-sic-port tf-sic-port-out" data-port-out title="将生成结果连接到其他生成节点"></button>'
    ].join("");
  };

  Editor.prototype.bindNode = function (article, node) {
    const self = this;
    const handle = article.querySelector("[data-drag-handle]");
    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || event.target.closest("button")) return;
      self.dragging = { nodeId: node.id, x: event.clientX, y: event.clientY, position: clone(node.position), moved: false };
      handle.setPointerCapture(event.pointerId);
      event.stopPropagation();
    });
    handle.addEventListener("pointermove", function (event) {
      if (!self.dragging || self.dragging.nodeId !== node.id) return;
      const dx = (event.clientX - self.dragging.x) / self.graph.viewport.zoom;
      const dy = (event.clientY - self.dragging.y) / self.graph.viewport.zoom;
      node.position.x = Math.max(0, self.dragging.position.x + dx);
      node.position.y = Math.max(0, self.dragging.position.y + dy);
      self.dragging.moved = self.dragging.moved || Math.abs(dx) + Math.abs(dy) > 2;
      article.style.left = node.position.x + "px";
      article.style.top = node.position.y + "px";
      self.renderEdges();
    });
    handle.addEventListener("pointerup", function () {
      if (!self.dragging || self.dragging.nodeId !== node.id) return;
      const moved = self.dragging.moved;
      self.dragging = null;
      if (moved) self.commitHistory();
    });
    const deleteButton = article.querySelector("[data-node-delete]");
    if (deleteButton) deleteButton.addEventListener("click", function () { self.removeNode(node.id); });
    const output = article.querySelector("[data-port-out]");
    if (output) output.addEventListener("pointerdown", function (event) {
      event.preventDefault(); event.stopPropagation();
      self.connecting = { source: node.id, current: self.worldPoint(event.clientX, event.clientY) };
      self.root.classList.add("is-connecting");
      self.renderEdges();
    });
    if (node.type === "upload") {
      const input = article.querySelector("[data-upload]");
      if (input) input.addEventListener("change", function () { if (input.files && input.files[0]) self.upload(node, input.files[0]); });
      const restore = article.querySelector("[data-restore]");
      if (restore) restore.addEventListener("click", function () {
        node.data.image = node.data.originalImage || ""; node.data.overridden = false; node.data.error = "";
        self.commitHistory(); self.render();
      });
      return;
    }
    const finalButton = article.querySelector("[data-final]");
    finalButton.addEventListener("click", function () {
      self.graph.nodes.forEach(function (item) { if (item.type === "generated") item.data.isFinal = item.id === node.id; });
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
      if (node.data.custom) node.data.assetName = file.name || "本地图片";
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
    if (!prompt) { node.data.error = "请先填写提示词"; this.render(); return; }
    if (invalid.length) { node.data.error = "提示词中存在失效图片引用，请先修复"; this.render(); return; }
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
    if (!source || !target || target.type !== "generated" || sourceId === targetId) { this.setStatus("连接目标必须是另一个生成节点", "error"); return; }
    if (!this.imageForNode(source)) { this.setStatus("请先为来源节点准备图片", "error"); return; }
    if (this.graph.edges.some(function (edge) { return edge.source === sourceId && edge.target === targetId; })) { this.setStatus("这两个节点已经连接", "error"); return; }
    if (this.hasPath(targetId, sourceId)) { this.setStatus("不能创建循环连接", "error"); return; }
    const order = this.incomingEdges(targetId).reduce(function (max, edge) { return Math.max(max, Number(edge.order || 0)); }, -1) + 1;
    this.graph.edges.push({ id: uid("edge"), source: sourceId, target: targetId, order: order });
    this.commitHistory(); this.render();
  };

  Editor.prototype.removeEdge = function (edgeId) {
    if (!this.graph.edges.some(function (edge) { return edge.id === edgeId; })) return;
    this.graph.edges = this.graph.edges.filter(function (edge) { return edge.id !== edgeId; });
    this.selectedEdgeId = null;
    this.commitHistory();
    this.render();
  };

  Editor.prototype.onConnectionMove = function (event) {
    if (!this.connecting) return;
    this.connecting.current = this.worldPoint(event.clientX, event.clientY);
    this.renderEdges();
  };

  Editor.prototype.onConnectionEnd = function (event) {
    if (!this.connecting) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const input = target && target.closest && target.closest("[data-port-in]");
    const article = input && input.closest("[data-node-id]");
    const source = this.connecting.source;
    this.connecting = null;
    this.root.classList.remove("is-connecting");
    if (article) this.addEdge(source, article.getAttribute("data-node-id"));
    else this.renderEdges();
  };

  Editor.prototype.portPoint = function (nodeId, selector) {
    const article = this.nodesLayer.querySelector('[data-node-id="' + CSS.escape(nodeId) + '"]');
    const port = article && article.querySelector(selector);
    const node = this.node(nodeId);
    if (!article || !port || !node) return { x: node ? node.position.x : 0, y: node ? node.position.y : 0 };
    return { x: node.position.x + port.offsetLeft + port.offsetWidth / 2, y: node.position.y + port.offsetTop + port.offsetHeight / 2 };
  };

  Editor.prototype.edgeGeometry = function (source, target) {
    const bend = Math.max(70, Math.abs(target.x - source.x) * 0.45);
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
    viewport.zoom = Math.max(0.25, Math.min(2, Number(viewport.zoom || 0.8)));
    this.world.style.transform = "translate(" + viewport.x + "px," + viewport.y + "px) scale(" + viewport.zoom + ")";
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
    return this.graph.nodes.find(function (node) { return node.type === "generated" && node.data.isFinal; });
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

  Editor.prototype.save = async function () {
    const finalNode = this.finalNode();
    if (!finalNode || !this.imageForNode(finalNode) || this.invalidReferences(finalNode).length) return;
    this.saving = true; this.updateToolbar(); this.setStatus("正在保存画布和分镜图…", "loading");
    try {
      const graph = this.persistedGraph();
      let flowId = Number(this.row.flowId || 0);
      if (flowId) {
        await this.config.post("/api/production/editImage/updateImageFlow", { flowId: flowId, nodes: graph.nodes, edges: graph.edges });
      } else {
        const saved = apiData(await this.config.post("/api/production/editImage/saveImageFlow", { nodes: graph.nodes, edges: graph.edges })) || {};
        flowId = Number(saved.id || 0);
        if (!flowId) throw new Error("画布保存接口未返回 flowId");
      }
      const prompt = this.compiledPrompt(finalNode);
      await this.config.post("/api/production/storyboard/editStoryboardInfo", { id: Number(this.row.id), prompt: prompt, videoDesc: String(this.row.videoDesc || "") });
      await this.config.post("/api/production/storyboard/updateStoryboardUrl", { id: Number(this.row.id), url: this.imageForNode(finalNode), flowId: flowId });
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
    if (!force && this.dirty && !window.confirm("画布有未保存的修改，确认关闭吗？")) return false;
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
