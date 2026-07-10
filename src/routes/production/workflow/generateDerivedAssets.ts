import express from "express";
import { jsonSchema, tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { createWorkflowStepRun, finishWorkflowStepRun, validateWorkflowContext } from "./utils";

const router = express.Router();
const workflowStep = "generateDerivedAssets" as const;
const assetTypes = ["role", "scene", "tool"];

const derivedAssetSuggestionSchema = z.object({
  parentAssetId: z.number().int().describe("父级原始资产 ID，必须来自输入的原始资产列表"),
  storyboardIds: z.array(z.number().int()).min(1).describe("使用该衍生资产的分镜 ID，必须来自输入的当前分镜批次"),
  name: z.string().trim().min(1).describe("衍生资产名称"),
  describe: z.string().trim().min(1).describe("结合分镜上下文给出的衍生资产视觉描述"),
});

const derivedAssetResultSchema = z.object({
  suggestions: z.array(derivedAssetSuggestionSchema).describe("建议新增的衍生资产列表；没有建议时返回空数组"),
});

type DerivedAssetResult = z.infer<typeof derivedAssetResultSchema>;

function parseJsonResult(text: string): DerivedAssetResult {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 未调用结构化结果工具，且响应中不包含有效 JSON 对象");

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized.slice(start, end + 1));
  } catch (e) {
    throw new Error(`AI 结构化结果 JSON 解析失败：${u.error(e).message}`);
  }

  const result = derivedAssetResultSchema.safeParse(parsed);
  if (!result.success) {
    const reason = result.error.issues.map((item) => `${item.path.join(".")} ${item.message}`).join("；");
    throw new Error(`AI 结构化结果校验失败：${reason}`);
  }
  return result.data;
}

function uniqueNumbers(ids: number[]) {
  return [...new Set(ids)];
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    storyboardIds: z.array(z.number().int().positive()).optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, storyboardIds: inputStoryboardIds } = req.body as {
      projectId: number;
      scriptId: number;
      storyboardIds?: number[];
    };
    let stepRunId: number | undefined;

    try {
      const { project, script } = await validateWorkflowContext(projectId, scriptId, true);
      const batchStoryboards = await u
        .db("o_storyboard")
        .where({ projectId, scriptId })
        .orderBy("index", "asc")
        .select("id", "index", "track", "duration", "videoDesc", "prompt", "shouldGenerateImage");
      const batchStoryboardIds = batchStoryboards.map((item) => item.id!).filter(Boolean);
      const requestedStoryboardIds = inputStoryboardIds == null ? batchStoryboardIds : uniqueNumbers(inputStoryboardIds);
      if (inputStoryboardIds && requestedStoryboardIds.length !== inputStoryboardIds.length) throw new Error("storyboardIds 不能包含重复 ID");

      const batchStoryboardIdSet = new Set(batchStoryboardIds);
      const invalidStoryboardIds = requestedStoryboardIds.filter((id) => !batchStoryboardIdSet.has(id));
      if (invalidStoryboardIds.length) {
        throw new Error(`分镜不属于当前项目和剧本批次：${invalidStoryboardIds.join(", ")}`);
      }
      const requestedStoryboardIdSet = new Set(requestedStoryboardIds);
      const storyboards = batchStoryboards.filter((item) => item.id && requestedStoryboardIdSet.has(item.id));

      stepRunId = await createWorkflowStepRun(projectId, scriptId, workflowStep);

      const originalAssets = await u
        .db("o_assets")
        .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
        .where("o_assets.projectId", projectId)
        .where("o_scriptAssets.scriptId", scriptId)
        .whereNull("o_assets.assetsId")
        .whereIn("o_assets.type", assetTypes)
        .distinct("o_assets.id", "o_assets.name", "o_assets.type", "o_assets.describe", "o_assets.prompt");
      if (!originalAssets.length) throw new Error("该剧本没有可用于生成衍生资产的原始资产");

      const storyboardAssetRows = requestedStoryboardIds.length
        ? await u
            .db("o_assets2Storyboard")
            .join("o_assets", "o_assets.id", "o_assets2Storyboard.assetId")
            .whereIn("o_assets2Storyboard.storyboardId", requestedStoryboardIds)
            .where("o_assets.projectId", projectId)
            .select("o_assets2Storyboard.storyboardId", "o_assets.id as assetId", "o_assets.name", "o_assets.type")
        : [];
      const storyboardAssetMap = storyboardAssetRows.reduce<Record<number, { id: number; name: string | null; type: string | null }[]>>(
        (result, item) => {
          const storyboardId = item.storyboardId!;
          if (!result[storyboardId]) result[storyboardId] = [];
          result[storyboardId].push({ id: item.assetId!, name: item.name ?? null, type: item.type ?? null });
          return result;
        },
        {},
      );
      const storyboardContext = storyboards.map((item) => ({ ...item, assets: storyboardAssetMap[item.id!] ?? [] }));

      const originalAssetIds = originalAssets.map((item) => item.id!).filter(Boolean);
      const existingDerivedAssets = await u
        .db("o_assets")
        .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
        .where("o_assets.projectId", projectId)
        .where("o_scriptAssets.scriptId", scriptId)
        .whereIn("o_assets.assetsId", originalAssetIds)
        .distinct("o_assets.id", "o_assets.assetsId", "o_assets.name", "o_assets.describe", "o_assets.type");

      let structuredResult: DerivedAssetResult | null = null;
      let toolCalled = false;
      const resultTool = tool({
        description: "分析完成后必须调用此工具返回结构化衍生资产建议",
        inputSchema: jsonSchema<DerivedAssetResult>(derivedAssetResultSchema.toJSONSchema()),
        execute: async (raw) => {
          const parsed = derivedAssetResultSchema.safeParse(raw);
          if (!parsed.success) throw new Error(`AI 工具结果校验失败：${parsed.error.message}`);
          toolCalled = true;
          structuredResult = parsed.data;
          return "结构化结果已接收，无需再输出其他内容";
        },
      });

      const aiResponse = await u.Ai.Text("universalAi").invoke({
        messages: [
          {
            role: "system",
            content: [
              "你是影视制作中的衍生资产规划助手。请基于指定剧本的原始资产和当前分镜批次上下文，识别需要独立视觉形态的衍生资产。",
              "衍生资产是原始角色、场景或道具在特定服装、状态、时段、损坏程度或剧情阶段下的视觉变体。",
              "每条建议必须引用输入中的父级原始资产 ID，并在 storyboardIds 中列出实际使用该变体的当前批次分镜 ID。",
              "不要把普通镜头、动作、情绪或摄影术语当作资产。名称应简洁且能区分父资产，描述应包含足够的可视化差异。不要重复已有衍生资产。",
              "完成后必须调用 resultTool。没有必要新增时也必须调用，并返回 suggestions: []。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                project: { id: project.id, name: project.name, intro: project.intro, artStyle: project.artStyle },
                script: { id: script!.id, name: script!.name, content: script!.content },
                storyboardIds: requestedStoryboardIds,
                originalAssets,
                existingDerivedAssets,
                storyboards: storyboardContext,
              },
              null,
              2,
            ),
          },
        ],
        tools: { resultTool },
      });

      if (!toolCalled || !structuredResult) structuredResult = parseJsonResult(aiResponse.text ?? "");
      const suggestions = (structuredResult as DerivedAssetResult).suggestions;
      const originalAssetMap = new Map(originalAssets.map((item) => [item.id!, item]));
      const invalidParentIds = uniqueNumbers(suggestions.map((item) => item.parentAssetId).filter((id) => !originalAssetMap.has(id)));
      if (invalidParentIds.length) throw new Error(`AI 返回了不属于该剧本原始资产的父级 ID：${invalidParentIds.join(", ")}`);

      const invalidSuggestedStoryboardIds = uniqueNumbers(
        suggestions.flatMap((item) => item.storyboardIds).filter((id) => !requestedStoryboardIdSet.has(id)),
      );
      if (invalidSuggestedStoryboardIds.length) {
        throw new Error(`AI 返回了不属于当前分镜批次的 storyboardIds：${invalidSuggestedStoryboardIds.join(", ")}`);
      }

      const uniqueSuggestions = [
        ...new Map(
          suggestions.map((item) => {
            const normalized = {
              ...item,
              name: item.name.trim(),
              describe: item.describe.trim(),
              storyboardIds: uniqueNumbers(item.storyboardIds),
            };
            return [`${normalized.parentAssetId}\u0000${normalized.name}`, normalized] as const;
          }),
        ).values(),
      ];

      const saved = await u.db.transaction(async (trx) => {
        const existingRows = await trx("o_assets")
          .where("projectId", projectId)
          .whereIn("assetsId", originalAssetIds)
          .select("id", "assetsId", "name", "describe");
        const existingMap = new Map(existingRows.map((item) => [`${item.assetsId}\u0000${item.name ?? ""}`, item]));
        const result: { id: number; parentAssetId: number; name: string; storyboardIds: number[]; created: boolean; updated: boolean }[] = [];

        for (const item of uniqueSuggestions) {
          const key = `${item.parentAssetId}\u0000${item.name}`;
          const existing = existingMap.get(key);
          let assetId = existing?.id;
          let created = false;
          let updated = false;
          if (!assetId) {
            const parent = originalAssetMap.get(item.parentAssetId)!;
            const [insertedId] = await trx("o_assets").insert({
              assetsId: item.parentAssetId,
              projectId,
              name: item.name,
              type: parent.type,
              describe: item.describe,
              startTime: Date.now(),
            });
            assetId = insertedId;
            existingMap.set(key, { id: assetId, assetsId: item.parentAssetId, name: item.name, describe: item.describe });
            created = true;
          } else if ((existing.describe ?? "") !== item.describe) {
            await trx("o_assets").where({ id: assetId, projectId }).update({
              describe: item.describe,
              prompt: null,
              promptState: null,
              promptErrorReason: null,
            });
            updated = true;
          }

          if (!(await trx("o_scriptAssets").where({ scriptId, assetId }).first())) {
            await trx("o_scriptAssets").insert({ scriptId, assetId });
          }
          for (const storyboardId of item.storyboardIds) {
            if (!(await trx("o_assets2Storyboard").where({ storyboardId, assetId }).first())) {
              await trx("o_assets2Storyboard").insert({ storyboardId, assetId });
            }
          }
          result.push({ id: assetId, parentAssetId: item.parentAssetId, name: item.name, storyboardIds: item.storyboardIds, created, updated });
        }
        return result;
      });

      const runState = saved.length ? "success" : "empty";
      await finishWorkflowStepRun(stepRunId, runState, saved.length);
      return res.status(200).send(
        success({
          projectId,
          scriptId,
          storyboardIds: requestedStoryboardIds,
          runId: stepRunId,
          runState,
          suggested: uniqueSuggestions.length,
          created: saved.filter((item) => item.created).length,
          updated: saved.filter((item) => item.updated).length,
          skipped: saved.filter((item) => !item.created && !item.updated).length,
          linked: saved.length,
          assets: saved,
        }),
      );
    } catch (e) {
      const message = u.error(e).message;
      if (stepRunId) {
        try {
          await finishWorkflowStepRun(stepRunId, "failed", 0, message);
        } catch (updateError) {
          console.error("衍生资产步骤失败状态写入失败", updateError);
        }
      }
      return res.status(400).send(error(`生成衍生资产失败：${message}`));
    }
  },
);
