import u from "@/utils";

export interface CanvasAssetSelection {
  assetId: number;
  sourceNodeId?: string | null;
  referenceEnabled: boolean;
  mode: "global" | "local";
  filePath?: string | null;
  describe?: string | null;
  prompt?: string | null;
  baseAssetRevision?: number;
}

export function normalizeCanvasGraph(nodesValue: unknown, edgesValue: unknown) {
  const nodes = Array.isArray(nodesValue) ? structuredClone(nodesValue) : [];
  const edges = Array.isArray(edgesValue) ? structuredClone(edgesValue) : [];
  nodes.forEach((node: any) => {
    if (!node?.data) return;
    for (const key of ["image", "generatedImage", "globalImage", "originalSrc"]) {
      if (typeof node.data[key] === "string" && node.data[key]) node.data[key] = u.replaceUrl(node.data[key]);
    }
    if (Array.isArray(node.data.references)) {
      node.data.references.forEach((reference: any) => {
        if (typeof reference?.image === "string" && reference.image) reference.image = u.replaceUrl(reference.image);
      });
    }
  });
  return { nodes, edges };
}

export function assertNoUnpublishedDraftReference(nodesValue: unknown, edgesValue: unknown) {
  const nodes = Array.isArray(nodesValue) ? nodesValue : [];
  const edges = Array.isArray(edgesValue) ? edgesValue : [];
  const nodeMap = new Map(nodes.map((node: any) => [String(node?.id), node]));
  const finalIds = new Set(nodes.filter((node: any) => node?.data?.finalNode || node?.data?.isFinal).map((node: any) => String(node.id)));
  const invalid = edges.some((edge: any) => {
    if (!finalIds.has(String(edge?.target))) return false;
    const source = nodeMap.get(String(edge?.source));
    return Boolean(source?.data?.draftAsset && !Number(source?.data?.assetId) && source?.data?.assetScope !== "canvas");
  });
  if (invalid) throw new Error("未发布的角色、场景或道具草稿不能连接最终分镜，请先发布为正式资产。");
}

export async function persistCanvasAssetSelections(
  trx: any,
  input: {
    projectId: number;
    scriptId: number;
    storyboardId: number;
    selections: CanvasAssetSelection[];
  },
) {
  const { projectId, scriptId, storyboardId, selections } = input;
  const assetIds = selections.map((selection) => Number(selection.assetId));
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length !== assetIds.length) throw new Error("画布资产选择不能包含重复资产");
  if (!uniqueAssetIds.length) return { addedAssetIds: [] as number[] };

  const assets = await trx("o_assets")
    .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
    .where("o_assets.projectId", projectId)
    .where("o_scriptAssets.scriptId", scriptId)
    .whereIn("o_assets.id", uniqueAssetIds)
    .distinct("o_assets.id", "o_assets.revision");
  const assetById = new Map<number, { id: number; revision?: number }>(assets.map((asset: any) => [Number(asset.id), asset]));
  const invalidAssetIds = uniqueAssetIds.filter((assetId) => !assetById.has(assetId));
  if (invalidAssetIds.length) throw new Error(`资产不属于当前项目和分镜表批次：${invalidAssetIds.join(", ")}`);

  const currentRelations = await trx("o_assets2Storyboard").where("storyboardId", storyboardId).select("assetId");
  const currentRelationIds = new Set(currentRelations.map((relation: any) => Number(relation.assetId)));
  const addedAssetIds: number[] = [];

  for (const selection of selections) {
    const assetId = Number(selection.assetId);
    const asset = assetById.get(assetId)!;
    const revision = Math.max(1, Number(asset.revision ?? 1));
    if (!currentRelationIds.has(assetId)) {
      await trx("o_assets2Storyboard").insert({
        storyboardId,
        assetId,
        assetRevision: revision,
        referenceEnabled: selection.referenceEnabled ? 1 : 0,
      });
      await trx("o_storyboardAssetExclusion").where({ storyboardId, assetId }).delete();
      currentRelationIds.add(assetId);
      addedAssetIds.push(assetId);
    }

    const relationUpdate: Record<string, number> = { referenceEnabled: selection.referenceEnabled ? 1 : 0 };
    if (selection.mode === "local") {
      const filePath = u.replaceUrl(selection.filePath || "");
      if (!filePath) throw new Error(`资产 ${assetId} 的本分镜版本没有有效图片`);
      if (!(await u.oss.fileExists(filePath))) throw new Error(`资产 ${assetId} 的本分镜版本图片已不存在，请重新上传或选择版本`);
      await trx("o_storyboardAssetOverride")
        .insert({
          storyboardId,
          assetId,
          filePath,
          describe: selection.describe ?? null,
          prompt: selection.prompt ?? null,
          sourceNodeId: selection.sourceNodeId ?? null,
          baseAssetRevision: Number(selection.baseAssetRevision ?? revision),
          updateTime: Date.now(),
        })
        .onConflict(["storyboardId", "assetId"])
        .merge();
    } else {
      await trx("o_storyboardAssetOverride").where({ storyboardId, assetId }).delete();
      relationUpdate.assetRevision = revision;
    }
    await trx("o_assets2Storyboard").where({ storyboardId, assetId }).update(relationUpdate);
  }

  return { addedAssetIds };
}

export async function copyCanvasImageToAsset(projectId: number, scriptId: number, type: string, imageUrl: string) {
  const sourcePath = u.replaceUrl(imageUrl).replace(/^\/smallImage\//, "/");
  if (!sourcePath) throw new Error("请先选择有效的资产图片");
  const base64 = await u.oss.getImageBase64(sourcePath);
  const extension = sourcePath.match(/\.(png|jpe?g|webp)$/i)?.[0]?.toLowerCase() || ".jpg";
  const savePath = `/${projectId}/assets/${scriptId}/${type}/${u.uuid()}${extension}`;
  await u.oss.writeFile(savePath, base64);
  return savePath;
}
