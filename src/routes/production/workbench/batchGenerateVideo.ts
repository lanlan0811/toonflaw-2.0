import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ReferenceList } from "@/utils/ai";
const router = express.Router();

type BatchTrack = {
  uploadData: { id: number; sources: string }[];
  trackId: number;
  prompt: string;
  duration: number;
};
type VideoTask = BatchTrack & { videoId: number; videoPath: string };

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    trackData: z.array(
      z.object({
        uploadData: z.array(
          z.object({
            id: z.number(),
            sources: z.string(),
          }),
        ),
        trackId: z.number(),
        prompt: z.string(),
        duration: z.number(),
      }),
    ),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    audio: z.boolean().optional(),
  }),
  async (req, res) => {
    const { scriptId, projectId, trackData, model, resolution, audio, mode } = req.body as {
      scriptId: number;
      projectId: number;
      trackData: BatchTrack[];
      model: `${string}:${string}`;
      resolution: string;
      audio?: boolean;
      mode: string;
    };

    try {
      let modeData: string[] = [];
      if (mode.startsWith('["') && mode.endsWith('"]')) {
        try {
          const parsed = JSON.parse(mode);
          if (Array.isArray(parsed)) modeData = parsed;
        } catch {}
      }

      const ratio = await u.db("o_project").select("videoRatio").where("id", projectId).first();
      if (!ratio) throw new Error("项目不存在");
      const requestedTrackIds = [...new Set(trackData.map((track) => track.trackId))];
      const validTracks = requestedTrackIds.length
        ? await u.db("o_videoTrack").where({ projectId, scriptId }).whereIn("id", requestedTrackIds).select("id", "state", "prompt")
        : [];
      const validTrackIds = new Set(validTracks.map((track) => track.id));
      const validTrackMap = new Map(validTracks.map((track) => [track.id, track]));
      const invalidTrackIds = requestedTrackIds.filter((trackId) => !validTrackIds.has(trackId));
      if (invalidTrackIds.length) throw new Error(`视频轨道不存在或不属于当前项目和剧本：${invalidTrackIds.join(", ")}`);

      const tasks = await u.db.transaction(async (trx) => {
        const result: VideoTask[] = [];
        for (const track of trackData) {
          const videoPath = `/${projectId}/video/${uuidv4()}.mp4`;
          const [videoId] = await trx("o_video").insert({
            filePath: videoPath,
            time: Date.now(),
            state: "生成中",
            errorReason: null,
            scriptId,
            projectId,
            videoTrackId: track.trackId,
          });
          result.push({ ...track, videoId, videoPath });
          const currentTrack = validTrackMap.get(track.trackId);
          if (currentTrack?.prompt && currentTrack.state !== "生成中") {
            await trx("o_videoTrack").where({ id: track.trackId, projectId, scriptId }).update({ state: "已完成", reason: null });
          }
        }
        return result;
      });

      res.status(200).send(success(tasks.map((task) => ({ videoId: task.videoId, trackId: task.trackId }))));

      const restoreTrackPromptState = async (task: VideoTask) => {
        await u.db("o_videoTrack").where({ id: task.trackId, projectId, scriptId }).update({ state: "已完成", reason: null });
      };
      const generateSingleVideo = async (task: VideoTask) => {
        const { videoId, videoPath, prompt, duration, uploadData } = task;
        try {
          const references = await Promise.all(
            uploadData.map(async (item): Promise<ReferenceList> => {
              if (item.sources === "storyboard") {
                const storyboard = await u.db("o_storyboard").where({ id: item.id, projectId, scriptId }).select("filePath").first();
                if (!storyboard?.filePath) throw new Error(`分镜 ${item.id} 没有可用图片`);
                return { base64: await u.oss.getImageBase64(storyboard.filePath), type: "image" };
              }
              if (item.sources === "assets") {
                const asset = await u
                  .db("o_assets")
                  .where({ "o_assets.id": item.id, "o_assets.projectId": projectId })
                  .leftJoin("o_image", "o_assets.imageId", "o_image.id")
                  .select("o_image.filePath", "o_assets.type")
                  .first();
                if (!asset?.filePath) throw new Error(`资产 ${item.id} 没有可用文件`);
                return {
                  base64: await u.oss.getImageBase64(asset.filePath),
                  type: asset.type === "audio" ? "audio" : "image",
                };
              }
              throw new Error(`不支持的参考资源类型：${item.sources}`);
            }),
          );
          const relatedObjects = { projectId, videoId, scriptId, type: "视频" };
          const aiVideo = u.Ai.Video(model);
          await aiVideo.run(
            {
              prompt,
              referenceList: references,
              mode: (modeData.length > 0 ? modeData : mode) as any,
              duration,
              aspectRatio: (ratio.videoRatio as "16:9" | "9:16") || "16:9",
              resolution,
              audio,
            },
            {
              projectId,
              taskClass: "视频生成",
              describe: "根据提示词生成视频",
              relatedObjects: JSON.stringify(relatedObjects),
            },
          );
          await aiVideo.save(videoPath);
          const updated = await u.db("o_video").where({ id: videoId, projectId, scriptId, videoTrackId: task.trackId }).update({
            state: "生成成功",
            errorReason: null,
          });
          if (!updated) throw new Error(`视频任务 ${videoId} 不存在`);
          await restoreTrackPromptState(task);
        } catch (taskError) {
          const errorReason = u.error(taskError).message;
          try {
            await u.db.transaction(async (trx) => {
              const updated = await trx("o_video").where({ id: videoId, projectId, scriptId, videoTrackId: task.trackId }).update({
                state: "生成失败",
                errorReason,
              });
              if (!updated) throw new Error(`视频任务 ${videoId} 不存在，无法写入失败状态`);
              await trx("o_videoTrack").where({ id: task.trackId, projectId, scriptId }).update({ state: "已完成", reason: null });
            });
          } catch (updateError) {
            console.error(`视频任务 ${videoId} 失败状态写入失败`, updateError);
          }
        }
      };

      void Promise.all(tasks.map(generateSingleVideo)).catch((taskError) => {
        console.error("批量视频后台任务执行失败", taskError);
      });
    } catch (e) {
      if (!res.headersSent) return res.status(400).send(error(u.error(e).message));
      console.error("批量视频任务启动失败", e);
    }
  },
);
