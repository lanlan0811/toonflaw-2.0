import knexFactory, { type Knex } from "knex";
import u from "../../src/utils";
import ensureProductFactorySchema from "../../src/lib/productFactory/schema";

const applicationDb = u.db;

export interface FakeAiCall {
  type: "image" | "video" | "text";
  model: string;
  input: Record<string, unknown>;
}

export async function createProductFactoryHarness() {
  // fixDB still reaches the shared utility singleton during startup; wait before replacing it.
  await u.db.ready;
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await knex.schema.createTable("o_project", (table) => {
    table.integer("id").primary();
    table.string("projectType").notNullable();
    table.text("name");
    table.text("intro");
    table.text("type");
    table.text("artStyle");
    table.text("directorManual");
    table.text("videoRatio");
    table.text("imageModel");
    table.text("videoModel");
    table.text("imageQuality");
    table.text("mode");
    table.integer("createTime");
  });
  await knex.schema.createTable("o_agentDeploy", (table) => {
    table.increments("id");
    table.string("key").notNullable();
    table.string("modelName");
  });
  await knex.schema.createTable("o_vendorConfig", (table) => {
    table.string("id").primary();
    table.string("name");
    table.integer("enable").notNullable().defaultTo(1);
    table.text("inputValues");
  });
  await knex.schema.createTable("o_assets", (table) => {
    table.increments("id");
    table.integer("projectId");
    table.integer("imageId");
  });
  await knex.schema.createTable("o_image", (table) => {
    table.increments("id");
    table.text("filePath");
    table.integer("assetsId");
    table.text("model");
  });
  await knex.schema.createTable("o_video", (table) => {
    table.increments("id");
    table.integer("projectId");
    table.text("filePath");
    table.text("model");
  });
  await ensureProductFactorySchema(knex);
  await knex("o_vendorConfig").insert({ id: "fake", name: "Fake Vendor", enable: 1, inputValues: JSON.stringify({ apiKey: "unchanged" }) });
  await knex("o_agentDeploy").insert({ key: "universalAi", modelName: "fake:fake-text" });

  const mutableU = u as unknown as Record<string, unknown>;
  const original = {
    db: u.db,
    oss: u.oss,
    Ai: u.Ai,
    vendor: u.vendor,
    replaceUrl: u.replaceUrl,
  };
  const files = new Map<string, Buffer>();
  const calls: FakeAiCall[] = [];
  let imageFailuresRemaining = 0;
  let videoFailuresRemaining = 0;
  let polishResponse: Record<string, unknown> = {
    goal: "润色后的目标",
    creative: "润色后的创意",
    craft: "润色后的制作要求",
    facts: "恶意修改商品事实",
    identity: "恶意删除身份锁",
  };
  const models = [
    { type: "image", modelName: "fake-image", name: "Fake Image", mode: ["singleImage", "multiReference"], promptLanguage: "zh", maxReferenceImages: 4 },
    { type: "video", modelName: "fake-video", name: "Fake Video", mode: ["singleImage"], promptLanguage: "zh", durationResolutionMap: [{ duration: [5], resolution: ["720p"] }], audio: false },
    { type: "video", modelName: "fake-start-end", name: "Fake Start End", mode: ["startEndRequired"], promptLanguage: "en", durationResolutionMap: [{ duration: [5], resolution: ["720p"] }], audio: false },
    { type: "video", modelName: "fake-multi-video", name: "Fake Multi Video", mode: [["imageReference:4"]], promptLanguage: "zh", durationResolutionMap: [{ duration: [5], resolution: ["720p"] }], audio: false },
    { type: "text", modelName: "fake-text", name: "Fake Text", mode: [], promptLanguage: "zh" },
  ];

  mutableU.db = knex;
  mutableU.vendor = {
    ...u.vendor,
    getVendor: (id: string) => ({ id, name: "Fake Vendor", version: "2.0" }),
    getModelList: async (id: string) => id === "fake" ? models : [],
  };
  mutableU.oss = {
    getFileUrl: async (filePath: string) => `/oss/${filePath}`,
    getSmallImageUrl: async (filePath: string) => `/oss/${filePath}?size=20`,
    getImageBase64: async (filePath: string) => {
      const content = files.get(filePath);
      if (!content) throw new Error(`测试文件不存在：${filePath}`);
      return `data:image/png;base64,${content.toString("base64")}`;
    },
    getFile: async (filePath: string) => {
      const content = files.get(filePath);
      if (!content) throw new Error(`测试文件不存在：${filePath}`);
      return content;
    },
    writeFile: async (filePath: string, content: Buffer | string) => {
      files.set(filePath, Buffer.isBuffer(content) ? content : Buffer.from(content));
    },
    fileExists: async (filePath: string) => files.has(filePath),
    deleteFile: async (filePath: string) => { files.delete(filePath); },
    deleteDirectory: async (directory: string) => {
      for (const filePath of files.keys()) if (filePath.startsWith(directory)) files.delete(filePath);
    },
  };
  mutableU.Ai = {
    Text: (model: string) => ({
      invoke: async (input: Record<string, unknown>) => {
        calls.push({ type: "text", model, input });
        return { text: JSON.stringify(polishResponse) };
      },
    }),
    Image: (model: string) => ({
      run: async (input: Record<string, unknown>) => {
        calls.push({ type: "image", model, input });
        if (imageFailuresRemaining > 0) {
          imageFailuresRemaining -= 1;
          throw new Error("伪造图片 Vendor 失败");
        }
        return { save: async (filePath: string) => { files.set(filePath, Buffer.from(`image:${calls.length}`)); } };
      },
    }),
    Video: (model: string) => ({
      run: async (input: Record<string, unknown>) => {
        calls.push({ type: "video", model, input });
        if (videoFailuresRemaining > 0) {
          videoFailuresRemaining -= 1;
          throw new Error("伪造视频 Vendor 失败");
        }
        return { save: async (filePath: string) => { files.set(filePath, Buffer.from(`video:${calls.length}`)); } };
      },
    }),
  };
  mutableU.replaceUrl = (value: string) => value;

  async function addProject(id: number, overrides: Record<string, unknown> = {}) {
    await knex("o_project").insert({
      id,
      projectType: "commerce",
      name: `商品项目 ${id}`,
      intro: "__TOONFLOW_PRODUCT_FACTORY_V1__\n测试活动",
      type: "商品",
      artStyle: "",
      directorManual: "",
      videoRatio: "16:9",
      imageModel: "fake:fake-image",
      videoModel: "fake:fake-video",
      imageQuality: "2K",
      mode: "singleImage",
      createTime: Date.now(),
      ...overrides,
    });
  }

  async function addPrimaryReference(projectId: number, productId: number, suffix = "main") {
    const filePath = `test/${projectId}/${productId}/${suffix}.png`;
    files.set(filePath, Buffer.from(`reference:${projectId}:${productId}:${suffix}`));
    const [id] = await knex("o_productFactoryReference").insert({
      projectId,
      productId,
      scope: "product",
      filePath,
      fileName: `${suffix}.png`,
      mimeType: "image/png",
      sha256: `sha-${projectId}-${productId}-${suffix}`,
      role: "front",
      isPrimary: 1,
      sortIndex: 0,
      width: 1024,
      height: 1024,
      createTime: Date.now(),
    });
    return Number(id);
  }

  return {
    knex,
    files,
    calls,
    addProject,
    addPrimaryReference,
    setImageFailures: (count: number) => { imageFailuresRemaining = count; },
    setVideoFailures: (count: number) => { videoFailuresRemaining = count; },
    setPolishResponse: (value: Record<string, unknown>) => { polishResponse = value; },
    cleanup: async () => {
      try {
        const { waitForProductFactoryQueueIdle } = await import("../../src/lib/productFactory/queue");
        await waitForProductFactoryQueueIdle(1_000);
      } catch {
        // A failed assertion may leave paused work; restoring the singleton still takes priority.
      }
      mutableU.db = original.db;
      mutableU.oss = original.oss;
      mutableU.Ai = original.Ai;
      mutableU.vendor = original.vendor;
      mutableU.replaceUrl = original.replaceUrl;
      await knex.destroy();
    },
  };
}

export async function insertInChunks(knex: Knex, table: string, rows: Record<string, unknown>[], chunkSize = 50) {
  for (let index = 0; index < rows.length; index += chunkSize) await knex(table).insert(rows.slice(index, index + chunkSize));
}

export async function waitForTerminalJobs(knex: Knex, expected: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await knex("o_productFactoryJob").select("state");
    if (rows.length >= expected && rows.every((row) => ["success", "failed", "cancelled"].includes(row.state))) return rows;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待 ${expected} 个任务结束超时`);
}

export async function closeApplicationDbForTest() {
  let initializationError: unknown;
  try {
    await applicationDb.ready;
  } catch (error) {
    initializationError = error;
  } finally {
    await applicationDb.destroy();
  }
  if (initializationError) throw initializationError;
}
