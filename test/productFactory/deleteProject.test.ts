import test, { after } from "node:test";
import assert from "node:assert/strict";
import { deleteProductFactoryProject, ensureProductFactoryConfig, upsertProductFactoryItem } from "../../src/lib/productFactory/service";
import { closeApplicationDbForTest, createProductFactoryHarness } from "./harness";

after(closeApplicationDbForTest);

test("删除视觉工厂项目需要名称确认并级联清理数据库与文件", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 730;
    const projectName = "待删除视觉工厂";
    await harness.addProject(projectId, { name: projectName });
    await ensureProductFactoryConfig(projectId);
    const product = await upsertProductFactoryItem(projectId, { sku: "DELETE-001", name: "删除测试商品" });
    const productId = Number(product.id);
    assert.ok(productId > 0);
    const referenceId = await harness.addPrimaryReference(projectId, productId, "delete-reference");
    const artifactPath = `product-factory/${projectId}/${productId}/image/delete.png`;
    const legacyImagePath = `${projectId}/legacy-image.png`;
    const legacyVideoPath = `${projectId}/legacy-video.mp4`;
    harness.files.set(artifactPath, Buffer.from("delete-artifact"));
    harness.files.set(legacyImagePath, Buffer.from("legacy-image"));
    harness.files.set(legacyVideoPath, Buffer.from("legacy-video"));
    const timestamp = Date.now();
    const [legacyImageId] = await harness.knex("o_image").insert({ filePath: legacyImagePath, assetsId: null, model: "fake:fake-image" });
    const [legacyAssetId] = await harness.knex("o_assets").insert({ projectId, imageId: Number(legacyImageId) });
    await harness.knex("o_image").where("id", legacyImageId).update({ assetsId: Number(legacyAssetId) });
    await harness.knex("o_video").insert({ projectId, filePath: legacyVideoPath, model: "fake:fake-video" });
    const [artifactId] = await harness.knex("o_productFactoryArtifact").insert({
      projectId,
      productId,
      jobId: null,
      workflowNodeId: "delete-image-node",
      detached: 0,
      mediaType: "image",
      slotKey: "main_clean",
      aspectRatio: "1:1",
      version: 1,
      templateId: "delete-test",
      templateVersion: 2,
      promptLanguage: "zh",
      promptSections: "{}",
      prompt: "delete test",
      model: "fake:fake-image",
      params: "{}",
      inputSignature: "delete-project-signature",
      inputArtifactIds: "[]",
      filePath: artifactPath,
      state: "success",
      errorReason: null,
      approved: 0,
      isCurrent: 1,
      inputChanged: 0,
      createTime: timestamp,
      updateTime: timestamp,
    });
    const [jobId] = await harness.knex("o_productFactoryJob").insert({
      projectId,
      productId,
      artifactId: Number(artifactId),
      workflowNodeId: "delete-image-node",
      dependsOnJobIds: "[]",
      phase: "image",
      slotKey: "main_clean",
      aspectRatio: "1:1",
      state: "paused",
      attempt: 0,
      model: "fake:fake-image",
      prompt: "delete test",
      params: "{}",
      inputReferenceIds: JSON.stringify([referenceId]),
      inputArtifactIds: "[]",
      errorReason: null,
      createTime: timestamp,
      startTime: null,
      endTime: null,
      updateTime: timestamp,
    });
    await harness.knex("o_productFactoryArtifact").where("id", artifactId).update({ jobId: Number(jobId) });

    await assert.rejects(() => deleteProductFactoryProject(projectId, "错误名称"), /请输入/);
    assert.ok(await harness.knex("o_project").where("id", projectId).first());

    const result = await deleteProductFactoryProject(projectId, projectName);
    assert.deepEqual(result.deleted, {
      projects: 1,
      products: 1,
      references: 1,
      workflows: 1,
      artifacts: 1,
      jobs: 1,
      configs: 1,
      ancillaryRecords: 0,
      legacyRecords: 3,
    });
    for (const table of ["o_project", "o_productFactoryConfig", "o_productFactoryItem", "o_productFactoryReference", "o_productFactoryWorkflow", "o_productFactoryArtifact", "o_productFactoryJob"]) {
      const column = table === "o_project" ? "id" : "projectId";
      assert.equal(Number((await harness.knex(table).where(column, projectId).count({ count: "*" }).first())?.count || 0), 0, `${table} 应清空`);
    }
    assert.equal(harness.files.has(artifactPath), false);
    assert.equal(harness.files.has(legacyImagePath), false);
    assert.equal(harness.files.has(legacyVideoPath), false);
    assert.equal([...harness.files.keys()].some((filePath) => filePath.includes("delete-reference")), false);
  } finally {
    await harness.cleanup();
  }
});
