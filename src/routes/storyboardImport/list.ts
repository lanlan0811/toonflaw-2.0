import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { serializeStoryboardImportListRow, type StoryboardImportListRow } from "@/lib/storyboardImportList";
import { validateFields } from "@/middleware/middleware";
import { resolveExactRoleAssociations } from "@/lib/storyboardAssetAssociations";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
    keyword: z.string().optional().nullable(),
    page: z.number().optional(),
    pageSize: z.number().optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, keyword, page = 1, pageSize = 50 } = req.body as { projectId: number; scriptId?: number | null; keyword?: string | null; page?: number; pageSize?: number };
    const offset = (page - 1) * pageSize;

    if (scriptId) {
      const script = await u.db("o_script").where({ id: scriptId, projectId }).first();
      if (!script) return res.status(400).send(error("分镜表批次不存在或不属于当前项目"));
    }

    const query = u
      .db("o_storyboard")
      .where({ projectId })
      .modify((qb) => {
        if (scriptId) qb.where("scriptId", scriptId);
        const text = keyword?.trim();
        if (!text) return;
        qb.andWhere((builder) => {
          builder.where("prompt", "like", `%${text}%`).orWhere("videoDesc", "like", `%${text}%`).orWhere("track", "like", `%${text}%`);
        });
      });

    const rows = await query.clone().orderBy("index", "asc").orderBy("id", "asc").offset(offset).limit(pageSize);
    const totalQuery = (await query.clone().count("* as total").first()) as { total?: number } | undefined;
    const storyboardIds = rows.map((item: { id?: number }) => item.id!).filter(Boolean);

    const relations = storyboardIds.length
      ? await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).select("storyboardId", "assetId", "assetRevision", "referenceEnabled")
      : [];
    const assetIds = [
      ...new Set(relations.map((item: { assetId?: number }) => Number(item.assetId)).filter((assetId): assetId is number => Number.isInteger(assetId) && assetId > 0)),
    ];
    const assets = assetIds.length
      ? await u
          .db("o_assets")
          .leftJoin("o_image", "o_assets.imageId", "o_image.id")
          .whereIn("o_assets.id", assetIds)
          .select(
            "o_assets.id",
            "o_assets.name",
            "o_assets.type",
            "o_assets.describe",
            "o_assets.imageId",
            "o_assets.prompt",
            "o_assets.promptState",
            "o_assets.promptErrorReason",
            "o_assets.flowId",
            "o_assets.revision",
            "o_image.state as imageState",
            "o_image.filePath",
          )
      : [];
    const assetsWithUrls = await Promise.all(
      assets.map(async (item) => {
        const validImage = Boolean(item.filePath && (await u.oss.fileExists(item.filePath)));
        return {
          ...item,
          validImage,
          src: validImage ? await u.oss.getSmallImageUrl(item.filePath) : "",
          originalSrc: validImage ? await u.oss.getFileUrl(item.filePath) : "",
        };
      }),
    );
    const assetMap = new Map(assetsWithUrls.map((item) => [Number(item.id), item]));
    const overrides = storyboardIds.length ? await u.db("o_storyboardAssetOverride").whereIn("storyboardId", storyboardIds) : [];
    const overridesWithUrls = await Promise.all(
      overrides.map(async (item) => {
        const validImage = Boolean(item.filePath && (await u.oss.fileExists(item.filePath)));
        return {
          ...item,
          validImage,
          src: validImage ? await u.oss.getSmallImageUrl(item.filePath) : "",
          originalSrc: validImage ? await u.oss.getFileUrl(item.filePath) : "",
        };
      }),
    );
    const overrideMap = new Map(overridesWithUrls.map((item) => [`${Number(item.storyboardId)}:${Number(item.assetId)}`, item]));
    const exclusions = storyboardIds.length ? await u.db("o_storyboardAssetExclusion").whereIn("storyboardId", storyboardIds).select("storyboardId", "assetId") : [];
    const excludedIdsByStoryboard = exclusions.reduce((result, item) => {
      const ids = result.get(Number(item.storyboardId)) ?? [];
      ids.push(Number(item.assetId));
      result.set(Number(item.storyboardId), ids);
      return result;
    }, new Map<number, number[]>());
    const relationMap = relations.reduce<Record<number, any[]>>((result, item) => {
      if (!item.storyboardId) return result;
      if (!result[item.storyboardId]) result[item.storyboardId] = [];
      const asset = assetMap.get(Number(item.assetId));
      if (asset) {
        result[item.storyboardId].push({
          ...asset,
          assetRevision: Number(item.assetRevision ?? 1),
          referenceEnabled: item.referenceEnabled === 0 ? 0 : 1,
          localOverride: overrideMap.get(`${Number(item.storyboardId)}:${Number(item.assetId)}`) ?? null,
        });
      }
      return result;
    }, {});

    const assetQuery = u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .whereIn("o_assets.type", ["role", "scene", "tool"]);
    if (scriptId) {
      assetQuery
        .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
        .where("o_scriptAssets.scriptId", scriptId);
    }
    const projectAssets = await assetQuery.distinct(
      "o_assets.id",
      "o_assets.name",
      "o_assets.type",
      "o_assets.assetsId",
      "o_assets.describe",
      "o_assets.imageId",
      "o_assets.prompt",
      "o_assets.promptState",
      "o_assets.promptErrorReason",
      "o_assets.flowId",
      "o_assets.revision",
      "o_image.state as imageState",
      "o_image.errorReason as imageErrorReason",
      "o_image.filePath",
    );
    const assetsWithSrc = await Promise.all(
      projectAssets.map(async (item) => {
        const imageState = String(item.imageState ?? "").toLowerCase();
        const imageCompleted = ["已完成", "生成成功", "success", "completed"].includes(imageState);
        const validImage = Boolean(imageCompleted && item.filePath && (await u.oss.fileExists(item.filePath)));
        return {
          ...item,
          validImage,
          src: validImage ? await u.oss.getSmallImageUrl(item.filePath) : "",
          originalSrc: validImage ? await u.oss.getFileUrl(item.filePath) : "",
        };
      }),
    );
    const scripts = await u
      .db("o_script")
      .leftJoin("o_storyboard", function () {
        this.on("o_storyboard.scriptId", "=", "o_script.id").andOn("o_storyboard.projectId", "=", "o_script.projectId");
      })
      .where("o_script.projectId", projectId)
      .groupBy("o_script.id", "o_script.name", "o_script.createTime")
      .orderBy("o_script.createTime", "desc")
      .select("o_script.id", "o_script.name", "o_script.createTime")
      .count("o_storyboard.id as storyboardCount");

    const data = await Promise.all(
      rows.map(async (item: StoryboardImportListRow) => {
        const storyboardAssets = relationMap[item.id!] ?? [];
        const automatic = await resolveExactRoleAssociations(u.db, {
          projectId,
          scriptId: Number(item.scriptId),
          storyboardId: Number(item.id),
          prompt: item.prompt,
          videoDesc: item.videoDesc,
        });
        const associatedIds = new Set(storyboardAssets.map((asset: any) => Number(asset.id)));
        const diagnostics = {
          automaticHitAssetIds: automatic.matched.map((asset) => Number(asset.id)),
          missingAssociationAssetIds: automatic.matched.map((asset) => Number(asset.id)).filter((assetId) => !associatedIds.has(assetId)),
          excludedAssetIds: excludedIdsByStoryboard.get(Number(item.id)) ?? [],
          disabledReferenceAssetIds: storyboardAssets.filter((asset: any) => asset.referenceEnabled === 0).map((asset: any) => Number(asset.id)),
          missingImageRoles: storyboardAssets
            .filter(
              (asset: any) =>
                asset.type === "role" &&
                asset.referenceEnabled !== 0 &&
                !asset.localOverride?.validImage &&
                (!asset.validImage || asset.imageState !== "已完成"),
            )
            .map((asset: any) => ({ assetId: Number(asset.id), name: asset.name })),
          staleAssetIds: storyboardAssets
            .filter(
              (asset: any) =>
                asset.referenceEnabled !== 0 &&
                !asset.localOverride &&
                Number(asset.assetRevision ?? 1) < Number(asset.revision ?? 1),
            )
            .map((asset: any) => Number(asset.id)),
          ambiguousRoleNames: automatic.ambiguous,
        };
        return {
          ...(await serializeStoryboardImportListRow(item, storyboardAssets, (filePath) => u.oss.getSmallImageUrl(filePath))),
          associationDiagnostics: diagnostics,
        };
      }),
    );

    res.status(200).send(
      success({
        data,
        total: Number(totalQuery?.total ?? 0),
        assets: assetsWithSrc,
        scripts: scripts.map((item) => ({
          ...item,
          storyboardCount: Number(item.storyboardCount ?? 0),
        })),
      }),
    );
  },
);
