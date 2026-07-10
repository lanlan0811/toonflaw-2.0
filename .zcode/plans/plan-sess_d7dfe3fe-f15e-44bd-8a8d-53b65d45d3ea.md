# “基于分镜表”AI 短剧工作流完整闭环修复方案

## 目标

将当前“接口基本存在、步骤之间仍会断链”的实现修复为可执行、可观察、可重试的闭环：

`导入分镜表 → 原始资产提示词 → 原始资产图 → 衍生资产 → 衍生资产提示词/图片 → 关联具体分镜 → 分镜图 → 视频提示词 → 视频`

本次以当前源码为准，不重复实施已经完成的旧计划项（API base、`scriptId` 保存、独立 `generateDerivedAssets` 路由等）。

## 阶段 1：统一项目和分镜表批次上下文

1. 抽取并复用 `projectId + scriptId` 校验逻辑：
   - 项目必须存在且 `projectType === "storyboard"`。
   - `scriptId` 必须属于当前项目。
   - 项目存在多个导入批次时必须明确选择，禁止模糊跨批次执行。
2. 资产范围一律通过 `o_scriptAssets` 确认，不依赖 `o_assets.scriptId` 或项目级模糊查询。
3. 后端禁止 storyboard 项目调用占位剧本的 `extractOriginalAssets`，避免覆盖导入时建立的资产关系。
4. 前端在只有一个批次时自动选中；有多个批次且未选择时，禁用所有依赖批次的步骤并显示原因。
5. 切换项目或批次时清理旧解析结果、执行状态和旧 `scriptId`，随后重新加载列表和进度。

主要文件：
- `src/routes/production/workflow/prepareStepRequest.ts`
- `src/routes/production/workflow/getProgress.ts`
- `src/routes/production/workflow/runStep.ts`
- `src/routes/storyboardImport/list.ts`
- `data/web/secondary-dev-patch.js`

## 阶段 2：确保导入后具备可生产的原始资产

1. 完善受支持的 TXT、Markdown、DOCX 字段归一化，尤其修复 TXT 中 `场景1/场景2/...`、角色参考和道具上下文解析。
2. 解析结果明确返回：
   - 识别到的角色、场景、道具数量；
   - 缺少时长、字段异常等完整 warnings；
   - “没有识别到任何原始资产”的阻断性警告。
3. 提交前在前端展示资产预览；没有原始资产时明确提示“衍生资产步骤不可执行”，不再让用户导入后才遇到模糊失败。
4. `commit` 校验外部传入的关联资产均属于当前项目，防止跨项目或无效资产 ID 写入。
5. 保持事务写入，并防止解析/提交按钮在请求中被重复点击；同一请求重复提交时避免无提示地追加重复分镜。
6. 导入图片 `src` 时同步维护可用文件路径，避免状态完成但图片不可读取。

主要文件：
- `src/routes/storyboardImport/parse.ts`
- `src/routes/storyboardImport/commit.ts`
- `data/web/secondary-dev-patch.js`

## 阶段 3：修复“生成衍生资产”步骤

1. 保留现有 `generateDerivedAssets` REST 接口，完善 AI 结构化输出：每条建议除父资产、名称和描述外，必须返回适用的当前批次分镜 ID。
2. 严格验证 AI 返回的父资产和分镜均属于当前 `projectId + scriptId`。
3. 以“父资产 + 名称”去重，防止普通重试重复创建；强制重生成时更新现有资产，而不是制造同名副本。
4. 创建/更新衍生资产后：
   - 写入 `o_scriptAssets`；
   - 根据 AI 返回的适用镜头写入 `o_assets2Storyboard`；
   - 保留父原始资产关系，并将衍生资产作为更具体的参考图加入对应镜头，确保后续分镜图能够实际读取衍生资产图片；
   - 前端允许用户编辑分镜资产关系，纠正 AI 自动关联。
5. 增加该步骤的持久化执行状态：开始、完成、部分完成、失败、错误原因、新增/更新/跳过数量。这样失败后刷新页面仍可见，并能真正支持“重试失败项”。
6. AI 返回空建议时记录明确结果，不再持续显示为无限“可执行”。

主要文件：
- `src/routes/production/workflow/generateDerivedAssets.ts`
- `src/routes/production/workflow/getProgress.ts`
- `src/lib/initDB.ts`（增加轻量工作流步骤运行记录表及索引）
- `src/lib/fixDB.ts`（启动时恢复遗留的运行中状态）
- `data/web/secondary-dev-patch.js`

## 阶段 4：打通衍生资产提示词和图片

1. 移除 `prepareStepRequest` 对“衍生资产必须已有 prompt”的硬过滤。
2. 复用现有图片接口能力：
   - 已有已确认 prompt 时直接使用；
   - prompt 为空时由图片接口自动生成并保存；
   - 文本模型和图片模型任一阶段失败，都写入图片失败状态和具体原因。
3. 前端不再因 `!asset.prompt` 静默禁用图片按钮；改为允许执行并说明“缺少提示词时将自动生成”。
4. 保留独立“衍生资产提示词”步骤，供用户预先生成、编辑和确认，但不再作为图片生成的绝对阻断条件。
5. 成功重试时清除旧 `promptErrorReason`、图片错误原因；普通执行排除已完成项，`retryFailedOnly` 只选失败项，`compulsory` 才强制重生成。
6. 统一单项生成与批量生成使用同一套可执行对象和状态判断。

主要文件：
- `src/routes/production/workflow/prepareStepRequest.ts`
- `src/routes/production/assets/batchGenerateAssetsImage.ts`
- `src/routes/assetsGenerate/batchPolishAssetsPrompt.ts`
- `data/web/secondary-dev-patch.js`

## 阶段 5：修复分镜图生成、关联和可视化

1. 分镜图总数和可执行对象只统计 `shouldGenerateImage !== 0` 的当前批次分镜。
2. 生成前读取当前分镜关联的原始及衍生资产：
   - 有可用参考图时按稳定顺序传入；
   - 关联资产存在但图片尚未完成时给出明确前置条件；
   - 完全无参考资产时按接口能力允许纯文本生成，并在页面提示。
3. 确保所有失败分支均 `await` 状态更新，写入 `生成失败 + reason`；成功后清除旧 `reason`。
4. 管理页增加：
   - 分镜图缩略图/预览；
   - 失败原因；
   - 关联原始资产和衍生资产；
   - 单条生成、重试失败、强制重生成。
5. 生成中禁止重复提交；已完成项普通执行不重复生成。

主要文件：
- `src/routes/production/storyboard/batchGenerateImage.ts`
- `src/routes/production/workflow/prepareStepRequest.ts`
- `src/routes/production/workflow/getProgress.ts`
- `src/routes/storyboardImport/list.ts`
- `data/web/secondary-dev-patch.js`
- `data/web/secondary-dev-patch.css`

## 阶段 6：修正进度、后台失败和视频后续链路

1. `getProgress` 分开统计并返回：
   - 原始资产存在性、提示词、图片；
   - 衍生资产创建、提示词、图片；
   - 分镜图；
   - 视频提示词和视频。
2. 每一步返回 `total/completed/failed/generating/runnable/blockReason`，前端据此展示和禁用按钮，不再仅以“存在任意一条衍生资产”判定整步成功。
3. `runStep` 返回准备数量和目标接口接受结果；前端将“已提交”与“生成完成”区分，并持续轮询到终态。
4. 轮询增加请求互斥和消息优先级，避免“状态已刷新”覆盖刚发生的具体错误。
5. 将视频图片读取、base64 转换及提示词组装纳入完整错误处理；启动恢复覆盖遗留的 `o_videoTrack.state = 生成中`。
6. 视频提示词加入分镜关联的原始/衍生资产上下文，并将图片质量与视频 resolution 分开映射和校验。
7. 视频进度按每条轨道当前有效结果计算，不用全部历史 `o_video` 记录累加。

主要文件：
- `src/routes/production/workflow/getProgress.ts`
- `src/routes/production/workflow/runStep.ts`
- `src/routes/production/workbench/batchGeneratePrompt.ts`
- `src/routes/production/workbench/batchGenerateVideo.ts`
- `src/lib/fixDB.ts`
- `data/web/secondary-dev-patch.js`

## 阶段 7：生产包和版本更新

1. 将应用版本从 `1.1.8` 提升到下一个补丁版本，并同步 `package.json`、锁文件和 `data/version.txt`，确保已安装用户的数据目录会更新。
2. 使用现有构建流程从 TypeScript 源码重新生成 `data/serve/app.js`，不手工修改 bundle。
3. 确认 Electron 构建入口、web 补丁和 production server 均进入最终发行包。

## 验证方案

1. 执行 `yarn lint`。
2. 执行生产构建 `yarn build`。
3. 对生成后的生产服务包做路由 smoke test：
   - `/api/storyboardImport/parse`
   - `/api/storyboardImport/commit`
   - `/api/storyboardImport/list`
   - `/api/storyboardImport/update`
   - `/api/production/workflow/getConfig`
   - `/api/production/workflow/getProgress`
   - `/api/production/workflow/generateDerivedAssets`
   - `/api/production/workflow/runStep`
4. 使用仓库中的标准 TXT、Markdown、DOCX 样例分别验证字段、warnings、资产和分镜关联。
5. 使用全新 storyboard 项目验证完整闭环及页面显示。
6. 验证异常场景：
   - 无原始资产；
   - 多批次未选择；
   - 文本模型失败；
   - 图片模型失败；
   - 缺少参考图；
   - 部分分镜不生成图片；
   - 重复点击；
   - 仅重试失败；
   - 强制重生成；
   - 应用重启后的运行中状态恢复。
7. 回归 novel/script 项目，确认项目类型、原资产提取和既有生产流程不受影响。

## 预期结果

完成后，页面会明确显示当前分镜表批次、每一步前置条件、执行数量、生成状态和失败原因；衍生资产能够创建并关联到具体分镜；无预生成 prompt 的衍生资产也能生成图片；分镜图能够实际使用原始/衍生资产并在管理页预览、失败重试，且旧版安装用户可以收到更新后的 web 和 server 文件。