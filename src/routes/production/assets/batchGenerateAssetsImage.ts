import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();
const imageQualities = ["1K", "2K", "4K"] as const;
type ImageQuality = (typeof imageQualities)[number];

const derivativeVisualManualByType: Record<string, string> = {
  role: "art_character_derivative",
  tool: "art_prop_derivative",
  scene: "art_scene_derivative",
};

export default router.post(
  "/",
  validateFields({
    assetIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const { assetIds, projectId, scriptId, concurrentCount = 5 } = req.body;

    const requestedAssetIds = [...new Set((assetIds as number[]).filter((id) => Number.isFinite(id)))];
    if (!requestedAssetIds.length) return res.status(400).send(error("assetIds不能为空"));

    const projectSettingData = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "artStyle").first();
    if (!projectSettingData) return res.status(400).send(error("未找到对应项目"));

    const imageModel = projectSettingData.imageModel?.trim();
    if (!imageModel) return res.status(400).send(error("项目未配置图片生成模型（imageModel）"));
    if (!/^[^:]+:.+$/.test(imageModel)) return res.status(400).send(error(`项目图片生成模型配置无效：${imageModel}`));

    const imageQuality = projectSettingData.imageQuality?.trim();
    if (!imageQuality) return res.status(400).send(error("项目未配置图片生成质量（imageQuality）"));
    if (!imageQualities.includes(imageQuality as ImageQuality)) {
      return res.status(400).send(error(`项目图片生成质量无效：${imageQuality}，仅支持 ${imageQualities.join("、")}`));
    }

    const script = await u.db("o_script").where({ id: scriptId, projectId }).first();
    if (!script) return res.status(400).send(error("未找到对应剧本"));

    const assetsDataArr = await u
      .db("o_assets")
      .join("o_scriptAssets", "o_assets.id", "o_scriptAssets.assetId")
      .where("o_assets.projectId", projectId)
      .where("o_scriptAssets.scriptId", scriptId)
      .whereIn("o_assets.id", requestedAssetIds)
      .whereNotNull("o_assets.assetsId")
      .select("o_assets.id", "o_assets.describe", "o_assets.name", "o_assets.type", "o_assets.assetsId", "o_assets.prompt");
    const validAssetIds = new Set(assetsDataArr.map((item) => item.id));
    if (validAssetIds.size !== requestedAssetIds.length) {
      return res.status(400).send(error("资产必须属于当前项目和剧本，且必须为衍生资产"));
    }

    const parentIds = [...new Set(assetsDataArr.map((item) => item.assetsId as number))];
    const parentAssetsData = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .whereIn("o_assets.id", parentIds)
      .select("o_assets.id", "o_image.filePath", "o_assets.describe");
    if (new Set(parentAssetsData.map((item) => item.id)).size !== parentIds.length) {
      return res.status(400).send(error("衍生资产的父资产不存在或不属于当前项目"));
    }

    assetsDataArr.forEach((item: any) => {
      const parent = parentAssetsData.find((parentItem) => parentItem.id === item.assetsId);
      if (parent) item.parentDescribe = parent.describe;
    });
    const imageUrlRecord: Record<number, string> = {};
    parentAssetsData.forEach((item) => {
      if (item.filePath) imageUrlRecord[item.id] = item.filePath;
    });

    // 每个任务开始前先原子创建“生成中”记录并关联资产，后续所有生成阶段都可落失败状态。
    const imageIdMap: Record<number, number> = {};
    await u.db.transaction(async (trx) => {
      for (const item of assetsDataArr) {
        const [imageId] = await trx("o_image").insert({
          assetsId: item.id,
          type: item.type,
          state: "生成中",
          errorReason: null,
          resolution: imageQuality,
          model: imageModel,
        });
        const updated = await trx("o_assets").where({ id: item.id, projectId }).update({ imageId });
        if (!updated) throw new Error(`资产 ${item.id} 不存在，无法关联图片任务`);
        imageIdMap[item.id!] = imageId;
      }
    });

    res.status(200).send(success("开始生成资产图片"));

    const generateSingleAsset = async (item: (typeof assetsDataArr)[number] & { parentDescribe?: string }) => {
      const imageId = imageIdMap[item.id!];
      const existingPrompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
      const needsGeneratedPrompt = !existingPrompt;
      let prompt = existingPrompt;
      let promptGenerated = false;

      try {
        if (needsGeneratedPrompt) {
          const visualManualName = derivativeVisualManualByType[item.type ?? ""];
          if (!visualManualName) throw new Error(`不支持的衍生资产类型：${item.type || "未指定"}`);
          if (!projectSettingData.artStyle?.trim()) throw new Error("项目未配置艺术风格，无法读取衍生资产视觉手册");

          const visualManual = u.getArtPrompt(projectSettingData.artStyle, "art_skills", visualManualName, true).trim();
          if (!visualManual) throw new Error(`未找到衍生资产视觉手册：${visualManualName}`);

          const { text } = await u.Ai.Text("universalAi").invoke({
            system: visualManual,
            messages: [
              {
                role: "user",
                content: `
            父级资产描述: ${item.parentDescribe || "无详细描述"}
            当前资产描述: ${item.describe || "无详细描述"}`,
              },
            ],
          });
          prompt = text.trim();
          if (!prompt) throw new Error("资产提示词生成结果为空");

          await u.db("o_assets").where({ id: item.id, projectId }).update({
            prompt,
            promptState: "已完成",
            promptErrorReason: null,
          });
          promptGenerated = true;
        }

        const parentImagePath = imageUrlRecord[item.assetsId!];
        const imageBase64 = parentImagePath ? await u.oss.getImageBase64(parentImagePath) : null;
        const requestData = {
          prompt,
          size: imageQuality as ImageQuality,
          aspectRatio: "16:9" as `${number}:${number}`,
        };
        const imageCls = await u.Ai.Image(imageModel as `${string}:${string}`).run(
          {
            referenceList: imageBase64 ? [{ type: "image", base64: imageBase64 }] : [],
            ...requestData,
          },
          {
            taskClass: "生成图片",
            describe: "资产图片生成",
            relatedObjects: JSON.stringify(requestData),
            projectId,
          },
        );
        const savePath = `/${projectId}/assets/${scriptId}/${item.type}/${u.uuid()}.jpg`;
        await imageCls.save(savePath);
        await u.db("o_image").where({ id: imageId }).update({
          state: "已完成",
          filePath: savePath,
          errorReason: null,
        });
      } catch (e) {
        const errorReason = u.error(e).message;
        const statusWrites: Promise<unknown>[] = [
          u.db("o_image").where({ id: imageId }).update({ state: "生成失败", errorReason }),
        ];
        if (needsGeneratedPrompt && !promptGenerated) {
          statusWrites.push(
            u.db("o_assets").where({ id: item.id, projectId }).update({
              promptState: "生成失败",
              promptErrorReason: errorReason,
            }),
          );
        }

        const results = await Promise.allSettled(statusWrites);
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            console.error(`资产 ${item.id} ${index === 0 ? "图片" : "提示词"}失败状态写入失败`, result.reason);
          }
        });
      }
    };

    for (let i = 0; i < assetsDataArr.length; i += concurrentCount) {
      const batch = assetsDataArr.slice(i, i + concurrentCount);
      await Promise.all(batch.map(generateSingleAsset));
    }
  },
);
