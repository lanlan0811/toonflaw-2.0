import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { submitProductFactoryReview } from "@/lib/productFactory/review";

export default createProductFactoryRoute(async (req) => submitProductFactoryReview(
  requiredId(req.body.projectId, "项目 ID"),
  requiredId(req.body.productId, "商品 ID"),
  Array.isArray(req.body.selections) ? req.body.selections : [],
  req.body.reviewMappings,
  req.body.reviewBindings,
));
