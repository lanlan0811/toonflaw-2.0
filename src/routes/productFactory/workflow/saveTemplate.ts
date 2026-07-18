import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { saveProductWorkflowAsTemplate } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => saveProductWorkflowAsTemplate(
  requiredId(req.body.projectId, "项目 ID"),
  requiredId(req.body.productId, "商品 ID"),
));
