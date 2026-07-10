import express from "express";
import u from "@/utils";
import pLimit from "p-limit";
import * as zod from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

type ItemType = "characters" | "props" | "scenes";
type AssetPromptItem = { assetsId: number; type: string; name: string; describe: string };
type TypeConfig = { promptKey: string; itemType: ItemType; label: string; nameLabel: string; visualManual: string };

const getTypeConfig = (isDerivative: boolean): Record<string, TypeConfig> => ({
  role: {
    promptKey: "role-polish",
    itemType: "characters",
    label: "角色标准四视图",
    nameLabel: "角色",
    visualManual: isDerivative ? "art_character_derivative" : "art_character",
  },
  scene: {
    promptKey: "scene-polish",
    itemType: "scenes",
    label: "场景图",
    nameLabel: "场景",
    visualManual: isDerivative ? "art_scene_derivative" : "art_scene",
  },
  tool: {
    promptKey: "tool-polish",
    itemType: "props",
    label: "道具图",
    nameLabel: "道具",
    visualManual: isDerivative ? "art_prop_derivative" : "art_prop",
  },
});

// 润色提示词
export default router.post(
  "/",
  validateFields({
    items: zod.array(
      zod.object({
        assetsId: zod.number(),
        type: zod.string(),
        name: zod.string(),
        describe: zod.string(),
      }),
    ),
    projectId: zod.number(),
    concurrentCount: zod.number().int().min(1).optional(),
    otherTextPrompt: zod.string(),
  }),
  async (req, res) => {
    const { projectId, items, concurrentCount, otherTextPrompt } = req.body as {
      projectId: number;
      items: AssetPromptItem[];
      concurrentCount?: number;
      otherTextPrompt: string;
    };
    const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
    if (!project) return res.status(500).send(success({ message: "项目为空" }));

    const assetsIds = [...new Set(items.map((item) => item.assetsId))];
    const assetsDataList = assetsIds.length
      ? await u.db("o_assets").where("projectId", projectId).whereIn("id", assetsIds).select("id", "assetsId")
      : [];
    if (assetsDataList.length !== assetsIds.length) return res.status(500).send(error("资产不存在或不属于当前项目"));

    const assetsDataMap = new Map(assetsDataList.map((asset) => [asset.id, asset]));
    await u.db("o_assets").where("projectId", projectId).whereIn("id", assetsIds).update({
      promptState: "生成中",
      promptErrorReason: null,
    });

    const writeFailureState = async (assetId: number, reason: string) => {
      try {
        await u.db("o_assets").where({ id: assetId, projectId }).update({
          promptState: "生成失败",
          promptErrorReason: reason,
        });
      } catch (updateError) {
        console.error(`资产 ${assetId} 提示词失败状态写入失败`, updateError);
      }
    };

    // 保持接口立即响应，任务继续在后台按指定并发数执行。
    const limit = pLimit(concurrentCount ?? 1);
    const tasks = items.map((item) =>
      limit(async () => {
        try {
          const assetData = assetsDataMap.get(item.assetsId);
          if (!assetData) throw new Error("资产不存在或不属于当前项目");

          const config = getTypeConfig(!!assetData.assetsId)[item.type];
          if (!config) throw new Error(`不支持的资产类型：${item.type || "未指定"}`);
          if (!project.artStyle?.trim()) throw new Error("项目未配置艺术风格，无法读取视觉手册");

          const visualManual = u.getArtPrompt(project.artStyle, "art_skills", config.visualManual, true).trim();
          if (!visualManual) throw new Error(`未找到视觉手册：${config.visualManual}`);

          const result = (await u.Ai.Text("universalAi").invoke({
            system: `${visualManual}\n${otherTextPrompt}`,
            messages: [
              {
                role: "user",
                content: `
                    **基础参数：**
      **${config.nameLabel}设定：**
      - ${config.nameLabel}名称:${item.name},
      - ${config.nameLabel}描述:${item.describe},`,
              },
            ],
          })) as { _output?: unknown; text?: unknown };
          const output = typeof result._output === "string" ? result._output.trim() : typeof result.text === "string" ? result.text.trim() : "";
          if (!output) throw new Error("资产提示词生成结果为空");

          await u.db("o_assets").where({ id: item.assetsId, projectId }).update({
            prompt: output,
            promptState: "已完成",
            promptErrorReason: null,
          });
        } catch (e) {
          await writeFailureState(item.assetsId, u.error(e).message);
        }
      }),
    );

    void Promise.all(tasks).catch((taskError) => {
      console.error("批量资产提示词后台任务执行失败", taskError);
    });

    return res.status(200).send(success({ total: items.length }));
  },
);
