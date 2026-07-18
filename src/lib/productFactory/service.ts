import u from "@/utils";
import { ProjectTypes } from "@/constants/project";
import { compileProductPrompt, promptInputSignature, type PromptCompileInput } from "@/lib/productFactory/prompts";
import {
  DEFAULT_PRODUCT_FACTORY_PACK,
  LEGACY_PROMO_MARKER,
  PRODUCT_FACTORY_GRAPH_VERSION,
  PRODUCT_FACTORY_MARKER,
  safeJsonParse,
  type ProductFactoryGraph,
  type ProductFactoryItemState,
  type ProductFactoryPack,
  type ProductFactoryPromptSections,
  type PromptLanguage,
} from "@/lib/productFactory/types";
import {
  createDefaultProductWorkflow,
  diffProductFactoryGraphs,
  migrateProductFactoryGraph,
  normalizeFactoryPack,
  validateProductWorkflow,
} from "@/lib/productFactory/workflow";

export interface ProductFactoryConfigInput {
  brandName?: string | null;
  campaignBrief?: string | null;
  visualTone?: string | null;
  forbiddenContent?: string | null;
  defaultPack?: Partial<ProductFactoryPack>;
  promptPolicy?: Record<string, unknown>;
  imageConcurrency?: number;
  videoConcurrency?: number;
}

export interface ProductFactoryItemInput {
  id?: number;
  sku: string;
  name: string;
  category?: string | null;
  description?: string | null;
  sellingPoints?: string[] | string | null;
  attributes?: Record<string, unknown> | string | null;
}

export interface ProductFactoryPromptRequest {
  projectId: number;
  productId: number;
  mediaType: "image" | "video";
  slotKey: string;
  aspectRatio: string;
  nodeId?: string;
  overrides?: Partial<ProductFactoryPromptSections>;
  runtime?: { mode?: string | string[]; duration?: number; resolution?: string; audio?: boolean };
}

export interface ProductFactoryModelMetadata {
  promptLanguage?: PromptLanguage;
  maxReferenceImages: number;
  modes: unknown[];
  raw: Record<string, unknown> | null;
}

function referenceLimitFromModes(modes: unknown[]) {
  let limit = 0;
  for (const mode of modes) {
    if (mode === "multiReference") limit = Math.max(limit, 10);
    if (!Array.isArray(mode)) continue;
    for (const entry of mode) {
      const match = typeof entry === "string" ? entry.match(/^imageReference:(\d+)$/) : null;
      if (match) limit = Math.max(limit, Number(match[1]));
    }
  }
  return limit;
}

export function modelSupportsProductReference(metadata: ProductFactoryModelMetadata, type: "image" | "video") {
  if (!metadata.raw) return true;
  if (typeof metadata.raw.type === "string" && metadata.raw.type !== type) return false;
  if (!metadata.modes.length) return true;
  if (type === "image") return metadata.modes.some((mode) => mode === "singleImage" || mode === "multiReference");
  return metadata.modes.some((mode) =>
    mode === "singleImage" || mode === "startFrameOptional" || mode === "endFrameOptional" || mode === "startEndRequired" ||
    (Array.isArray(mode) && mode.some((entry) => typeof entry === "string" && entry.startsWith("imageReference:"))),
  );
}

const defaultPromptPolicy = {
  templateVersion: 2,
  aiPolish: false,
  protectFacts: true,
};

const modelMetadataCache = new Map<string, { expiresAt: number; value: ProductFactoryModelMetadata }>();

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sellingPointsFromRow(value: unknown) {
  const parsed = safeJsonParse<unknown>(value, null);
  if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  return normalizeString(value).split(/[|\n]/).map((item) => item.trim()).filter(Boolean);
}

function attributesFromRow(value: unknown) {
  const parsed = safeJsonParse<Record<string, unknown>>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

export async function requireProductFactoryProject(projectId: number, allowLegacy = false) {
  const project = await u.db("o_project").where("id", projectId).first();
  if (!project) throw new Error("项目不存在");
  const legacy = normalizeString(project.intro).includes(LEGACY_PROMO_MARKER);
  if (project.projectType !== ProjectTypes.commerce && !(allowLegacy && legacy)) throw new Error("该项目不是商品视觉工厂项目");
  return project;
}

export async function ensureProductFactoryConfig(projectId: number) {
  await requireProductFactoryProject(projectId, true);
  let config = await u.db("o_productFactoryConfig").where("projectId", projectId).first();
  if (!config) {
    const timestamp = Date.now();
    await u.db("o_productFactoryConfig").insert({
      projectId,
      brandName: "",
      campaignBrief: "",
      visualTone: "高级、克制、真实的商业摄影",
      forbiddenContent: "",
      defaultPack: JSON.stringify(DEFAULT_PRODUCT_FACTORY_PACK),
      promptPolicy: JSON.stringify(defaultPromptPolicy),
      imageConcurrency: 2,
      videoConcurrency: 1,
      migrationVersion: 0,
      defaultTemplateGraph: JSON.stringify(createDefaultProductWorkflow(0)),
      templateRevision: 1,
      createTime: timestamp,
      updateTime: timestamp,
    });
    config = await u.db("o_productFactoryConfig").where("projectId", projectId).first();
  }
  if (!config) throw new Error("商品视觉工厂配置初始化失败");
  if (!config.defaultTemplateGraph) {
    const template = createDefaultProductWorkflow(0, safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK));
    await u.db("o_productFactoryConfig").where("projectId", projectId).update({ defaultTemplateGraph: JSON.stringify(template), templateRevision: 1, updateTime: Date.now() });
    config = { ...config, defaultTemplateGraph: JSON.stringify(template), templateRevision: 1 };
  }
  return config as NonNullable<typeof config>;
}

export async function getProductFactoryModelMetadata(modelValue: string): Promise<ProductFactoryModelMetadata> {
  const cacheKey = normalizeString(modelValue);
  const cached = modelMetadataCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [vendorId, modelName] = normalizeString(modelValue).split(/:(.+)/);
  if (!vendorId || !modelName) return { maxReferenceImages: 1, modes: [], raw: null };
  try {
    const models = await u.vendor.getModelList(vendorId);
    const raw = (models.find((item: any) => item.modelName === modelName) || null) as Record<string, unknown> | null;
    const declaredLanguage = raw?.promptLanguage;
    const promptLanguage = declaredLanguage === "zh" || declaredLanguage === "en" || declaredLanguage === "bilingual" ? declaredLanguage : undefined;
    const modes = Array.isArray(raw?.mode) ? raw.mode : Array.isArray(raw?.modes) ? raw.modes : [];
    const inferredLimit = referenceLimitFromModes(modes);
    const maxReferenceImages = clampInt(
      raw?.maxReferenceImages ?? raw?.referenceImageMax ?? raw?.maxImages ?? raw?.imageMax ?? inferredLimit,
      1,
      10,
      1,
    );
    const value: ProductFactoryModelMetadata = { promptLanguage, maxReferenceImages, modes, raw };
    modelMetadataCache.set(cacheKey, { expiresAt: Date.now() + 5_000, value });
    return value;
  } catch {
    return { maxReferenceImages: 1, modes: [], raw: null };
  }
}

export async function getProductFactoryWorkspace(projectId: number) {
  const project = await requireProductFactoryProject(projectId, true);
  const config = await ensureProductFactoryConfig(projectId);
  const brandReferenceRows = await u.db("o_productFactoryReference").where({ projectId, scope: "brand" }).orderBy("sortIndex", "asc");
  const universalAi = await u.db("o_agentDeploy").where("key", "universalAi").first();
  const counts = await u.db("o_productFactoryItem")
    .where("projectId", projectId)
    .select("state")
    .count({ count: "id" })
    .groupBy("state");
  return {
    marker: PRODUCT_FACTORY_MARKER,
    project,
    config: {
      ...config,
      defaultPack: normalizeFactoryPack(safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK)),
      promptPolicy: safeJsonParse(config.promptPolicy, defaultPromptPolicy),
      defaultTemplateGraph: migrateProductFactoryGraph(safeJsonParse(config.defaultTemplateGraph, createDefaultProductWorkflow(0)), 0).graph,
      templateRevision: Number(config.templateRevision || 1),
    },
    brandReferences: await Promise.all(brandReferenceRows.map(async (reference) => ({ ...reference, url: await u.oss.getFileUrl(reference.filePath) }))),
    aiPolishAvailable: Boolean(universalAi?.modelName),
    counts: Object.fromEntries(counts.map((item: any) => [item.state, Number(item.count)])),
  };
}

export async function markProductFactoryArtifactsInputChanged(projectId: number, productIds?: number[]) {
  let query = u.db("o_productFactoryArtifact").where({ projectId, state: "success", inputChanged: 0 });
  const ids = [...new Set((productIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length) query = query.whereIn("productId", ids);
  return query.update({ inputChanged: 1, updateTime: Date.now() });
}

export async function updateProductFactoryWorkspace(projectId: number, input: ProductFactoryConfigInput) {
  const current = await ensureProductFactoryConfig(projectId);
  const patch = {
    brandName: input.brandName === undefined ? current.brandName : normalizeString(input.brandName),
    campaignBrief: input.campaignBrief === undefined ? current.campaignBrief : normalizeString(input.campaignBrief),
    visualTone: input.visualTone === undefined ? current.visualTone : normalizeString(input.visualTone),
    forbiddenContent: input.forbiddenContent === undefined ? current.forbiddenContent : normalizeString(input.forbiddenContent),
    defaultPack: input.defaultPack === undefined
      ? current.defaultPack
      : JSON.stringify(normalizeFactoryPack({ ...safeJsonParse(current.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK), ...input.defaultPack })),
    promptPolicy: input.promptPolicy === undefined
      ? current.promptPolicy
      : JSON.stringify({ ...safeJsonParse(current.promptPolicy, defaultPromptPolicy), ...input.promptPolicy }),
    imageConcurrency: input.imageConcurrency === undefined ? current.imageConcurrency : clampInt(input.imageConcurrency, 1, 5, 2),
    videoConcurrency: input.videoConcurrency === undefined ? current.videoConcurrency : clampInt(input.videoConcurrency, 1, 2, 1),
    updateTime: Date.now(),
  };
  const generationInputsChanged = ["brandName", "campaignBrief", "visualTone", "forbiddenContent", "promptPolicy"]
    .some((key) => String((current as any)[key] ?? "") !== String((patch as any)[key] ?? ""));
  await u.db("o_productFactoryConfig").where("projectId", projectId).update(patch);
  if (generationInputsChanged) await markProductFactoryArtifactsInputChanged(projectId);

  if (input.defaultPack !== undefined) {
    const templateRevision = Number(current.templateRevision || 1) + 1;
    await u.db("o_productFactoryConfig").where("projectId", projectId).update({
      defaultTemplateGraph: JSON.stringify(createDefaultProductWorkflow(0, safeJsonParse(patch.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK))),
      templateRevision,
      updateTime: Date.now(),
    });
  }
  return getProductFactoryWorkspace(projectId);
}

export async function ensureProductWorkflow(projectId: number, productId: number) {
  const item = await u.db("o_productFactoryItem").where({ projectId, id: productId }).first();
  if (!item) throw new Error("商品不存在");
  let workflow = await u.db("o_productFactoryWorkflow").where({ projectId, productId }).first();
  if (!workflow) {
    const config = await ensureProductFactoryConfig(projectId);
    const timestamp = Date.now();
    await u.db("o_productFactoryWorkflow").insert({
      projectId,
      productId,
      version: PRODUCT_FACTORY_GRAPH_VERSION,
      customized: 0,
      graphData: JSON.stringify(createDefaultProductWorkflow(productId, safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK))),
      revision: 1,
      templateRevision: Number(config.templateRevision || 1),
      v1Backup: null,
      createTime: timestamp,
      updateTime: timestamp,
    });
    workflow = await u.db("o_productFactoryWorkflow").where({ projectId, productId }).first();
  }
  if (!workflow) throw new Error("商品工作流初始化失败");
  const rawGraph = safeJsonParse<ProductFactoryGraph>(workflow.graphData, createDefaultProductWorkflow(productId));
  const migrated = migrateProductFactoryGraph(rawGraph, productId);
  if (migrated.migrated || Number(workflow.version || 1) < PRODUCT_FACTORY_GRAPH_VERSION) {
    await u.db("o_productFactoryWorkflow").where({ projectId, productId }).update({
      version: PRODUCT_FACTORY_GRAPH_VERSION,
      graphData: JSON.stringify(migrated.graph),
      revision: Math.max(1, Number(workflow.revision || 1)),
      v1Backup: workflow.v1Backup || workflow.graphData,
      updateTime: Date.now(),
    });
    workflow = await u.db("o_productFactoryWorkflow").where({ projectId, productId }).first();
  }
  if (!workflow) throw new Error("商品工作流迁移失败");
  const executable = migrated.graph.nodes.filter((node) => node.type === "image" || node.type === "video");
  for (const node of executable) {
    await u.db("o_productFactoryArtifact")
      .where({ projectId, productId, mediaType: node.type, slotKey: String(node.data.slotKey || ""), aspectRatio: String(node.data.aspectRatio || "") })
      .whereNull("workflowNodeId")
      .update({ workflowNodeId: node.id });
    await u.db("o_productFactoryJob")
      .where({ projectId, productId, phase: node.type, slotKey: String(node.data.slotKey || ""), aspectRatio: String(node.data.aspectRatio || "") })
      .whereNull("workflowNodeId")
      .update({ workflowNodeId: node.id });
  }
  return { ...workflow, revision: Math.max(1, Number(workflow.revision || 1)), graph: migrated.graph };
}

export async function upsertProductFactoryItem(projectId: number, input: ProductFactoryItemInput) {
  await ensureProductFactoryConfig(projectId);
  const sku = normalizeString(input.sku).toUpperCase();
  const name = normalizeString(input.name);
  if (!sku) throw new Error("SKU 不能为空");
  if (!name) throw new Error("商品名称不能为空");
  const sellingPoints = Array.isArray(input.sellingPoints)
    ? input.sellingPoints.map(String).map((item) => item.trim()).filter(Boolean)
    : normalizeString(input.sellingPoints).split(/[|\n]/).map((item) => item.trim()).filter(Boolean);
  const attributes = typeof input.attributes === "string"
    ? safeJsonParse<Record<string, unknown>>(input.attributes, {})
    : input.attributes || {};
  const timestamp = Date.now();
  const existing = input.id
    ? await u.db("o_productFactoryItem").where({ projectId, id: input.id }).first()
    : await u.db("o_productFactoryItem").where({ projectId, sku }).first();
  const data = {
    sku,
    name,
    category: normalizeString(input.category),
    description: normalizeString(input.description),
    sellingPoints: JSON.stringify(sellingPoints),
    attributes: JSON.stringify(attributes),
    updateTime: timestamp,
  };
  let productId: number;
  if (existing?.id) {
    const duplicate = await u.db("o_productFactoryItem").where({ projectId, sku }).whereNot("id", existing.id).first();
    if (duplicate) throw new Error(`SKU 已存在：${sku}`);
    const generationInputsChanged = ["sku", "name", "category", "description", "sellingPoints", "attributes"]
      .some((key) => String((existing as any)[key] ?? "") !== String((data as any)[key] ?? ""));
    await u.db("o_productFactoryItem").where({ projectId, id: existing.id }).update(data);
    productId = Number(existing.id);
    if (generationInputsChanged) await markProductFactoryArtifactsInputChanged(projectId, [productId]);
  } else {
    const inserted = await u.db("o_productFactoryItem").insert({ ...data, projectId, state: "draft", createTime: timestamp });
    productId = Number(inserted[0]);
  }
  await ensureProductWorkflow(projectId, productId);
  await refreshProductFactoryItemState(projectId, productId);
  return getProductFactoryItem(projectId, productId);
}

export async function getProductFactoryItem(projectId: number, productId: number) {
  const item = await u.db("o_productFactoryItem").where({ projectId, id: productId }).first();
  if (!item) throw new Error("商品不存在");
  const [references, artifacts, workflow] = await Promise.all([
    u.db("o_productFactoryReference").where({ projectId, productId }).orderBy("sortIndex", "asc"),
    u.db("o_productFactoryArtifact").where({ projectId, productId }).orderBy("id", "desc"),
    ensureProductWorkflow(projectId, productId),
  ]);
  return {
    ...item,
    sellingPoints: sellingPointsFromRow(item.sellingPoints),
    attributes: attributesFromRow(item.attributes),
    references: await Promise.all(references.map(async (ref) => ({ ...ref, url: await u.oss.getFileUrl(ref.filePath) }))),
    artifacts: await Promise.all(artifacts.map(async (artifact) => ({
      ...artifact,
      url: artifact.filePath ? await u.oss.getFileUrl(artifact.filePath) : null,
      promptSections: safeJsonParse(artifact.promptSections, {}),
      params: safeJsonParse(artifact.params, {}),
    }))),
    workflow,
  };
}

export async function listProductFactoryItems(projectId: number, page = 1, pageSize = 50, search = "", summary = false, state = "") {
  await ensureProductFactoryConfig(projectId);
  const limit = clampInt(pageSize, 1, 100, 50);
  const currentPage = Math.max(1, Math.round(Number(page) || 1));
  let query = u.db("o_productFactoryItem").where("projectId", projectId);
  let countQuery = u.db("o_productFactoryItem").where("projectId", projectId);
  const term = normalizeString(search);
  if (term) {
    const applySearch = (builder: any) => builder.where((nested: any) => nested.whereLike("sku", `%${term}%`).orWhereLike("name", `%${term}%`));
    query = applySearch(query);
    countQuery = applySearch(countQuery);
  }
  const normalizedState = normalizeString(state);
  if (normalizedState && normalizedState !== "all") {
    query = query.where("state", normalizedState);
    countQuery = countQuery.where("state", normalizedState);
  }
  const [rows, countRow] = await Promise.all([
    query.orderBy("id", "desc").limit(limit).offset((currentPage - 1) * limit),
    countQuery.count({ count: "id" }).first(),
  ]);
  const productIds = rows.map((row) => Number(row.id));
  if (summary) {
    const [references, artifactCounts] = productIds.length ? await Promise.all([
      u.db("o_productFactoryReference").where("projectId", projectId).whereIn("productId", productIds).orderBy("isPrimary", "desc").orderBy("sortIndex", "asc"),
      u.db("o_productFactoryArtifact").where("projectId", projectId).whereIn("productId", productIds).where("state", "success")
        .select("productId", "mediaType").count({ count: "id" }).groupBy("productId", "mediaType"),
    ]) : [[], []];
    const referenceMap = new Map<number, any>();
    for (const reference of references) if (!referenceMap.has(Number(reference.productId))) referenceMap.set(Number(reference.productId), reference);
    const countMap = new Map<string, number>();
    for (const count of artifactCounts) countMap.set(`${count.productId}:${count.mediaType}`, Number((count as any).count || 0));
    const items = await Promise.all(rows.map(async (row) => {
      const reference = referenceMap.get(Number(row.id));
      return {
        id: Number(row.id), sku: row.sku, name: row.name, category: row.category, state: row.state, updateTime: row.updateTime,
        thumbnailUrl: reference?.filePath ? await u.oss.getFileUrl(reference.filePath) : null,
        referenceCount: references.filter((candidate) => Number(candidate.productId) === Number(row.id)).length,
        imageCount: countMap.get(`${row.id}:image`) || 0,
        videoCount: countMap.get(`${row.id}:video`) || 0,
      };
    }));
    return { items, page: currentPage, pageSize: limit, total: Number((countRow as any)?.count || 0), summary: true };
  }
  let [references, artifacts, workflows] = productIds.length
    ? await Promise.all([
        u.db("o_productFactoryReference").where("projectId", projectId).whereIn("productId", productIds).orderBy("sortIndex", "asc"),
        u.db("o_productFactoryArtifact").where("projectId", projectId).whereIn("productId", productIds).orderBy("id", "desc"),
        u.db("o_productFactoryWorkflow").where("projectId", projectId).whereIn("productId", productIds),
      ])
    : [[], [], []];
  if (workflows.length !== productIds.length) {
    const existing = new Set(workflows.map((workflow) => Number(workflow.productId)));
    await Promise.all(productIds.filter((id) => !existing.has(id)).map((id) => ensureProductWorkflow(projectId, id)));
    workflows = await u.db("o_productFactoryWorkflow").where("projectId", projectId).whereIn("productId", productIds);
  }
  const referenceMap = new Map<number, typeof references>();
  const artifactMap = new Map<number, typeof artifacts>();
  for (const reference of references) {
    const id = Number(reference.productId);
    referenceMap.set(id, [...(referenceMap.get(id) || []), reference]);
  }
  for (const artifact of artifacts) {
    const id = Number(artifact.productId);
    artifactMap.set(id, [...(artifactMap.get(id) || []), artifact]);
  }
  const workflowMap = new Map(workflows.map((workflow) => [Number(workflow.productId), workflow]));
  const items = await Promise.all(rows.map(async (row) => {
    const productId = Number(row.id);
    const workflow = workflowMap.get(productId)!;
    return {
      ...row,
      sellingPoints: sellingPointsFromRow(row.sellingPoints),
      attributes: attributesFromRow(row.attributes),
      references: await Promise.all((referenceMap.get(productId) || []).map(async (reference) => ({ ...reference, url: await u.oss.getFileUrl(reference.filePath) }))),
      artifacts: await Promise.all((artifactMap.get(productId) || []).map(async (artifact) => ({
        ...artifact,
        url: artifact.filePath ? await u.oss.getFileUrl(artifact.filePath) : null,
        promptSections: safeJsonParse(artifact.promptSections, {}),
        params: safeJsonParse(artifact.params, {}),
      }))),
      workflow: {
        ...workflow,
        graph: safeJsonParse<ProductFactoryGraph>(workflow.graphData, createDefaultProductWorkflow(productId)),
      },
    };
  }));
  return { items, page: currentPage, pageSize: limit, total: Number((countRow as any)?.count || 0) };
}

export async function deleteProductFactoryItems(projectId: number, productIds: number[]) {
  const ids = [...new Set(productIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return { deleted: 0 };
  const references = await u.db("o_productFactoryReference").where("projectId", projectId).whereIn("productId", ids).select("filePath");
  const artifacts = await u.db("o_productFactoryArtifact").where("projectId", projectId).whereIn("productId", ids).select("filePath");
  await u.db.transaction(async (trx) => {
    await trx("o_productFactoryJob").where("projectId", projectId).whereIn("productId", ids).delete();
    await trx("o_productFactoryArtifact").where("projectId", projectId).whereIn("productId", ids).delete();
    await trx("o_productFactoryWorkflow").where("projectId", projectId).whereIn("productId", ids).delete();
    await trx("o_productFactoryReference").where("projectId", projectId).whereIn("productId", ids).delete();
    await trx("o_productFactoryItem").where("projectId", projectId).whereIn("id", ids).delete();
  });
  for (const row of [...references, ...artifacts]) {
    if (!row.filePath) continue;
    try { await u.oss.deleteFile(row.filePath); } catch { /* already removed */ }
  }
  return { deleted: ids.length };
}

export async function deleteProductFactoryProject(projectId: number, confirmationName: string) {
  const project = await requireProductFactoryProject(projectId, true);
  const confirmationToken = normalizeString(project.name) || `#${projectId}`;
  if (normalizeString(confirmationName) !== confirmationToken) {
    throw new Error(`请输入“${confirmationToken}”确认删除`);
  }

  const [references, artifacts] = await Promise.all([
    u.db("o_productFactoryReference").where("projectId", projectId).select("filePath"),
    u.db("o_productFactoryArtifact").where("projectId", projectId).select("filePath"),
  ]);
  const deleted = {
    projects: 0,
    products: 0,
    references: 0,
    workflows: 0,
    artifacts: 0,
    jobs: 0,
    configs: 0,
    ancillaryRecords: 0,
    legacyRecords: 0,
  };

  await u.db.transaction(async (trx) => {
    const tableCache = new Map<string, boolean>();
    const hasTable = async (table: string) => {
      if (!tableCache.has(table)) tableCache.set(table, await trx.schema.hasTable(table));
      return tableCache.get(table)!;
    };
    const current = await trx("o_project").where("id", projectId).first();
    if (!current) throw new Error("项目不存在或已被删除");
    const isLegacy = normalizeString(current.intro).includes(LEGACY_PROMO_MARKER);
    if (current.projectType !== ProjectTypes.commerce && !isLegacy) throw new Error("该项目不是商品视觉工厂项目");

    deleted.jobs = await trx("o_productFactoryJob").where("projectId", projectId).delete();
    deleted.artifacts = await trx("o_productFactoryArtifact").where("projectId", projectId).delete();
    deleted.workflows = await trx("o_productFactoryWorkflow").where("projectId", projectId).delete();
    deleted.references = await trx("o_productFactoryReference").where("projectId", projectId).delete();
    deleted.products = await trx("o_productFactoryItem").where("projectId", projectId).delete();
    deleted.configs = await trx("o_productFactoryConfig").where("projectId", projectId).delete();

    if (await hasTable("o_novel")) {
      const novelIds = (await trx("o_novel").where("projectId", projectId).select("id")).map((row) => Number(row.id));
      if (novelIds.length && await hasTable("o_eventChapter")) {
        const eventIds = [...new Set((await trx("o_eventChapter").whereIn("novelId", novelIds).select("eventId")).map((row) => Number(row.eventId)).filter(Boolean))];
        deleted.legacyRecords += await trx("o_eventChapter").whereIn("novelId", novelIds).delete();
        if (eventIds.length && await hasTable("o_event")) {
          const retainedIds = new Set((await trx("o_eventChapter").whereIn("eventId", eventIds).select("eventId")).map((row) => Number(row.eventId)));
          const orphanEventIds = eventIds.filter((id) => !retainedIds.has(id));
          if (orphanEventIds.length) deleted.legacyRecords += await trx("o_event").whereIn("id", orphanEventIds).delete();
        }
      }
      deleted.legacyRecords += await trx("o_novel").where("projectId", projectId).delete();
    }

    const scriptIds = await hasTable("o_script")
      ? (await trx("o_script").where("projectId", projectId).select("id")).map((row) => Number(row.id))
      : [];
    const storyboardIds = await hasTable("o_storyboard")
      ? (await trx("o_storyboard").where("projectId", projectId).select("id")).map((row) => Number(row.id))
      : [];
    const assetRows = await hasTable("o_assets")
      ? await trx("o_assets").where("projectId", projectId).select("id", "imageId")
      : [];
    const assetIds = assetRows.map((row) => Number(row.id));
    const imageIds = [...new Set(assetRows.map((row) => Number(row.imageId)).filter(Boolean))];

    if (await hasTable("o_scriptAssets")) {
      if (scriptIds.length) deleted.legacyRecords += await trx("o_scriptAssets").whereIn("scriptId", scriptIds).delete();
      if (assetIds.length) deleted.legacyRecords += await trx("o_scriptAssets").whereIn("assetId", assetIds).delete();
    }
    if (await hasTable("o_assets2Storyboard")) {
      if (storyboardIds.length) deleted.legacyRecords += await trx("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
      if (assetIds.length) deleted.legacyRecords += await trx("o_assets2Storyboard").whereIn("assetId", assetIds).delete();
    }
    if (assetIds.length && await hasTable("o_assetsRole2Audio")) {
      deleted.legacyRecords += await trx("o_assetsRole2Audio").whereIn("assetsRoleId", assetIds).orWhereIn("assetsAudioId", assetIds).delete();
    }
    if (scriptIds.length) deleted.legacyRecords += await trx("o_script").whereIn("id", scriptIds).delete();
    if (storyboardIds.length) deleted.legacyRecords += await trx("o_storyboard").whereIn("id", storyboardIds).delete();
    if (assetIds.length) {
      await trx("o_assets").whereIn("id", assetIds).update({ imageId: null });
      deleted.legacyRecords += await trx("o_assets").whereIn("id", assetIds).delete();
    }
    if (await hasTable("o_image") && (assetIds.length || imageIds.length)) {
      const imageQuery = trx("o_image");
      if (assetIds.length) imageQuery.whereIn("assetsId", assetIds);
      if (imageIds.length) assetIds.length ? imageQuery.orWhereIn("id", imageIds) : imageQuery.whereIn("id", imageIds);
      deleted.legacyRecords += await imageQuery.delete();
    }
    for (const table of ["o_videoTrack", "o_video"]) {
      if (await hasTable(table)) deleted.legacyRecords += await trx(table).where("projectId", projectId).delete();
    }

    for (const table of ["o_tasks", "o_agentWorkData", "o_workflowStepRun"]) {
      if (await hasTable(table)) deleted.ancillaryRecords += await trx(table).where("projectId", projectId).delete();
    }
    if (await hasTable("memories")) {
      deleted.ancillaryRecords += await trx("memories").where("isolationKey", "like", `${projectId}:%`).delete();
    }
    deleted.projects = await trx("o_project").where("id", projectId).delete();
    if (deleted.projects !== 1) throw new Error("项目删除失败，请重试");
  });

  let deletedFiles = 0;
  const storageWarnings: string[] = [];
  const filePaths = [...new Set([...references, ...artifacts].map((row) => normalizeString(row.filePath)).filter(Boolean))];
  for (const filePath of filePaths) {
    try { await u.oss.deleteFile(filePath); deletedFiles += 1; } catch { /* directory sweep below handles missing files */ }
  }
  for (const directory of [`product-factory/${projectId}`, `${projectId}`]) {
    try { await u.oss.deleteDirectory(directory); } catch (error) {
      const message = u.error(error).message;
      if (message && !/不存在|ENOENT|no such file/i.test(message)) storageWarnings.push(`${directory}: ${message}`);
    }
  }

  return {
    projectId,
    projectName: confirmationToken,
    deleted,
    deletedFiles,
    storageWarnings,
  };
}

export async function updateProductWorkflow(
  projectId: number,
  productId: number,
  graph: ProductFactoryGraph,
  customized = true,
  markInputChanged = true,
  baseRevision?: number,
) {
  const current = await ensureProductWorkflow(projectId, productId);
  const currentRevision = Number(current.revision || 1);
  if (baseRevision !== undefined && Number(baseRevision) !== currentRevision) {
    throw new Error(`工作流已在其他操作中更新（当前修订 ${currentRevision}），请刷新后重试`);
  }
  if (Number(graph.productId) !== productId) throw new Error("工作流商品 ID 不匹配");
  const migrated = migrateProductFactoryGraph(graph, productId).graph;
  const previous = migrateProductFactoryGraph(current.graph, productId).graph;
  for (const protectedNode of previous.nodes.filter((node) => node.data.system === true)) {
    if (!migrated.nodes.some((node) => node.id === protectedNode.id && node.type === protectedNode.type)) throw new Error(`系统节点 ${protectedNode.data.label || protectedNode.id} 不能删除或替换`);
  }
  validateProductWorkflow(migrated);
  migrated.customized = customized;
  const diff = diffProductFactoryGraphs(previous, migrated);
  const nextRevision = currentRevision + 1;
  await u.db("o_productFactoryWorkflow").where({ projectId, productId }).update({
    graphData: JSON.stringify(migrated),
    customized: customized ? 1 : 0,
    version: PRODUCT_FACTORY_GRAPH_VERSION,
    revision: nextRevision,
    updateTime: Date.now(),
  });
  if (diff.removedNodeIds.length) {
    await u.db("o_productFactoryArtifact").where({ projectId, productId }).whereIn("workflowNodeId", diff.removedNodeIds).update({ detached: 1, updateTime: Date.now() });
  }
  if (markInputChanged && diff.affectedNodeIds.length) {
    await u.db("o_productFactoryArtifact").where({ projectId, productId, state: "success", inputChanged: 0 }).whereIn("workflowNodeId", diff.affectedNodeIds).update({ inputChanged: 1, updateTime: Date.now() });
  }
  return ensureProductWorkflow(projectId, productId);
}

export async function syncProductWorkflowTemplate(projectId: number, productId: number) {
  const config = await ensureProductFactoryConfig(projectId);
  const current = await ensureProductWorkflow(projectId, productId);
  return updateProductWorkflow(
    projectId,
    productId,
    createDefaultProductWorkflow(productId, safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK)),
    false,
    true,
    Number(current.revision || 1),
  );
}

function instantiateTemplate(raw: unknown, productId: number, pack: ProductFactoryPack) {
  const parsed = safeJsonParse<ProductFactoryGraph>(typeof raw === "string" ? raw : JSON.stringify(raw || {}), createDefaultProductWorkflow(productId, pack));
  const graph = migrateProductFactoryGraph(parsed, productId, pack).graph;
  graph.productId = productId;
  return graph;
}

function mergeTemplateGraph(current: ProductFactoryGraph, template: ProductFactoryGraph, preserveCustom: boolean) {
  if (!preserveCustom) return template;
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
  const templateIds = new Set(template.nodes.map((node) => node.id));
  const nodes = template.nodes.map((node) => {
    const existing = currentNodes.get(node.id);
    if (!existing) return node;
    const preservedData = Object.fromEntries(["label", "promptOverride", "promptCustomized", "modelOverride", "runtime"].map((key) => [key, existing.data[key]]).filter(([, value]) => value !== undefined));
    return { ...node, position: { ...existing.position }, data: { ...node.data, ...preservedData } };
  });
  for (const node of current.nodes) if (!templateIds.has(node.id)) nodes.push(node);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [...template.edges];
  const edgeKeys = new Set(edges.map((edge) => `${edge.source}:${edge.sourcePort}>${edge.target}:${edge.targetPort}`));
  for (const edge of current.edges) {
    const touchesCustom = !templateIds.has(edge.source) || !templateIds.has(edge.target);
    const key = `${edge.source}:${edge.sourcePort}>${edge.target}:${edge.targetPort}`;
    if (touchesCustom && nodeIds.has(edge.source) && nodeIds.has(edge.target) && !edgeKeys.has(key)) { edges.push(edge); edgeKeys.add(key); }
  }
  return {
    ...template,
    nodes,
    edges,
    viewport: current.viewport,
    reviewBindings: { ...template.reviewBindings, ...current.reviewBindings },
    reviewMappings: { ...template.reviewMappings, ...current.reviewMappings },
    customized: true,
  };
}

export async function previewProductWorkflowTemplate(projectId: number, productIds: number[], preserveCustom = true) {
  const config = await ensureProductFactoryConfig(projectId);
  const ids = [...new Set(productIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw new Error("请选择至少一个 SKU");
  const existing = await u.db("o_productFactoryItem").where("projectId", projectId).whereIn("id", ids).select("id");
  if (existing.length !== ids.length) throw new Error("模板范围包含不存在的 SKU");
  const pack = normalizeFactoryPack(safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK));
  const items = [];
  for (const productId of ids) {
    const workflow = await ensureProductWorkflow(projectId, productId);
    const candidate = mergeTemplateGraph(workflow.graph, instantiateTemplate(config.defaultTemplateGraph, productId, pack), preserveCustom);
    const diff = diffProductFactoryGraphs(workflow.graph, candidate);
    const affectedArtifactsRow = diff.affectedNodeIds.length
      ? await u.db("o_productFactoryArtifact").where({ projectId, productId, state: "success" }).whereIn("workflowNodeId", diff.affectedNodeIds).count({ count: "id" }).first()
      : { count: 0 };
    items.push({
      productId,
      revision: Number(workflow.revision || 1),
      addedNodeIds: candidate.nodes.filter((node) => !workflow.graph.nodes.some((old) => old.id === node.id)).map((node) => node.id),
      removedNodeIds: diff.removedNodeIds,
      changedNodeIds: diff.semanticChangedNodeIds,
      affectedNodeIds: diff.affectedNodeIds,
      affectedArtifacts: Number((affectedArtifactsRow as any)?.count || 0),
    });
  }
  return {
    templateRevision: Number(config.templateRevision || 1),
    preserveCustom,
    items,
    summary: {
      skuCount: items.length,
      addedNodes: items.reduce((sum, item) => sum + item.addedNodeIds.length, 0),
      removedNodes: items.reduce((sum, item) => sum + item.removedNodeIds.length, 0),
      changedNodes: items.reduce((sum, item) => sum + item.changedNodeIds.length, 0),
      affectedArtifacts: items.reduce((sum, item) => sum + item.affectedArtifacts, 0),
    },
  };
}

export async function applyProductWorkflowTemplate(projectId: number, productIds: number[], preserveCustom = true, force = false, confirmed = false) {
  if (force && !confirmed) throw new Error("强制覆盖必须在查看差异后再次确认");
  const preview = await previewProductWorkflowTemplate(projectId, productIds, preserveCustom && !force);
  const config = await ensureProductFactoryConfig(projectId);
  const pack = normalizeFactoryPack(safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK));
  const workflows = [];
  for (const item of preview.items) {
    const current = await ensureProductWorkflow(projectId, item.productId);
    const candidate = mergeTemplateGraph(current.graph, instantiateTemplate(config.defaultTemplateGraph, item.productId, pack), preserveCustom && !force);
    const updated = await updateProductWorkflow(projectId, item.productId, candidate, preserveCustom && !force, true, Number(current.revision || 1));
    await u.db("o_productFactoryWorkflow").where({ projectId, productId: item.productId }).update({ templateRevision: Number(config.templateRevision || 1) });
    workflows.push(updated);
  }
  return { applied: workflows.length, templateRevision: Number(config.templateRevision || 1), preview, workflows };
}

export async function saveProductWorkflowAsTemplate(projectId: number, productId: number) {
  const [config, workflow] = await Promise.all([ensureProductFactoryConfig(projectId), ensureProductWorkflow(projectId, productId)]);
  const templateRevision = Number(config.templateRevision || 1) + 1;
  const template = structuredClone(workflow.graph);
  template.productId = 0;
  template.viewport = { x: 30, y: 30, zoom: 0.75 };
  template.reviewBindings = Object.fromEntries(Object.keys(template.reviewBindings || {}).map((nodeId) => [nodeId, { primary: null }]));
  template.reviewMappings = Object.fromEntries(Object.keys(template.reviewMappings || {}).map((key) => [key, null]));
  await u.db("o_productFactoryConfig").where("projectId", projectId).update({ defaultTemplateGraph: JSON.stringify(template), templateRevision, updateTime: Date.now() });
  return { templateRevision, graph: template };
}

export function findWorkflowPromptOverride(graph: ProductFactoryGraph, mediaType: "image" | "video", slotKey: string, aspectRatio: string, nodeId?: string) {
  const node = nodeId
    ? graph.nodes.find((item) => item.id === nodeId && (item.type === "image" || item.type === "video"))
    : graph.nodes.find((item) => item.type === mediaType && item.data.slotKey === slotKey && item.data.aspectRatio === aspectRatio);
  const value = node?.data.promptOverride;
  return value && typeof value === "object" ? value as Partial<ProductFactoryPromptSections> : undefined;
}

export async function compilePromptForProduct(request: ProductFactoryPromptRequest) {
  const project = await requireProductFactoryProject(request.projectId, true);
  const config = await ensureProductFactoryConfig(request.projectId);
  const item = await u.db("o_productFactoryItem").where({ projectId: request.projectId, id: request.productId }).first();
  if (!item) throw new Error("商品不存在");
  const workflow = await ensureProductWorkflow(request.projectId, request.productId);
  const node = request.nodeId
    ? workflow.graph.nodes.find((candidate) => candidate.id === request.nodeId && (candidate.type === "image" || candidate.type === "video"))
    : workflow.graph.nodes.find((candidate) => candidate.type === request.mediaType && candidate.data.slotKey === request.slotKey && candidate.data.aspectRatio === request.aspectRatio);
  if (!node || (node.type !== "image" && node.type !== "video")) throw new Error("未找到对应的工作流节点");
  const mediaType = node.type;
  const slotKey = String(node.data.slotKey || request.slotKey || "");
  const aspectRatio = String(node.data.aspectRatio || request.aspectRatio || "");
  if (!slotKey || !aspectRatio) throw new Error(`工作流节点 ${node.id} 缺少角色或比例`);
  const refs = await u.db("o_productFactoryReference").where({ projectId: request.projectId, productId: request.productId }).orderBy("isPrimary", "desc").orderBy("sortIndex", "asc");
  const brandRefs = await u.db("o_productFactoryReference").where({ projectId: request.projectId, scope: "brand" }).orderBy("sortIndex", "asc");
  const pack = normalizeFactoryPack(safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK));
  const modelOverride = normalizeString(node.data.modelOverride);
  const model = modelOverride || normalizeString(mediaType === "image" ? project.imageModel : project.videoModel);
  if (!model || !/^[^:]+:.+$/.test(model)) throw new Error(`项目未配置有效的${mediaType === "image" ? "图片" : "视频"}模型`);
  const metadata = await getProductFactoryModelMetadata(model);
  if (modelOverride && !metadata.raw) throw new Error(`节点覆盖模型 ${modelOverride} 已失效；请恢复项目默认模型或重新选择已有模型`);
  const overrides = request.overrides || findWorkflowPromptOverride(workflow.graph, mediaType, slotKey, aspectRatio, node.id);
  const runtime = node.data.runtime && typeof node.data.runtime === "object" ? node.data.runtime as Record<string, unknown> : {};
  const input: PromptCompileInput = {
    mediaType,
    slotKey: slotKey as PromptCompileInput["slotKey"],
    aspectRatio,
    model,
    size: (["1K", "2K", "4K"].includes(String(runtime.quality)) ? String(runtime.quality) : pack.imageQuality) as "1K" | "2K" | "4K",
    mode: request.runtime?.mode ?? runtime.mode as string | string[] | undefined ?? project.mode ?? undefined,
    duration: request.runtime?.duration ?? Number(runtime.duration || pack.videoDuration),
    resolution: request.runtime?.resolution ?? String(runtime.resolution || pack.videoResolution),
    audio: request.runtime?.audio ?? (runtime.audio === undefined ? pack.videoAudio : Boolean(runtime.audio)),
    brandName: config.brandName,
    campaignBrief: config.campaignBrief,
    visualTone: config.visualTone,
    forbiddenContent: config.forbiddenContent,
    sku: item.sku,
    productName: item.name,
    category: item.category,
    description: item.description,
    sellingPoints: sellingPointsFromRow(item.sellingPoints),
    attributes: attributesFromRow(item.attributes),
    referenceLabels: [
      ...refs.map((ref) => `${ref.isPrimary ? "主参考" : "补充参考"}:${ref.fileName}`),
      ...brandRefs.map((ref) => `品牌参考:${ref.fileName}`),
    ],
    promptLanguage: metadata.promptLanguage,
    overrides,
  };
  const result = compileProductPrompt(input);
  return {
    input,
    result,
    signature: promptInputSignature({
      input,
      sections: result.sections,
      references: refs.map((ref) => [ref.id, ref.sha256]),
      brandReferences: brandRefs.map((ref) => [ref.id, ref.sha256]),
      workflowVersion: workflow.version,
      workflowNodeId: node.id,
    }),
    referenceIds: refs.map((ref) => Number(ref.id)),
    modelMetadata: metadata,
    node,
  };
}

export async function saveProductPromptOverride(request: ProductFactoryPromptRequest, overrides: Partial<ProductFactoryPromptSections> | null) {
  const workflow = await ensureProductWorkflow(request.projectId, request.productId);
  const node = request.nodeId
    ? workflow.graph.nodes.find((item) => item.id === request.nodeId && (item.type === "image" || item.type === "video"))
    : workflow.graph.nodes.find((item) => item.type === request.mediaType && item.data.slotKey === request.slotKey && item.data.aspectRatio === request.aspectRatio);
  if (!node) throw new Error("未找到对应的工作流节点");
  node.data.promptOverride = overrides;
  node.data.promptCustomized = Boolean(overrides && Object.keys(overrides).length);
  return updateProductWorkflow(request.projectId, request.productId, workflow.graph, true);
}

export async function refreshProductFactoryItemState(projectId: number, productId: number): Promise<ProductFactoryItemState> {
  const [refs, jobs, artifacts, workflow] = await Promise.all([
    u.db("o_productFactoryReference").where({ projectId, productId }),
    u.db("o_productFactoryJob").where({ projectId, productId }),
    u.db("o_productFactoryArtifact").where({ projectId, productId }),
    ensureProductWorkflow(projectId, productId),
  ]);
  let state: ProductFactoryItemState = refs.some((ref) => ref.isPrimary) ? "ready" : "draft";
  const imageJobs = jobs.filter((job) => job.phase === "image");
  const videoJobs = jobs.filter((job) => job.phase === "video");
  if (imageJobs.some((job) => job.state === "queued" || job.state === "running")) state = "image_generating";
  else {
    const images = artifacts.filter((artifact) => artifact.mediaType === "image" && artifact.state === "success");
    const approvedImages = images.filter((artifact) => artifact.approved);
    const currentImages = images.filter((artifact) => artifact.isCurrent);
    const videoNodes = workflow.graph.nodes.filter((node) => node.type === "video");
    const hasAllVideoMappings = videoNodes.every((node) => {
      const primary = workflow.graph.reviewBindings?.[node.id]?.primary;
      const legacy = workflow.graph.reviewMappings?.[`${node.data.slotKey}:${node.data.aspectRatio}`];
      return Number(Array.isArray(primary) ? primary[0] : primary ?? legacy) > 0;
    });
    if (images.length && (currentImages.some((artifact) => !artifact.approved) || !approvedImages.length || !hasAllVideoMappings)) state = "awaiting_review";
    else if (approvedImages.length && hasAllVideoMappings) state = "video_ready";
    if (videoJobs.some((job) => job.state === "queued" || job.state === "running")) state = "video_generating";
    const videos = artifacts.filter((artifact) => artifact.mediaType === "video" && artifact.state === "success" && artifact.isCurrent);
    const expectedVideos = workflow.graph.nodes.filter((node) => node.type === "video").length;
    if (expectedVideos > 0 && videos.length >= expectedVideos) state = "completed";
  }
  if (jobs.some((job) => job.state === "failed" || job.state === "interrupted") && !jobs.some((job) => job.state === "queued" || job.state === "running")) state = "partial_failed";
  await u.db("o_productFactoryItem").where({ projectId, id: productId }).update({ state, updateTime: Date.now() });
  return state;
}
