import assert from "node:assert/strict";
import test, { after } from "node:test";
import knexFactory from "knex";
import u from "../../src/utils";
import {
  assertNoUnpublishedDraftReference,
  normalizeCanvasGraph,
  persistCanvasAssetSelections,
} from "../../src/lib/storyboardCanvas";

after(async () => {
  await u.db.ready;
  await u.db.destroy();
});

async function createCanvasDatabase() {
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await knex.schema.createTable("o_assets", (table) => {
    table.integer("id").primary();
    table.integer("projectId").notNullable();
    table.integer("revision").notNullable().defaultTo(1);
  });
  await knex.schema.createTable("o_scriptAssets", (table) => {
    table.integer("scriptId").notNullable();
    table.integer("assetId").notNullable();
    table.primary(["scriptId", "assetId"]);
  });
  await knex.schema.createTable("o_assets2Storyboard", (table) => {
    table.integer("storyboardId").notNullable();
    table.integer("assetId").notNullable();
    table.integer("assetRevision").notNullable().defaultTo(1);
    table.integer("referenceEnabled").notNullable().defaultTo(1);
    table.primary(["storyboardId", "assetId"]);
  });
  await knex.schema.createTable("o_storyboardAssetExclusion", (table) => {
    table.integer("storyboardId").notNullable();
    table.integer("assetId").notNullable();
    table.integer("createTime").notNullable();
    table.primary(["storyboardId", "assetId"]);
  });
  await knex.schema.createTable("o_storyboardAssetOverride", (table) => {
    table.integer("storyboardId").notNullable();
    table.integer("assetId").notNullable();
    table.text("filePath").notNullable();
    table.text("describe");
    table.text("prompt");
    table.text("sourceNodeId");
    table.integer("baseAssetRevision");
    table.integer("updateTime").notNullable();
    table.primary(["storyboardId", "assetId"]);
  });
  await knex("o_assets").insert([
    { id: 1, projectId: 10, revision: 3 },
    { id: 2, projectId: 10, revision: 4 },
    { id: 3, projectId: 11, revision: 5 },
  ]);
  await knex("o_scriptAssets").insert([
    { scriptId: 20, assetId: 1 },
    { scriptId: 21, assetId: 2 },
    { scriptId: 20, assetId: 3 },
  ]);
  return knex;
}

test("canvas save adds a current-batch asset idempotently and clears its exclusion", async (t) => {
  const knex = await createCanvasDatabase();
  t.after(async () => knex.destroy());
  await knex("o_storyboardAssetExclusion").insert({ storyboardId: 30, assetId: 1, createTime: Date.now() });
  const selection = { assetId: 1, referenceEnabled: true, mode: "global" as const };

  const first = await persistCanvasAssetSelections(knex, {
    projectId: 10,
    scriptId: 20,
    storyboardId: 30,
    selections: [selection],
  });
  const second = await persistCanvasAssetSelections(knex, {
    projectId: 10,
    scriptId: 20,
    storyboardId: 30,
    selections: [selection],
  });

  assert.deepEqual(first.addedAssetIds, [1]);
  assert.deepEqual(second.addedAssetIds, []);
  assert.deepEqual(await knex("o_assets2Storyboard").select("storyboardId", "assetId", "assetRevision", "referenceEnabled"), [
    { storyboardId: 30, assetId: 1, assetRevision: 3, referenceEnabled: 1 },
  ]);
  assert.equal(await knex("o_storyboardAssetExclusion").where({ storyboardId: 30, assetId: 1 }).first(), undefined);
});

test("canvas save rejects assets outside the current project or storyboard batch", async (t) => {
  const knex = await createCanvasDatabase();
  t.after(async () => knex.destroy());

  await assert.rejects(
    () => persistCanvasAssetSelections(knex, {
      projectId: 10,
      scriptId: 20,
      storyboardId: 30,
      selections: [{ assetId: 2, referenceEnabled: true, mode: "global" }],
    }),
    /当前项目和分镜表批次/,
  );
  await assert.rejects(
    () => persistCanvasAssetSelections(knex, {
      projectId: 10,
      scriptId: 20,
      storyboardId: 30,
      selections: [{ assetId: 3, referenceEnabled: true, mode: "global" }],
    }),
    /当前项目和分镜表批次/,
  );
  assert.equal(await knex("o_assets2Storyboard").count("* as total").first().then((row) => Number(row?.total ?? 0)), 0);
});

test("canvas-only assets can reference the final node without creating formal asset records", async (t) => {
  const knex = await createCanvasDatabase();
  t.after(async () => knex.destroy());
  const nodes = [
    {
      id: "canvas-asset-1",
      type: "upload",
      data: {
        assetId: null,
        assetScope: "canvas",
        assetKind: "local",
        localAssetKey: "canvas-asset-1",
        assetType: "role",
        assetName: "临时角色",
        image: "/10/editImage/local.png",
        draftAsset: false,
      },
    },
    { id: "final-1", type: "generated", data: { isFinal: true, generatedImage: "/10/storyboard/final.png" } },
  ];
  const edges = [{ id: "edge-1", source: "canvas-asset-1", target: "final-1", order: 0 }];

  assert.doesNotThrow(() => assertNoUnpublishedDraftReference(nodes, edges));
  const graph = normalizeCanvasGraph(nodes, edges);
  assert.equal(graph.nodes[0].data.assetScope, "canvas");
  const reloaded = JSON.parse(JSON.stringify({ nodes: graph.nodes, edges: graph.edges }));
  assert.equal(reloaded.nodes[0].data.localAssetKey, "canvas-asset-1");
  assert.deepEqual(reloaded.edges, edges);
  assert.doesNotThrow(() => assertNoUnpublishedDraftReference(reloaded.nodes, reloaded.edges));
  await persistCanvasAssetSelections(knex, { projectId: 10, scriptId: 20, storyboardId: 30, selections: [] });
  assert.equal(await knex("o_assets").count("* as total").first().then((row) => Number(row?.total ?? 0)), 3);
  assert.equal(await knex("o_assets2Storyboard").count("* as total").first().then((row) => Number(row?.total ?? 0)), 0);
});

test("legacy unpublished drafts remain blocked unless normalized as canvas scope", () => {
  const final = { id: "final", type: "generated", data: { isFinal: true } };
  const edge = [{ id: "edge", source: "draft", target: "final", order: 0 }];
  const legacyDraft = { id: "draft", type: "upload", data: { assetId: null, draftAsset: true } };
  const canvasDraft = { id: "draft", type: "upload", data: { assetId: null, draftAsset: true, assetScope: "canvas" } };

  assert.throws(() => assertNoUnpublishedDraftReference([legacyDraft, final], edge), /未发布/);
  assert.doesNotThrow(() => assertNoUnpublishedDraftReference([canvasDraft, final], edge));
});
