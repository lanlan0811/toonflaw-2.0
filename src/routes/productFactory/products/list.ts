import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { listProductFactoryItems } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => listProductFactoryItems(
  requiredId(req.body.projectId, "项目 ID"),
  req.body.page,
  req.body.pageSize,
  req.body.search,
  req.body.summary === true,
  req.body.state,
));
