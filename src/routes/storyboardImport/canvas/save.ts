import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";
import { assertNoUnpublishedDraftReference, normalizeCanvasGraph, persistCanvasAssetSelections } from "@/lib/storyboardCanvas";
import { ensureExactRoleAssociations } from "@/lib/storyboardAssetAssociations";

const router = express.Router();

const selectionSchema = z.object({
  assetId: z.number().int().positive(),
  sourceNodeId: z.string().optional().nullable(),
  referenceEnabled: z.boolean(),
  mode: z.enum(["global", "local"]),
  filePath: z.string().optional().nullable(),
  describe: z.string().optional().nullable(),
  prompt: z.string().optional().nullable(),
  baseAssetRevision: z.number().int().positive().optional(),
});

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    storyboardId: z.number().int().positive(),
    flowId: z.number().int().positive().optional().nullable(),
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    prompt: z.string(),
    finalImageUrl: z.string().optional().nullable(),
    assetSelections: z.array(selectionSchema).optional(),
  }),
  async (req, res) => {
    try {
      assertNoUnpublishedDraftReference(req.body.nodes, req.body.edges);
      const graph = normalizeCanvasGraph(req.body.nodes, req.body.edges);
      const result = await u.db.transaction(async (trx) => {
        const { projectId, scriptId, storyboardId } = req.body;
        const project = await trx("o_project").where("id", projectId).select("projectType").first();
        if (!project || normalizeProjectType(project.projectType ?? "") !== ProjectTypes.storyboard) {
          throw new Error("该能力仅适用于“基于分镜表”项目");
        }
        const storyboard = await trx("o_storyboard").where({ id: storyboardId, projectId, scriptId }).first();
        if (!storyboard) throw new Error("分镜不存在或不属于当前项目和剧本");

        await ensureExactRoleAssociations(trx, {
          storyboardId,
          projectId,
          scriptId,
          prompt: req.body.prompt,
          videoDesc: storyboard.videoDesc,
        });

        const expectedFlowId = Number(req.body.flowId || 0);
        const currentFlowId = Number(storyboard.flowId || 0);
        if (expectedFlowId !== currentFlowId) throw new Error("画布版本已变更，请刷新后重试");
        let flowId = currentFlowId;
        if (flowId) {
          const flow = await trx("o_imageFlow").where("id", flowId).first();
          if (!flow) throw new Error("画布流程不存在，请刷新后重试");
          await trx("o_imageFlow").where("id", flowId).update({ flowData: JSON.stringify(graph) });
        } else {
          [flowId] = await trx("o_imageFlow").insert({ flowData: JSON.stringify(graph) });
        }

        const updateStoryboard: Record<string, unknown> = { flowId, prompt: req.body.prompt };
        if (typeof req.body.finalImageUrl === "string") {
          const filePath = u.replaceUrl(req.body.finalImageUrl);
          updateStoryboard.filePath = filePath;
          updateStoryboard.state = filePath ? "已完成" : "未生成";
          updateStoryboard.reason = null;
          updateStoryboard.shouldGenerateImage = filePath ? 1 : 0;
        }
        await trx("o_storyboard").where({ id: storyboardId, projectId, scriptId }).update(updateStoryboard);

        const selections = req.body.assetSelections ?? [];
        await persistCanvasAssetSelections(trx, { projectId, scriptId, storyboardId, selections });
        return { flowId };
      });
      res.status(200).send(success(result));
    } catch (cause) {
      res.status(400).send(error(cause instanceof Error ? cause.message : "保存画布失败"));
    }
  },
);
