import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

const imageQualities = ["1K", "2K", "4K"] as const;
type ImageQuality = (typeof imageQualities)[number];
type ImageModel = `${string}:${string}`;
type AspectRatio = `${number}:${number}`;
type StoryboardRow = {
  id?: number | null;
  prompt?: string | null;
  state?: string | null;
  reason?: string | null;
  videoDesc?: string | null;
  shouldGenerateImage?: number | null;
};
type AssetRow = {
  id?: number | null;
  projectId?: number | null;
  imageId?: number | null;
};
type ReferenceImage = {
  assetId: number;
  imageId: number;
  filePath: string;
};
type ProjectImageSettings = {
  imageModel: ImageModel;
  imageQuality: ImageQuality;
  videoRatio: AspectRatio;
};

function uniqueNumbers(ids: number[]) {
  return [...new Set(ids)];
}

async function writeFailureState(storyboardIds: number[], projectId: number, scriptId: number, reason: string, compulsory = false) {
  if (!storyboardIds.length) return;
  await u.db("o_storyboard").where({ projectId, scriptId }).whereIn("id", storyboardIds).update({
    filePath: "",
    state: "生成失败",
    reason,
    ...(compulsory ? { shouldGenerateImage: 1 } : {}),
  });
}

async function validateProjectImageSettings(projectId: number): Promise<ProjectImageSettings> {
  const project = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "videoRatio").first();
  if (!project) throw new Error("项目不存在");

  const imageModel = typeof project.imageModel === "string" ? project.imageModel.trim() : "";
  const [vendorId, modelName] = imageModel.split(/:(.+)/);
  if (!vendorId || !modelName) throw new Error("项目 imageModel 未配置或格式无效，应为 vendorId:modelName");

  let models: any[];
  try {
    models = await u.vendor.getModelList(vendorId);
  } catch (e) {
    throw new Error(`项目 imageModel 无法读取：${u.error(e).message}`);
  }
  const selectedModel = models.find((item) => item.modelName === modelName);
  if (!selectedModel) throw new Error(`项目 imageModel 不存在：${imageModel}`);
  if (selectedModel.type && selectedModel.type !== "image") throw new Error(`项目 imageModel 不是图片模型：${imageModel}`);

  const imageQuality = typeof project.imageQuality === "string" ? project.imageQuality.trim() : "";
  if (!imageQualities.includes(imageQuality as ImageQuality)) {
    throw new Error(`项目 imageQuality 无效：${imageQuality || "未配置"}，仅支持 ${imageQualities.join("、")}`);
  }

  const videoRatio = typeof project.videoRatio === "string" ? project.videoRatio.trim() : "";
  if (!/^[1-9]\d*:[1-9]\d*$/.test(videoRatio)) {
    throw new Error(`项目 videoRatio 无效：${videoRatio || "未配置"}，应为正整数比例（例如 16:9）`);
  }

  return {
    imageModel: imageModel as ImageModel,
    imageQuality: imageQuality as ImageQuality,
    videoRatio: videoRatio as AspectRatio,
  };
}

async function getStoryboardReferences(storyboardIds: number[], projectId: number, scriptId: number) {
  const referencesByStoryboard = new Map<number, ReferenceImage[]>();
  const associationCountByStoryboard = new Map<number, number>();
  storyboardIds.forEach((id) => {
    referencesByStoryboard.set(id, []);
    associationCountByStoryboard.set(id, 0);
  });
  if (!storyboardIds.length) return { referencesByStoryboard, associationCountByStoryboard };

  const relations = await u
    .db("o_assets2Storyboard")
    .whereIn("storyboardId", storyboardIds)
    .orderBy("rowid", "asc")
    .select("storyboardId", "assetId");
  const relationAssetIds = relations.map((item) => Number(item.assetId));
  const invalidRelationAssetIds = uniqueNumbers(relationAssetIds.filter((id) => !Number.isInteger(id) || id <= 0));
  if (invalidRelationAssetIds.length) {
    throw new Error(`分镜关联资产 ID 无效：${invalidRelationAssetIds.join(", ")}`);
  }
  const assetIds = uniqueNumbers(relationAssetIds);
  if (!assetIds.length) return { referencesByStoryboard, associationCountByStoryboard };

  const assets = (await u.db("o_assets").whereIn("id", assetIds).select("id", "projectId", "imageId")) as AssetRow[];
  const assetMap = new Map(assets.map((item) => [Number(item.id), item]));
  const scriptAssetRows = await u.db("o_scriptAssets").where("scriptId", scriptId).whereIn("assetId", assetIds).select("assetId");
  const scriptAssetIds = new Set(scriptAssetRows.map((item) => Number(item.assetId)));
  const missingAssetIds = assetIds.filter((id) => !assetMap.has(id));
  const crossProjectAssetIds = assetIds.filter((id) => assetMap.has(id) && Number(assetMap.get(id)?.projectId) !== projectId);
  const unrelatedAssetIds = assetIds.filter((id) => !scriptAssetIds.has(id));

  if (missingAssetIds.length) throw new Error(`分镜关联资产不存在：${missingAssetIds.join(", ")}`);
  if (crossProjectAssetIds.length) throw new Error(`分镜关联资产不属于当前项目：${crossProjectAssetIds.join(", ")}`);
  if (unrelatedAssetIds.length) throw new Error(`分镜关联资产不属于当前剧本批次：${unrelatedAssetIds.join(", ")}`);

  const imageIds = uniqueNumbers(
    assets
      .map((item) => Number(item.imageId))
      .filter((id) => Number.isInteger(id) && id > 0),
  );
  const images = imageIds.length
    ? await u.db("o_image").whereIn("id", imageIds).where("state", "已完成").select("id", "filePath")
    : [];
  const imageMap = new Map(
    images
      .filter((item) => typeof item.filePath === "string" && item.filePath.trim())
      .map((item) => [Number(item.id), item.filePath!.trim()]),
  );

  for (const relation of relations) {
    const storyboardId = Number(relation.storyboardId);
    const assetId = Number(relation.assetId);
    associationCountByStoryboard.set(storyboardId, (associationCountByStoryboard.get(storyboardId) ?? 0) + 1);
    const imageId = Number(assetMap.get(assetId)?.imageId);
    const filePath = imageMap.get(imageId);
    if (Number.isInteger(imageId) && imageId > 0 && filePath) {
      referencesByStoryboard.get(storyboardId)?.push({ assetId, imageId, filePath });
    }
  }

  return { referencesByStoryboard, associationCountByStoryboard };
}

async function readReferenceImages(references: ReferenceImage[]) {
  if (!references.length) return [];
  const results = await Promise.all(
    references.map(async (reference) => {
      try {
        const base64 = await u.oss.getImageBase64(reference.filePath);
        return base64 ? { type: "image" as const, base64 } : null;
      } catch {
        return null;
      }
    }),
  );
  const available = results.filter((item): item is { type: "image"; base64: string } => item !== null);
  if (!available.length) {
    throw new Error(`分镜有关联资产，但关联资产的已完成图片均读取失败（资产 ID：${references.map((item) => item.assetId).join(", ")}）`);
  }
  return available;
}

export default router.post(
  "/",
  validateFields({
    storyboardIds: z.array(z.number().int().positive()).min(1),
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    concurrentCount: z.number().int().min(1).optional(),
    compulsory: z.boolean().optional(),
  }),
  async (req, res) => {
    const {
      storyboardIds,
      projectId,
      scriptId,
      concurrentCount = 5,
      compulsory = false,
    } = req.body as {
      storyboardIds: number[];
      projectId: number;
      scriptId: number;
      concurrentCount?: number;
      compulsory?: boolean;
    };

    const requestedStoryboardIds = uniqueNumbers(storyboardIds);
    if (requestedStoryboardIds.length !== storyboardIds.length) {
      return res.status(400).send(error("storyboardIds 不能包含重复 ID"));
    }

    const projectExists = await u.db("o_project").where("id", projectId).first("id");
    if (!projectExists) return res.status(400).send(error("项目不存在"));
    const script = await u.db("o_script").where({ id: scriptId, projectId }).first("id");
    if (!script) return res.status(400).send(error("剧本不存在或不属于当前项目"));

    const storyboardData = (await u
      .db("o_storyboard")
      .where({ projectId, scriptId })
      .whereIn("id", requestedStoryboardIds)
      .select("id", "prompt", "state", "reason", "videoDesc", "shouldGenerateImage")) as StoryboardRow[];
    const storyboardMap = new Map(storyboardData.map((item) => [Number(item.id), item]));
    const invalidStoryboardIds = requestedStoryboardIds.filter((id) => !storyboardMap.has(id));
    if (invalidStoryboardIds.length) {
      return res.status(400).send(error(`分镜不存在或不属于当前项目和剧本批次：${invalidStoryboardIds.join(", ")}`));
    }

    const invalidShouldGenerateIds = storyboardData
      .filter((item) => item.shouldGenerateImage !== 0 && item.shouldGenerateImage !== 1)
      .map((item) => Number(item.id));
    if (invalidShouldGenerateIds.length) {
      return res.status(400).send(error(`分镜 shouldGenerateImage 必须为 0 或 1：${invalidShouldGenerateIds.join(", ")}`));
    }

    const orderedStoryboards = requestedStoryboardIds.map((id) => storyboardMap.get(id)!);
    const acceptedStoryboards = compulsory ? orderedStoryboards : orderedStoryboards.filter((item) => item.shouldGenerateImage === 1);
    const skippedStoryboards = compulsory ? [] : orderedStoryboards.filter((item) => item.shouldGenerateImage === 0);
    const acceptedIds = acceptedStoryboards.map((item) => Number(item.id));
    const skippedIds = skippedStoryboards.map((item) => Number(item.id));

    if (!acceptedIds.length) {
      try {
        const { referencesByStoryboard } = await getStoryboardReferences(requestedStoryboardIds, projectId, scriptId);
        await u.db("o_storyboard").where({ projectId, scriptId }).whereIn("id", skippedIds).update({ state: "未生成", reason: null });
        const currentSkippedStoryboards = (await u
          .db("o_storyboard")
          .where({ projectId, scriptId })
          .whereIn("id", requestedStoryboardIds)
          .select("id", "prompt", "state", "reason", "videoDesc", "shouldGenerateImage")) as StoryboardRow[];
        const currentSkippedMap = new Map(currentSkippedStoryboards.map((item) => [Number(item.id), item]));
        return res.status(200).send(
          success(
            requestedStoryboardIds.map((id) => {
              const item = currentSkippedMap.get(id)!;
              return {
                id,
                prompt: item.prompt,
                associateAssetsIds: (referencesByStoryboard.get(id) ?? []).map((reference) => reference.imageId),
                src: null,
                state: item.state,
                reason: item.reason,
                videoDesc: item.videoDesc,
                shouldGenerateImage: item.shouldGenerateImage,
                accepted: false,
                skipped: true,
              };
            }),
          ),
        );
      } catch (e) {
        return res.status(400).send(error(`分镜图片初始化失败：${u.error(e).message}`));
      }
    }

    let settings: ProjectImageSettings;
    let referencesByStoryboard: Map<number, ReferenceImage[]>;
    let associationCountByStoryboard: Map<number, number>;
    try {
      settings = await validateProjectImageSettings(projectId);
      ({ referencesByStoryboard, associationCountByStoryboard } = await getStoryboardReferences(acceptedIds, projectId, scriptId));

      const unavailableReferenceIds = acceptedIds.filter(
        (id) => (associationCountByStoryboard.get(id) ?? 0) > 0 && !(referencesByStoryboard.get(id)?.length ?? 0),
      );
      const readyIds = acceptedIds.filter((id) => !unavailableReferenceIds.includes(id));
      const unavailableReason = "分镜有关联资产，但关联资产均无可用的当前已完成图片";

      await u.db.transaction(async (trx) => {
        if (skippedIds.length) {
          await trx("o_storyboard").where({ projectId, scriptId }).whereIn("id", skippedIds).update({ state: "未生成", reason: null });
        }
        if (unavailableReferenceIds.length) {
          await trx("o_storyboard").where({ projectId, scriptId }).whereIn("id", unavailableReferenceIds).update({
            filePath: "",
            state: "生成失败",
            reason: unavailableReason,
          });
        }
        if (readyIds.length) {
          await trx("o_storyboard").where({ projectId, scriptId }).whereIn("id", readyIds).update({
            state: "生成中",
            reason: null,
            ...(compulsory ? { shouldGenerateImage: 1 } : {}),
          });
        }
      });
    } catch (e) {
      const reason = `分镜图片初始化失败：${u.error(e).message}`;
      try {
        await writeFailureState(acceptedIds, projectId, scriptId, reason, compulsory);
      } catch (updateError) {
        console.error("分镜图片初始化失败状态写入失败", updateError);
        return res.status(500).send(error(`${reason}；失败状态写入失败：${u.error(updateError).message}`));
      }
      return res.status(400).send(error(reason));
    }

    const currentStoryboards = (await u
      .db("o_storyboard")
      .where({ projectId, scriptId })
      .whereIn("id", requestedStoryboardIds)
      .select("id", "prompt", "state", "reason", "videoDesc", "shouldGenerateImage")) as StoryboardRow[];
    const currentStoryboardMap = new Map(currentStoryboards.map((item) => [Number(item.id), item]));
    const acceptedIdSet = new Set(acceptedIds);
    const skippedIdSet = new Set(skippedIds);
    res.status(200).send(
      success(
        requestedStoryboardIds.map((id) => {
          const item = currentStoryboardMap.get(id)!;
          return {
            id,
            prompt: item.prompt,
            associateAssetsIds: (referencesByStoryboard.get(id) ?? []).map((reference) => reference.imageId),
            src: null,
            state: item.state,
            reason: item.reason,
            videoDesc: item.videoDesc,
            shouldGenerateImage: item.shouldGenerateImage,
            accepted: acceptedIdSet.has(id),
            skipped: skippedIdSet.has(id),
          };
        }),
      ),
    );

    const generateTask = async (item: StoryboardRow) => {
      const storyboardId = Number(item.id);
      if ((associationCountByStoryboard.get(storyboardId) ?? 0) > 0 && !(referencesByStoryboard.get(storyboardId)?.length ?? 0)) return;

      try {
        const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
        if (!prompt) throw new Error("分镜提示词为空");
        const referenceList = await readReferenceImages(referencesByStoryboard.get(storyboardId) ?? []);
        const requestData = {
          prompt,
          size: settings.imageQuality,
          aspectRatio: settings.videoRatio,
        };
        const imageCls = await u.Ai.Image(settings.imageModel).run(
          {
            referenceList,
            ...requestData,
          },
          {
            taskClass: "生成分镜图片",
            describe: "分镜图片生成",
            relatedObjects: JSON.stringify(requestData),
            projectId,
          },
        );
        const savePath = `/${projectId}/assets/${scriptId}/${u.uuid()}.jpg`;
        await imageCls.save(savePath);
        await u.db("o_storyboard").where({ id: storyboardId, projectId, scriptId }).update({
          filePath: savePath,
          state: "已完成",
          reason: null,
        });
      } catch (e) {
        const reason = u.error(e).message;
        try {
          await writeFailureState([storyboardId], projectId, scriptId, reason);
        } catch (updateError) {
          console.error(`分镜 ${storyboardId} 失败状态写入失败`, updateError);
        }
      }
    };

    for (let i = 0; i < acceptedStoryboards.length; i += concurrentCount) {
      const batch = acceptedStoryboards.slice(i, i + concurrentCount);
      await Promise.all(batch.map(generateTask));
    }
  },
);
