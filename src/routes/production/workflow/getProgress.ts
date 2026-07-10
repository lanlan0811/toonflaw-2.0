import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

import { validateWorkflowContext } from "./utils";

const router = express.Router();

type WorkflowState = "idle" | "ready" | "generating" | "success" | "failed" | "partial";
type ItemState = "pending" | "success" | "failed" | "generating";

type AssetProgressRow = {
  id?: number;
  assetsId?: number | null;
  type?: string | null;
  prompt?: string | null;
  promptState?: string | null;
  imageState?: string | null;
};

function getProgressState(total: number, pending: number, successCount: number, failed: number, generating: number): WorkflowState {
  if (!total) return "idle";
  if (generating) return "generating";
  if (failed && successCount) return "partial";
  if (failed) return "failed";
  if (successCount === total) return "success";
  if (pending) return "ready";
  return "idle";
}

function getImageState(state?: string | null): ItemState {
  if (state === "已完成" || state === "生成成功") return "success";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "生成中") return "generating";
  return "pending";
}

function getPromptState(state?: string | null, prompt?: string | null): ItemState {
  if (state === "生成中") return "generating";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "已完成" || state === "生成成功" || !!prompt) return "success";
  return "pending";
}

function getExtractState(state?: number | null): ItemState {
  if (state === 1) return "success";
  if (state === -1) return "failed";
  if (state === 0 || state === 2) return "generating";
  return "pending";
}

function getVideoState(state?: string | null): ItemState {
  if (state === "已完成" || state === "生成成功") return "success";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "生成中") return "generating";
  return "pending";
}

function countByState<T>(list: T[], stateGetter: (item: T) => ItemState) {
  return list.reduce(
    (result, item) => {
      result[stateGetter(item)] += 1;
      return result;
    },
    { pending: 0, success: 0, failed: 0, generating: 0 },
  );
}

function withCompatibility<T extends { state: WorkflowState; total: number }>(step: T, runnable: boolean, blockReason: string | null = null) {
  return {
    ...step,
    runnable,
    blockReason: runnable ? null : blockReason,
    completed: step.state === "success",
    generating: step.state === "generating",
    failed: step.state === "failed" || step.state === "partial",
  };
}

function getRunState(state?: string | null): WorkflowState {
  if (state === "running") return "generating";
  if (state === "success" || state === "empty") return "success";
  if (state === "failed") return "failed";
  return "idle";
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body as { projectId: number; scriptId?: number | null };
    try {
      const { project, isStoryboardProject } = await validateWorkflowContext(projectId, scriptId);

      const scriptQuery = u.db("o_script").where("projectId", projectId);
    if (scriptId) scriptQuery.where("id", scriptId);
    const scripts = await scriptQuery.select("id", "extractState", "errorReason");
    if (scriptId && !scripts.length) return res.status(400).send(error("剧本不存在或不属于当前项目"));

    const [novelTotalRow, novelPendingRow, eventSuccessRow, eventFailedRow, latestDerivedRun] = await Promise.all([
      u.db("o_novel").where("projectId", projectId).count("id as total").first(),
      u.db("o_novel").where("projectId", projectId).where("eventState", 0).count("id as total").first(),
      u.db("o_novel").where("projectId", projectId).where("eventState", 1).count("id as total").first(),
      u.db("o_novel").where("projectId", projectId).where("eventState", -1).count("id as total").first(),
      scriptId
        ? u.db("o_workflowStepRun").where({ projectId, scriptId, step: "generateDerivedAssets" }).orderBy("id", "desc").first()
        : Promise.resolve(undefined),
    ]);

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
    const assets = (await assetQuery.distinct(
      "o_assets.id",
      "o_assets.assetsId",
      "o_assets.type",
      "o_assets.prompt",
      "o_assets.promptState",
      "o_image.state as imageState",
    )) as AssetProgressRow[];

    const originalAssets = assets.filter((item) => !item.assetsId);
    const derivedAssets = assets.filter((item) => !!item.assetsId);
    const originalPromptCounts = countByState(originalAssets, (item) => getPromptState(item.promptState, item.prompt));
    const derivedPromptCounts = countByState(derivedAssets, (item) => getPromptState(item.promptState, item.prompt));
    const originalImageCounts = countByState(originalAssets, (item) => getImageState(item.imageState));
    const derivedImageCounts = countByState(derivedAssets, (item) => getImageState(item.imageState));
    const scriptExtractCounts = countByState(scripts, (item) => getExtractState(item.extractState));
    const originalAssetState: WorkflowState = scriptExtractCounts.generating
      ? "generating"
      : scriptExtractCounts.failed && originalAssets.length
        ? "partial"
        : scriptExtractCounts.failed
          ? "failed"
          : originalAssets.length
            ? "success"
            : scripts.length
              ? "ready"
              : "idle";

    const storyboardQuery = u.db("o_storyboard").where("projectId", projectId);
    if (scriptId) storyboardQuery.where("scriptId", scriptId);
    const storyboards = await storyboardQuery.select("id", "state", "shouldGenerateImage");
    const imageStoryboards = storyboards.filter((item) => item.shouldGenerateImage !== 0);
    const storyboardImageCounts = countByState(imageStoryboards, (item) => getImageState(item.state));

    const trackQuery = u.db("o_videoTrack").where("projectId", projectId);
    if (scriptId) trackQuery.where("scriptId", scriptId);
    const tracks = await trackQuery.select("id", "state", "prompt", "videoId", "selectVideoId");
    const trackIds = tracks.map((item) => item.id!).filter(Boolean);
    const videos = trackIds.length
      ? await u.db("o_video").whereIn("videoTrackId", trackIds).select("id", "state", "videoTrackId", "time")
      : [];
    const videoPromptCounts = countByState(tracks, (item) => getPromptState(item.state, item.prompt));
    const representativeVideos = tracks.map((track) => {
      const candidates = videos
        .filter((video) => video.videoTrackId === track.id)
        .sort((a, b) => Number(b.time ?? b.id ?? 0) - Number(a.time ?? a.id ?? 0));
      const selectedVideoId = track.selectVideoId ?? track.videoId;
      return candidates.find((video) => video.id === selectedVideoId) ?? candidates[0];
    });
    const videoCounts = countByState(representativeVideos, (item) => getVideoState(item?.state));

    const novelTotal = Number((novelTotalRow as { total?: number })?.total ?? 0);
    const novelPending = Number((novelPendingRow as { total?: number })?.total ?? 0);
    const eventSuccess = Number((eventSuccessRow as { total?: number })?.total ?? 0);
    const eventFailed = Number((eventFailedRow as { total?: number })?.total ?? 0);

    const hasOriginalAssets = originalAssets.length > 0;
    const hasDerivedAssets = derivedAssets.length > 0;
    const hasStoryboards = storyboards.length > 0;
    const derivedRunState = getRunState(latestDerivedRun?.state);
    const derivedState: WorkflowState = derivedRunState === "idle"
      ? hasOriginalAssets && hasStoryboards
        ? "ready"
        : "idle"
      : derivedRunState;
    const derivedRunnable =
      !!scriptId &&
      hasOriginalAssets &&
      hasStoryboards &&
      (!latestDerivedRun || latestDerivedRun.state === "failed");
    const derivedBlockReason = !scriptId
      ? "生成衍生资产需要明确指定 scriptId"
      : !hasOriginalAssets
        ? "当前批次没有原始资产"
        : !hasStoryboards
          ? "当前批次没有分镜"
          : latestDerivedRun?.state === "running"
            ? "衍生资产正在生成"
            : latestDerivedRun?.state === "success"
              ? "衍生资产已生成；如需重新分析，请启用强制重生成"
              : latestDerivedRun?.state === "empty"
                ? "本次分析没有需要创建的衍生资产；如需重新分析，请启用强制重生成"
                : null;
    const steps = {
      importContent: withCompatibility({
        state: scripts.length || novelTotal || storyboards.length ? "success" : "idle",
        total: scripts.length + novelTotal + storyboards.length,
        scripts: scripts.length,
        novels: novelTotal,
        storyboards: storyboards.length,
      }, false, "导入步骤不通过工作流运行接口执行"),
      novelEvents: withCompatibility({
        state: getProgressState(novelTotal, novelPending, eventSuccess, eventFailed, 0),
        total: novelTotal,
        pending: novelPending,
        success: eventSuccess,
        failed: eventFailed,
      }, novelTotal > 0 && novelPending + eventFailed > 0, novelTotal ? "没有待处理或失败的小说章节" : "项目没有小说章节"),
      originalAssets: withCompatibility({
        state: originalAssetState,
        total: originalAssets.length,
        sourceScripts: scripts.length,
        extract: scriptExtractCounts,
      }, !isStoryboardProject && scripts.some((item) => getExtractState(item.extractState) === "pending" || getExtractState(item.extractState) === "failed"), isStoryboardProject ? "基于分镜表的项目在导入时已创建原始资产" : scripts.length ? "没有可提取的剧本" : "项目没有剧本"),
      originalAssetPrompts: withCompatibility({
        state: getProgressState(originalAssets.length, originalPromptCounts.pending, originalPromptCounts.success, originalPromptCounts.failed, originalPromptCounts.generating),
        total: originalAssets.length,
        ...originalPromptCounts,
      }, hasOriginalAssets && originalPromptCounts.generating === 0 && originalPromptCounts.pending + originalPromptCounts.failed > 0, hasOriginalAssets ? "没有待处理或失败的原始资产提示词" : "当前批次没有原始资产"),
      originalAssetImages: withCompatibility({
        state: getProgressState(originalAssets.length, originalImageCounts.pending, originalImageCounts.success, originalImageCounts.failed, originalImageCounts.generating),
        total: originalAssets.length,
        ...originalImageCounts,
      }, hasOriginalAssets && originalPromptCounts.success > 0 && originalImageCounts.generating === 0 && originalImageCounts.pending + originalImageCounts.failed > 0, !hasOriginalAssets ? "当前批次没有原始资产" : !originalPromptCounts.success ? "没有已就绪的原始资产提示词" : "没有待处理或失败的原始资产图片"),
      derivedAssets: withCompatibility({
        state: derivedState,
        total: derivedAssets.length,
        runState: latestDerivedRun?.state ?? null,
        runId: latestDerivedRun?.id ?? null,
        runItemCount: latestDerivedRun?.itemCount ?? null,
        errorReason: latestDerivedRun?.errorReason ?? null,
        startTime: latestDerivedRun?.startTime ?? null,
        endTime: latestDerivedRun?.endTime ?? null,
      }, derivedRunnable, derivedBlockReason),
      derivedAssetPrompts: withCompatibility({
        state: getProgressState(derivedAssets.length, derivedPromptCounts.pending, derivedPromptCounts.success, derivedPromptCounts.failed, derivedPromptCounts.generating),
        total: derivedAssets.length,
        ...derivedPromptCounts,
      }, hasDerivedAssets && derivedPromptCounts.generating === 0 && derivedPromptCounts.pending + derivedPromptCounts.failed > 0, hasDerivedAssets ? "没有待处理或失败的衍生资产提示词" : "当前批次没有衍生资产"),
      derivedAssetImages: withCompatibility({
        state: getProgressState(derivedAssets.length, derivedImageCounts.pending, derivedImageCounts.success, derivedImageCounts.failed, derivedImageCounts.generating),
        total: derivedAssets.length,
        ...derivedImageCounts,
      }, hasDerivedAssets && derivedImageCounts.generating === 0 && derivedImageCounts.pending + derivedImageCounts.failed > 0, hasDerivedAssets ? "没有待处理或失败的衍生资产图片" : "当前批次没有衍生资产"),
      storyboardPanel: withCompatibility({
        state: storyboards.length ? "success" : scripts.length || derivedAssets.length ? "ready" : "idle",
        total: storyboards.length,
      }, false, storyboards.length ? "分镜面板已存在" : "分镜面板不通过工作流运行接口生成"),
      storyboardImages: withCompatibility({
        state: getProgressState(imageStoryboards.length, storyboardImageCounts.pending, storyboardImageCounts.success, storyboardImageCounts.failed, storyboardImageCounts.generating),
        total: imageStoryboards.length,
        skipped: storyboards.length - imageStoryboards.length,
        ...storyboardImageCounts,
      }, imageStoryboards.length > 0 && storyboardImageCounts.generating === 0 && storyboardImageCounts.pending + storyboardImageCounts.failed > 0, imageStoryboards.length ? "没有待处理或失败的分镜图片" : "当前批次没有需要生成图片的分镜"),
      videoPrompts: withCompatibility({
        state: getProgressState(tracks.length, videoPromptCounts.pending, videoPromptCounts.success, videoPromptCounts.failed, videoPromptCounts.generating),
        total: tracks.length,
        ...videoPromptCounts,
      }, tracks.length > 0 && videoPromptCounts.generating === 0 && videoPromptCounts.pending + videoPromptCounts.failed > 0, tracks.length ? "没有待处理或失败的视频提示词" : "当前批次没有视频轨道"),
      videos: withCompatibility({
        state: getProgressState(tracks.length, videoCounts.pending, videoCounts.success, videoCounts.failed, videoCounts.generating),
        total: tracks.length,
        attempts: videos.length,
        ...videoCounts,
      }, tracks.length > 0 && videoPromptCounts.success > 0 && videoCounts.generating === 0 && videoCounts.pending + videoCounts.failed > 0, !tracks.length ? "当前批次没有视频轨道" : !videoPromptCounts.success ? "没有已就绪的视频提示词" : "没有待处理或失败的视频"),
    };

      return res.status(200).send(
        success({
          project: {
            id: project.id,
            name: project.name,
            projectType: project.projectType,
          },
          scriptId: scriptId ?? null,
          steps,
        }),
      );
    } catch (e) {
      return res.status(400).send(error(u.error(e).message));
    }
  },
);
