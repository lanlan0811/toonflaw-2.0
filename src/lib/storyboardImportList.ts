export type StoryboardImportListRow = {
  id?: number;
  index?: number;
  prompt?: string;
  duration?: string | number;
  state?: string;
  scriptId?: number;
  projectId?: number;
  track?: string;
  videoDesc?: string;
  shouldGenerateImage?: number;
  reason?: string;
  filePath?: string;
  flowId?: number | null;
};

export async function serializeStoryboardImportListRow(
  item: StoryboardImportListRow,
  assets: unknown[],
  getSmallImageUrl: (filePath: string) => Promise<string>,
) {
  return {
    id: item.id,
    index: item.index,
    prompt: item.prompt,
    duration: Number(item.duration ?? 0),
    state: item.state,
    scriptId: item.scriptId,
    projectId: item.projectId,
    track: item.track,
    videoDesc: item.videoDesc,
    shouldGenerateImage: item.shouldGenerateImage,
    reason: item.reason,
    flowId: item.flowId ?? null,
    src: item.filePath ? await getSmallImageUrl(item.filePath) : "",
    assets,
  };
}
