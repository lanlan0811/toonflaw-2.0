import test from "node:test";
import assert from "node:assert/strict";
import knexFactory from "knex";
import ensureProductFactorySchema from "../../src/lib/productFactory/schema";

test("商品工厂表可幂等创建且启动恢复不会自动重跑任务", async () => {
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await ensureProductFactorySchema(knex);
    await ensureProductFactorySchema(knex);
    for (const table of ["o_productFactoryConfig", "o_productFactoryItem", "o_productFactoryReference", "o_productFactoryWorkflow", "o_productFactoryArtifact", "o_productFactoryJob"]) {
      assert.equal(await knex.schema.hasTable(table), true);
    }
    assert.equal(await knex.schema.hasColumn("o_productFactoryArtifact", "inputChanged"), true);
    assert.equal(await knex.schema.hasColumn("o_productFactoryWorkflow", "revision"), true);
    assert.equal(await knex.schema.hasColumn("o_productFactoryWorkflow", "v1Backup"), true);
    assert.equal(await knex.schema.hasColumn("o_productFactoryArtifact", "workflowNodeId"), true);
    assert.equal(await knex.schema.hasColumn("o_productFactoryJob", "dependsOnJobIds"), true);
    const base = {
      projectId: 1,
      productId: 1,
      phase: "image",
      slotKey: "main_clean",
      aspectRatio: "9:16",
      attempt: 0,
      model: "vendor:model",
      prompt: "prompt",
      createTime: Date.now(),
      updateTime: Date.now(),
    };
    await knex("o_productFactoryJob").insert([{ ...base, state: "running" }, { ...base, state: "queued" }]);
    await ensureProductFactorySchema(knex);
    const rows = await knex("o_productFactoryJob").orderBy("id", "asc");
    assert.equal(rows[0].state, "interrupted");
    assert.match(rows[0].errorReason, /软件退出/);
    assert.equal(rows[1].state, "paused");
  } finally {
    await knex.destroy();
  }
});
