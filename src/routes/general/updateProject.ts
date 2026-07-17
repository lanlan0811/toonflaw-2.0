import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeProjectType } from "@/constants/project";
const router = express.Router();

// 修改项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    intro: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
    artStyle: z.string().optional().nullable(),
    videoRatio: z.string().optional().nullable(),
    projectType: z.string().optional().nullable(),
  }),
  async (req, res) => {
    const { id, intro, type, artStyle, videoRatio, projectType } = req.body;
    const updateData: Record<string, string | number | null | undefined> = {
      intro,
      type,
      artStyle,
      videoRatio,
    };
    if (projectType != null) {
      const normalizedProjectType = normalizeProjectType(projectType);
      if (!normalizedProjectType) return res.status(400).send(error("项目类型仅支持：基于小说原文、基于剧本、基于分镜表"));
      updateData.projectType = normalizedProjectType;
    }

    await u.db("o_project").where("id", id).update(updateData);

    res.status(200).send(success({ message: "修改成功" }));
  },
);
