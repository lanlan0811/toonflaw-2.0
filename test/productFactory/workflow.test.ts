import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultProductWorkflow, diffProductFactoryGraphs, migrateProductFactoryGraph, normalizeFactoryPack, validateProductWorkflow } from "../../src/lib/productFactory/workflow";

test("默认套餐生成 8 个图片节点、审核门和 4 个视频节点", () => {
  const graph = createDefaultProductWorkflow(42);
  assert.equal(graph.nodes.filter((node) => node.type === "source").length, 1);
  assert.equal(graph.nodes.filter((node) => node.type === "image").length, 8);
  assert.equal(graph.nodes.filter((node) => node.type === "review").length, 1);
  assert.equal(graph.nodes.filter((node) => node.type === "video").length, 4);
  assert.equal(Object.keys(graph.reviewMappings).length, 4);
  assert.equal(graph.version, 2);
  assert.equal(Object.keys(graph.reviewBindings).length, 4);
  assert.equal(graph.edges.every((edge) => edge.sourcePort && edge.targetPort), true);
  assert.equal(validateProductWorkflow(graph), true);
});

test("v1 图幂等迁移到端口化 v2 并区分布局与语义变化", () => {
  const legacy: any = createDefaultProductWorkflow(9);
  legacy.version = 1;
  delete legacy.reviewBindings;
  legacy.edges = legacy.edges.map(({ id, source, target }: any) => ({ id, source, target }));
  const first = migrateProductFactoryGraph(legacy, 9);
  const second = migrateProductFactoryGraph(first.graph, 9);
  assert.equal(first.migrated, true);
  assert.equal(second.migrated, false);
  assert.equal(second.graph.edges.every((edge) => edge.sourcePort && edge.targetPort), true);
  const layout = structuredClone(second.graph);
  layout.nodes[1].position.x += 20;
  const layoutDiff = diffProductFactoryGraphs(second.graph, layout);
  assert.equal(layoutDiff.layoutChanged, true);
  assert.deepEqual(layoutDiff.affectedNodeIds, []);
  const semantic = structuredClone(second.graph);
  semantic.nodes[1].data.modelOverride = "fake:model";
  const semanticDiff = diffProductFactoryGraphs(second.graph, semantic);
  assert.equal(semanticDiff.affectedNodeIds.includes(semantic.nodes[1].id), true);
  assert.equal(semanticDiff.affectedNodeIds.some((id) => id.startsWith("video:")), true);
});

test("套餐范围被限制并在空配置时回退默认值", () => {
  const pack = normalizeFactoryPack({ imageSlots: [], videoSlots: [], ratios: [], videoDuration: 999, imageQuality: "4K" });
  assert.equal(pack.imageSlots.length, 4);
  assert.equal(pack.videoSlots.length, 2);
  assert.equal(pack.ratios.length, 2);
  assert.equal(pack.videoDuration, 30);
  assert.equal(pack.imageQuality, "4K");
});

test("工作流拒绝循环连接", () => {
  const graph = createDefaultProductWorkflow(7);
  graph.edges.push({ id: "cycle", source: "review", target: "source" });
  assert.throws(() => validateProductWorkflow(graph), /循环/);
});
