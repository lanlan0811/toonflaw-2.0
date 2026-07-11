import u from "@/utils";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";
import type { WorkflowStep } from "@/constants/workflow";

export const workflowStepRunStates = ["running", "success", "empty", "failed"] as const;
export type WorkflowStepRunState = (typeof workflowStepRunStates)[number];

export type WorkflowStepRun = {
  id?: number;
  projectId?: number;
  scriptId?: number | null;
  step?: string;
  state?: string;
  itemCount?: number | null;
  errorReason?: string | null;
  startTime?: number | null;
  endTime?: number | null;
  updateTime?: number | null;
};

export class WorkflowStepRunningError extends Error {
  status = 409;

  constructor() {
    super("该工作流步骤正在执行，请勿重复提交");
    this.name = "WorkflowStepRunningError";
  }
}

function scopeWorkflowStepRuns(database: any, projectId: number, scriptId: number | null, step: WorkflowStep) {
  const query = database("o_workflowStepRun").where({ projectId, step });
  if (scriptId == null) query.whereNull("scriptId");
  else query.where("scriptId", scriptId);
  return query;
}

async function getLatestWorkflowStepRunFrom(database: any, projectId: number, scriptId: number | null, step: WorkflowStep) {
  return (await scopeWorkflowStepRuns(database, projectId, scriptId, step).orderBy("id", "desc").first()) as WorkflowStepRun | undefined;
}

async function reconcileWorkflowStepRuns(database: any, projectId: number, scriptId: number | null, step: WorkflowStep) {
  const latest = await getLatestWorkflowStepRunFrom(database, projectId, scriptId, step);
  if (!latest?.id) return latest;

  const now = Date.now();
  await scopeWorkflowStepRuns(database, projectId, scriptId, step)
    .where("state", "running")
    .where("id", "<", latest.id)
    .update({
      state: "failed",
      itemCount: 0,
      errorReason: "已被较新的工作流运行记录取代",
      endTime: now,
      updateTime: now,
    });
  return latest;
}

export async function validateWorkflowContext(projectId: number, scriptId?: number | null, requireScript = false) {
  const project = await u.db("o_project").where("id", projectId).first();
  if (!project) throw new Error("项目不存在");

  const isStoryboardProject = normalizeProjectType(project.projectType ?? "") === ProjectTypes.storyboard;
  if ((requireScript || isStoryboardProject) && !scriptId) {
    throw new Error(isStoryboardProject ? "基于分镜表的项目必须明确指定 scriptId" : "必须明确指定 scriptId");
  }

  const script = scriptId ? await u.db("o_script").where({ id: scriptId, projectId }).first() : undefined;
  if (scriptId && !script) throw new Error("剧本不存在或不属于当前项目");

  return { project, script, isStoryboardProject };
}

export async function getLatestWorkflowStepRun(projectId: number, scriptId: number | null, step: WorkflowStep) {
  if (!(await u.db.schema.hasTable("o_workflowStepRun"))) return undefined;
  return await getLatestWorkflowStepRunFrom(u.db, projectId, scriptId, step);
}

export async function createWorkflowStepRun(projectId: number, scriptId: number | null, step: WorkflowStep) {
  return await u.db.transaction(async (trx) => {
    const latest = await reconcileWorkflowStepRuns(trx, projectId, scriptId, step);
    if (latest?.state === "running") throw new WorkflowStepRunningError();

    const now = Date.now();
    const [id] = await trx("o_workflowStepRun").insert({
      projectId,
      scriptId,
      step,
      state: "running",
      itemCount: 0,
      errorReason: null,
      startTime: now,
      endTime: null,
      updateTime: now,
    });
    return id;
  });
}

export async function finishWorkflowStepRun(id: number, state: Exclude<WorkflowStepRunState, "running">, itemCount = 0, errorReason: string | null = null) {
  const now = Date.now();
  await u.db("o_workflowStepRun").where("id", id).update({
    state,
    itemCount,
    errorReason,
    endTime: now,
    updateTime: now,
  });
}
