import test, { after } from "node:test";
import assert from "node:assert/strict";
import { closeApplicationDbForTest, createProductFactoryHarness, waitForTerminalJobs } from "./harness";
import { ensureProductWorkflow, previewProductWorkflowTemplate, updateProductWorkflow, upsertProductFactoryItem } from "../../src/lib/productFactory/service";
import { enqueueProductFactoryJobs } from "../../src/lib/productFactory/queue";

after(closeApplicationDbForTest);

function artifactRow(projectId: number, productId: number, workflowNodeId: string, mediaType: "image" | "video", slotKey: string, aspectRatio: string) {
  const timestamp = Date.now();
  return {
    projectId, productId, workflowNodeId, mediaType, slotKey, aspectRatio, version: 1, prompt: "test", model: "fake:model",
    inputSignature: `sig:${workflowNodeId}`, inputArtifactIds: "[]", state: "success", approved: 0, isCurrent: 1,
    inputChanged: 0, detached: 0, createTime: timestamp, updateTime: timestamp,
  };
}

test("revision 冲突被拒绝，布局不失效而语义变化只失效节点及下游", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 701;
    await harness.addProject(projectId);
    const item = await upsertProductFactoryItem(projectId, { sku: "REV-1", name: "修订测试" });
    const productId = Number(item.id);
    const workflow = await ensureProductWorkflow(projectId, productId);
    const imageNode = workflow.graph.nodes.find((node) => node.type === "image")!;
    const videoNode = workflow.graph.nodes.find((node) => node.type === "video")!;
    await harness.knex("o_productFactoryArtifact").insert([
      artifactRow(projectId, productId, imageNode.id, "image", String(imageNode.data.slotKey), String(imageNode.data.aspectRatio)),
      artifactRow(projectId, productId, videoNode.id, "video", String(videoNode.data.slotKey), String(videoNode.data.aspectRatio)),
    ]);
    const layout = structuredClone(workflow.graph);
    layout.nodes.find((node) => node.id === imageNode.id)!.position.x += 40;
    const afterLayout = await updateProductWorkflow(projectId, productId, layout, true, true, workflow.revision);
    assert.equal((await harness.knex("o_productFactoryArtifact").where("workflowNodeId", imageNode.id).first()).inputChanged, 0);
    const semantic = structuredClone(afterLayout.graph);
    semantic.nodes.find((node) => node.id === imageNode.id)!.data.promptOverride = { creative: "新创意" };
    const afterSemantic = await updateProductWorkflow(projectId, productId, semantic, true, true, afterLayout.revision);
    assert.equal((await harness.knex("o_productFactoryArtifact").where("workflowNodeId", imageNode.id).first()).inputChanged, 1);
    assert.equal((await harness.knex("o_productFactoryArtifact").where("workflowNodeId", videoNode.id).first()).inputChanged, 1);
    await assert.rejects(() => updateProductWorkflow(projectId, productId, afterSemantic.graph, true, true, workflow.revision), /当前修订/);
  } finally { await harness.cleanup(); }
});

test("模板预览默认保留 SKU 自定义节点并返回受影响产物摘要", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 702;
    await harness.addProject(projectId);
    const item = await upsertProductFactoryItem(projectId, { sku: "TPL-1", name: "模板测试" });
    const productId = Number(item.id);
    const workflow = await ensureProductWorkflow(projectId, productId);
    const graph = structuredClone(workflow.graph);
    graph.nodes.push({ id: "note:sku-custom", type: "note", position: { x: 500, y: 900 }, data: { label: "SKU 自定义便签", outputKey: "note-custom", roleKey: "note", runtime: {}, inputs: [], outputs: [] } });
    await updateProductWorkflow(projectId, productId, graph, true, true, workflow.revision);
    const preview = await previewProductWorkflowTemplate(projectId, [productId], true);
    assert.equal(preview.items[0].removedNodeIds.includes("note:sku-custom"), false);
    assert.equal(preview.summary.skuCount, 1);
  } finally { await harness.cleanup(); }
});

test("运行派生图片节点会自动补齐上游并按依赖顺序提交真实图片输入", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 703;
    await harness.addProject(projectId);
    const item = await upsertProductFactoryItem(projectId, { sku: "CHAIN-1", name: "派生链测试" });
    const productId = Number(item.id);
    await harness.addPrimaryReference(projectId, productId);
    const workflow = await ensureProductWorkflow(projectId, productId);
    const graph = structuredClone(workflow.graph);
    const parent = graph.nodes.find((node) => node.type === "image")!;
    const review = graph.nodes.find((node) => node.type === "review")!;
    const derived = structuredClone(parent);
    derived.id = "image:derived:9:16";
    derived.position = { x: parent.position.x + 330, y: parent.position.y + 30 };
    derived.data = { ...derived.data, label: "派生特写", outputKey: "derived:9:16", roleKey: "scene_detail", promptOverride: { creative: "基于上游图片派生特写" } };
    graph.nodes.push(derived);
    graph.edges.push(
      { id: "edge:parent-derived", source: parent.id, target: derived.id, sourcePort: "image", targetPort: "reference" },
      { id: "edge:derived-review", source: derived.id, target: review.id, sourcePort: "image", targetPort: "candidate" },
    );
    await updateProductWorkflow(projectId, productId, graph, true, true, workflow.revision);
    const batch = await enqueueProductFactoryJobs({ projectId, productIds: [productId], phase: "image", scope: { type: "node", productId, nodeId: derived.id } });
    assert.equal(batch.jobIds.length, 2);
    await waitForTerminalJobs(harness.knex, 2);
    const jobs = await harness.knex("o_productFactoryJob").orderBy("id", "asc");
    assert.equal(jobs.every((job) => job.state === "success"), true);
    assert.deepEqual(JSON.parse(jobs[1].dependsOnJobIds), [jobs[0].id]);
    const calls = harness.calls.filter((call) => call.type === "image");
    assert.equal(calls.length, 2);
    assert.equal(Array.isArray(calls[1].input.referenceList) && calls[1].input.referenceList.length >= 2, true);
  } finally { await harness.cleanup(); }
});
