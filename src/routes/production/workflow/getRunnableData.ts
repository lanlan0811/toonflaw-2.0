import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

import { validateWorkflowContext } from "./utils";

const router = express.Router();
const runnableAssetTypes = ["role", "scene", "tool"];
type ItemState = "pending" | "success" | "failed" | "generating";

type AssetRunnableRow = {
  id?: number;
  name?: string | null;
  describe?: string | null;
  prompt?: string | null;
  type?: string | null;
  assetsId?: number | null;
  promptState?: string | null;
  promptErrorReason?: string | null;
  imageState?: string | null;
  imageErrorReason?: string | null;
  filePath?: string | null;
};

function getImageStatus(state?: string | null): ItemState {
  if (state === "已完成" || state === "生成成功") return "success";
  if (state === "生成中") return "generating";
  if (state === "生成失败" || state === "失败") return "failed";
  return "pending";
}

function getPromptStatus(state?: string | null, prompt?: string | null): ItemState {
  if (state === "生成中") return "generating";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "已完成" || state === "生成成功" || !!prompt) return "success";
  return "pending";
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body as { projectId: number; scriptId?: number | null };
    let context: Awaited<ReturnType<typeof validateWorkflowContext>>;
    try {
      context = await validateWorkflowContext(projectId, scriptId);
    } catch (e) {
      return res.status(400).send(error(u.error(e).message));
    }
    const { project, isStoryboardProject } = context;

    const scriptsQuery = u.db("o_script").where("projectId", projectId);
    if (scriptId) scriptsQuery.where("id", scriptId);
    const scripts = await scriptsQuery.select("id", "name", "extractState", "errorReason");
    if (scriptId && !scripts.length) return res.status(400).send(error("剧本不存在或不属于当前项目"));
    const scriptIds = scripts.map((item) => item.id!).filter(Boolean);

    const assetQuery = u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .whereIn("o_assets.type", runnableAssetTypes);
    if (scriptId) {
      assetQuery
        .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
        .where("o_scriptAssets.scriptId", scriptId);
    }
    const assets = (await assetQuery.distinct(
      "o_assets.id",
      "o_assets.name",
      "o_assets.describe",
      "o_assets.prompt",
      "o_assets.type",
      "o_assets.assetsId",
      "o_assets.promptState",
      "o_assets.promptErrorReason",
      "o_image.state as imageState",
      "o_image.errorReason as imageErrorReason",
      "o_image.filePath",
    )) as AssetRunnableRow[];

    const originalAssets = assets.filter((item) => !item.assetsId);
    const derivedAssets = assets.filter((item) => !!item.assetsId);
    const mapAsset = (item: AssetRunnableRow) => ({
      id: item.id,
      name: item.name,
      describe: item.describe,
      prompt: item.prompt,
      type: item.type,
      parentId: item.assetsId ?? null,
      promptState: getPromptStatus(item.promptState, item.prompt),
      promptErrorReason: item.promptErrorReason ?? null,
      imageState: getImageStatus(item.imageState),
      imageErrorReason: item.imageErrorReason ?? null,
      hasImage: !!item.filePath,
    });

    const relationRows = scriptIds.length
      ? await u
          .db("o_scriptAssets")
          .join("o_assets", "o_assets.id", "o_scriptAssets.assetId")
          .whereIn("o_scriptAssets.scriptId", scriptIds)
          .where("o_assets.projectId", projectId)
          .whereIn("o_assets.type", runnableAssetTypes)
          .select("o_scriptAssets.scriptId", "o_assets.assetsId")
      : [];
    const latestDerivedRun = scriptId
      ? await u.db("o_workflowStepRun").where({ projectId, scriptId, step: "generateDerivedAssets" }).orderBy("id", "desc").first()
      : undefined;
    const derivableScriptIds = isStoryboardProject && scriptId && latestDerivedRun?.state !== "running" && relationRows.some((item) => item.scriptId === scriptId && !item.assetsId)
      ? [scriptId]
      : scripts
          .filter((script) => {
            const rows = relationRows.filter((item) => item.scriptId === script.id);
            return rows.some((item) => !item.assetsId) && latestDerivedRun?.state !== "running";
          })
          .map((item) => item.id);

    const storyboardQuery = u.db("o_storyboard").where("projectId", projectId);
    if (scriptId) storyboardQuery.where("scriptId", scriptId);
    const storyboards = await storyboardQuery.select("id", "scriptId", "prompt", "videoDesc", "duration", "track", "trackId", "state", "shouldGenerateImage", "filePath", "reason");
    const storyboardIds = storyboards.map((item) => item.id!).filter(Boolean);
    const assets2StoryboardRows = storyboardIds.length
      ? await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).orderBy("rowid").select("storyboardId", "assetId")
      : [];
    const storyboardAssetMap = assets2StoryboardRows.reduce<Record<number, number[]>>((result, item) => {
      if (!result[item.storyboardId!]) result[item.storyboardId!] = [];
      result[item.storyboardId!].push(item.assetId!);
      return result;
    }, {});

    const storyboardItems = storyboards.map((item) => ({
      id: item.id,
      scriptId: item.scriptId,
      prompt: item.prompt,
      videoDesc: item.videoDesc,
      duration: Number(item.duration ?? 0),
      track: item.track,
      trackId: item.trackId,
      shouldGenerateImage: item.shouldGenerateImage,
      imageState: getImageStatus(item.state),
      reason: item.reason ?? null,
      hasImage: !!item.filePath,
      associateAssetsIds: storyboardAssetMap[item.id!] ?? [],
    }));

    const trackQuery = u.db("o_videoTrack").where("projectId", projectId);
    if (scriptId) trackQuery.where("scriptId", scriptId);
    const tracks = await trackQuery.select("id", "scriptId", "prompt", "state", "reason", "duration", "videoId", "selectVideoId");
    const trackIds = tracks.map((item) => item.id!).filter(Boolean);
    const videos = trackIds.length
      ? await u.db("o_video").whereIn("videoTrackId", trackIds).select("id", "state", "videoTrackId", "errorReason", "time")
      : [];
    const videoMap = videos.reduce<Record<number, typeof videos>>((result, item) => {
      if (!result[item.videoTrackId!]) result[item.videoTrackId!] = [];
      result[item.videoTrackId!].push(item);
      return result;
    }, {});

    const trackItems = tracks.map((item) => {
      const attempts = (videoMap[item.id!] ?? []).sort((a, b) => Number(b.time ?? b.id ?? 0) - Number(a.time ?? a.id ?? 0));
      const selectedVideoId = item.selectVideoId ?? item.videoId;
      const representative = attempts.find((video) => video.id === selectedVideoId) ?? attempts[0];
      return {
        id: item.id,
        scriptId: item.scriptId,
        duration: item.duration ?? 0,
        prompt: item.prompt ?? "",
        promptState: getPromptStatus(item.state, item.prompt),
        reason: item.reason ?? null,
        storyboardIds: storyboardItems.filter((storyboard) => storyboard.trackId === item.id).map((storyboard) => storyboard.id),
        videoState: getImageStatus(representative?.state),
        videoErrorReason: representative?.errorReason ?? null,
        videos: attempts.map((video) => ({ id: video.id, state: getImageStatus(video.state), errorReason: video.errorReason ?? null })),
      };
    });

    return res.status(200).send(
      success({
        project,
        scripts,
        runnable: {
          extractOriginalAssets: isStoryboardProject ? [] : scripts.filter((item) => ![0, 1, 2].includes(item.extractState ?? -2)).map((item) => item.id),
          polishOriginalAssetPrompts: originalAssets.filter((item) => ["pending", "failed"].includes(getPromptStatus(item.promptState, item.prompt))).map(mapAsset),
          generateOriginalAssetImages: originalAssets.filter((item) => item.prompt && ["pending", "failed"].includes(getImageStatus(item.imageState))).map(mapAsset),
          generateDerivedAssets: derivableScriptIds,
          polishDerivedAssetPrompts: derivedAssets.filter((item) => ["pending", "failed"].includes(getPromptStatus(item.promptState, item.prompt))).map(mapAsset),
          generateDerivedAssetImages: derivedAssets.filter((item) => ["pending", "failed"].includes(getImageStatus(item.imageState))).map(mapAsset),
          generateStoryboardImages: storyboardItems.filter((item) => item.shouldGenerateImage !== 0 && ["pending", "failed"].includes(item.imageState)),
          generateVideoPrompts: trackItems.filter((item) => ["pending", "failed"].includes(item.promptState) && item.storyboardIds.length),
          generateVideos: trackItems.filter((item) => item.prompt && item.promptState === "success" && ["pending", "failed"].includes(item.videoState)),
        },
      }),
    );
  },
);
