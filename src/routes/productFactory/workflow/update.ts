import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { updateProductWorkflow } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => {
  if (Number(req.body.graph?.version || 1) >= 2 && !Number.isInteger(Number(req.body.baseRevision))) throw new Error("Graph v2 更新必须提供 baseRevision");
  return updateProductWorkflow(
    requiredId(req.body.projectId, "项目 ID"),
    requiredId(req.body.productId, "商品 ID"),
    req.body.graph,
    true,
    true,
    req.body.baseRevision === undefined ? undefined : Number(req.body.baseRevision),
  );
});
