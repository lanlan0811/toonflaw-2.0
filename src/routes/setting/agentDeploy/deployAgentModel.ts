import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    items: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        model: z.string(),
        modelName: z.string(),
        vendorId: z.string().nullable(),
        desc: z.string(),
        temperature: z.number().optional(),
        maxOutputTokens: z.number().optional(),
      }),
    ),
  }),
  async (req, res) => {
    const { items } = req.body;
    for (const item of items) {
      const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = item;
      await u.db("o_agentDeploy").where({ id }).update({ id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens });
    }
    res.status(200).send(success("批量配置成功"));
  },
);
