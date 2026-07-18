import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { beginProductFactoryProjectDeletion, finishProductFactoryProjectDeletion } from "@/lib/productFactory/queue";
import { deleteProductFactoryProject } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => {
  const projectId = requiredId(req.body.projectId, "项目 ID");
  beginProductFactoryProjectDeletion(projectId);
  try {
    return await deleteProductFactoryProject(projectId, String(req.body.confirmationName || ""));
  } finally {
    finishProductFactoryProjectDeletion(projectId);
  }
});
