import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

import { workflowStepSchema, WorkflowStep, getWorkflowStepTargetApi } from "@/constants/workflow";
import { getLatestWorkflowStepRun, validateWorkflowContext } from "./utils";

const router = express.Router();

type ItemState = "pending" | "success" | "failed" | "generating";

type AssetRow = {
  id?: number;
  name?: string | null;
  describe?: string | null;
  prompt?: string | null;
  type?: string | null;
  assetsId?: number | null;
  promptState?: string | null;
  imageState?: string | null;
  filePath?: string | null;
};

type StoryboardRow = {
  id?: number;
  scriptId?: number | null;
  prompt?: string | null;
  videoDesc?: string | null;
  duration?: string | null;
  trackId?: number | null;
  state?: string | null;
  shouldGenerateImage?: number | null;
  filePath?: string | null;
};

type TrackRow = {
  id?: number;
  scriptId?: number | null;
  prompt?: string | null;
  state?: string | null;
  duration?: number | null;
};

const assetTypes = ["role", "scene", "tool"];

function getImageStatus(state?: string | null): ItemState {
  if (state === "生成中") return "generating";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "已完成" || state === "生成成功") return "success";
  return "pending";
}

function getPromptStatus(state?: string | null, prompt?: string | null): ItemState {
  if (state === "生成中") return "generating";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "已完成" || state === "生成成功" || !!prompt) return "success";
  return "pending";
}

function isRunnableState(state: ItemState, compulsory: boolean, retryFailedOnly: boolean) {
  if (state === "generating") return false;
  if (retryFailedOnly) return state === "failed";
  return compulsory || state === "pending" || state === "failed";
}

async function getScripts(projectId: number, scriptId?: number | null) {
  const query = u.db("o_script").where("projectId", projectId);
  if (scriptId) query.where("id", scriptId);
  return await query.select("id", "name", "extractState");
}

async function getAssets(projectId: number, scriptId?: number | null) {
  const query = u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .whereIn("o_assets.type", assetTypes);
  if (scriptId) {
    query
      .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
      .where("o_scriptAssets.scriptId", scriptId);
  }
  return (await query.distinct(
    "o_assets.id",
    "o_assets.name",
    "o_assets.describe",
    "o_assets.prompt",
    "o_assets.type",
    "o_assets.assetsId",
    "o_assets.promptState",
    "o_image.state as imageState",
    "o_image.filePath",
  )) as AssetRow[];
}

async function getStoryboards(projectId: number, scriptId?: number | null) {
  const query = u.db("o_storyboard").where("projectId", projectId);
  if (scriptId) query.where("scriptId", scriptId);
  return (await query.select("id", "scriptId", "prompt", "videoDesc", "duration", "trackId", "state", "shouldGenerateImage", "filePath")) as StoryboardRow[];
}

async function getTracks(projectId: number, scriptId?: number | null) {
  const query = u.db("o_videoTrack").where("projectId", projectId);
  if (scriptId) query.where("scriptId", scriptId);
  return (await query.select("id", "scriptId", "prompt", "state", "duration", "videoId", "selectVideoId")) as (TrackRow & {
    videoId?: number | null;
    selectVideoId?: number | null;
  })[];
}

type TrackSource = { id: number; sources: "storyboard" | "assets" };

async function getTrackInfo(storyboards: StoryboardRow[]) {
  const result = storyboards.reduce<Record<number, TrackSource[]>>((record, storyboard) => {
    if (!storyboard.id || !storyboard.trackId) return record;
    if (!record[storyboard.trackId]) record[storyboard.trackId] = [];
    record[storyboard.trackId].push({ id: storyboard.id, sources: "storyboard" });
    return record;
  }, {});
  const storyboardIds = storyboards.map((item) => item.id).filter((id): id is number => !!id);
  if (!storyboardIds.length) return result;

  const relations = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).orderBy("rowid").select("storyboardId", "assetId");
  const storyboardMap = new Map(storyboards.filter((item) => item.id && item.trackId).map((item) => [item.id!, item.trackId!]));
  const trackAssetIds = new Map<number, Set<number>>();
  relations.forEach((relation) => {
    if (!relation.storyboardId || !relation.assetId) return;
    const trackId = storyboardMap.get(relation.storyboardId);
    if (!trackId) return;
    if (!trackAssetIds.has(trackId)) trackAssetIds.set(trackId, new Set());
    trackAssetIds.get(trackId)!.add(relation.assetId);
  });
  trackAssetIds.forEach((assetIds, trackId) => {
    if (!result[trackId]) result[trackId] = [];
    result[trackId].push(...[...assetIds].map((id) => ({ id, sources: "assets" as const })));
  });
  return result;
}

async function getVideoResolution(videoModel?: string | null) {
  if (!videoModel) throw new Error("项目未配置视频模型");
  const [vendorId, modelName] = videoModel.split(/:(.+)/);
  if (!vendorId || !modelName) throw new Error("视频模型配置格式无效");
  const models = await u.vendor.getModelList(vendorId);
  const model = models.find((item) => item.modelName === modelName);
  const resolution = model?.durationResolutionMap?.flatMap((item: { resolution?: string[] }) => item.resolution ?? []).find((item: string) => !!item);
  if (!resolution) throw new Error("视频模型未配置可用分辨率");
  return resolution;
}

function supportsAssetReferences(mode?: string | null) {
  if (!mode) return false;
  try {
    return Array.isArray(JSON.parse(mode));
  } catch {
    return false;
  }
}

function inferSingleScriptId(scripts: { id?: number }[], message: string) {
  const ids = scripts.map((item) => item.id).filter((id): id is number => !!id);
  if (ids.length > 1) throw new Error(message);
  if (!ids.length) throw new Error("未找到可执行的剧本");
  return ids[0];
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
    step: workflowStepSchema,
    concurrentCount: z.number().int().min(1).optional(),
    groupSize: z.number().int().min(1).optional(),
    otherTextPrompt: z.string().optional(),
    compulsory: z.boolean().optional(),
    itemIds: z.array(z.number().int()).optional(),
    retryFailedOnly: z.boolean().optional(),
    audio: z.boolean().optional(),
  }),
  async (req, res) => {
    const {
      projectId,
      scriptId,
      step,
      concurrentCount = 5,
      groupSize = 5,
      otherTextPrompt = "",
      compulsory = false,
      itemIds,
      retryFailedOnly = false,
      audio = false,
    } = req.body as {
      projectId: number;
      scriptId?: number | null;
      step: WorkflowStep;
      concurrentCount?: number;
      groupSize?: number;
      otherTextPrompt?: string;
      compulsory?: boolean;
      itemIds?: number[];
      retryFailedOnly?: boolean;
      audio?: boolean;
    };
    const requestedItemIds = itemIds ? new Set(itemIds) : null;
    const invalidItemIds = itemIds?.filter((id) => !Number.isFinite(id) || id <= 0) ?? [];

    if (invalidItemIds.length) return res.status(400).send(error("itemIds 必须是有效的正整数"));
    if (compulsory && retryFailedOnly) return res.status(400).send(error("强制重生成和仅重试失败项不能同时启用"));

    try {
      const { project, isStoryboardProject } = await validateWorkflowContext(projectId, scriptId);
      if (isStoryboardProject && step === "extractOriginalAssets") {
        return res.status(400).send(error("基于分镜表的项目在导入时已创建原始资产，不支持 extractOriginalAssets"));
      }

      const scripts = await getScripts(projectId, scriptId);
      if (scriptId && !scripts.length) return res.status(400).send(error("剧本不存在或不属于当前项目"));
      const targetApi = getWorkflowStepTargetApi(step);

      if (step === "extractOriginalAssets") {
        const runnableScriptIds = scripts
          .filter((item) => retryFailedOnly ? item.extractState === -1 : item.extractState !== 1 && item.extractState !== 0 && item.extractState !== 2)
          .map((item) => item.id)
          .filter((id): id is number => !!id);
        return res.status(200).send(success({ step, targetApi, requestBody: { scriptIds: runnableScriptIds, projectId, groupSize }, total: runnableScriptIds.length }));
      }

      const assets = await getAssets(projectId, scriptId);
      const originalAssets = assets.filter((item) => !item.assetsId);
      const derivedAssets = assets.filter((item) => !!item.assetsId);

      if (step === "generateDerivedAssets") {
        const realScriptId = scriptId ?? inferSingleScriptId(scripts, "项目包含多个剧本，生成衍生资产需要明确指定 scriptId");
        const batchStoryboards = await getStoryboards(projectId, realScriptId);
        const batchStoryboardIds = batchStoryboards.map((item) => item.id).filter((id): id is number => !!id);
        const batchStoryboardIdSet = new Set(batchStoryboardIds);
        const invalidStoryboardIds = itemIds?.filter((id) => !batchStoryboardIdSet.has(id)) ?? [];
        if (invalidStoryboardIds.length) {
          return res.status(400).send(error(`分镜不属于当前项目和剧本批次：${[...new Set(invalidStoryboardIds)].join(", ")}`));
        }
        const storyboardIds = requestedItemIds ? batchStoryboardIds.filter((id) => requestedItemIds.has(id)) : batchStoryboardIds;
        if (!storyboardIds.length) {
          return res.status(400).send(error("当前剧本批次没有可用于生成衍生资产的分镜"));
        }
        if (!originalAssets.length) {
          return res.status(400).send(error("该剧本没有可用于生成衍生资产的原始资产"));
        }
        const latestRun = await getLatestWorkflowStepRun(projectId, realScriptId, step);
        if (latestRun?.state === "running") {
          return res.status(409).send(error("该工作流步骤正在执行，请勿重复提交", null, 409));
        }
        const runnable = retryFailedOnly ? latestRun?.state === "failed" : compulsory || !latestRun || latestRun.state === "failed";
        return res.status(200).send(
          success({
            step,
            targetApi,
            requestBody: { projectId, scriptId: realScriptId, storyboardIds },
            total: runnable ? 1 : 0,
          }),
        );
      }

      if (step === "polishOriginalAssetPrompts" || step === "polishDerivedAssetPrompts") {
        const list = step === "polishOriginalAssetPrompts" ? originalAssets : derivedAssets;
        const items = list
          .filter((item) => !requestedItemIds || (item.id != null && requestedItemIds.has(item.id)))
          .filter((item) => isRunnableState(getPromptStatus(item.promptState, item.prompt), compulsory, retryFailedOnly))
          .map((item) => ({ assetsId: item.id, type: item.type, name: item.name ?? "", describe: item.describe ?? "" }));
        return res.status(200).send(success({ step, targetApi, requestBody: { items, projectId, concurrentCount, otherTextPrompt }, total: items.length }));
      }

      if (step === "generateOriginalAssetImages") {
        const items = originalAssets
          .filter((item) => !requestedItemIds || (item.id != null && requestedItemIds.has(item.id)))
          .filter((item) => item.prompt && isRunnableState(getImageStatus(item.imageState), compulsory, retryFailedOnly))
          .map((item) => ({ id: item.id, type: item.type, name: item.name ?? "", prompt: item.prompt ?? "", base64: null }));
        return res.status(200).send(
          success({
            step,
            targetApi,
            requestBody: {
              projectId,
              model: project.imageModel,
              resolution: project.imageQuality,
              concurrentCount,
              items,
            },
            total: items.length,
          }),
        );
      }

      if (step === "generateDerivedAssetImages") {
        const realScriptId = scriptId ?? inferSingleScriptId(scripts, "项目包含多个剧本，生成衍生资产图需要明确指定 scriptId");
        const scriptAssets = scriptId ? derivedAssets : await getAssets(projectId, realScriptId).then((items) => items.filter((item) => !!item.assetsId));
        const assetIds = scriptAssets
          .filter((item) => !requestedItemIds || (item.id != null && requestedItemIds.has(item.id)))
          .filter((item) => isRunnableState(getImageStatus(item.imageState), compulsory, retryFailedOnly))
          .map((item) => item.id)
          .filter((id): id is number => !!id);
        return res.status(200).send(success({ step, targetApi, requestBody: { assetIds, projectId, scriptId: realScriptId, concurrentCount }, total: assetIds.length }));
      }

      const storyboards = await getStoryboards(projectId, scriptId);

      if (step === "generateStoryboardImages") {
        const realScriptId = scriptId ?? inferSingleScriptId(scripts, "项目包含多个剧本，生成分镜图需要明确指定 scriptId");
        const scriptStoryboards = scriptId ? storyboards : storyboards.filter((item) => item.scriptId === realScriptId);
        const storyboardIds = scriptStoryboards
          .filter((item) => !requestedItemIds || (item.id != null && requestedItemIds.has(item.id)))
          .filter((item) => item.shouldGenerateImage !== 0 && isRunnableState(getImageStatus(item.state), compulsory, retryFailedOnly))
          .map((item) => item.id)
          .filter((id): id is number => !!id);
        return res.status(200).send(success({ step, targetApi, requestBody: { storyboardIds, projectId, scriptId: realScriptId, concurrentCount, compulsory }, total: storyboardIds.length }));
      }

      const tracks = await getTracks(projectId, scriptId);
      const trackInfo = await getTrackInfo(storyboards);

      if (step === "generateVideoPrompts") {
        const trackData = tracks
          .filter((item) => !requestedItemIds || (item.id != null && requestedItemIds.has(item.id)))
          .filter((item) => isRunnableState(getPromptStatus(item.state, item.prompt), compulsory, retryFailedOnly) && trackInfo[item.id!]?.some((source) => source.sources === "storyboard"))
          .map((item) => ({ trackId: item.id, info: trackInfo[item.id!] }));
        return res.status(200).send(success({ step, targetApi, requestBody: { projectId, trackData, mode: project.mode ?? "", model: project.videoModel, concurrentCount }, total: trackData.length }));
      }

      if (step === "generateVideos") {
        const realScriptId = scriptId ?? inferSingleScriptId(scripts, "项目包含多个剧本，生成视频需要明确指定 scriptId");
        const scriptTracks = tracks.filter((item) => item.scriptId === realScriptId && (!requestedItemIds || (item.id != null && requestedItemIds.has(item.id))));
        const trackIds = scriptTracks.map((item) => item.id!).filter(Boolean);
        const videos = trackIds.length
          ? await u.db("o_video").whereIn("videoTrackId", trackIds).select("id", "videoTrackId", "state", "time")
          : [];
        const runnableTrackIds = new Set(
          scriptTracks
            .filter((track) => {
              const attempts = videos
                .filter((video) => video.videoTrackId === track.id)
                .sort((a, b) => Number(b.time ?? b.id ?? 0) - Number(a.time ?? a.id ?? 0));
              const selectedVideoId = track.selectVideoId ?? track.videoId;
              const representative = attempts.find((video) => video.id === selectedVideoId) ?? attempts[0];
              return isRunnableState(getImageStatus(representative?.state), compulsory, retryFailedOnly);
            })
            .map((track) => track.id),
        );
        const assetMap = new Map(assets.filter((item) => item.id).map((item) => [item.id!, item]));
        const includeAssetReferences = supportsAssetReferences(project.mode);
        const trackData = scriptTracks
          .filter((item) => item.prompt && trackInfo[item.id!]?.some((source) => source.sources === "storyboard") && runnableTrackIds.has(item.id))
          .map((item) => ({
            trackId: item.id,
            prompt: item.prompt ?? "",
            duration: item.duration ?? 5,
            uploadData: (trackInfo[item.id!] ?? []).filter((source) => {
              if (source.sources === "storyboard") {
                const row = storyboards.find((storyboard) => storyboard.id === source.id);
                return row?.filePath && getImageStatus(row.state) === "success";
              }
              if (!includeAssetReferences) return false;
              const asset = assetMap.get(source.id);
              return asset?.filePath && getImageStatus(asset.imageState) === "success";
            }),
          }))
          .filter((item) => item.uploadData.some((source) => source.sources === "storyboard"));
        const resolution = trackData.length ? await getVideoResolution(project.videoModel) : "";
        return res.status(200).send(
          success({
            step,
            targetApi,
            requestBody: {
              projectId,
              scriptId: realScriptId,
              trackData,
              model: project.videoModel,
              mode: project.mode ?? "",
              resolution,
              audio,
            },
            total: trackData.length,
          }),
        );
      }

      return res.status(400).send(error("不支持的流程步骤"));
    } catch (e) {
      return res.status(400).send(error(u.error(e).message));
    }
  },
);
