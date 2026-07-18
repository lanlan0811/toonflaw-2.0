import { createProductFactoryRoute, idList, requiredId } from "@/lib/productFactory/http";
import { previewProductWorkflowTemplate } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => previewProductWorkflowTemplate(
  requiredId(req.body.projectId, "项目 ID"),
  idList(req.body.productIds, "商品 ID"),
  req.body.preserveCustom !== false,
));
