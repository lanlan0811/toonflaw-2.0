import u from "@/utils";
import type { ReferenceList } from "@/utils/ai";
import {
  compilePromptForProduct,
  ensureProductFactoryConfig,
  ensureProductWorkflow,
  modelSupportsProductReference,
  refreshProductFactoryItemState,
  requireProductFactoryProject,
} from "@/lib/productFactory/service";
import { safeJsonParse, type ProductFactoryGraph, type ProductFactoryGraphNode, type ProductFactoryPhase, type ProductFactoryPromptSections } from "@/lib/productFactory/types";

export interface ProductFactoryJobPlanRequest {
  projectId: number;
  productIds: number[];
  phase: ProductFactoryPhase;
  regenerate?: boolean;
  scope?:
    | { type: "node"; productId: number; nodeId: string; includeDownstream?: boolean }
    | { type: "batch"; productIds: number[]; phases?: ProductFactoryPhase[]; roleKeys?: string[] };
}

interface PlannedJob {
  projectId: number;
  productId: number;
  phase: ProductFactoryPhase;
  workflowNodeId: string;
  slotKey: string;
  aspectRatio: string;
  model: string;
  prompt: string;
  promptSections: ProductFactoryPromptSections;
  templateId: string;
  templateVersion: number;
  promptLanguage: string;
  inputSignature: string;
  inputReferenceIds: number[];
  inputArtifactIds: number[];
  inputArtifactNodeIds: string[];
  dependsOnNodeIds: string[];
  params: Record<string, unknown>;
}

export interface ProductFactoryJobPlan {
  jobs: PlannedJob[];
  skipped: Array<{ productId: number; slotKey?: string; aspectRatio?: string; reason: string }>;
  warnings: string[];
  summary: {
    requestedProducts: number;
    taskCount: number;
    skippedCount: number;
    imageCount: number;
    videoCount: number;
  };
}

function uniqueIds(ids: number[]) {
  return [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function topologicalNodes(graph: ProductFactoryGraph) {
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const queue = graph.nodes.filter((node) => (indegree.get(node.id) || 0) === 0).map((node) => node.id);
  const result: ProductFactoryGraphNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (node) result.push(node);
    for (const target of outgoing.get(id) || []) {
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return result;
}

function executionNodes(graph: ProductFactoryGraph, request: ProductFactoryJobPlanRequest, productId: number) {
  const executable = new Set<string>();
  const scope = request.scope;
  if (scope?.type === "node") {
    if (Number(scope.productId) !== productId) return [];
    const target = graph.nodes.find((node) => node.id === scope.nodeId);
    if (!target) throw new Error(`工作流中不存在节点 ${scope.nodeId}`);
    if (target.type === "review") throw new Error("审核门不能作为生成任务执行；请先显式提交审核结果");
    if (target.type !== "image" && target.type !== "video") throw new Error("该节点不是可执行节点");
    executable.add(target.id);
    if (scope.includeDownstream) {
      const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
      for (const edge of graph.edges) outgoing.get(edge.source)?.push(edge.target);
      const queue = [target.id];
      while (queue.length) {
        for (const id of outgoing.get(queue.shift()!) || []) {
          const node = graph.nodes.find((candidate) => candidate.id === id);
          if (!node || executable.has(id) || node.type === "review") continue;
          if (node.type === "image" || node.type === "video") executable.add(id);
          queue.push(id);
        }
      }
    }
  } else {
    const phases = new Set(scope?.type === "batch" && scope.phases?.length ? scope.phases : [request.phase]);
    const roles = new Set(scope?.type === "batch" ? scope.roleKeys || [] : []);
    for (const node of graph.nodes) {
      if ((node.type === "image" || node.type === "video") && phases.has(node.type) && (!roles.size || roles.has(String(node.data.roleKey || node.data.slotKey || "")))) executable.add(node.id);
    }
  }
  // Missing derived-image ancestors are real dependencies and must be planned first.
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) incoming.get(edge.target)?.push(edge.source);
  const pending = [...executable];
  while (pending.length) {
    const id = pending.shift()!;
    for (const parentId of incoming.get(id) || []) {
      const parent = graph.nodes.find((node) => node.id === parentId);
      if (parent?.type === "image" && !executable.has(parentId)) { executable.add(parentId); pending.push(parentId); }
    }
  }
  return topologicalNodes(graph).filter((node) => executable.has(node.id));
}

function parseMode(value: unknown): any {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return "singleImage";
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function chooseVideoMode(configured: unknown, modes: unknown[]) {
  const requested = parseMode(configured);
  const isImageReferenceMode = (mode: unknown) => Array.isArray(mode) && mode.some((entry) => typeof entry === "string" && entry.startsWith("imageReference:"));
  if (!modes.length) return requested === "text" ? "singleImage" : requested;
  if (typeof requested === "string" && requested !== "text" && requested !== "startEndRequired" && modes.includes(requested)) return requested;
  if (isImageReferenceMode(requested)) return requested;
  for (const preferred of ["singleImage", "startFrameOptional", "endFrameOptional"]) if (modes.includes(preferred)) return preferred;
  if (modes.includes("startEndRequired")) return "startEndRequired";
  const referenceMode = modes.find(isImageReferenceMode);
  if (referenceMode) return referenceMode;
  throw new Error("当前视频模型没有可由单张批准图片驱动的模式");
}

function adaptVideoParams(input: { duration: number; resolution: string; audio: boolean }, raw: Record<string, unknown> | null) {
  let duration = input.duration;
  let resolution = input.resolution;
  let audio = input.audio;
  const map = Array.isArray(raw?.durationResolutionMap) ? raw.durationResolutionMap as Array<{ duration?: unknown; resolution?: unknown }> : [];
  const candidates = map.flatMap((entry) => {
    const durations = Array.isArray(entry.duration) ? entry.duration.map(Number).filter(Number.isFinite) : [];
    const resolutions = Array.isArray(entry.resolution) ? entry.resolution.map(String) : [];
    return durations.flatMap((candidateDuration) => resolutions.map((candidateResolution) => ({ duration: candidateDuration, resolution: candidateResolution })));
  });
  if (candidates.length) {
    const requestedPixels = Number(input.resolution.match(/\d+/)?.[0] || 0);
    candidates.sort((left, right) => {
      const score = (candidate: typeof left) => Math.abs(candidate.duration - input.duration) * 10 + Math.abs(Number(candidate.resolution.match(/\d+/)?.[0] || 0) - requestedPixels);
      return score(left) - score(right);
    });
    duration = candidates[0].duration;
    resolution = candidates[0].resolution;
  }
  if (raw?.audio === false) audio = false;
  if (raw?.audio === true) audio = true;
  return { duration, resolution, audio };
}

export async function planProductFactoryJobs(request: ProductFactoryJobPlanRequest): Promise<ProductFactoryJobPlan> {
  const project = await requireProductFactoryProject(request.projectId, true);
  const config = await ensureProductFactoryConfig(request.projectId);
  const productIds = uniqueIds(request.scope?.type === "batch" ? request.scope.productIds : request.scope?.type === "node" ? [request.scope.productId] : request.productIds);
  if (!productIds.length) throw new Error("请明确选择至少一个商品");
  const items = await u.db("o_productFactoryItem").where("projectId", request.projectId).whereIn("id", productIds);
  if (items.length !== productIds.length) throw new Error("选择的商品中包含不存在或不属于该项目的记录");

  const jobs: PlannedJob[] = [];
  const skipped: ProductFactoryJobPlan["skipped"] = [];
  const warnings = new Set<string>();
  for (const item of items) {
    const productId = Number(item.id);
    const workflow = await ensureProductWorkflow(request.projectId, productId);
    const nodes = executionNodes(workflow.graph, request, productId);
    const plannedByNode = new Map<string, PlannedJob>();
    const references = await u.db("o_productFactoryReference").where({ projectId: request.projectId, productId }).orderBy("isPrimary", "desc").orderBy("sortIndex", "asc");
    const brandReferences = await u.db("o_productFactoryReference").where({ projectId: request.projectId, scope: "brand" }).orderBy("sortIndex", "asc");
    if (!references.some((ref) => ref.isPrimary)) {
      skipped.push({ productId, reason: "未指定商品主参考图" });
      continue;
    }
    for (const node of nodes) {
      const phase = node.type as ProductFactoryPhase;
      const slotKey = String(node.data.slotKey || "");
      const aspectRatio = String(node.data.aspectRatio || "");
      if (!slotKey || !aspectRatio) {
        skipped.push({ productId, reason: `工作流节点 ${node.id} 缺少槽位或比例` });
        continue;
      }
      const inputArtifactIds: number[] = [];
      const inputArtifactSignatures: string[] = [];
      const inputArtifactNodeIds: string[] = [];
      const dependsOnNodeIds: string[] = [];
      if (phase === "image") {
        const incomingImages = workflow.graph.edges
          .filter((edge) => edge.target === node.id)
          .map((edge) => workflow.graph.nodes.find((candidate) => candidate.id === edge.source))
          .filter((candidate): candidate is ProductFactoryGraphNode => candidate?.type === "image");
        let missingDependency = false;
        for (const parent of incomingImages) {
          const currentArtifact = await u.db("o_productFactoryArtifact").where({
            projectId: request.projectId, productId, workflowNodeId: parent.id, mediaType: "image", state: "success", isCurrent: 1, inputChanged: 0, detached: 0,
          }).orderBy("id", "desc").first();
          if (currentArtifact?.id && currentArtifact.filePath) {
            inputArtifactIds.push(Number(currentArtifact.id));
            inputArtifactSignatures.push(String(currentArtifact.inputSignature));
          } else if (plannedByNode.has(parent.id)) {
            inputArtifactNodeIds.push(parent.id);
            dependsOnNodeIds.push(parent.id);
            inputArtifactSignatures.push(plannedByNode.get(parent.id)!.inputSignature);
          } else {
            skipped.push({ productId, slotKey, aspectRatio, reason: `必要上游节点 ${parent.data.label || parent.id} 没有可用产物` });
            missingDependency = true;
          }
        }
        if (missingDependency) continue;
      } else {
        const bindings = workflow.graph.reviewBindings?.[node.id] || {};
        const legacyId = workflow.graph.reviewMappings?.[`${slotKey}:${aspectRatio}`];
        const bindingIds = uniqueIds(Object.values(bindings).flatMap((value) => Array.isArray(value) ? value : value ? [value] : []));
        if (!bindingIds.length && Number(legacyId) > 0) bindingIds.push(Number(legacyId));
        const sources = bindingIds.length
          ? await u.db("o_productFactoryArtifact").where({ projectId: request.projectId, productId, mediaType: "image", state: "success", approved: 1 }).whereIn("id", bindingIds)
          : [];
        sources.sort((left, right) => bindingIds.indexOf(Number(left.id)) - bindingIds.indexOf(Number(right.id)));
        if (!sources.length || sources.some((source) => !source.filePath)) {
          skipped.push({ productId, slotKey, aspectRatio, reason: "审核门尚未为该视频节点配置已批准的输入端口" });
          continue;
        }
        inputArtifactIds.push(...sources.map((source) => Number(source.id)));
        inputArtifactSignatures.push(...sources.map((source) => String(source.inputSignature)));
      }
      let compiled;
      try {
        compiled = await compilePromptForProduct({
          projectId: request.projectId,
          productId,
          mediaType: phase,
          slotKey,
          aspectRatio,
          nodeId: node.id,
        });
      } catch (error) {
        skipped.push({ productId, slotKey, aspectRatio, reason: u.error(error).message });
        continue;
      }
      if (!modelSupportsProductReference(compiled.modelMetadata, phase)) {
        skipped.push({ productId, slotKey, aspectRatio, reason: `当前${phase === "image" ? "图片" : "视频"}模型不支持参考图输入` });
        continue;
      }
      let videoParams: Record<string, unknown> | null = null;
      if (phase === "video") {
        try {
          const adapted = adaptVideoParams({
            duration: compiled.input.duration || 5,
            resolution: compiled.input.resolution || "720p",
            audio: Boolean(compiled.input.audio),
          }, compiled.modelMetadata.raw);
          const mode = chooseVideoMode(project.mode, compiled.modelMetadata.modes);
          videoParams = { ...adapted, aspectRatio, mode };
          compiled = await compilePromptForProduct({
            projectId: request.projectId,
            productId,
            mediaType: phase,
            slotKey,
            aspectRatio,
            nodeId: node.id,
            runtime: { ...adapted, mode },
          });
          if (adapted.duration !== Number(safeJsonParse<Record<string, unknown>>(config.defaultPack, {}).videoDuration || 5) || adapted.resolution !== String(safeJsonParse<Record<string, unknown>>(config.defaultPack, {}).videoResolution || "720p") || adapted.audio !== Boolean(safeJsonParse<Record<string, unknown>>(config.defaultPack, {}).videoAudio)) {
            warnings.add(`视频参数已按模型能力适配为 ${adapted.resolution} / ${adapted.duration}秒 / 音频${adapted.audio ? "开启" : "关闭"}`);
          }
        } catch (error) {
          skipped.push({ productId, slotKey, aspectRatio, reason: u.error(error).message });
          continue;
        }
      }
      const allReferences = [...references, ...brandReferences];
      const videoMode = videoParams?.mode;
      const isVideoMultiReference = phase === "video" && Array.isArray(videoMode) && videoMode.some((entry) => typeof entry === "string" && entry.startsWith("imageReference:"));
      const referenceBudget = phase === "image"
        ? Math.max(0, compiled.modelMetadata.maxReferenceImages - inputArtifactIds.length - inputArtifactNodeIds.length)
        : isVideoMultiReference ? Math.max(0, compiled.modelMetadata.maxReferenceImages - inputArtifactIds.length) : 0;
      const relevantReferences = allReferences.slice(0, referenceBudget);
      const submittedReferenceCount = relevantReferences.length + inputArtifactIds.length + inputArtifactNodeIds.length;
      if ((phase === "image" || isVideoMultiReference) && allReferences.length > relevantReferences.length) {
        warnings.add(`当前模型最多使用 ${compiled.modelMetadata.maxReferenceImages} 张参考图，审核图和商品主参考优先，其余参考图不会提交给模型`);
      }
      if (submittedReferenceCount > compiled.modelMetadata.maxReferenceImages) throw new Error("参考图规划超过模型声明上限");
      const signature = compiled.signature;
      const inputSignature = await import("node:crypto").then(({ default: crypto }) => crypto.createHash("sha256").update(JSON.stringify({
        promptSignature: signature,
        inputArtifactIds,
        inputArtifactSignatures,
        model: compiled.input.model,
        phase,
        workflowNodeId: node.id,
        slotKey,
        aspectRatio,
      })).digest("hex"));
      const existingActive = await u.db("o_productFactoryArtifact").where({ inputSignature, workflowNodeId: node.id }).whereIn("state", ["queued", "running"]).first();
      const existingSuccess = request.regenerate ? null : await u.db("o_productFactoryArtifact").where({ inputSignature, workflowNodeId: node.id, state: "success" }).first();
      if (existingActive || existingSuccess) {
        skipped.push({ productId, slotKey, aspectRatio, reason: "已有相同输入签名的待执行、执行中或成功结果" });
        continue;
      }
      const planned: PlannedJob = {
        projectId: request.projectId,
        productId,
        phase,
        workflowNodeId: node.id,
        slotKey,
        aspectRatio,
        model: compiled.input.model,
        prompt: compiled.result.compiledPrompt,
        promptSections: compiled.result.sections,
        templateId: compiled.result.templateId,
        templateVersion: compiled.result.templateVersion,
        promptLanguage: compiled.result.language,
        inputSignature,
        inputReferenceIds: relevantReferences.map((ref) => Number(ref.id)),
        inputArtifactIds,
        inputArtifactNodeIds,
        dependsOnNodeIds,
        params: phase === "image"
          ? { size: compiled.input.mediaType === "image" ? (safeJsonParse<Record<string, unknown>>(config.defaultPack, {}).imageQuality || "2K") : "2K", aspectRatio }
          : videoParams!,
      };
      jobs.push(planned);
      plannedByNode.set(node.id, planned);
    }
  }
  return {
    jobs,
    skipped,
    warnings: [...warnings],
    summary: {
      requestedProducts: productIds.length,
      taskCount: jobs.length,
      skippedCount: skipped.length,
      imageCount: jobs.filter((job) => job.phase === "image").length,
      videoCount: jobs.filter((job) => job.phase === "video").length,
    },
  };
}

export async function enqueueProductFactoryJobs(request: ProductFactoryJobPlanRequest) {
  const plan = await planProductFactoryJobs(request);
  const ids: number[] = [];
  const jobByNode = new Map<string, number>();
  const artifactByNode = new Map<string, number>();
  for (const planned of plan.jobs) {
    const nodeKey = (nodeId: string) => `${planned.productId}:${nodeId}`;
    const dependencyJobIds = planned.dependsOnNodeIds.map((nodeId) => jobByNode.get(nodeKey(nodeId))).filter((id): id is number => Boolean(id));
    const dependencyArtifactIds = planned.inputArtifactNodeIds.map((nodeId) => artifactByNode.get(nodeKey(nodeId))).filter((id): id is number => Boolean(id));
    const inputArtifactIds = uniqueIds([...planned.inputArtifactIds, ...dependencyArtifactIds]);
    let createdArtifactId = 0;
    let createdJobId = 0;
    await u.db.transaction(async (trx) => {
      const versionRow = await trx("o_productFactoryArtifact")
        .where({ projectId: planned.projectId, productId: planned.productId, workflowNodeId: planned.workflowNodeId })
        .max({ version: "version" })
        .first();
      const timestamp = Date.now();
      const [artifactId] = await trx("o_productFactoryArtifact").insert({
        projectId: planned.projectId,
        productId: planned.productId,
        workflowNodeId: planned.workflowNodeId,
        detached: 0,
        mediaType: planned.phase,
        slotKey: planned.slotKey,
        aspectRatio: planned.aspectRatio,
        version: Number((versionRow as any)?.version || 0) + 1,
        templateId: planned.templateId,
        templateVersion: planned.templateVersion,
        promptLanguage: planned.promptLanguage,
        promptSections: JSON.stringify(planned.promptSections),
        prompt: planned.prompt,
        model: planned.model,
        params: JSON.stringify(planned.params),
        inputSignature: planned.inputSignature,
        inputArtifactIds: JSON.stringify(inputArtifactIds),
        filePath: null,
        state: "queued",
        errorReason: null,
        approved: 0,
        isCurrent: 0,
        inputChanged: 0,
        createTime: timestamp,
        updateTime: timestamp,
      });
      const [jobId] = await trx("o_productFactoryJob").insert({
        projectId: planned.projectId,
        productId: planned.productId,
        artifactId: Number(artifactId),
        workflowNodeId: planned.workflowNodeId,
        dependsOnJobIds: JSON.stringify(dependencyJobIds),
        phase: planned.phase,
        slotKey: planned.slotKey,
        aspectRatio: planned.aspectRatio,
        state: "queued",
        attempt: 0,
        model: planned.model,
        prompt: planned.prompt,
        params: JSON.stringify(planned.params),
        inputReferenceIds: JSON.stringify(planned.inputReferenceIds),
        inputArtifactIds: JSON.stringify(inputArtifactIds),
        errorReason: null,
        createTime: timestamp,
        startTime: null,
        endTime: null,
        updateTime: timestamp,
      });
      await trx("o_productFactoryArtifact").where("id", artifactId).update({ jobId: Number(jobId) });
      ids.push(Number(jobId));
      createdArtifactId = Number(artifactId);
      createdJobId = Number(jobId);
    });
    artifactByNode.set(nodeKey(planned.workflowNodeId), createdArtifactId);
    jobByNode.set(nodeKey(planned.workflowNodeId), createdJobId);
    await refreshProductFactoryItemState(planned.projectId, planned.productId);
  }
  scheduleProductFactoryQueue();
  return { ...plan, jobIds: ids };
}

const activeByProject = new Map<number, { image: number; video: number }>();
const deletingProjects = new Set<number>();
let scheduling = false;

function activeFor(projectId: number) {
  let value = activeByProject.get(projectId);
  if (!value) {
    value = { image: 0, video: 0 };
    activeByProject.set(projectId, value);
  }
  return value;
}

export function beginProductFactoryProjectDeletion(projectId: number) {
  const active = activeByProject.get(projectId);
  if (active && active.image + active.video > 0) {
    throw new Error("项目仍有正在生成的任务，请等待任务结束后再删除");
  }
  if (deletingProjects.has(projectId)) throw new Error("项目正在删除，请勿重复操作");
  deletingProjects.add(projectId);
}

export function finishProductFactoryProjectDeletion(projectId: number) {
  deletingProjects.delete(projectId);
}

async function executeProductFactoryJob(jobId: number) {
  const job = await u.db("o_productFactoryJob").where("id", jobId).first();
  if (!job || job.state !== "queued" || deletingProjects.has(Number(job.projectId))) return;
  const artifact = job.artifactId ? await u.db("o_productFactoryArtifact").where("id", job.artifactId).first() : null;
  if (!artifact) throw new Error("任务缺少输出产物记录");
  const timestamp = Date.now();
  await u.db("o_productFactoryJob").where("id", jobId).update({ state: "running", attempt: Number(job.attempt) + 1, startTime: timestamp, endTime: null, errorReason: null, updateTime: timestamp });
  await u.db("o_productFactoryArtifact").where("id", artifact.id).update({ state: "running", errorReason: null, updateTime: timestamp });
  await refreshProductFactoryItemState(job.projectId, job.productId);
  try {
    const params = JSON.parse(job.params || "{}");
    const relatedObjects = JSON.stringify({ productFactoryJobId: jobId, productId: job.productId, artifactId: artifact.id, slotKey: job.slotKey, aspectRatio: job.aspectRatio });
    const extension = job.phase === "image" ? "png" : "mp4";
    const outputPath = `product-factory/${job.projectId}/${job.productId}/${job.phase}/${job.slotKey}-${job.aspectRatio.replace(":", "x")}-${artifact.version}-${u.uuid()}.${extension}`;
    if (job.phase === "image") {
      const sourceIds = JSON.parse(job.inputArtifactIds || "[]") as number[];
      const sources = sourceIds.length ? await u.db("o_productFactoryArtifact").whereIn("id", sourceIds).where({ projectId: job.projectId, productId: job.productId, mediaType: "image", state: "success" }) : [];
      sources.sort((left, right) => sourceIds.indexOf(Number(left.id)) - sourceIds.indexOf(Number(right.id)));
      if (sources.length !== sourceIds.length || sources.some((source) => !source.filePath)) throw new Error("图片任务的必要上游产物尚未完成");
      const refIds = JSON.parse(job.inputReferenceIds || "[]") as number[];
      const refs = refIds.length ? await u.db("o_productFactoryReference").whereIn("id", refIds).where({ projectId: job.projectId }) : [];
      refs.sort((left, right) => refIds.indexOf(Number(left.id)) - refIds.indexOf(Number(right.id)));
      if (!refs.length && !sources.length) throw new Error("图片任务缺少商品参考图或上游图片");
      const referenceList = [
        ...await Promise.all(sources.map(async (source) => ({ type: "image" as const, base64: await u.oss.getImageBase64(source.filePath!) }))),
        ...await Promise.all(refs.map(async (ref) => ({ type: "image" as const, base64: await u.oss.getImageBase64(ref.filePath) }))),
      ];
      const image = await u.Ai.Image(job.model as `${string}:${string}`).run(
        { prompt: job.prompt, referenceList, size: params.size || "2K", aspectRatio: job.aspectRatio as `${number}:${number}` },
        { projectId: job.projectId, taskClass: "商品视觉-图片生成", describe: `${job.slotKey} ${job.aspectRatio}`, relatedObjects },
      );
      await image.save(outputPath);
    } else {
      const sourceIds = JSON.parse(job.inputArtifactIds || "[]") as number[];
      const sources = sourceIds.length ? await u.db("o_productFactoryArtifact").whereIn("id", sourceIds).where({ projectId: job.projectId, productId: job.productId, mediaType: "image", state: "success", approved: 1 }) : [];
      if (!sources.length || sources.some((source) => !source.filePath)) throw new Error("视频任务缺少已批准的来源图");
      const refIds = JSON.parse(job.inputReferenceIds || "[]") as number[];
      const supplementalRefs = refIds.length ? await u.db("o_productFactoryReference").whereIn("id", refIds).where({ projectId: job.projectId }) : [];
      supplementalRefs.sort((left, right) => refIds.indexOf(Number(left.id)) - refIds.indexOf(Number(right.id)));
      let referenceList = [
        ...await Promise.all(sources.map(async (source) => ({ type: "image" as const, base64: await u.oss.getImageBase64(source.filePath!) }))),
        ...await Promise.all(supplementalRefs.map(async (ref) => ({ type: "image" as const, base64: await u.oss.getImageBase64(ref.filePath) }))),
      ] as ReferenceList[];
      if (params.mode === "startEndRequired" && referenceList.length === 1) referenceList = [referenceList[0], referenceList[0]];
      const video = await u.Ai.Video(job.model as `${string}:${string}`).run(
        {
          prompt: job.prompt,
          referenceList,
          mode: params.mode || "singleImage",
          duration: Number(params.duration || 5),
          aspectRatio: job.aspectRatio as "16:9" | "9:16",
          resolution: String(params.resolution || "720p"),
          audio: Boolean(params.audio),
        },
        { projectId: job.projectId, taskClass: "商品视觉-视频生成", describe: `${job.slotKey} ${job.aspectRatio}`, relatedObjects },
      );
      await video.save(outputPath);
    }
    await u.db.transaction(async (trx) => {
      await trx("o_productFactoryArtifact")
        .where({ projectId: job.projectId, productId: job.productId, workflowNodeId: job.workflowNodeId, isCurrent: 1 })
        .whereNot("id", artifact.id)
        .update({ isCurrent: 0, updateTime: Date.now() });
      await trx("o_productFactoryArtifact").where("id", artifact.id).update({ state: "success", filePath: outputPath, isCurrent: 1, errorReason: null, updateTime: Date.now() });
      await trx("o_productFactoryJob").where("id", jobId).update({ state: "success", errorReason: null, endTime: Date.now(), updateTime: Date.now() });
    });
  } catch (error) {
    const reason = u.error(error).message || "生成失败";
    await u.db("o_productFactoryArtifact").where("id", artifact.id).update({ state: "failed", errorReason: reason, updateTime: Date.now() });
    await u.db("o_productFactoryJob").where("id", jobId).update({ state: "failed", errorReason: reason, endTime: Date.now(), updateTime: Date.now() });
  } finally {
    await refreshProductFactoryItemState(job.projectId, job.productId);
  }
}

async function runScheduledJob(jobId: number, projectId: number, phase: ProductFactoryPhase) {
  const active = activeFor(projectId);
  active[phase] += 1;
  try {
    await executeProductFactoryJob(jobId);
  } finally {
    active[phase] = Math.max(0, active[phase] - 1);
    scheduleProductFactoryQueue();
  }
}

export function scheduleProductFactoryQueue() {
  if (scheduling) return;
  scheduling = true;
  setImmediate(async () => {
    try {
      const jobs = await u.db("o_productFactoryJob").where("state", "queued").orderBy("id", "asc").limit(100);
      const configs = new Map<number, Awaited<ReturnType<typeof ensureProductFactoryConfig>>>();
      for (const job of jobs) {
        const projectId = Number(job.projectId);
        const phase = job.phase as ProductFactoryPhase;
        let config = configs.get(projectId);
        if (!config) {
          config = await ensureProductFactoryConfig(projectId);
          configs.set(projectId, config);
        }
        const active = activeFor(projectId);
        const limit = phase === "image" ? Number(config.imageConcurrency || 2) : Number(config.videoConcurrency || 1);
        if (active[phase] >= limit) continue;
        const dependencyIds = safeJsonParse<number[]>(job.dependsOnJobIds, []);
        if (dependencyIds.length) {
          const dependencies = await u.db("o_productFactoryJob").whereIn("id", dependencyIds).select("state");
          if (dependencies.some((dependency) => ["failed", "cancelled", "interrupted"].includes(String(dependency.state)))) {
            const reason = "必要上游任务失败或被取消";
            await u.db("o_productFactoryJob").where("id", job.id).update({ state: "failed", errorReason: reason, endTime: Date.now(), updateTime: Date.now() });
            if (job.artifactId) await u.db("o_productFactoryArtifact").where("id", job.artifactId).update({ state: "failed", errorReason: reason, updateTime: Date.now() });
            await refreshProductFactoryItemState(projectId, Number(job.productId));
            continue;
          }
          if (dependencies.length !== dependencyIds.length || dependencies.some((dependency) => dependency.state !== "success")) continue;
        }
        void runScheduledJob(Number(job.id), projectId, phase);
      }
    } finally {
      scheduling = false;
    }
  });
}

export async function waitForProductFactoryQueueIdle(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = [...activeByProject.values()].reduce((sum, value) => sum + value.image + value.video, 0);
    const pending = await u.db("o_productFactoryJob").whereIn("state", ["queued", "running"]).count({ count: "id" }).first();
    if (!scheduling && active === 0 && Number((pending as any)?.count || 0) === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!scheduling) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("等待商品视觉工厂队列空闲超时");
}

export async function getProductFactoryJobProgress(projectId: number, productIds?: number[]) {
  await requireProductFactoryProject(projectId, true);
  const ids = uniqueIds(productIds || []);
  let jobsQuery = u.db("o_productFactoryJob").where("projectId", projectId);
  let countQuery = u.db("o_productFactoryJob").where("projectId", projectId);
  if (ids.length) {
    jobsQuery = jobsQuery.whereIn("productId", ids);
    countQuery = countQuery.whereIn("productId", ids);
  }
  const [jobs, countRows] = await Promise.all([
    jobsQuery.orderBy("id", "desc").limit(100),
    countQuery.select("state").count({ count: "id" }).groupBy("state"),
  ]);
  const counts = Object.fromEntries(countRows.map((row: any) => [row.state, Number(row.count)]));
  return { jobs, counts, active: activeByProject.get(projectId) || { image: 0, video: 0 } };
}

export async function resumeProductFactoryJobs(projectId: number, jobIds?: number[]) {
  const ids = uniqueIds(jobIds || []);
  let query = u.db("o_productFactoryJob").where("projectId", projectId).whereIn("state", ["paused", "interrupted"]);
  if (ids.length) query = query.whereIn("id", ids);
  const jobs = await query.select("id", "artifactId", "productId");
  if (jobs.length) {
    await u.db("o_productFactoryJob").whereIn("id", jobs.map((job) => Number(job.id))).update({ state: "queued", errorReason: null, startTime: null, endTime: null, updateTime: Date.now() });
    await u.db("o_productFactoryArtifact").whereIn("id", jobs.map((job) => Number(job.artifactId)).filter(Boolean)).update({ state: "queued", errorReason: null, updateTime: Date.now() });
  }
  for (const job of jobs) await refreshProductFactoryItemState(projectId, Number(job.productId));
  scheduleProductFactoryQueue();
  return { resumed: jobs.length };
}

export async function retryProductFactoryJobs(projectId: number, jobIds: number[]) {
  const ids = uniqueIds(jobIds);
  if (!ids.length) throw new Error("请选择要重试的任务");
  const jobs = await u.db("o_productFactoryJob").where({ projectId }).whereIn("id", ids).whereIn("state", ["failed", "interrupted"]);
  if (jobs.length) {
    await u.db("o_productFactoryJob").whereIn("id", jobs.map((job) => Number(job.id))).update({ state: "queued", errorReason: null, startTime: null, endTime: null, updateTime: Date.now() });
    await u.db("o_productFactoryArtifact").whereIn("id", jobs.map((job) => Number(job.artifactId)).filter(Boolean)).update({ state: "queued", errorReason: null, updateTime: Date.now() });
  }
  scheduleProductFactoryQueue();
  return { retried: jobs.length };
}

export async function cancelQueuedProductFactoryJobs(projectId: number, jobIds?: number[]) {
  const ids = uniqueIds(jobIds || []);
  let query = u.db("o_productFactoryJob").where({ projectId, state: "queued" });
  if (ids.length) query = query.whereIn("id", ids);
  const jobs = await query.select("id", "artifactId", "productId");
  if (jobs.length) {
    await u.db("o_productFactoryJob").whereIn("id", jobs.map((job) => Number(job.id))).update({ state: "cancelled", endTime: Date.now(), updateTime: Date.now() });
    await u.db("o_productFactoryArtifact").whereIn("id", jobs.map((job) => Number(job.artifactId)).filter(Boolean)).update({ state: "cancelled", updateTime: Date.now() });
  }
  for (const job of jobs) await refreshProductFactoryItemState(projectId, Number(job.productId));
  return { cancelled: jobs.length };
}
