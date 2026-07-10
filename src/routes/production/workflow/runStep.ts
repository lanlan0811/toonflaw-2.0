import express from "express";
import axios from "axios";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { workflowStepSchema } from "@/constants/workflow";

const router = express.Router();

type PreparedStep = {
  step: string;
  targetApi: string;
  requestBody: Record<string, unknown>;
  total: number;
};

function getBaseUrl(req: express.Request) {
  return `${req.protocol}://${req.get("host")}`;
}

function getAuthHeaders(req: express.Request) {
  return req.headers.authorization ? { authorization: req.headers.authorization } : undefined;
}

function getInternalUrl(baseUrl: string, path: string, req: express.Request) {
  const url = new URL(path, baseUrl);
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
    step: workflowStepSchema,
    concurrentCount: z.number().int().min(1).optional(),
    groupSize: z.number().int().min(1).optional(),
    otherTextPrompt: z.string().optional(),
    compulsory: z.boolean().optional(),
    itemIds: z.array(z.number().int()).optional(),
    retryFailedOnly: z.boolean().optional(),
    audio: z.boolean().optional(),
  }),
  async (req, res) => {
    let prepared: PreparedStep | null = null;
    try {
      const baseUrl = getBaseUrl(req);
      const headers = getAuthHeaders(req);
      const prepareUrl = getInternalUrl(baseUrl, "/api/production/workflow/prepareStepRequest", req);
      const prepareRes = await axios.post(prepareUrl, req.body, { headers });
      prepared = (prepareRes.data?.data as PreparedStep | undefined) ?? null;
      if (!prepared) return res.status(400).send(error("流程步骤请求体准备失败", { prepared: null }));
      if (!prepared.total) {
        return res.status(200).send(
          success({
            status: "skipped",
            reason: "没有可执行对象",
            prepared,
          }),
        );
      }

      const targetUrl = getInternalUrl(baseUrl, prepared.targetApi, req);
      const runRes = await axios.post(targetUrl, prepared.requestBody, { headers });
      return res.status(200).send(
        success({
          status: "started",
          prepared,
          result: runRes.data,
        }),
      );
    } catch (e) {
      const responseData = axios.isAxiosError(e) ? e.response?.data : undefined;
      const responsePrepared = responseData?.data?.prepared ?? null;
      const message = responseData?.message ?? u.error(e).message;
      return res.status(400).send(error(message, { prepared: prepared ?? responsePrepared }));
    }
  },
);
