import { createProductFactoryRoute, idList, requiredId } from "@/lib/productFactory/http";
import { applyProductWorkflowTemplate } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => applyProductWorkflowTemplate(
  requiredId(req.body.projectId, "项目 ID"),
  idList(req.body.productIds, "商品 ID"),
  req.body.preserveCustom !== false,
  req.body.force === true,
  req.body.confirmed === true,
));
