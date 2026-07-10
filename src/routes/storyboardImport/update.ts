import express from "express";
import { db } from "@/utils/db";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { recalculateStoryboardTracks } from "./recalculateTracks";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    projectId: z.number(),
    prompt: z.string(),
    videoDesc: z.string(),
    duration: z.number(),
    track: z.string(),
    shouldGenerateImage: z.number(),
    associateAssetsIds: z.array(z.number()).optional(),
  }),
  async (req, res) => {
    const { id, projectId, prompt, videoDesc, duration, track, shouldGenerateImage, associateAssetsIds = [] } = req.body as {
      id: number;
      projectId: number;
      prompt: string;
      videoDesc: string;
      duration: number;
      track: string;
      shouldGenerateImage: number;
      associateAssetsIds?: number[];
    };
    if (duration <= 0) return res.status(400).send(error("时长必须大于 0"));

    try {
      const result = await db.transaction(async (trx: any) => {
        const storyboard = await trx("o_storyboard").where({ id, projectId }).first();
        if (!storyboard) throw new Error("分镜不存在");

        await trx("o_storyboard").where({ id, projectId }).update({
          prompt,
          videoDesc,
          duration: String(duration),
          track: track || "默认分组",
          shouldGenerateImage,
        });

        await trx("o_assets2Storyboard").where("storyboardId", id).delete();
        const uniqueAssetIds = [...new Set(associateAssetsIds.filter((assetId) => Number.isInteger(assetId) && assetId > 0))];
        if (uniqueAssetIds.length !== associateAssetsIds.length) throw new Error("关联资产 ID 必须是有效的正整数");
        if (uniqueAssetIds.length) {
          const validAssets = await trx("o_assets")
            .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
            .where("o_assets.projectId", projectId)
            .where("o_scriptAssets.scriptId", storyboard.scriptId)
            .whereIn("o_assets.id", uniqueAssetIds)
            .distinct("o_assets.id");
          const validAssetIds = validAssets.map((item: { id: number }) => item.id);
          if (validAssetIds.length !== uniqueAssetIds.length) {
            const validAssetIdSet = new Set(validAssetIds);
            const invalidAssetIds = uniqueAssetIds.filter((assetId) => !validAssetIdSet.has(assetId));
            throw new Error(`关联资产不属于当前项目和分镜表批次：${invalidAssetIds.join(", ")}`);
          }
          await trx("o_assets2Storyboard").insert(
            validAssetIds.map((assetId: number) => ({
              storyboardId: id,
              assetId,
            })),
          );
        }

        await recalculateStoryboardTracks(trx, projectId, [Number(storyboard.scriptId)]);
        return { message: "更新分镜成功" };
      });

      res.status(200).send(success(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "更新分镜失败";
      res.status(400).send(error(message));
    }
  },
);
