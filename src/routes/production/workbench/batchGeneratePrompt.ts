import express from "express";
import u from "@/utils";
import pLimit from "p-limit";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import fs from "fs/promises";
import path from "path";
const router = express.Router();

type TrackSource = { id: number; sources: string };
type TrackRequest = { trackId: number; info: TrackSource[] };
type PromptAsset = {
  id: number;
  type?: string | null;
  name?: string | null;
  describe?: string | null;
  prompt?: string | null;
  assetsId?: number | null;
  filePath?: string | null;
};

function escapeXmlAttribute(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function getVideoPromptGeneration(vendorId: string, modelName: string, mode: string) {
  const videoPrompt = await u.db("o_prompt").where("type", "videoPromptGeneration").first();
  let videoPromptGeneration: string | undefined;
  const modelPromptData = await u.db("o_modelPrompt").where("vendorId", vendorId).where("model", modelName).first();

  if (modelPromptData?.path) {
    try {
      videoPromptGeneration = await fs.readFile(path.join(u.getPath(["modelPrompt"]), modelPromptData.path), "utf-8");
    } catch {}
  }

  if (!videoPromptGeneration) {
    const modelLower = modelName.toLowerCase();
    let fileName: string | null = null;
    if (modelLower.includes("wan") && modelLower.includes("2.6")) {
      fileName = "wan2.6Single-imageFirstFrameMode.md";
    } else if (/seedance.*2[.\-]0/i.test(modelLower)) {
      fileName = "seedance2Multi-parameterMode.md";
    } else if (mode === "startEndRequired" || mode === "endFrameOptional" || mode === "startFrameOptional") {
      fileName = "universalFirstAndLastFrameMode.md";
    } else if (mode.startsWith('["') && mode.endsWith('"]')) {
      fileName = "universalMulti-parameterMode.md";
    }
    if (fileName) {
      try {
        videoPromptGeneration = await fs.readFile(path.join(u.getPath(["modelPrompt"]), "video", fileName), "utf-8");
      } catch {}
    }
  }

  return videoPromptGeneration || videoPrompt?.useData || videoPrompt?.data || undefined;
}

async function markTrackFailed(projectId: number, trackId: number, reason: string) {
  try {
    await u.db("o_videoTrack").where({ id: trackId, projectId }).update({ state: "生成失败", reason });
  } catch (updateError) {
    console.error(`视频轨道 ${trackId} 提示词失败状态写入失败`, updateError);
  }
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    trackData: z.array(
      z.object({
        trackId: z.number(),
        info: z.array(
          z.object({
            id: z.number(),
            sources: z.string(),
          }),
        ),
      }),
    ),
    mode: z.string(),
    model: z.string(),
    concurrentCount: z.number().optional(), //并发数
  }),
  async (req, res) => {
    const { trackData, projectId, mode, model, concurrentCount = 5 } = req.body as {
      trackData: TrackRequest[];
      projectId: number;
      mode: string;
      model: string;
      concurrentCount?: number;
    };
    try {
      const [vendorId, modelName] = model.split(/:(.+)/);
      if (!vendorId || !modelName) throw new Error("视频模型配置格式无效");

      const limit = pLimit(concurrentCount);
      const tasks = trackData.map((track) =>
        limit(async () => {
          try {
            const updated = await u.db("o_videoTrack").where({ id: track.trackId, projectId }).update({ state: "生成中", reason: null });
            if (!updated) throw new Error(`视频轨道 ${track.trackId} 不存在或不属于当前项目`);

            const projectData = await u.db("o_project").select("artStyle").where({ id: projectId }).first();
            if (!projectData) throw new Error("项目不存在");
            const videoPromptGeneration = await getVideoPromptGeneration(vendorId, modelName, mode);
            if (!videoPromptGeneration) throw new Error("未配置视频提示词生成模板");

            const storyboardSources = track.info.filter((item) => item.sources === "storyboard");
            const explicitAssetIds = track.info.filter((item) => item.sources === "assets").map((item) => item.id);
            const storyboards = await Promise.all(
              storyboardSources.map(async (item) => {
                const storyboard = await u
                  .db("o_storyboard")
                  .where({ "o_storyboard.id": item.id, "o_storyboard.projectId": projectId })
                  .select("id", "videoDesc", "prompt", "track", "duration", "shouldGenerateImage", "filePath")
                  .first();
                if (!storyboard) throw new Error(`分镜 ${item.id} 不存在或不属于当前项目`);
                const associateAssetsIds = await u
                  .db("o_assets2Storyboard")
                  .where("storyboardId", item.id)
                  .orderBy("rowid")
                  .select("assetId")
                  .pluck("assetId");
                return { ...storyboard, associateAssetsIds: associateAssetsIds.map(Number) };
              }),
            );

            const associatedAssetIds = [
              ...new Set([...explicitAssetIds, ...storyboards.flatMap((item) => item.associateAssetsIds)].filter((id) => Number.isFinite(id))),
            ];
            const associatedAssets = associatedAssetIds.length
              ? ((await u
                  .db("o_assets")
                  .leftJoin("o_image", "o_image.id", "o_assets.imageId")
                  .where("o_assets.projectId", projectId)
                  .whereIn("o_assets.id", associatedAssetIds)
                  .select(
                    "o_assets.id",
                    "o_assets.type",
                    "o_assets.name",
                    "o_assets.describe",
                    "o_assets.prompt",
                    "o_assets.assetsId",
                    "o_image.filePath",
                  )) as PromptAsset[])
              : [];
            const associatedAssetMap = new Map(associatedAssets.map((item) => [item.id, item]));
            const orderedAssociatedAssets = associatedAssetIds.map((id) => associatedAssetMap.get(id)).filter((item): item is PromptAsset => !!item);
            const parentAssetIds = [...new Set(orderedAssociatedAssets.map((item) => item.assetsId).filter((id): id is number => !!id))];
            const parentAssets = parentAssetIds.length
              ? ((await u
                  .db("o_assets")
                  .leftJoin("o_image", "o_image.id", "o_assets.imageId")
                  .where("o_assets.projectId", projectId)
                  .whereIn("o_assets.id", parentAssetIds)
                  .select(
                    "o_assets.id",
                    "o_assets.type",
                    "o_assets.name",
                    "o_assets.describe",
                    "o_assets.prompt",
                    "o_assets.assetsId",
                    "o_image.filePath",
                  )) as PromptAsset[])
              : [];
            const parentAssetMap = new Map(parentAssets.map((item) => [item.id, item]));
            const contextAssets = [
              ...parentAssets.filter((parent) => !associatedAssetMap.has(parent.id)),
              ...orderedAssociatedAssets,
            ];
            const missingAssetIds = associatedAssetIds.filter((id) => !associatedAssetMap.has(id));
            if (missingAssetIds.length) throw new Error(`分镜关联资产不存在或不属于当前项目：${missingAssetIds.join(", ")}`);
            const imageAssets = orderedAssociatedAssets.filter((item) => item.filePath && item.type !== "audio");
            const imageStoryboards = storyboards.filter((item) => item.shouldGenerateImage !== 0 && item.filePath);
            const referenceImages = await Promise.all([
              ...imageAssets.map(async (item) => ({
                label: `资产 ${item.id}（${item.assetsId ? "衍生资产" : "原始资产"}：${item.name ?? "未命名"}）`,
                base64: await u.oss.getImageBase64(item.filePath!),
              })),
              ...imageStoryboards.map(async (item) => ({
                label: `分镜 ${item.id}`,
                base64: await u.oss.getImageBase64(item.filePath!),
              })),
            ]);

            const assetContext = contextAssets.map((item) => {
              const parent = item.assetsId ? parentAssetMap.get(item.assetsId) : undefined;
              return {
                id: item.id,
                assetKind: item.assetsId ? "derived" : "original",
                parentAssetId: item.assetsId ?? null,
                parentAssetName: parent?.name ?? null,
                type: item.type ?? null,
                name: item.name ?? null,
                describe: item.describe ?? null,
                prompt: item.prompt ?? null,
                hasImage: !!item.filePath,
              };
            });
            const storyboardContent = storyboards
              .map(
                (item) => `<storyboardItem
  id='${escapeXmlAttribute(item.id)}'
  videoDesc='${escapeXmlAttribute(item.videoDesc)}'
  prompt='${escapeXmlAttribute(item.prompt)}'
  track='${escapeXmlAttribute(item.track)}'
  duration='${escapeXmlAttribute(item.duration)}'
  associateAssetsIds='${escapeXmlAttribute(JSON.stringify(item.associateAssetsIds))}'
  shouldGenerateImage='${item.shouldGenerateImage !== 0 && !!item.filePath}'
></storyboardItem>`,
              )
              .join("\n");
            const content = `
**模型名称**：${modelName}
**资产信息**（按参考图顺序）：${imageAssets
              .map((item) => `[${item.id},${item.type ?? "unknown"},${item.name ?? "未命名"},${item.assetsId ? "derived" : "original"}]`)
              .join("，")}
**分镜关联的原始/衍生资产信息**：${JSON.stringify(assetContext)}
**分镜信息**：
${storyboardContent}
**参考图映射**：${referenceImages.map((item, index) => `@图${index + 1}=${item.label}`).join("，")}
`;
            const userContent: ({ type: "text"; text: string } | { type: "image"; image: string })[] = [
              { type: "text", text: content },
              ...referenceImages.flatMap((item, index) => [
                { type: "text" as const, text: `@图${index + 1}：${item.label}` },
                { type: "image" as const, image: item.base64 },
              ]),
            ];
            const visualManual = u.getArtPrompt(projectData.artStyle || "无", "art_skills", "art_storyboard_video");
            const { text } = await u.Ai.Text("universalAi").invoke({
              system: videoPromptGeneration,
              messages: [
                { role: "assistant", content: visualManual },
                { role: "user", content: userContent },
              ],
            });

            await u.db("o_videoTrack").where({ id: track.trackId, projectId }).update({
              prompt: text,
              state: "已完成",
              reason: null,
            });
            return { trackId: track.trackId, text };
          } catch (trackError) {
            const reason = u.error(trackError).message;
            await markTrackFailed(projectId, track.trackId, reason);
            return { trackId: track.trackId, error: reason };
          }
        }),
      );

      void Promise.all(tasks).catch((backgroundError) => {
        console.error("批量视频提示词后台任务执行失败", backgroundError);
      });
      return res.status(200).send(success("开始生成提示词"));
    } catch (e) {
      return res.status(400).send(error(u.error(e).message));
    }
  },
);
