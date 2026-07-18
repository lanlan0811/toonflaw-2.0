import { createProductFactoryRoute, idList, requiredId } from "@/lib/productFactory/http";
import { enqueueProductFactoryJobs } from "@/lib/productFactory/queue";

export default createProductFactoryRoute(async (req) => {
  if (req.body.confirmed !== true) throw new Error("提交任务前必须明确确认费用与任务数量");
  const scope = req.body.scope?.type === "node"
    ? { type: "node" as const, productId: requiredId(req.body.scope.productId, "商品 ID"), nodeId: String(req.body.scope.nodeId || ""), includeDownstream: req.body.scope.includeDownstream === true }
    : req.body.scope?.type === "batch"
      ? { type: "batch" as const, productIds: idList(req.body.scope.productIds, "商品 ID"), phases: Array.isArray(req.body.scope.phases) ? req.body.scope.phases.filter((phase: unknown) => phase === "image" || phase === "video") : undefined, roleKeys: Array.isArray(req.body.scope.roleKeys) ? req.body.scope.roleKeys.map(String) : undefined }
      : undefined;
  return enqueueProductFactoryJobs({
    projectId: requiredId(req.body.projectId, "项目 ID"),
    productIds: scope?.type === "batch" ? scope.productIds : scope?.type === "node" ? [scope.productId] : idList(req.body.productIds, "商品 ID"),
    phase: req.body.phase === "video" ? "video" : "image",
    regenerate: req.body.regenerate === true,
    scope,
  });
});
