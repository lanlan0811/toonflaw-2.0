import u from "@/utils";
import { ensureProductWorkflow, refreshProductFactoryItemState, updateProductWorkflow } from "@/lib/productFactory/service";
import type { ProductFactoryReviewBindings } from "@/lib/productFactory/types";

export interface ReviewSelection {
  artifactId: number;
  nodeId?: string;
}

export async function submitProductFactoryReview(
  projectId: number,
  productId: number,
  selections: ReviewSelection[],
  reviewMappings?: Record<string, number | null>,
  reviewBindings?: ProductFactoryReviewBindings,
) {
  const workflow = await ensureProductWorkflow(projectId, productId);
  const ids = [...new Set(selections.map((selection) => Number(selection.artifactId)).filter((id) => Number.isInteger(id) && id > 0))];
  const artifacts = ids.length
    ? await u.db("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", state: "success" }).whereIn("id", ids)
    : [];
  if (artifacts.length !== ids.length) throw new Error("审核选择包含不存在、失败或不属于该商品的图片");
  await u.db.transaction(async (trx) => {
    for (const artifact of artifacts) {
      const selection = selections.find((candidate) => Number(candidate.artifactId) === Number(artifact.id));
      if (selection?.nodeId && artifact.workflowNodeId && selection.nodeId !== artifact.workflowNodeId) throw new Error("审核图片与图片节点不匹配");
      const siblingQuery = trx("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image" });
      if (artifact.workflowNodeId) siblingQuery.where("workflowNodeId", artifact.workflowNodeId);
      else siblingQuery.where({ slotKey: artifact.slotKey, aspectRatio: artifact.aspectRatio });
      await siblingQuery.update({ approved: 0, isCurrent: 0, updateTime: Date.now() });
      await trx("o_productFactoryArtifact").where("id", artifact.id).update({ approved: 1, isCurrent: 1, updateTime: Date.now() });
    }
  });
  const allowedIds = new Set(artifacts.map((artifact) => Number(artifact.id)));
  const approvedRows = await u.db("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", state: "success", approved: 1 });
  for (const row of approvedRows) allowedIds.add(Number(row.id));
  if (reviewBindings) {
    for (const [videoNodeId, bindings] of Object.entries(reviewBindings)) {
      const videoNode = workflow.graph.nodes.find((node) => node.id === videoNodeId && node.type === "video");
      if (!videoNode) throw new Error(`审核绑定引用了不存在的视频节点 ${videoNodeId}`);
      workflow.graph.reviewBindings[videoNodeId] ||= {};
      for (const [portId, value] of Object.entries(bindings || {})) {
        if (!videoNode.data.inputs?.some((port) => port.id === portId)) throw new Error(`视频节点 ${videoNodeId} 不存在输入端口 ${portId}`);
        const values = Array.isArray(value) ? value.map(Number) : value === null ? [] : [Number(value)];
        if (values.some((id) => !allowedIds.has(id))) throw new Error(`视频节点 ${videoNodeId} 的 ${portId} 端口必须引用已批准图片`);
        workflow.graph.reviewBindings[videoNodeId][portId] = Array.isArray(value) ? values : value === null ? null : values[0];
      }
      const legacyKey = `${String(videoNode.data.slotKey || "")}:${String(videoNode.data.aspectRatio || "")}`;
      const primary = workflow.graph.reviewBindings[videoNodeId].primary;
      workflow.graph.reviewMappings[legacyKey] = Array.isArray(primary) ? Number(primary[0] || 0) || null : Number(primary || 0) || null;
    }
  } else if (reviewMappings) {
    for (const [key, value] of Object.entries(reviewMappings)) {
      const id = value === null ? null : Number(value);
      if (id !== null && !allowedIds.has(id)) throw new Error(`视频来源 ${key} 必须引用已批准图片`);
      workflow.graph.reviewMappings[key] = id;
      const node = workflow.graph.nodes.find((candidate) => candidate.type === "video" && `${candidate.data.slotKey}:${candidate.data.aspectRatio}` === key);
      if (node) workflow.graph.reviewBindings[node.id] = { ...(workflow.graph.reviewBindings[node.id] || {}), primary: id };
    }
  } else {
    for (const ratio of ["9:16", "16:9"]) {
      const hero = approvedRows.find((row) => row.slotKey === "scene_studio" && row.aspectRatio === ratio);
      const lifestyle = approvedRows.find((row) => row.slotKey === "scene_lifestyle" && row.aspectRatio === ratio);
      workflow.graph.reviewMappings[`video_hero:${ratio}`] = hero?.id ? Number(hero.id) : null;
      workflow.graph.reviewMappings[`video_lifestyle:${ratio}`] = lifestyle?.id ? Number(lifestyle.id) : null;
      const heroNode = workflow.graph.nodes.find((node) => node.type === "video" && node.data.slotKey === "video_hero" && node.data.aspectRatio === ratio);
      const lifestyleNode = workflow.graph.nodes.find((node) => node.type === "video" && node.data.slotKey === "video_lifestyle" && node.data.aspectRatio === ratio);
      if (heroNode) workflow.graph.reviewBindings[heroNode.id] = { ...(workflow.graph.reviewBindings[heroNode.id] || {}), primary: hero?.id ? Number(hero.id) : null };
      if (lifestyleNode) workflow.graph.reviewBindings[lifestyleNode.id] = { ...(workflow.graph.reviewBindings[lifestyleNode.id] || {}), primary: lifestyle?.id ? Number(lifestyle.id) : null };
    }
  }
  await updateProductWorkflow(projectId, productId, workflow.graph, Boolean(workflow.customized), true);
  const state = await refreshProductFactoryItemState(projectId, productId);
  return { approvedArtifactIds: [...allowedIds], reviewMappings: workflow.graph.reviewMappings, reviewBindings: workflow.graph.reviewBindings, state };
}
