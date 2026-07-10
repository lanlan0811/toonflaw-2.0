(function(){
  if (window.__TOONFLOW_SECONDARY_DEV_PATCH__) return;
  window.__TOONFLOW_SECONDARY_DEV_PATCH__ = true;

  const stateLabels = { idle:'未开始', ready:'可执行', generating:'生成中', success:'已完成', failed:'失败', partial:'部分完成' };
  const defaultStepConfigs = [
    {key:'polishOriginalAssetPrompts',label:'原始资产提示词',progressKey:'originalAssetPrompts',description:'润色并补全原始资产生成提示词。'},
    {key:'generateOriginalAssetImages',label:'原始资产图',progressKey:'originalAssetImages',description:'批量生成原始资产图片。'},
    {key:'generateDerivedAssets',label:'生成衍生资产',progressKey:'derivedAssets',description:'根据原始资产和分镜上下文创建衍生资产。'},
    {key:'polishDerivedAssetPrompts',label:'衍生资产提示词',progressKey:'derivedAssetPrompts',description:'润色并补全衍生资产生成提示词。'},
    {key:'generateDerivedAssetImages',label:'衍生资产图',progressKey:'derivedAssetImages',description:'批量生成衍生资产图片。'},
    {key:'generateStoryboardImages',label:'分镜图',progressKey:'storyboardImages',description:'根据分镜面板生成图片。'},
    {key:'generateVideoPrompts',label:'视频提示词',progressKey:'videoPrompts',description:'按轨道生成视频提示词。'},
    {key:'generateVideos',label:'视频',progressKey:'videos',description:'提交视频生成任务。'}
  ];
  const forceableStepKeys = ['generateOriginalAssetImages','generateDerivedAssets','generateDerivedAssetImages','generateStoryboardImages','generateVideos'];
  const scriptRequiredStepKeys = defaultStepConfigs.map(function(step){ return step.key; });
  let stepConfigs = defaultStepConfigs.slice();
  let parsedRows = [];
  let parsedMeta = {};
  let parsedAssetStats = {role:0,scene:0,tool:0,total:0};
  let selectedFile = null;
  let storyboardRows = [];
  let currentAssets = [];
  let currentScripts = [];
  let selectedStoryboardIds = [];
  let editingStoryboard = null;
  let editingAsset = null;
  let currentProjectId = null;
  let currentScriptId = null;
  let apiRoot = null;
  let apiRootPromise = null;
  let progressByTarget = {};
  let runningSteps = {};
  let progressRequests = {};
  let listRequest = null;
  let parseRequests = {};
  let commitRequests = {};
  let contextEpoch = 0;
  let newImportMode = false;
  let progressTimer = null;
  let listTimer = null;

  function el(tag, attrs, children){
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function(k){
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'on') Object.keys(attrs[k]).forEach(function(ev){ node.addEventListener(ev, attrs[k][ev]); });
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function(child){ node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child); });
    return node;
  }
  function $(id){ return document.getElementById(id); }
  function setStatus(id, msg, type){ const node=$(id); if(!node) return; node.className='tf-sd-status '+(type||''); node.textContent=msg||''; }
  function getToken(){ return localStorage.getItem('token') || localStorage.getItem('Authorization') || sessionStorage.getItem('token') || sessionStorage.getItem('Authorization') || ''; }
  function normalizeApiRoot(url){
    const value = String(url || '').trim().replace(/\/+$/, '');
    if (!value) throw new Error('未取得后端服务地址');
    return /\/api$/i.test(value) ? value : value + '/api';
  }
  function getApiRoot(){
    if (apiRoot) return Promise.resolve(apiRoot);
    if (apiRootPromise) return apiRootPromise;
    if (location.protocol !== 'file:') {
      apiRoot = normalizeApiRoot(location.origin);
      return Promise.resolve(apiRoot);
    }
    apiRootPromise = fetch('toonflow://getAppUrl').then(function(res){
      if (!res.ok) throw new Error('获取后端服务地址失败：'+res.status);
      return res.json();
    }).then(function(data){
      apiRoot = normalizeApiRoot(data && data.url);
      return apiRoot;
    }).catch(function(err){
      apiRootPromise = null;
      throw err;
    });
    return apiRootPromise;
  }
  function joinApiUrl(root, path){
    const value = String(path || '').trim();
    if (/^https?:\/\//i.test(value)) return value;
    const suffix = value.replace(/^\/?api(?:\/|$)/i, '').replace(/^\/+/, '');
    return root.replace(/\/+$/, '') + (suffix ? '/'+suffix : '');
  }
  async function post(url, body){
    const token = getToken();
    const headers = {'Content-Type':'application/json'};
    if (token) headers.authorization = token.startsWith('Bearer ') ? token : token;
    const root = await getApiRoot();
    const res = await fetch(joinApiUrl(root, url), {method:'POST', headers, body: JSON.stringify(body || {})});
    const data = await res.json().catch(function(){ return null; });
    if (!res.ok || (data && data.code && data.code !== 200)) throw new Error((data && (data.message || data.msg)) || ('请求失败：'+res.status));
    return data;
  }
  function getQueryNumber(names){
    const hash = location.hash || '';
    const search = location.search || '';
    const all = [search, hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''].join('&');
    for (const name of names) {
      const m = all.match(new RegExp('[?&#]'+name+'=([0-9]+)'));
      if (m) return Number(m[1]);
    }
    const path = (location.pathname + hash);
    for (const name of names) {
      const m = path.match(new RegExp(name+'[/=:-]([0-9]+)', 'i'));
      if (m) return Number(m[1]);
    }
    return null;
  }
  function clearProjectData(nextProjectId){
    contextEpoch += 1;
    parsedRows = [];
    parsedMeta = {};
    parsedAssetStats = {role:0,scene:0,tool:0,total:0};
    selectedFile = null;
    storyboardRows = [];
    currentAssets = [];
    currentScripts = [];
    selectedStoryboardIds = [];
    editingStoryboard = null;
    editingAsset = null;
    currentScriptId = null;
    progressByTarget = {};
    runningSteps = {};
    progressRequests = {};
    listRequest = null;
    parseRequests = {};
    commitRequests = {};
    ['tf-sd-file','tf-sm-file'].forEach(function(id){ if ($(id)) $(id).value = ''; });
    ['tf-sd-script-id','tf-sm-script-id'].forEach(function(id){ if ($(id)) $(id).value = ''; });
    ['tf-sd-preview','tf-sm-preview'].forEach(function(id){ if ($(id)) $(id).innerHTML = '<div class="tf-sd-help" style="padding:10px">暂无解析结果</div>'; });
    ['tf-sd-asset-stats','tf-sm-asset-stats'].forEach(function(id){ if ($(id)) $(id).innerHTML = ''; });
    ['tf-sd-warnings','tf-sm-warnings'].forEach(function(id){ if ($(id)) $(id).innerHTML = ''; });
    ['tf-sd-import-status','tf-sm-import-status','tf-sd-workflow-status','tf-sm-workflow-status'].forEach(function(id){ setStatus(id,''); });
    if ($('tf-sm-list')) $('tf-sm-list').innerHTML = '<div class="tf-sd-help" style="padding:10px">项目已变化，请重新加载分镜表</div>';
    if ($('tf-sm-assets')) $('tf-sm-assets').innerHTML = '<div class="tf-sd-help">项目已变化，请重新加载资产</div>';
    closeEditStoryboard();
    closeEditAsset();
    closeImagePreview();
    currentProjectId = nextProjectId || null;
    renderSteps(null);
    renderSteps(null, 'page');
    updateContextDisplay();
  }
  function setProjectContext(projectId){
    if (currentProjectId && currentProjectId !== projectId) {
      newImportMode = false;
      clearProjectData(projectId);
    }
    else currentProjectId = projectId;
    ['tf-sd-project-id','tf-sm-project-id'].forEach(function(id){ if ($(id) && Number($(id).value) !== projectId) $(id).value = String(projectId); });
    updateContextDisplay();
    return projectId;
  }
  function getProjectId(){
    const pageField = $('tf-sm-project-id');
    const legacyField = $('tf-sd-project-id');
    const primaryField = isStoryboardRoute() ? pageField : legacyField;
    const secondaryField = isStoryboardRoute() ? legacyField : pageField;
    const fieldValue = primaryField && primaryField.value ? primaryField.value : secondaryField && secondaryField.value ? secondaryField.value : '';
    const value = fieldValue ? Number(fieldValue) : getQueryNumber(['projectId','project','pid']);
    if(!value) throw new Error('请先选择或填写 projectId');
    return setProjectContext(value);
  }
  function clearBatchData(nextScriptId){
    const value = Number(nextScriptId);
    contextEpoch += 1;
    currentScriptId = value > 0 ? value : null;
    storyboardRows = [];
    currentAssets = [];
    selectedStoryboardIds = [];
    editingStoryboard = null;
    editingAsset = null;
    progressByTarget = {};
    runningSteps = {};
    progressRequests = {};
    listRequest = null;
    ['tf-sd-script-id','tf-sm-script-id'].forEach(function(id){ if ($(id)) $(id).value = currentScriptId ? String(currentScriptId) : ''; });
    if ($('tf-sm-list')) $('tf-sm-list').innerHTML = '<div class="tf-sd-help" style="padding:10px">批次已变化，正在加载分镜表...</div>';
    if ($('tf-sm-assets')) $('tf-sm-assets').innerHTML = '<div class="tf-sd-help">批次已变化，正在加载资产...</div>';
    setStatus('tf-sm-workflow-status','');
    closeEditStoryboard();
    closeEditAsset();
    closeImagePreview();
    renderSteps(null, 'page');
    renderSteps(null);
    updateContextDisplay();
  }
  function setCurrentScriptId(scriptId, options){
    const value = Number(scriptId);
    const nextScriptId = value > 0 ? value : null;
    const opts = options || {};
    if (nextScriptId !== currentScriptId && opts.clear !== false) clearBatchData(nextScriptId);
    else {
      currentScriptId = nextScriptId;
      ['tf-sd-script-id','tf-sm-script-id'].forEach(function(id){ if ($(id)) $(id).value = currentScriptId ? String(currentScriptId) : ''; });
      updateContextDisplay();
    }
    return currentScriptId;
  }
  function getScriptId(){
    if (newImportMode) return null;
    const pageNode = $('tf-sm-script-id');
    const legacyNode = $('tf-sd-script-id');
    const primaryNode = isStoryboardRoute() ? pageNode : legacyNode;
    const secondaryNode = isStoryboardRoute() ? legacyNode : pageNode;
    const inputValue = (primaryNode && primaryNode.value || secondaryNode && secondaryNode.value || '').trim();
    const queryProjectId = getQueryNumber(['projectId','project','pid']);
    const queryScriptId = !currentProjectId || !queryProjectId || queryProjectId === currentProjectId ? getQueryNumber(['scriptId','script','sid']) : null;
    const value = Number(inputValue || currentScriptId || queryScriptId);
    if (value > 0 && value !== currentScriptId) setCurrentScriptId(value);
    return currentScriptId;
  }
  function renderBatchOptions(scripts){
    const select = $('tf-sm-script-id');
    currentScripts = Array.isArray(scripts) ? scripts.slice() : [];
    if(!select) return currentScriptId;
    const availableIds = currentScripts.map(function(script){ return Number(script.id); }).filter(Boolean);
    let selectedId = currentScriptId && availableIds.includes(Number(currentScriptId)) ? Number(currentScriptId) : null;
    if (!selectedId && currentScripts.length === 1 && !newImportMode) selectedId = Number(currentScripts[0].id) || null;
    const options = ['<option value="">'+(currentScripts.length > 1 ? '请选择分镜表批次（必选）' : '暂无分镜表批次')+'</option>'].concat(currentScripts.map(function(script){
      const count = Number(script.storyboardCount || 0);
      return '<option value="'+script.id+'">'+escapeHtml(script.name || ('分镜表批次 '+script.id))+' · '+count+' 条</option>';
    }));
    select.innerHTML = options.join('');
    if (selectedId !== currentScriptId) setCurrentScriptId(selectedId);
    else {
      ['tf-sd-script-id','tf-sm-script-id'].forEach(function(id){ if ($(id)) $(id).value = selectedId ? String(selectedId) : ''; });
      updateContextDisplay();
    }
    return selectedId;
  }
  function getBatchBlockReason(){
    if (currentScriptId) return '';
    if (currentScripts.length > 1) return '当前项目有多个分镜表批次，请先选择批次，避免跨批次执行。';
    if (!currentScripts.length) return '当前项目还没有可用的分镜表批次，请先导入并提交分镜表。';
    return '请先选择当前分镜表批次。';
  }
  function contextText(){ return '项目 '+(currentProjectId || '未选择')+' · '+(newImportMode ? '新建分镜表模式（不关联现有批次）' : '当前 scriptId/批次 '+(currentScriptId || '未选择')); }
  function updateContextDisplay(){
    ['tf-sd-context','tf-sm-context'].forEach(function(id){ const node=$(id); if(node) node.textContent=contextText(); });
  }
  function statusWithContext(message){ return (message || '') + '（'+contextText()+'）'; }
  function handleProjectFieldChange(node){
    const value = Number(node && node.value);
    if (value > 0) setProjectContext(value);
  }
  function bindContextFields(prefix){
    const projectNode = $(prefix+'-project-id');
    const scriptNode = $(prefix+'-script-id');
    if (projectNode && !projectNode.__tfContextBound) {
      projectNode.__tfContextBound = true;
      projectNode.addEventListener('change', function(){ handleProjectFieldChange(projectNode); });
      projectNode.addEventListener('input', function(){
        const value = Number(projectNode.value);
        if (value > 0 && currentProjectId && value !== currentProjectId) clearProjectData(value);
      });
    }
    if (scriptNode && !scriptNode.__tfContextBound) {
      scriptNode.__tfContextBound = true;
      scriptNode.addEventListener('change', function(){
        newImportMode = false;
        setCurrentScriptId(scriptNode.value);
        if (scriptNode.id === 'tf-sm-script-id') {
          refreshStoryboardList({preserveBatch:true});
          refreshProgress('page');
        }
      });
    }
  }
  function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function isStoryboardRoute(){ return /storyboard-table|storyboardManage|storyboard-management/i.test(location.pathname + location.hash); }
  function guessIds(){
    const pid = getQueryNumber(['projectId','project','pid']);
    const sid = getQueryNumber(['scriptId','script','sid']);
    if (pid) {
      ['tf-sd-project-id','tf-sm-project-id'].forEach(function(id){ if ($(id)) $(id).value = String(pid); });
      setProjectContext(pid);
    }
    if (sid && !currentScriptId && !newImportMode) setCurrentScriptId(sid);
    else if (pid && currentProjectId === pid) updateContextDisplay();
  }
  function projectTypeLabel(type){ return type === 'storyboard' ? '基于分镜表' : type === 'novel' ? '基于小说原文' : '基于剧本'; }

  function renderPreview(rows, targetId){
    const box = $(targetId || 'tf-sd-preview'); if(!box) return;
    if (!rows.length) { box.innerHTML = '<div class="tf-sd-help" style="padding:10px">暂无解析结果</div>'; return; }
    const head = '<table class="tf-sd-table"><thead><tr><th>镜号</th><th>画面内容</th><th>时长</th><th>景别</th><th>镜头运动</th><th>场景/轨道</th><th>角色</th><th>道具</th><th>台词/旁白</th><th>音效/配乐</th><th>备注</th></tr></thead><tbody>';
    const body = rows.slice(0,80).map(function(r,i){
      return '<tr><td>'+escapeHtml(r.shotNo||i+1)+'</td><td>'+escapeHtml(r.visualContent||r.videoDesc||r.prompt||'')+'</td><td>'+escapeHtml(r.duration||'')+'</td><td>'+escapeHtml(r.shotSize||'')+'</td><td>'+escapeHtml(r.cameraMove||'')+'</td><td>'+escapeHtml(r.scene||r.track||'')+'</td><td>'+escapeHtml((r.roleNames||[]).join('、'))+'</td><td>'+escapeHtml((r.toolNames||[]).join('、'))+'</td><td>'+escapeHtml(r.dialogue||'')+'</td><td>'+escapeHtml(r.audio||'')+'</td><td>'+escapeHtml(r.remark||'')+'</td></tr>';
    }).join('');
    const foot = '</tbody></table>' + (rows.length>80?'<div class="tf-sd-help" style="padding:8px">仅展示前 80 条，共 '+rows.length+' 条</div>':'');
    box.innerHTML = head + body + foot;
  }

  function renderWarnings(warnings, targetId){
    const box = $(targetId); if(!box) return;
    box.innerHTML = (warnings || []).length ? warnings.map(function(item){ return '<div>'+escapeHtml(item)+'</div>'; }).join('') : '';
  }

  function readSelectedFile(){
    return new Promise(function(resolve, reject){
      if (!selectedFile) return resolve({});
      const reader = new FileReader();
      reader.onerror = function(){ reject(new Error('文件读取失败')); };
      reader.onload = function(){
        const name = selectedFile.name || '';
        const payload = {filename:name, mimeType:selectedFile.type || ''};
        if (/\.docx$/i.test(name)) payload.base64 = String(reader.result || '');
        else payload.content = String(reader.result || '');
        resolve(payload);
      };
      if (/\.docx$/i.test(selectedFile.name || '')) reader.readAsDataURL(selectedFile); else reader.readAsText(selectedFile, 'utf-8');
    });
  }

  function normalizeAssetStat(value){
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }
  function collectParsedAssetStats(rows, meta){
    const associatedIds = new Set();
    (rows || []).forEach(function(row){
      (row.associateAssetsIds || []).forEach(function(id){ const value=Number(id); if(value>0) associatedIds.add(value); });
    });
    const metaStats = meta && meta.assetStats;
    if (metaStats && typeof metaStats === 'object') {
      const role = normalizeAssetStat(typeof metaStats.roles !== 'undefined' ? metaStats.roles : metaStats.role);
      const scene = normalizeAssetStat(typeof metaStats.scenes !== 'undefined' ? metaStats.scenes : metaStats.scene);
      const tool = normalizeAssetStat(typeof metaStats.tools !== 'undefined' ? metaStats.tools : metaStats.tool);
      const total = normalizeAssetStat(metaStats.total) || role + scene + tool;
      return {role:role,scene:scene,tool:tool,total:total,associated:associatedIds.size};
    }
    const roleNames = new Set();
    const sceneNames = new Set();
    const toolNames = new Set();
    (meta && meta.roles || []).forEach(function(item){ if (item && item.name) roleNames.add(String(item.name).trim()); });
    (meta && meta.scenes || []).forEach(function(item){ if (item && item.name) sceneNames.add(String(item.name).trim()); });
    (rows || []).forEach(function(row){
      (row.roleNames || []).forEach(function(name){ if (name) roleNames.add(String(name).trim()); });
      (row.sceneNames || []).forEach(function(name){ if (name) sceneNames.add(String(name).trim()); });
      (row.toolNames || []).forEach(function(name){ if (name) toolNames.add(String(name).trim()); });
    });
    const total = roleNames.size+sceneNames.size+toolNames.size;
    return {role:roleNames.size,scene:sceneNames.size,tool:toolNames.size,total:total,associated:associatedIds.size};
  }
  function renderParsedAssetStats(prefix){
    const box = $(prefix+'-asset-stats'); if(!box) return;
    if (!parsedRows.length) { box.innerHTML = ''; return; }
    const warning = parsedAssetStats.total === 0;
    box.innerHTML = '<div class="tf-sm-parse-stats'+(warning?' warning':'')+'"><strong>解析资产统计</strong><span>角色 '+parsedAssetStats.role+'</span><span>场景 '+parsedAssetStats.scene+'</span><span>道具 '+parsedAssetStats.tool+'</span><span>合计 '+parsedAssetStats.total+'</span>'+(parsedAssetStats.associated?'<span>已有资产关联 '+parsedAssetStats.associated+'</span>':'')+'</div>'+(warning?'<div class="tf-sd-status warn tf-sm-block-warning">强警告：未解析到待创建的角色、场景或道具原始资产。纯文本分镜或已提供 associateAssetsIds 的数据仍可合法导入；提交前将再次请你确认。</div>':'');
  }
  function setImportBusy(prefix, kind, busy){
    const button = $(prefix+'-'+kind+'-button');
    if (!button) return;
    button.disabled = !!busy;
    button.textContent = busy ? (kind === 'parse' ? '正在解析...' : '正在提交...') : (kind === 'parse' ? '解析预览' : '确认导入分镜表');
  }
  async function parseStoryboard(target){
    const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
    const requestKey = target === 'page' ? 'page' : 'legacy';
    if (parseRequests[requestKey] || commitRequests[requestKey]) return;
    const requestEpoch = contextEpoch;
    const requestToken = {};
    parseRequests[requestKey] = requestToken;
    setImportBusy(prefix,'parse',true);
    if ($(prefix+'-commit-button')) $(prefix+'-commit-button').disabled = true;
    try{
      const filePayload = await readSelectedFile();
      const contentNode = $(prefix+'-import-content');
      const content = contentNode ? contentNode.value.trim() : '';
      if (!content && !filePayload.content && !filePayload.base64) throw new Error('请先粘贴内容或上传分镜表文件');
      setStatus(prefix+'-import-status','正在解析...');
      const formatNode = $(prefix+'-import-format');
      const body = Object.assign({format:(formatNode && formatNode.value) || 'auto'}, filePayload);
      if (content && !body.base64) body.content = content;
      const res = await post('/api/storyboardImport/parse', body);
      if (requestEpoch !== contextEpoch) return;
      parsedRows = (res.data && res.data.data) || [];
      parsedMeta = (res.data && res.data.meta) || {};
      parsedAssetStats = collectParsedAssetStats(parsedRows, parsedMeta);
      renderPreview(parsedRows, prefix+'-preview');
      renderWarnings((res.data && res.data.warnings) || [], prefix+'-warnings');
      renderParsedAssetStats(prefix);
      if (!parsedRows.length) throw new Error('未解析到有效分镜数据');
      if (!parsedAssetStats.total) setStatus(prefix+'-import-status','解析完成，但未发现待创建的原始资产。纯文本或已有资产关联仍可提交，请确认强警告。','warn');
      else setStatus(prefix+'-import-status','解析完成：'+parsedRows.length+' 条；原始资产 '+parsedAssetStats.total+' 个（角色 '+parsedAssetStats.role+' / 场景 '+parsedAssetStats.scene+' / 道具 '+parsedAssetStats.tool+'）','ok');
    }catch(e){ if (requestEpoch === contextEpoch) setStatus(prefix+'-import-status',e.message,'err'); }
    finally {
      if (parseRequests[requestKey] === requestToken) delete parseRequests[requestKey];
      if (requestEpoch === contextEpoch) setImportBusy(prefix,'parse',false);
      if (requestEpoch === contextEpoch) setImportBusy(prefix,'commit',false);
    }
  }

  async function commitStoryboard(target){
    const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
    const requestKey = target === 'page' ? 'page' : 'legacy';
    if (commitRequests[requestKey] || parseRequests[requestKey]) return;
    const requestEpoch = contextEpoch;
    const requestToken = {};
    commitRequests[requestKey] = requestToken;
    if ($(prefix+'-parse-button')) $(prefix+'-parse-button').disabled = true;
    setImportBusy(prefix,'commit',true);
    try{
      const projectId = getProjectId();
      if (!parsedRows.length) throw new Error('请先解析分镜表');
      if (!parsedAssetStats.total && !window.confirm('强警告：本次导入未解析到待创建的角色、场景或道具原始资产。\n\n若这是合法纯文本分镜，或分镜已通过 associateAssetsIds 关联现有资产，可以继续提交。是否确认继续？')) {
        setStatus(prefix+'-import-status','已取消提交；未解析到待创建的原始资产。','warn');
        return;
      }
      setStatus(prefix+'-import-status','正在提交入库...');
      const body = {projectId, data: parsedRows, meta: parsedMeta, options:{createScriptAssets:true,useReferenceAssetDescriptions:true,writeStoryboardIndex:true}};
      if (!newImportMode) {
        const sid = getScriptId();
        if (sid) body.scriptId = sid;
      }
      const scriptNameNode = $(prefix+'-script-name');
      const scriptName = scriptNameNode && scriptNameNode.value ? scriptNameNode.value.trim() : '';
      if (scriptName) body.scriptName = scriptName;
      const res = await post('/api/storyboardImport/commit', body);
      if (requestEpoch !== contextEpoch) return;
      const total = (res.data && res.data.total) || 0;
      const committedScriptId = res.data && res.data.scriptId;
      newImportMode = false;
      if (committedScriptId) setCurrentScriptId(committedScriptId, {clear:false});
      setStatus(prefix+'-import-status',statusWithContext('已提交入库：'+total+' 条分镜。注意：提交不等于图片/视频生产完成，请继续查看下方流程进度。'),'ok');
      await refreshStoryboardList({preserveBatch:true});
      await refreshProgress(target);
    }catch(e){ if (requestEpoch === contextEpoch) setStatus(prefix+'-import-status',e.message,'err'); }
    finally {
      if (commitRequests[requestKey] === requestToken) delete commitRequests[requestKey];
      if (requestEpoch === contextEpoch) setImportBusy(prefix,'parse',false);
      if (requestEpoch === contextEpoch) setImportBusy(prefix,'commit',false);
    }
  }

  async function loadConfig(target){
    try{
      const res = await post('/api/production/workflow/getConfig', {});
      const data = res && res.data;
      const serverSteps = data && Array.isArray(data.steps) ? data.steps : [];
      stepConfigs = defaultStepConfigs.map(function(fallback){
        const serverStep = serverSteps.find(function(step){ return step.key === fallback.key; }) || {};
        return Object.assign({}, serverStep, fallback);
      });
      renderSteps(progressByTarget[target === 'page' ? 'page' : 'legacy'] || null, target);
    }catch(e){
      stepConfigs = defaultStepConfigs.slice();
      renderSteps(progressByTarget[target === 'page' ? 'page' : 'legacy'] || null, target);
      setStatus((target === 'page' ? 'tf-sm' : 'tf-sd')+'-workflow-status',statusWithContext('流程配置加载失败，将使用内置配置：'+e.message),'warn');
    }
  }

  function getStepProgress(progress, step){
    if (!progress || !progress.steps) return null;
    let value = progress.steps[step.progressKey];
    if (!value && step.key === 'polishOriginalAssetPrompts') value = progress.steps.originalAssets;
    if (!value && step.key === 'polishDerivedAssetPrompts') value = progress.steps.derivedAssets;
    return value || null;
  }

  function progressCount(value, fallback){
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0,value) : Math.max(0,Number(fallback || 0));
  }
  function getStepMetrics(progress, step, compulsory, retryFailedOnly){
    const p = getStepProgress(progress, step) || {};
    const total = progressCount(p.total, 0);
    const completed = progressCount(p.success, typeof p.completed === 'boolean' ? (p.completed ? total : 0) : p.completed);
    const hasPendingCount = typeof p.pending === 'number' && Number.isFinite(p.pending);
    const pendingCount = hasPendingCount ? progressCount(p.pending,0) : 0;
    let generating = progressCount(typeof p.generating === 'boolean' ? undefined : p.generating, p.generating === true ? Math.max(1,total-completed-pendingCount) : 0);
    generating = Math.min(total || generating, generating);
    let failed = progressCount(typeof p.failed === 'boolean' ? undefined : p.failed, 0);
    if (p.failed === true && !failed) failed = Math.max(1,total-completed-pendingCount-generating);
    failed = Math.min(total || failed, failed);
    const pending = hasPendingCount ? pendingCount : Math.max(0,total-completed-failed-generating);
    const forceable = forceableStepKeys.includes(step.key);
    const serverRunnable = typeof p.runnable === 'boolean' ? p.runnable : progressCount(p.runnable,0) > 0;
    let runnable = typeof p.runnable === 'number' ? progressCount(p.runnable,0) : (serverRunnable ? Math.max(1,pending+failed) : 0);
    if (retryFailedOnly) runnable = failed;
    else if (compulsory && forceable) runnable = Math.max(0,total-generating);
    if (step.key === 'generateDerivedAssets') runnable = generating ? 0 : (retryFailedOnly ? failed : compulsory || serverRunnable || !total ? 1 : 0);
    let blockReason = String(p.blockReason || '');
    if (!getScriptId() && currentScripts.length > 1) blockReason = getBatchBlockReason();
    else if (scriptRequiredStepKeys.includes(step.key) && !getScriptId()) blockReason = getBatchBlockReason();
    else if (generating) blockReason = '已有任务生成中，请等待本步骤完成。';
    else if (retryFailedOnly && !failed) blockReason = '当前没有失败项可重试。';
    else if (compulsory && forceable && runnable) blockReason = '';
    else if (!runnable && !blockReason) {
      if (!total && step.key !== 'generateDerivedAssets') blockReason = '当前批次没有该步骤可处理的对象。';
      else if (completed === total && total) blockReason = '全部对象已完成；如需重做，请启用“强制重生成”。';
      else blockReason = '当前没有可执行对象。';
    }
    return {progress:p,total:total,completed:completed,failed:failed,generating:generating,pending:pending,runnable:Math.max(0,runnable),blockReason:blockReason};
  }

  function runningStepKey(step, target){
    return [target === 'page' ? 'page' : 'legacy', currentProjectId || 'none', currentScriptId || 'all', step].join(':');
  }

  function renderSteps(progress, target){
    const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
    const box = $(prefix+'-steps'); if(!box) return;
    const compulsory = !!(($(prefix+'-compulsory')||{}).checked);
    const retryFailedOnly = !!(($(prefix+'-retry-failed-only')||{}).checked);
    box.innerHTML = '';
    stepConfigs.forEach(function(step){
      const metrics = getStepMetrics(progress, step, compulsory, retryFailedOnly);
      const st = metrics.progress.state || 'idle';
      const runningKey = runningStepKey(step.key, target);
      const isRunning = !!runningSteps[runningKey];
      const generating = st === 'generating' || metrics.generating > 0 || isRunning;
      const forceable = forceableStepKeys.includes(step.key);
      const disabled = generating || !!metrics.blockReason || (!metrics.runnable && !(compulsory && forceable));
      const button = el('button',{class:'tf-sd-btn tf-sd-mini primary',text:generating?'执行中':'执行',title:metrics.blockReason || ('可执行 '+metrics.runnable+' 项'),on:{click:function(){ runStep(step.key, target); }}});
      button.disabled = disabled;
      if (disabled) button.setAttribute('aria-disabled','true');
      const metricItems = [
        'total '+metrics.total,
        'completed '+metrics.completed,
        'failed '+metrics.failed,
        'generating '+metrics.generating,
        'runnable '+metrics.runnable
      ];
      const item = el('div',{class:'tf-sd-step'+(metrics.blockReason?' blocked':'')},[
        el('div',{class:'tf-sd-step-main'},[
          el('div',{class:'tf-sd-step-name',text:step.label || step.key}),
          el('div',{class:'tf-sd-step-desc',text:step.description || ''}),
          el('div',{class:'tf-sd-step-metrics'},metricItems.map(function(text){ return el('span',{text:text}); })),
          metrics.blockReason ? el('div',{class:'tf-sd-step-block',text:'blockReason：'+metrics.blockReason}) : el('span',{})
        ]),
        el('div',{class:'tf-sd-step-actions'},[
          el('span',{class:'tf-sd-chip '+st,text:stateLabels[st] || st}),
          button
        ])
      ]);
      box.appendChild(item);
    });
  }

  async function refreshProgress(target, options){
    const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
    const targetKey = target === 'page' ? 'page' : 'legacy';
    const opts = options || {};
    let projectId;
    try { projectId = getProjectId(); }
    catch (e) { if (!opts.silent) setStatus(prefix+'-workflow-status',e.message,'err'); return null; }
    const sid = getScriptId();
    const requestKey = [targetKey,projectId,sid || 'all',contextEpoch].join(':');
    if (progressRequests[requestKey]) return progressRequests[requestKey].promise;
    const requestEpoch = contextEpoch;
    const requestToken = {};
    if (!opts.silent) setStatus(prefix+'-workflow-status',statusWithContext('正在读取流程状态...'));
    const requestPromise = post('/api/production/workflow/getProgress', sid ? {projectId:projectId,scriptId:sid} : {projectId:projectId}).then(function(res){
      if (requestEpoch !== contextEpoch || currentProjectId !== projectId || getScriptId() !== sid) return null;
      progressByTarget[targetKey] = res.data || null;
      if (res.data && res.data.scriptId && !currentScriptId && !newImportMode) setCurrentScriptId(res.data.scriptId, {clear:false});
      renderSteps(progressByTarget[targetKey], target);
      const statusNode = $(prefix+'-workflow-status');
      if (!opts.silent && statusNode && statusNode.textContent.indexOf('正在读取流程状态...') === 0) setStatus(prefix+'-workflow-status','');
      return res.data;
    }).catch(function(e){
      if (requestEpoch === contextEpoch) setStatus(prefix+'-workflow-status',statusWithContext(e.message),'err');
      return null;
    }).finally(function(){ if (progressRequests[requestKey] === requestToken) delete progressRequests[requestKey]; });
    requestToken.promise = requestPromise;
    progressRequests[requestKey] = requestToken;
    return requestPromise;
  }

  async function runStep(step, target, options){
    const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
    const opts = options || {};
    const itemIds = Array.isArray(opts.itemIds) ? opts.itemIds.map(Number).filter(Boolean) : [];
    let projectId;
    try { projectId = getProjectId(); }
    catch (e) { setStatus(prefix+'-workflow-status',e.message,'err'); if (opts.throwOnError) throw e; return {ok:false,error:e}; }
    const sid = getScriptId();
    if ((!sid && currentScripts.length > 1) || (scriptRequiredStepKeys.includes(step) && !sid)) {
      const error = new Error(getBatchBlockReason());
      setStatus(prefix+'-workflow-status',statusWithContext(error.message),'err');
      renderSteps(progressByTarget[target === 'page' ? 'page' : 'legacy'] || null, target);
      if (opts.throwOnError) throw error;
      return {ok:false,error:error};
    }
    const runningKey = [target === 'page' ? 'page' : 'legacy',projectId,sid || 'all',step].join(':');
    if (runningSteps[runningKey]) return {ok:false,error:new Error('该步骤正在执行中')};
    const requestEpoch = contextEpoch;
    const requestContext = {epoch:requestEpoch,projectId:projectId,scriptId:sid};
    const runToken = {};
    function contextChanged(){ return requestContext.epoch !== contextEpoch || currentProjectId !== requestContext.projectId || getScriptId() !== requestContext.scriptId; }
    runningSteps[runningKey] = runToken;
    renderSteps(progressByTarget[target === 'page' ? 'page' : 'legacy'] || null, target);
    try{
      const body = {projectId, step};
      if (sid) body.scriptId = sid;
      body.concurrentCount = Number(($(prefix+'-concurrent-count')||{}).value || 5);
      body.groupSize = Number(($(prefix+'-group-size')||{}).value || 5);
      body.compulsory = typeof opts.compulsory === 'boolean' ? opts.compulsory : !!(($(prefix+'-compulsory')||{}).checked);
      body.audio = !!(($(prefix+'-audio')||{}).checked);
      body.retryFailedOnly = typeof opts.retryFailedOnly === 'boolean' ? opts.retryFailedOnly : !!(($(prefix+'-retry-failed-only')||{}).checked);
      if (itemIds.length) body.itemIds = itemIds;
      setStatus(prefix+'-workflow-status',statusWithContext('正在提交步骤：'+step+' ...'));
      const res = await post('/api/production/workflow/runStep', body);
      if (contextChanged()) return {ok:false,aborted:true,error:new Error('上下文已切换，已终止后续操作')};
      const info = res.data || {};
      const preparedTotal = Number(info.prepared && info.prepared.total || 0);
      if (info.status === 'skipped') {
        const error = new Error(info.reason || '没有可执行对象');
        setStatus(prefix+'-workflow-status',statusWithContext('未启动：'+error.message+'；runnable '+preparedTotal),'warn');
        return {ok:false,skipped:true,error:error,data:info};
      }
      setStatus(prefix+'-workflow-status',statusWithContext('已提交生产任务：'+step+'；runnable '+preparedTotal+'。提交不等于完成，请查看步骤统计。'),'ok');
      await refreshStoryboardList({preserveBatch:true,silent:true});
      if (contextChanged()) return {ok:false,aborted:true,error:new Error('上下文已切换，已终止后续操作')};
      await refreshProgress(target, {silent:true});
      return {ok:true,data:info};
    }catch(e){
      if (!contextChanged()) setStatus(prefix+'-workflow-status',statusWithContext(e.message),'err');
      if (opts.throwOnError) throw e;
      return {ok:false,error:e,aborted:contextChanged()};
    }
    finally {
      if (runningSteps[runningKey] === runToken) delete runningSteps[runningKey];
      if (!contextChanged()) renderSteps(progressByTarget[target === 'page' ? 'page' : 'legacy'] || null, target);
    }
  }

  async function refreshStoryboardList(options){
    const box = $('tf-sm-list');
    if (!box) return null;
    const opts = options || {};
    let projectId;
    try { projectId = getProjectId(); }
    catch (e) { if (!opts.silent) box.innerHTML = '<div class="tf-sd-status err" style="padding:12px">'+escapeHtml(e.message)+'</div>'; return null; }
    const keyword = (($('tf-sm-search')||{}).value || '').trim();
    const sid = getScriptId();
    const requestEpoch = contextEpoch;
    const requestKey = [projectId,sid || 'all',keyword,requestEpoch].join(':');
    if (listRequest && listRequest.key === requestKey) return listRequest.promise;
    if (!opts.silent) box.innerHTML = '<div class="tf-sd-help" style="padding:12px">正在加载分镜表（'+escapeHtml(contextText())+'）...</div>';
    const requestBody = {projectId, keyword, page:1, pageSize:200};
    if (sid) requestBody.scriptId = sid;
    const promise = post('/api/storyboardImport/list', requestBody).then(async function(res){
      if (requestEpoch !== contextEpoch) return null;
      let rows = (res.data && res.data.data) || [];
      const assets = (res.data && res.data.assets) || [];
      const scripts = (res.data && res.data.scripts) || [];
      const previousSid = sid;
      const selectedSid = renderBatchOptions(scripts);
      if (!previousSid && selectedSid && scripts.length === 1 && !opts.preserveBatch) {
        const refreshed = await refreshStoryboardList({preserveBatch:true,silent:opts.silent});
        if (currentScriptId === selectedSid) await refreshProgress('page', {silent:true});
        return refreshed;
      }
      if (!selectedSid && scripts.length > 1) rows = [];
      else if (selectedSid) rows = rows.filter(function(row){ return Number(row.scriptId) === selectedSid; });
      const visibleAssets = !selectedSid && scripts.length > 1 ? [] : assets;
      storyboardRows = rows;
      currentAssets = visibleAssets;
      selectedStoryboardIds = selectedStoryboardIds.filter(function(id){ return rows.some(function(row){ return row.id === id; }); });
      renderStoryboardList(rows);
      if (!selectedSid && scripts.length > 1) {
        const assetBox = $('tf-sm-assets');
        if (assetBox) assetBox.innerHTML = '<div class="tf-sm-batch-block"><strong>资产已隐藏</strong><div>'+escapeHtml(getBatchBlockReason())+'</div></div>';
      } else renderAssets(visibleAssets);
      renderSteps(progressByTarget.page || null, 'page');
      return res.data;
    }).catch(function(e){
      if (requestEpoch === contextEpoch) box.innerHTML = '<div class="tf-sd-status err" style="padding:12px">'+escapeHtml(e.message)+'</div>';
      return null;
    }).finally(function(){ if (listRequest && listRequest.key === requestKey) listRequest = null; });
    listRequest = {key:requestKey,promise:promise};
    return promise;
  }

  function storyboardAssetMarkup(assets){
    if (!(assets || []).length) return '<span class="tf-sd-help">无关联资产</span>';
    return '<div class="tf-sm-story-assets">'+assets.map(function(relationAsset){
      const fullAsset = currentAssets.find(function(item){ return Number(item.id) === Number(relationAsset.id); }) || relationAsset;
      const derived = !!fullAsset.assetsId;
      const typeLabel = {role:'角色',scene:'场景',tool:'道具'}[fullAsset.type] || fullAsset.type || '资产';
      return '<span class="tf-sm-asset-badge '+(derived?'derived':'original')+'" title="'+(derived?'衍生资产':'原始资产')+'">'+escapeHtml(fullAsset.name || '')+' · '+escapeHtml(typeLabel)+' · '+(derived?'衍生':'原始')+'</span>';
    }).join('')+'</div>';
  }

  function renderStoryboardList(rows){
    const box = $('tf-sm-list'); if(!box) return;
    if (!getScriptId() && currentScripts.length > 1) { box.innerHTML = '<div class="tf-sm-batch-block"><strong>请选择分镜表批次</strong><div>'+escapeHtml(getBatchBlockReason())+'</div></div>'; return; }
    if(!rows.length){ box.innerHTML = '<div class="tf-sd-empty">暂无分镜表数据</div>'; return; }
    const allChecked = rows.length && rows.every(function(row){ return selectedStoryboardIds.includes(row.id); });
    const toolbar = '<div class="tf-sm-table-actions"><button class="tf-sd-btn tf-sd-mini warn" data-action="bulk-delete" '+(!selectedStoryboardIds.length?'disabled':'')+'>批量删除</button><span class="tf-sd-help">已选择 '+selectedStoryboardIds.length+' 条</span></div>';
    const head = '<table class="tf-sd-table tf-sm-main-table"><thead><tr><th><input type="checkbox" data-action="toggle-all" '+(allChecked?'checked':'')+'></th><th>缩略图</th><th>镜号 / 画面内容</th><th>时长</th><th>场景/轨道</th><th>关联资产</th><th>分镜图状态 / 原因</th><th>操作</th></tr></thead><tbody>';
    const body = rows.map(function(r,i){
      const shot = (r.videoDesc || '').match(/镜号[:：]\s*([^\n]+)/);
      const checked = selectedStoryboardIds.includes(r.id) ? 'checked' : '';
      const failed = isFailedState(r.state);
      const success = isSuccessState(r.state);
      const generating = isGeneratingState(r.state);
      const src = String(r.src || '').trim();
      const thumbnail = src ? '<button class="tf-sm-story-thumb" data-action="preview-storyboard" data-id="'+r.id+'" title="查看分镜图"><img src="'+escapeHtml(src)+'" alt="分镜 '+escapeHtml(r.index || i+1)+'" loading="lazy"></button>' : '<div class="tf-sm-story-thumb placeholder">暂无图片</div>';
      const stateClass = failed?'failed':success?'success':generating?'generating':'idle';
      const reason = r.reason ? '<div class="tf-sm-story-reason" title="'+escapeHtml(r.reason)+'">'+escapeHtml(r.reason)+'</div>' : '';
      const generateImage = Number(r.shouldGenerateImage) !== 0;
      const generateButton = generateImage && !success && !failed ? '<button class="tf-sd-btn tf-sd-mini primary" data-action="generate-image" data-id="'+r.id+'" '+(generating?'disabled':'')+'>'+(generating?'生成中':'生成分镜图')+'</button>' : '';
      const retryButton = generateImage && failed ? '<button class="tf-sd-btn tf-sd-mini primary" data-action="retry-image" data-id="'+r.id+'">失败重试</button>' : '';
      const forceButton = '<button class="tf-sd-btn tf-sd-mini warn" data-action="force-image" data-id="'+r.id+'" '+(generating?'disabled':'')+'>'+(generateImage?'强制重生':'强制生成')+'</button>';
      return '<tr><td><input type="checkbox" data-action="toggle-one" data-id="'+r.id+'" '+checked+'></td><td>'+thumbnail+'</td><td><div class="tf-sm-shot-no">'+escapeHtml(r.index || (shot && shot[1]) || i+1)+'</div><div class="tf-sm-story-desc">'+escapeHtml(r.videoDesc || r.prompt || '')+'</div></td><td>'+escapeHtml(r.duration || '')+'</td><td>'+escapeHtml(r.track || '')+'</td><td>'+storyboardAssetMarkup(r.assets||[])+'</td><td><span class="tf-sd-chip '+stateClass+'">'+escapeHtml(r.state || '未生成')+'</span>'+reason+'</td><td><div class="tf-sm-row-actions"><button class="tf-sd-btn tf-sd-mini" data-action="edit" data-id="'+r.id+'">编辑关联</button>'+generateButton+retryButton+forceButton+'<button class="tf-sd-btn tf-sd-mini warn" data-action="delete" data-id="'+r.id+'">删除</button></div></td></tr>';
    }).join('');
    box.innerHTML = toolbar + head + body + '</tbody></table>';
    bindStoryboardListActions(box);
  }

  function bindStoryboardListActions(box){
    box.querySelectorAll('[data-action]').forEach(function(node){
      node.addEventListener('click', function(e){
        const action = node.getAttribute('data-action');
        const id = Number(node.getAttribute('data-id'));
        if (action === 'edit') openEditStoryboard(id);
        if (action === 'preview-storyboard') {
          const row = storyboardRows.find(function(item){ return item.id === id; });
          if (row) openImagePreview(row.src, '分镜 '+(row.index || row.id));
        }
        if (action === 'generate-image') runStep('generateStoryboardImages','page',{itemIds:[id],retryFailedOnly:false,compulsory:false});
        if (action === 'retry-image') runStep('generateStoryboardImages','page',{itemIds:[id],retryFailedOnly:true,compulsory:false});
        if (action === 'force-image') runStep('generateStoryboardImages','page',{itemIds:[id],retryFailedOnly:false,compulsory:true});
        if (action === 'delete') deleteStoryboards([id]);
        if (action === 'bulk-delete') deleteStoryboards(selectedStoryboardIds.slice());
      });
      node.addEventListener('change', function(){
        const action = node.getAttribute('data-action');
        const id = Number(node.getAttribute('data-id'));
        if (action === 'toggle-one') toggleStoryboardSelection(id, node.checked);
        if (action === 'toggle-all') toggleAllStoryboardSelection(node.checked);
      });
    });
  }

  function toggleStoryboardSelection(id, checked){
    if (!id) return;
    selectedStoryboardIds = checked ? Array.from(new Set(selectedStoryboardIds.concat(id))) : selectedStoryboardIds.filter(function(item){ return item !== id; });
    renderStoryboardList(storyboardRows);
  }

  function toggleAllStoryboardSelection(checked){
    selectedStoryboardIds = checked ? storyboardRows.map(function(row){ return row.id; }).filter(Boolean) : [];
    renderStoryboardList(storyboardRows);
  }

  async function deleteStoryboards(ids){
    try{
      if (!ids.length) throw new Error('请先选择分镜');
      if (!window.confirm('确认删除选中的 '+ids.length+' 条分镜吗？')) return;
      const projectId = getProjectId();
      await post('/api/storyboardImport/delete', {projectId, ids});
      selectedStoryboardIds = selectedStoryboardIds.filter(function(id){ return !ids.includes(id); });
      await refreshStoryboardList();
      await refreshProgress('page');
    }catch(e){ window.$message ? window.$message.error(e.message) : alert(e.message); }
  }

  function openEditStoryboard(id){
    editingStoryboard = storyboardRows.find(function(row){ return row.id === id; });
    if (!editingStoryboard) return;
    const dialog = $('tf-sm-edit-dialog');
    if (!dialog) return;
    $('tf-sm-edit-prompt').value = editingStoryboard.prompt || '';
    $('tf-sm-edit-video-desc').value = editingStoryboard.videoDesc || '';
    $('tf-sm-edit-duration').value = editingStoryboard.duration || 3;
    $('tf-sm-edit-track').value = editingStoryboard.track || '默认分组';
    $('tf-sm-edit-generate-image').checked = Number(editingStoryboard.shouldGenerateImage) !== 0;
    renderEditAssetOptions(editingStoryboard.assets || []);
    dialog.classList.add('open');
  }

  function closeEditStoryboard(){
    editingStoryboard = null;
    const dialog = $('tf-sm-edit-dialog');
    if (dialog) dialog.classList.remove('open');
  }

  function renderEditAssetOptions(selectedAssets){
    const box = $('tf-sm-edit-assets'); if(!box) return;
    const selectedIds = (selectedAssets || []).map(function(asset){ return asset.id; });
    if (!currentAssets.length) { box.innerHTML = '<div class="tf-sd-help">暂无可关联资产</div>'; return; }
    box.innerHTML = currentAssets.map(function(asset){
      const checked = selectedIds.includes(asset.id) ? 'checked' : '';
      return '<label class="tf-sm-asset-option"><input type="checkbox" value="'+asset.id+'" '+checked+'> <span>'+escapeHtml(asset.name)+' · '+escapeHtml(asset.type || '')+'</span></label>';
    }).join('');
  }

  async function saveStoryboardEdit(){
    try{
      if (!editingStoryboard) throw new Error('没有正在编辑的分镜');
      const projectId = getProjectId();
      const assetIds = Array.from(document.querySelectorAll('#tf-sm-edit-assets input:checked')).map(function(node){ return Number(node.value); }).filter(Boolean);
      const body = {
        id: editingStoryboard.id,
        projectId,
        prompt: $('tf-sm-edit-prompt').value.trim() || '分镜',
        videoDesc: $('tf-sm-edit-video-desc').value.trim() || $('tf-sm-edit-prompt').value.trim() || '分镜',
        duration: Number($('tf-sm-edit-duration').value || 3),
        track: $('tf-sm-edit-track').value.trim() || '默认分组',
        shouldGenerateImage: $('tf-sm-edit-generate-image').checked ? 1 : 0,
        associateAssetsIds: assetIds
      };
      await post('/api/storyboardImport/update', body);
      closeEditStoryboard();
      await refreshStoryboardList();
      await refreshProgress('page');
    }catch(e){ setStatus('tf-sm-edit-status', e.message, 'err'); }
  }

  function isFailedState(state){ return state === '生成失败' || state === '失败' || state === 'failed'; }
  function isGeneratingState(state){ return state === '生成中' || state === 'generating'; }
  function isSuccessState(state){ return state === '已完成' || state === '生成成功' || state === 'success'; }

  function renderAssets(assets){
    const box = $('tf-sm-assets'); if(!box) return;
    if(!assets.length){ box.innerHTML = '<div class="tf-sd-empty">暂无资产，导入分镜表后会自动生成角色、场景、道具。</div>'; return; }
    const title = {role:'角色资产',scene:'场景资产',tool:'道具资产',other:'其他资产'};
    function renderSection(sectionTitle, list){
      if (!list.length) return '<div class="tf-sm-asset-group"><h4>'+sectionTitle+'</h4><div class="tf-sd-help">暂无数据</div></div>';
      const groups = list.reduce(function(result, asset){ const type = asset.type || 'other'; (result[type] = result[type] || []).push(asset); return result; }, {});
      return '<div class="tf-sm-asset-group"><h4>'+sectionTitle+'</h4>'+Object.keys(groups).map(function(type){
        return '<div class="tf-sd-help tf-sm-asset-type">'+escapeHtml(title[type] || type)+'</div><div class="tf-sm-assets-grid">'+groups[type].map(function(asset){
          const promptState = asset.promptState || (asset.prompt ? '已完成' : '未生成');
          const imageState = asset.imageState || (asset.src ? '已完成' : '未生成');
          const promptFailed = isFailedState(promptState);
          const imageFailed = isFailedState(imageState);
          const promptGenerating = isGeneratingState(promptState);
          const imageGenerating = isGeneratingState(imageState);
          const promptSuccess = isSuccessState(promptState);
          const imageSuccess = isSuccessState(imageState);
          const src = String(asset.src || '').trim();
          const image = src ? '<button class="tf-sm-asset-thumb" data-action="preview-asset" data-id="'+asset.id+'" title="点击查看大图"><img src="'+escapeHtml(src)+'" alt="'+escapeHtml(asset.name || '资产图片')+'" loading="lazy"></button>' : '<div class="tf-sm-asset-thumb placeholder"><span>暂无图片</span></div>';
          const promptButtonText = promptGenerating ? '生成中' : promptFailed ? '重试提示词' : promptSuccess ? '重新生成提示词' : '生成提示词';
          const imageButtonText = imageGenerating ? '生成中' : imageFailed ? '重试图片' : imageSuccess ? '重新生成图片' : '生成图片';
          const imageDisabled = imageGenerating || (!asset.assetsId && !asset.prompt);
          const imageHint = !asset.prompt
            ? asset.assetsId
              ? '<div class="tf-sm-auto-prompt-note">暂无 prompt，点击生成图片时会由图片任务自动生成。</div>'
              : '<div class="tf-sm-auto-prompt-note">原始资产需要先生成或填写 prompt，才能生成图片。</div>'
            : '';
          return '<div class="tf-sm-asset-card">'+image+'<div class="tf-sm-asset-content"><div class="tf-sm-asset-title">'+escapeHtml(asset.name)+'</div><div class="tf-sm-asset-label">描述</div><div class="tf-sm-asset-desc">'+escapeHtml(asset.describe || '暂无描述')+'</div><div class="tf-sm-asset-label">提示词</div><div class="tf-sm-asset-prompt">'+escapeHtml(asset.prompt || '暂无提示词')+'</div>'+imageHint+'<div class="tf-sm-asset-states"><span>提示词：'+escapeHtml(promptState)+'</span><span>图片：'+escapeHtml(imageState)+'</span></div>'+(asset.promptErrorReason?'<div class="tf-sd-status err">提示词：'+escapeHtml(asset.promptErrorReason)+'</div>':'')+(asset.imageErrorReason?'<div class="tf-sd-status err">图片：'+escapeHtml(asset.imageErrorReason)+'</div>':'')+'<div class="tf-sm-asset-actions"><button class="tf-sd-btn tf-sd-mini" data-action="edit-asset" data-id="'+asset.id+'">编辑</button><button class="tf-sd-btn tf-sd-mini primary" data-action="asset-prompt" data-id="'+asset.id+'" '+(promptGenerating?'disabled':'')+'>'+promptButtonText+'</button><button class="tf-sd-btn tf-sd-mini primary" data-action="asset-image" data-id="'+asset.id+'" '+(imageDisabled?'disabled':'')+' title="'+(!asset.prompt?(asset.assetsId?'将由图片任务自动生成提示词，再生成图片':'请先生成或填写原始资产提示词'):'生成资产图片')+'">'+imageButtonText+'</button></div></div></div>';
        }).join('')+'</div>';
      }).join('')+'</div>';
    }
    box.innerHTML = renderSection('原始资产', assets.filter(function(asset){ return !asset.assetsId; })) + renderSection('衍生资产', assets.filter(function(asset){ return !!asset.assetsId; }));
    box.querySelectorAll('[data-action]').forEach(function(node){
      node.addEventListener('click', function(){
        const asset = currentAssets.find(function(item){ return item.id === Number(node.getAttribute('data-id')); });
        if (!asset) return;
        const action = node.getAttribute('data-action');
        if (action === 'preview-asset') openImagePreview(asset.originalSrc || asset.src, asset.name);
        if (action === 'edit-asset') openEditAsset(asset.id);
        if (action === 'asset-prompt') runAssetStep(asset, 'prompt');
        if (action === 'asset-image') runAssetStep(asset, 'image');
      });
    });
  }

  function assertRunContext(context){
    if (context.epoch !== contextEpoch || currentProjectId !== context.projectId || getScriptId() !== context.scriptId) throw new Error('上下文已切换，已终止自动串联');
  }

  async function runAssetStep(asset, kind){
    const derived = !!asset.assetsId;
    const step = kind === 'prompt' ? (derived ? 'polishDerivedAssetPrompts' : 'polishOriginalAssetPrompts') : (derived ? 'generateDerivedAssetImages' : 'generateOriginalAssetImages');
    const state = kind === 'prompt' ? (asset.promptState || (asset.prompt ? '已完成' : '未生成')) : (asset.imageState || (asset.src ? '已完成' : '未生成'));
    const runContext = {epoch:contextEpoch,projectId:currentProjectId,scriptId:getScriptId()};
    const actionKey = ['asset',runContext.projectId || 'none',runContext.scriptId || 'all',asset.id,kind].join(':');
    if (runningSteps[actionKey]) return;
    const actionToken = {};
    runningSteps[actionKey] = actionToken;
    try {
      assertRunContext(runContext);
      let runnableAsset = asset;
      if (kind === 'image' && !asset.prompt && derived) {
        setStatus('tf-sm-workflow-status',statusWithContext('衍生资产“'+(asset.name || asset.id)+'”暂无 prompt，将由图片任务自动生成提示词并继续生成图片。'),'warn');
      }
      const latestState = kind === 'image' ? (runnableAsset.imageState || (runnableAsset.src ? '已完成' : '未生成')) : state;
      const imageResult = await runStep(step, 'page', {itemIds:[asset.id], retryFailedOnly:isFailedState(latestState), compulsory:isSuccessState(latestState),throwOnError:true});
      if (!imageResult.ok) throw imageResult.error || new Error('资产步骤未启动');
    } catch (e) {
      if (runContext.epoch === contextEpoch) setStatus('tf-sm-workflow-status',statusWithContext(e.message),'err');
    } finally {
      if (runningSteps[actionKey] === actionToken) delete runningSteps[actionKey];
    }
  }

  function openEditAsset(id){
    editingAsset = currentAssets.find(function(asset){ return asset.id === id; }) || null;
    const dialog = $('tf-sm-asset-edit-dialog');
    if (!editingAsset || !dialog) return;
    $('tf-sm-asset-edit-describe').value = editingAsset.describe || '';
    $('tf-sm-asset-edit-prompt').value = editingAsset.prompt || '';
    setStatus('tf-sm-asset-edit-status','');
    dialog.classList.add('open');
  }

  function closeEditAsset(){
    editingAsset = null;
    const dialog = $('tf-sm-asset-edit-dialog');
    if (dialog) dialog.classList.remove('open');
  }

  async function saveAssetEdit(){
    try{
      if (!editingAsset) throw new Error('没有正在编辑的资产');
      const projectId = getProjectId();
      const scriptId = getScriptId();
      if (!scriptId) throw new Error('请先选择当前分镜表批次');
      await post('/api/storyboardImport/updateAsset', {
        projectId,
        scriptId,
        id: editingAsset.id,
        describe: $('tf-sm-asset-edit-describe').value.trim(),
        prompt: $('tf-sm-asset-edit-prompt').value.trim()
      });
      closeEditAsset();
      await refreshStoryboardList();
      await refreshProgress('page');
    }catch(e){ setStatus('tf-sm-asset-edit-status',e.message,'err'); }
  }

  function openImagePreview(src, title){
    if (!src) return;
    const dialog = $('tf-sm-image-preview');
    if (!dialog) return;
    $('tf-sm-image-preview-img').src = src;
    $('tf-sm-image-preview-img').alt = title || '资产大图';
    $('tf-sm-image-preview-title').textContent = title || '图片预览';
    dialog.classList.add('open');
  }

  function closeImagePreview(){
    const dialog = $('tf-sm-image-preview');
    if (dialog) dialog.classList.remove('open');
    const image = $('tf-sm-image-preview-img');
    if (image) image.removeAttribute('src');
  }

  function startNewStoryboardImport(){
    newImportMode = true;
    setCurrentScriptId(null);
    parsedRows = [];
    parsedMeta = {};
    parsedAssetStats = {role:0,scene:0,tool:0,total:0};
    selectedFile = null;
    if ($('tf-sm-file')) $('tf-sm-file').value = '';
    if ($('tf-sm-script-name')) $('tf-sm-script-name').value = '';
    if ($('tf-sm-import-content')) $('tf-sm-import-content').value = '';
    renderPreview([], 'tf-sm-preview');
    renderWarnings([], 'tf-sm-warnings');
    renderParsedAssetStats('tf-sm');
    setImportBusy('tf-sm','commit',false);
    setStatus('tf-sm-import-status','已开始新建分镜表，请填写名称并导入内容。','ok');
    $('tf-sm-import-section').scrollIntoView({behavior:'smooth',block:'start'});
  }

  function field(label,type,id,placeholder,options){
    let input;
    if (type === 'textarea') input = el('textarea',{id:id,placeholder:placeholder||''});
    else if (type === 'select') input = el('select',{id:id},(options||[]).map(function(v){return el('option',{value:v,text:v});}));
    else input = el('input',{id:id,placeholder:placeholder||'',value:placeholder && /^\d+$/.test(placeholder) ? placeholder : ''});
    return el('div',{class:'tf-sd-field'},[el('label',{text:label}), input]);
  }

  function buildImportSection(prefix, withFile){
    const children = [
      el('h3',{text:'1. 新建分镜表'}),
      el('div',{class:'tf-sd-help',html:'支持 TXT 标准格式、Markdown 表格和 Word DOCX 表格版。分镜表会自动生成角色、场景、道具原始资产。'}),
      el('div',{class:'tf-sd-grid '+(withFile?'tf-sm-import-grid':''),style:withFile?'grid-template-columns:180px 1fr 1fr':''},[
        field('格式','select',prefix+'-import-format','', ['auto','txt-standard','markdown','docx','json','csv','text']),
        withFile ? field('分镜表名称','input',prefix+'-script-name','') : el('span',{}),
        withFile ? el('div',{class:'tf-sd-field'},[el('label',{text:'上传文件'}),el('input',{id:prefix+'-file',type:'file',accept:'.txt,.md,.docx',on:{change:function(e){ selectedFile = e.target.files && e.target.files[0] || null; }}})]) : field('分镜表内容','textarea',prefix+'-import-content','粘贴分镜表内容，或逐行输入画面描述'),
        withFile ? field('分镜表内容','textarea',prefix+'-import-content','也可以直接粘贴 TXT 或 Markdown 内容') : el('span',{})
      ]),
      el('div',{class:'tf-sd-row'},[
        el('button',{id:prefix+'-parse-button',class:'tf-sd-btn primary',text:'解析预览',on:{click:function(){ parseStoryboard(prefix==='tf-sm'?'page':undefined); }}}),
        el('button',{id:prefix+'-commit-button',class:'tf-sd-btn warn',text:'确认导入分镜表',on:{click:function(){ commitStoryboard(prefix==='tf-sm'?'page':undefined); }}})
      ]),
      el('div',{id:prefix+'-asset-stats'}),
      el('div',{id:prefix+'-preview',class:'tf-sd-preview'},[el('div',{class:'tf-sd-help',style:'padding:10px',text:'暂无解析结果'})]),
      el('div',{id:prefix+'-warnings',class:'tf-sd-status warn'}),
      el('div',{id:prefix+'-import-status',class:'tf-sd-status'})
    ];
    return el('div',{class:'tf-sd-section'},children);
  }

  function buildWorkflowSection(prefix){
    return el('div',{class:'tf-sd-section'},[
      el('h3',{text:'3. 生产流程'}),
      el('div',{class:'tf-sd-grid'},[
        field('并发数','input',prefix+'-concurrent-count','5'),
        field('分组大小','input',prefix+'-group-size','5'),
        el('div',{class:'tf-sd-field'},[el('label',{text:'选项'}),el('label',{class:'tf-sd-help'},[el('input',{type:'checkbox',id:prefix+'-compulsory'}),' 强制重生成']),el('br'),el('label',{class:'tf-sd-help'},[el('input',{type:'checkbox',id:prefix+'-retry-failed-only'}),' 仅重试失败项']),el('br'),el('label',{class:'tf-sd-help'},[el('input',{type:'checkbox',id:prefix+'-audio'}),' 视频带音频'])])
      ]),
      el('div',{id:prefix+'-steps',class:'tf-sd-steps'}),
      el('div',{id:prefix+'-workflow-status',class:'tf-sd-status'})
    ]);
  }

  function buildEditDialog(){
    return el('div',{id:'tf-sm-edit-dialog',class:'tf-sm-dialog'},[
      el('div',{class:'tf-sm-dialog-mask',on:{click:closeEditStoryboard}}),
      el('div',{class:'tf-sm-dialog-panel'},[
        el('div',{class:'tf-sm-dialog-header'},[
          el('div',{},[el('div',{class:'tf-sd-title',text:'编辑分镜'}),el('div',{class:'tf-sd-help',text:'修改画面内容、时长、轨道和关联资产。'})]),
          el('button',{class:'tf-sd-close',text:'×',on:{click:closeEditStoryboard}})
        ]),
        el('div',{class:'tf-sm-dialog-body'},[
          el('div',{class:'tf-sd-grid'},[
            field('时长（秒）','input','tf-sm-edit-duration','3'),
            field('场景/轨道','input','tf-sm-edit-track','默认分组'),
            el('div',{class:'tf-sd-field'},[el('label',{text:'生成分镜图'}),el('label',{class:'tf-sd-help'},[el('input',{type:'checkbox',id:'tf-sm-edit-generate-image'}),' 需要生成'])])
          ]),
          field('分镜图提示词','textarea','tf-sm-edit-prompt',''),
          field('画面内容 / 视频描述','textarea','tf-sm-edit-video-desc',''),
          el('div',{class:'tf-sd-field'},[el('label',{text:'关联资产'}),el('div',{id:'tf-sm-edit-assets',class:'tf-sm-edit-assets'})]),
          el('div',{id:'tf-sm-edit-status',class:'tf-sd-status'})
        ]),
        el('div',{class:'tf-sm-dialog-footer'},[
          el('button',{class:'tf-sd-btn',text:'取消',on:{click:closeEditStoryboard}}),
          el('button',{class:'tf-sd-btn primary',text:'保存',on:{click:saveStoryboardEdit}})
        ])
      ])
    ]);
  }

  function buildAssetEditDialog(){
    return el('div',{id:'tf-sm-asset-edit-dialog',class:'tf-sm-dialog'},[
      el('div',{class:'tf-sm-dialog-mask',on:{click:closeEditAsset}}),
      el('div',{class:'tf-sm-dialog-panel tf-sm-asset-edit-panel'},[
        el('div',{class:'tf-sm-dialog-header'},[
          el('div',{},[el('div',{class:'tf-sd-title',text:'编辑资产'}),el('div',{class:'tf-sd-help',text:'修改资产描述和图片生成提示词。'})]),
          el('button',{class:'tf-sd-close',text:'×',title:'关闭',on:{click:closeEditAsset}})
        ]),
        el('div',{class:'tf-sm-dialog-body'},[
          field('资产描述','textarea','tf-sm-asset-edit-describe',''),
          field('图片生成提示词','textarea','tf-sm-asset-edit-prompt',''),
          el('div',{id:'tf-sm-asset-edit-status',class:'tf-sd-status'})
        ]),
        el('div',{class:'tf-sm-dialog-footer'},[
          el('button',{class:'tf-sd-btn',text:'取消',on:{click:closeEditAsset}}),
          el('button',{class:'tf-sd-btn primary',text:'保存',on:{click:saveAssetEdit}})
        ])
      ])
    ]);
  }

  function buildImagePreview(){
    return el('div',{id:'tf-sm-image-preview',class:'tf-sm-dialog tf-sm-image-preview'},[
      el('div',{class:'tf-sm-dialog-mask',on:{click:closeImagePreview}}),
      el('div',{class:'tf-sm-image-preview-panel'},[
        el('div',{class:'tf-sm-image-preview-header'},[
          el('div',{id:'tf-sm-image-preview-title',class:'tf-sd-title',text:'图片预览'}),
          el('button',{class:'tf-sd-close',text:'×',title:'关闭预览',on:{click:closeImagePreview}})
        ]),
        el('img',{id:'tf-sm-image-preview-img',alt:'资产大图'})
      ])
    ]);
  }

  function renderStoryboardPage(){
    let root = $('tf-storyboard-page-root');
    if (!isStoryboardRoute()) {
      if(root) root.classList.remove('open');
      if (listTimer) { clearInterval(listTimer); listTimer = null; }
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
      return;
    }
    if (!root) {
      root = el('div',{id:'tf-storyboard-page-root'},[
        el('div',{class:'tf-sm-shell'},[
          el('div',{class:'tf-sm-header'},[
            el('div',{class:'tf-sm-title-wrap'},[
              el('div',{class:'tf-sm-icon',html:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-13Zm3 1v11h2v-11H7Zm4 0v4h2v-4h-2Zm0 6v5h2v-5h-2Zm4-6v11h2v-11h-2Z"/></svg>'}),
              el('div',{},[el('h1',{text:'分镜表管理'}),el('div',{class:'tf-sd-help',text:'基于分镜表填写、解析原始资产，并继续完成短剧生产流程。'})])
            ]),
            el('button',{class:'tf-sd-btn',text:'返回项目',on:{click:function(){ history.back(); }}})
          ]),
          el('div',{class:'tf-sm-toolbar'},[
            field('项目ID','input','tf-sm-project-id',''),
            field('当前分镜表批次','select','tf-sm-script-id','', []),
            el('div',{class:'tf-sd-field tf-sm-search-field'},[el('label',{text:'搜索'}),el('input',{id:'tf-sm-search',placeholder:'搜索分镜表名称 / 镜号 / 场景 / 画面内容',on:{keydown:function(e){ if(e.key==='Enter') refreshStoryboardList(); }}})]),
            el('button',{class:'tf-sd-btn primary tf-sm-toolbar-btn',text:'搜索',on:{click:refreshStoryboardList}}),
            el('button',{class:'tf-sd-btn primary tf-sm-toolbar-btn',text:'+ 新建分镜表',on:{click:startNewStoryboardImport}})
          ]),
          el('div',{id:'tf-sm-context',class:'tf-sd-status',text:contextText()}),
          el('div',{class:'tf-sm-main'},[
            el('div',{class:'tf-sm-left'},[
              el('div',{id:'tf-sm-import-section'},[buildImportSection('tf-sm', true)]),
              el('div',{class:'tf-sd-section'},[el('h3',{text:'2. 分镜表列表'}),el('div',{id:'tf-sm-list',class:'tf-sd-preview tf-sm-list'},[el('div',{class:'tf-sd-help',style:'padding:10px',text:'暂无数据'})])])
            ]),
            el('div',{class:'tf-sm-right'},[
              el('div',{class:'tf-sd-section'},[el('h3',{text:'资产管理'}),el('div',{id:'tf-sm-assets',class:'tf-sm-assets'},[el('div',{class:'tf-sd-help',text:'导入分镜表后自动生成角色、场景、道具。'})])]),
              buildWorkflowSection('tf-sm')
            ])
          ])
        ]),
        buildEditDialog(),
        buildAssetEditDialog(),
        buildImagePreview()
      ]);
      document.body.appendChild(root);
    }
    root.classList.add('open');
    bindContextFields('tf-sm');
    if (!$('tf-sm-compulsory').__tfRenderBound) {
      $('tf-sm-compulsory').__tfRenderBound = true;
      $('tf-sm-compulsory').addEventListener('change', function(){
        if ($('tf-sm-compulsory').checked) $('tf-sm-retry-failed-only').checked = false;
        renderSteps(progressByTarget.page || null, 'page');
      });
      $('tf-sm-retry-failed-only').addEventListener('change', function(){
        if ($('tf-sm-retry-failed-only').checked) $('tf-sm-compulsory').checked = false;
        renderSteps(progressByTarget.page || null, 'page');
      });
    }
    guessIds();
    loadConfig('page');
    refreshStoryboardList();
    refreshProgress('page');
    if (listTimer) clearInterval(listTimer);
    listTimer = setInterval(function(){ if(isStoryboardRoute()) refreshStoryboardList({preserveBatch:true,silent:true}); }, 15000);
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(function(){ if(isStoryboardRoute()) refreshProgress('page',{silent:true}); }, 5000);
  }

  function hookHistory(){
    const rawPush = history.pushState;
    const rawReplace = history.replaceState;
    history.pushState = function(){ const result = rawPush.apply(this, arguments); setTimeout(renderStoryboardPage, 0); return result; };
    history.replaceState = function(){ const result = rawReplace.apply(this, arguments); setTimeout(renderStoryboardPage, 0); return result; };
    window.addEventListener('popstate', renderStoryboardPage);
    window.addEventListener('hashchange', renderStoryboardPage);
  }

  function patchProjectCards(){
    document.querySelectorAll('.card').forEach(function(card){
      card.querySelectorAll('*').forEach(function(node){
        if (node.childNodes.length === 1 && node.textContent === '基于小说剧本') node.textContent = '基于剧本';
      });
    });
  }

  function buildUI(){
    hookHistory();
    renderStoryboardPage();
    setInterval(patchProjectCards, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI); else buildUI();
})();
