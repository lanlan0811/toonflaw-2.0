import type { Knex } from "knex";

async function createIfMissing(knex: Knex, name: string, builder: (table: Knex.CreateTableBuilder) => void) {
  if (!(await knex.schema.hasTable(name))) await knex.schema.createTable(name, builder);
}

async function addColumnIfMissing(knex: Knex, tableName: string, columnName: string, builder: (table: Knex.AlterTableBuilder) => void) {
  if (await knex.schema.hasTable(tableName) && !(await knex.schema.hasColumn(tableName, columnName))) {
    await knex.schema.alterTable(tableName, builder);
  }
}

export default async function ensureProductFactorySchema(knex: Knex) {
  await createIfMissing(knex, "o_productFactoryConfig", (table) => {
    table.integer("projectId").notNullable().primary();
    table.text("brandName");
    table.text("campaignBrief");
    table.text("visualTone");
    table.text("forbiddenContent");
    table.text("defaultPack").notNullable();
    table.text("promptPolicy").notNullable();
    table.integer("imageConcurrency").notNullable().defaultTo(2);
    table.integer("videoConcurrency").notNullable().defaultTo(1);
    table.integer("migrationVersion").notNullable().defaultTo(0);
    table.text("defaultTemplateGraph");
    table.integer("templateRevision").notNullable().defaultTo(1);
    table.integer("createTime").notNullable();
    table.integer("updateTime").notNullable();
  });

  await createIfMissing(knex, "o_productFactoryItem", (table) => {
    table.increments("id");
    table.integer("projectId").notNullable();
    table.text("sku").notNullable();
    table.text("name").notNullable();
    table.text("category");
    table.text("description");
    table.text("sellingPoints");
    table.text("attributes");
    table.string("state").notNullable().defaultTo("draft");
    table.integer("createTime").notNullable();
    table.integer("updateTime").notNullable();
    table.unique(["projectId", "sku"]);
    table.index(["projectId", "state", "id"]);
  });

  await createIfMissing(knex, "o_productFactoryReference", (table) => {
    table.increments("id");
    table.integer("projectId").notNullable();
    table.integer("productId");
    table.string("scope").notNullable().defaultTo("product");
    table.text("filePath").notNullable();
    table.text("fileName").notNullable();
    table.text("mimeType").notNullable();
    table.text("sha256").notNullable();
    table.string("role").notNullable().defaultTo("other");
    table.integer("isPrimary").notNullable().defaultTo(0);
    table.integer("sortIndex").notNullable().defaultTo(0);
    table.integer("width");
    table.integer("height");
    table.integer("createTime").notNullable();
    table.index(["projectId", "productId", "scope"]);
    table.index(["projectId", "sha256"]);
  });

  await createIfMissing(knex, "o_productFactoryWorkflow", (table) => {
    table.increments("id");
    table.integer("projectId").notNullable();
    table.integer("productId").notNullable();
    table.integer("version").notNullable().defaultTo(1);
    table.integer("customized").notNullable().defaultTo(0);
    table.integer("revision").notNullable().defaultTo(1);
    table.integer("templateRevision").notNullable().defaultTo(1);
    table.text("v1Backup");
    table.text("graphData").notNullable();
    table.integer("createTime").notNullable();
    table.integer("updateTime").notNullable();
    table.unique(["projectId", "productId"]);
  });

  await createIfMissing(knex, "o_productFactoryArtifact", (table) => {
    table.increments("id");
    table.integer("projectId").notNullable();
    table.integer("productId").notNullable();
    table.integer("jobId");
    table.string("workflowNodeId");
    table.integer("detached").notNullable().defaultTo(0);
    table.string("mediaType").notNullable();
    table.string("slotKey").notNullable();
    table.string("aspectRatio").notNullable();
    table.integer("version").notNullable().defaultTo(1);
    table.text("templateId");
    table.integer("templateVersion");
    table.string("promptLanguage");
    table.text("promptSections");
    table.text("prompt").notNullable();
    table.text("model").notNullable();
    table.text("params");
    table.text("inputSignature").notNullable();
    table.text("inputArtifactIds");
    table.text("filePath");
    table.string("state").notNullable().defaultTo("queued");
    table.text("errorReason");
    table.integer("approved").notNullable().defaultTo(0);
    table.integer("isCurrent").notNullable().defaultTo(1);
    table.integer("inputChanged").notNullable().defaultTo(0);
    table.integer("createTime").notNullable();
    table.integer("updateTime").notNullable();
    table.index(["projectId", "productId", "mediaType", "slotKey", "aspectRatio"]);
    table.index(["inputSignature", "state"]);
  });

  await createIfMissing(knex, "o_productFactoryJob", (table) => {
    table.increments("id");
    table.integer("projectId").notNullable();
    table.integer("productId").notNullable();
    table.integer("artifactId");
    table.string("workflowNodeId");
    table.text("dependsOnJobIds");
    table.string("phase").notNullable();
    table.string("slotKey").notNullable();
    table.string("aspectRatio").notNullable();
    table.string("state").notNullable().defaultTo("queued");
    table.integer("attempt").notNullable().defaultTo(0);
    table.text("model").notNullable();
    table.text("prompt").notNullable();
    table.text("params");
    table.text("inputReferenceIds");
    table.text("inputArtifactIds");
    table.text("errorReason");
    table.integer("createTime").notNullable();
    table.integer("startTime");
    table.integer("endTime");
    table.integer("updateTime").notNullable();
    table.index(["projectId", "state", "phase", "id"]);
    table.index(["productId", "phase", "slotKey", "aspectRatio"]);
  });

  await addColumnIfMissing(knex, "o_productFactoryArtifact", "inputChanged", (table) => {
    table.integer("inputChanged").notNullable().defaultTo(0);
  });
  await addColumnIfMissing(knex, "o_productFactoryConfig", "defaultTemplateGraph", (table) => table.text("defaultTemplateGraph"));
  await addColumnIfMissing(knex, "o_productFactoryConfig", "templateRevision", (table) => table.integer("templateRevision").notNullable().defaultTo(1));
  await addColumnIfMissing(knex, "o_productFactoryWorkflow", "revision", (table) => table.integer("revision").notNullable().defaultTo(1));
  await addColumnIfMissing(knex, "o_productFactoryWorkflow", "templateRevision", (table) => table.integer("templateRevision").notNullable().defaultTo(1));
  await addColumnIfMissing(knex, "o_productFactoryWorkflow", "v1Backup", (table) => table.text("v1Backup"));
  await addColumnIfMissing(knex, "o_productFactoryArtifact", "workflowNodeId", (table) => table.string("workflowNodeId"));
  await addColumnIfMissing(knex, "o_productFactoryArtifact", "detached", (table) => table.integer("detached").notNullable().defaultTo(0));
  await addColumnIfMissing(knex, "o_productFactoryJob", "workflowNodeId", (table) => table.string("workflowNodeId"));
  await addColumnIfMissing(knex, "o_productFactoryJob", "dependsOnJobIds", (table) => table.text("dependsOnJobIds"));

  const timestamp = Date.now();
  await knex("o_productFactoryJob").where("state", "running").update({
    state: "interrupted",
    errorReason: "软件退出导致任务中断，请确认后重试",
    endTime: timestamp,
    updateTime: timestamp,
  });
  await knex("o_productFactoryJob").where("state", "queued").update({ state: "paused", updateTime: timestamp });
}
