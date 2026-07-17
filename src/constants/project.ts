export const ProjectTypes = {
  novel: "novel",
  script: "script",
  storyboard: "storyboard",
} as const;

export type ProjectType = (typeof ProjectTypes)[keyof typeof ProjectTypes];

export const projectTypeLabels: Record<ProjectType, string> = {
  [ProjectTypes.novel]: "基于小说原文",
  [ProjectTypes.script]: "基于剧本",
  [ProjectTypes.storyboard]: "基于分镜表",
};

const projectTypeAliasMap: Record<string, ProjectType> = {
  novel: ProjectTypes.novel,
  小说: ProjectTypes.novel,
  小说原文: ProjectTypes.novel,
  基于小说: ProjectTypes.novel,
  基于小说原文: ProjectTypes.novel,
  script: ProjectTypes.script,
  剧本: ProjectTypes.script,
  基于剧本: ProjectTypes.script,
  storyboard: ProjectTypes.storyboard,
  分镜: ProjectTypes.storyboard,
  分镜表: ProjectTypes.storyboard,
  基于分镜: ProjectTypes.storyboard,
  基于分镜表: ProjectTypes.storyboard,
};

export function normalizeProjectType(projectType: string): ProjectType | null {
  return projectTypeAliasMap[projectType.trim()] ?? null;
}

export function isProjectType(projectType: string): boolean {
  return normalizeProjectType(projectType) !== null;
}
