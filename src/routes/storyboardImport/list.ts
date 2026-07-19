import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { serializeStoryboardImportListRow, type StoryboardImportListRow } from "@/lib/storyboardImportList";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
    keyword: z.string().optional().nullable(),
    page: z.number().optional(),
    pageSize: z.number().optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, keyword, page = 1, pageSize = 50 } = req.body as { projectId: number; scriptId?: number | null; keyword?: string | null; page?: number; pageSize?: number };
    const offset = (page - 1) * pageSize;

    if (scriptId) {
      const script = await u.db("o_script").where({ id: scriptId, projectId }).first();
      if (!script) return res.status(400).send(error("分镜表批次不存在或不属于当前项目"));
    }

    const query = u
      .db("o_storyboard")
      .where({ projectId })
      .modify((qb) => {
        if (scriptId) qb.where("scriptId", scriptId);
        const text = keyword?.trim();
        if (!text) return;
        qb.andWhere((builder) => {
          builder.where("prompt", "like", `%${text}%`).orWhere("videoDesc", "like", `%${text}%`).orWhere("track", "like", `%${text}%`);
        });
      });

    const rows = await query.clone().orderBy("index", "asc").orderBy("id", "asc").offset(offset).limit(pageSize);
    const totalQuery = (await query.clone().count("* as total").first()) as { total?: number } | undefined;
    const storyboardIds = rows.map((item: { id?: number }) => item.id!).filter(Boolean);

    const relations = storyboardIds.length ? await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).select("storyboardId", "assetId") : [];
    const assetIds = [...new Set(relations.map((item: { assetId?: number }) => item.assetId).filter(Boolean))];
    const assets = assetIds.length ? await u.db("o_assets").whereIn("id", assetIds).select("id", "name", "type", "describe", "imageId", "prompt", "promptState", "promptErrorReason") : [];
    const assetMap = new Map(assets.map((item) => [item.id, item]));
    const relationMap = relations.reduce<Record<number, any[]>>((result, item) => {
      if (!item.storyboardId) return result;
      if (!result[item.storyboardId]) result[item.storyboardId] = [];
      const asset = assetMap.get(item.assetId);
      if (asset) result[item.storyboardId].push(asset);
      return result;
    }, {});

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
    const projectAssets = await assetQuery.distinct(
      "o_assets.id",
      "o_assets.name",
      "o_assets.type",
      "o_assets.assetsId",
      "o_assets.describe",
      "o_assets.imageId",
      "o_assets.prompt",
      "o_assets.promptState",
      "o_assets.promptErrorReason",
      "o_image.state as imageState",
      "o_image.errorReason as imageErrorReason",
      "o_image.filePath",
    );
    const assetsWithSrc = await Promise.all(
      projectAssets.map(async (item) => ({
        ...item,
        src: item.filePath ? await u.oss.getSmallImageUrl(item.filePath) : "",
        originalSrc: item.filePath ? await u.oss.getFileUrl(item.filePath) : "",
      })),
    );
    const scripts = await u
      .db("o_script")
      .leftJoin("o_storyboard", function () {
        this.on("o_storyboard.scriptId", "=", "o_script.id").andOn("o_storyboard.projectId", "=", "o_script.projectId");
      })
      .where("o_script.projectId", projectId)
      .groupBy("o_script.id", "o_script.name", "o_script.createTime")
      .orderBy("o_script.createTime", "desc")
      .select("o_script.id", "o_script.name", "o_script.createTime")
      .count("o_storyboard.id as storyboardCount");

    const data = await Promise.all(
      rows.map((item: StoryboardImportListRow) =>
        serializeStoryboardImportListRow(item, relationMap[item.id!] ?? [], (filePath) => u.oss.getSmallImageUrl(filePath)),
      ),
    );

    res.status(200).send(
      success({
        data,
        total: Number(totalQuery?.total ?? 0),
        assets: assetsWithSrc,
        scripts: scripts.map((item) => ({
          ...item,
          storyboardCount: Number(item.storyboardCount ?? 0),
        })),
      }),
    );
  },
);
