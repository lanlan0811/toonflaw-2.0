import assert from "node:assert/strict";
import test from "node:test";
import { serializeStoryboardImportListRow } from "../../src/lib/storyboardImportList";

test("storyboard list response includes a persisted flowId", async () => {
  const data = await serializeStoryboardImportListRow(
    { id: 10, projectId: 2, scriptId: 3, duration: "4", filePath: "2/storyboard/10.jpg", flowId: 88 },
    [{ id: 5, name: "主角" }],
    async (filePath) => `/oss/smallImage/${filePath}`,
  );

  assert.equal(data.flowId, 88);
  assert.equal(data.projectId, 2);
  assert.equal(data.scriptId, 3);
  assert.equal(data.duration, 4);
  assert.equal(data.src, "/oss/smallImage/2/storyboard/10.jpg");
  assert.deepEqual(data.assets, [{ id: 5, name: "主角" }]);
});

test("storyboard list response normalizes a missing flowId to null", async () => {
  const data = await serializeStoryboardImportListRow(
    { id: 11, projectId: 2, scriptId: 4, duration: 0 },
    [],
    async () => "unused",
  );

  assert.equal(data.flowId, null);
  assert.equal(data.src, "");
});
