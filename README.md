# Toonflow 二次开发版

> [!IMPORTANT]
> **原创致敬与来源声明**
>
> 本仓库是在 **HBAI-Ltd（北京爱啊科技有限公司）** 原创的 Toonflow 项目代码基础上进行的二次开发。感谢原作者及原项目贡献者提供完整的 AI 影视生产基础能力。本仓库不是官方发行版，二次开发内容、维护节奏和使用支持均由本仓库维护者自行负责。
>
> 原作者 / 原维护组织：**HBAI-Ltd（北京爱啊科技有限公司）**
>
> 原始项目完整仓库地址：
>
> - [![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/HBAI-Ltd/Toonflow-app) <https://github.com/HBAI-Ltd/Toonflow-app>
> - [![Gitee](https://img.shields.io/badge/Gitee-C71D23?style=flat-square&logo=gitee&logoColor=white)](https://gitee.com/HBAI-Ltd/Toonflow-app) <https://gitee.com/HBAI-Ltd/Toonflow-app>
> - [![GitCode](https://img.shields.io/badge/GitCode-FC5531?style=flat-square&logo=git&logoColor=white)](https://gitcode.com/HBAI-Ltd/Toonflow-app) <https://gitcode.com/HBAI-Ltd/Toonflow-app>
> - [![AtomGit](https://img.shields.io/badge/AtomGit-DA203E?style=flat-square&logo=git&logoColor=white)](https://atomgit.com/HBAI-Ltd/Toonflow-app) <https://atomgit.com/HBAI-Ltd/Toonflow-app>
>
> 原项目关联的前端源代码仓库：
>
> - [![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/HBAI-Ltd/Toonflow-web) <https://github.com/HBAI-Ltd/Toonflow-web>
> - [![Gitee](https://img.shields.io/badge/Gitee-C71D23?style=flat-square&logo=gitee&logoColor=white)](https://gitee.com/HBAI-Ltd/Toonflow-web) <https://gitee.com/HBAI-Ltd/Toonflow-web>
>
> 当前二次开发仓库：[![Gitee](https://img.shields.io/badge/Gitee-C71D23?style=flat-square&logo=gitee&logoColor=white)](https://gitee.com/lan0811/toonflaw-2.0) <https://gitee.com/lan0811/toonflaw-2.0>

<div align="center">
  <table>
    <tr>
      <td align="center" width="50%">
        <a href="https://github.com/HBAI-Ltd">
          <img src="https://github.com/HBAI-Ltd.png?size=160" width="96" height="96" alt="HBAI-Ltd 头像" />
        </a>
        <br />
        <strong>原创作者 · HBAI-Ltd</strong>
        <br />
        <sub>Toonflow 原项目作者与维护组织</sub>
        <br /><br />
        <a href="https://github.com/HBAI-Ltd">
          <img src="https://img.shields.io/badge/GitHub-原创主页-181717?style=flat-square&amp;logo=github&amp;logoColor=white" alt="HBAI-Ltd GitHub 主页" />
        </a>
        <a href="https://gitee.com/HBAI-Ltd">
          <img src="https://img.shields.io/badge/Gitee-原创主页-C71D23?style=flat-square&amp;logo=gitee&amp;logoColor=white" alt="HBAI-Ltd Gitee 主页" />
        </a>
      </td>
      <td align="center" width="50%">
        <a href="https://gitee.com/lan0811">
          <img src="https://foruda.gitee.com/avatar/1769601315847069536/16529552_lan0811_1769601315.png" width="96" height="96" alt="Lan0811 头像" />
        </a>
        <br />
        <strong>二次开发维护者 · Lan0811</strong>
        <br />
        <sub>当前扩展版本的开发与维护</sub>
        <br /><br />
        <a href="https://gitee.com/lan0811">
          <img src="https://img.shields.io/badge/Gitee-我的主页-C71D23?style=flat-square&amp;logo=gitee&amp;logoColor=white" alt="Lan0811 Gitee 主页" />
        </a>
        <a href="https://gitee.com/lan0811/toonflaw-2.0">
          <img src="https://img.shields.io/badge/Gitee-二开仓库-2F54EB?style=flat-square&amp;logo=gitee&amp;logoColor=white" alt="Toonflow 二次开发仓库" />
        </a>
      </td>
    </tr>
  </table>
</div>

## 项目定位

这是一个面向 AI 短剧、漫剧和产品宣传片生产的本地工作台。项目保留 Toonflow 原有的小说、剧本、资产、分镜和视频生产能力，并在此基础上补充了三条独立业务线：

1. 以分镜表为起点的 AI 短剧生产闭环。
2. 以源视频为起点、按原剧情一比一复刻的短剧转绘工作流。
3. 以节点画布为核心的单条产品宣传片生成工作区。

当前版本号为 `1.1.9`。应用可作为 Electron 桌面端运行，也可以单独启动本地 HTTP 服务。业务数据、生成素材和工作流状态默认保存在本机。

## 本仓库新增内容

### 1. 基于分镜表与转绘的独立项目类型

项目类型现统一为：

| 值 | 页面含义 | 主要输入 |
| --- | --- | --- |
| `novel` | 基于小说原文 | 小说章节与事件 |
| `script` | 基于剧本 | 单集或批量剧本 |
| `storyboard` | 基于分镜表 | 结构化分镜表 |
| `redraw` | 转绘 | 一段需要转换视觉风格的源短剧视频 |

`storyboard` 项目拥有独立的分镜表管理入口，不再被当作普通剧本项目显示或跳转。`redraw` 项目只从“我的项目 → 新建项目”创建，拥有独立的转绘工作区，不与产品宣传片或其他项目入口混用。

### 2. 分镜表解析、预览与入库

二次开发接口支持解析以下输入：

- 标准 TXT 分镜格式；
- Markdown 表格；
- Word DOCX 表格；
- JSON；
- CSV / TSV；
- 直接粘贴的结构化文本。

解析阶段会标准化镜号、时长、景别、镜头运动、场景、画面描述、台词、音效、道具和备注等字段。用户确认后，系统会在事务内创建或复用：

- 内部分镜批次；
- 角色、场景、道具原始资产；
- 分镜记录及排序；
- 分镜与资产关联；
- 视频轨道。

### 3. 分镜表资产统计与关联修复

资产统计以最终分镜行实际使用的 `roleNames`、`sceneNames` 和 `toolNames` 为准，不再把未使用的参考资料混入主统计。

当前实现还包含：

- 未使用角色参考的明确警告；
- 缺少场景美术参考的明确警告；
- 同一批次内已明确道具的跨镜头补关联；
- 场景、角色、道具按类型去重；
- 解析端与提交端资产统计一致性校验；
- 防止无依据的模糊资产推断；
- 分镜关联资产的查询、编辑和重算。

### 4. 可观察、可重试的生产工作流

分镜表项目可以按以下步骤继续生产：

```text
导入分镜表
  → 原始资产提示词
  → 原始资产图片
  → 创建衍生资产
  → 衍生资产提示词
  → 衍生资产图片
  → 分镜图
  → 视频提示词
  → 视频
```

工作流会按 `projectId + scriptId` 隔离不同项目与导入批次，并为每一步提供总数、已完成数、失败数、生成中数量、可执行数量和阻塞原因。已完成项不会在普通执行中重复提交；失败项可以单独重试，必要时也可以强制重新生成。

### 5. 源短剧一比一转绘工作流

转绘用于在保持原短剧内容和时间轴不变的前提下，将人物、服装、场景、道具和画面媒介转换成目标风格，例如亚洲真人风格转欧美真人风格、动漫风格转真人风格。

这里的“一比一复刻”是指：

- 剧情事件、对白、人物动作和镜头顺序不增不减；
- 镜头起止时间与源视频保持一致；
- 最终成片继续使用源视频音轨，不翻译、不改写对白，也不重新配音；
- 只转换视觉表现，不承诺生成画面与源视频逐像素一致。

转绘工作区按以下阶段执行：

```text
上传并分析源视频
  → 制作转绘剧本
  → 生成原始资产与原始资产图
  → 生成衍生资产与衍生资产图
  → 生成分镜表、分镜面板与分镜图
  → 生成视频提示词与转绘片段
  → 逐片保真复核
  → 挂载原音轨并合成最终短剧
```

源视频分析会提取媒体信息、镜头边界、关键帧、对白、动作、人物、场景、道具、景别、视角、运镜和音效线索。用户确认逐镜分析结果后，系统才会继续创建剧本、资产和分镜。分析、资产、分镜及视频费用处均设有人工检查点。

工作流支持“执行当前步骤”“完成本阶段”“仅重试失败项”和强制重新生成。修改目标风格、镜头内容或资产图后，受影响的下游结果会标记为“已过期”，避免混用旧结果。

视频片段默认以 `85/100` 作为保真通过线。缺失关键动作、增删剧情事件或镜头顺序错误属于硬失败；未通过片段会自动携带监督意见重试两次。仍未通过时需要人工继续生成或明确接受，未处理完的片段不能进入最终合成。

完整设计、数据结构和验收标准见 [AI 短剧“转绘”项目开发计划](./.codex/plans/redraw-project.md)。

### 6. 转绘 Agent 简易与高级配置

转绘 Agent 负责视频理解、工作流决策、剧本生成、资产映射、分镜生产和保真复核；资产图、分镜图和视频本身仍分别由项目选择的图片模型和视频模型生成。

简易模式只需配置 `redrawAgent`，全部 `redrawAgent:*` 子任务都会回退到这个主配置。所选模型必须同时声明文本、图片、视频输入和工具调用能力，否则系统会阻止开始视频分析并列出缺失能力。

高级模式可以为不同职责单独选择模型：

| 配置键 | 职责 | 最低能力 |
| --- | --- | --- |
| `redrawAgent:decisionAgent` | 检查步骤前置条件并选择后端允许的工具 | 文本、工具调用 |
| `redrawAgent:supervisionAgent` | 检查分析、剧本、资产和分镜是否违背一比一规则 | 文本、图片、工具调用 |
| `redrawAgent:videoAnalysisAgent` | 分析镜头、动作、对白、场景、运镜、音效和源风格 | 视频、图片、工具调用 |
| `redrawAgent:scriptAgent` | 将镜头分析转换为不增删剧情的转绘剧本 | 文本、工具调用 |
| `redrawAgent:assetMappingAgent` | 映射源人物、场景、道具与目标风格资产 | 文本、图片、工具调用 |
| `redrawAgent:storyboardAgent` | 生成分镜表、分镜面板内容和分镜图提示词 | 文本、图片、工具调用 |
| `redrawAgent:fidelitySupervisorAgent` | 比较源片段与生成片段并给出评分和重试意见 | 视频、工具调用 |

决策层不能绕过后端状态机、模型能力检查或人工确认点。高级模式允许混用不同供应商，但系统不会自动切换供应商，也不会产生未经确认的视频费用。

### 7. 产品宣传片独立工作区

访问地址：

```text
/#/product-promo
/#/product-promo?projectId=<项目ID>
```

该工作区从主界面侧边栏直接进入，使用带内部标记的项目与普通短剧项目隔离。主要能力包括：

- 宣传片项目的新建、编辑、打开和删除；
- 上传图片、图片生成、最终视频三类节点；
- 节点拖拽、连线、缩放、平移、适配视图和自动排版；
- 自连、重复边、循环和视频节点出边校验；
- 根据上游连线自动收集图片参考；
- 按拓扑依赖一键生成并从失败节点续跑；
- 图片原始比例展示，竖图不裁切；
- 视频任务轮询、失败原因、播放、打开和下载；
- 面向商业产品图与产品视频的内置提示词模板。

宣传片画布保存在浏览器本地存储中，键名按项目隔离；Base64 原始文件不会写入本地存储。第一版以单次视频模型生成的一条成片为目标，不包含多片段剪辑、字幕合成或独立音轨混合。

## 保留的 Toonflow 基础能力

在原项目能力基础上，本仓库仍可使用：

- 小说章节导入、事件提取与剧本改编；
- ScriptAgent、ProductionAgent 与转绘 Agent；
- 角色、场景、道具的原始资产和衍生资产管理；
- 资产提示词润色与图片生成；
- 分镜面板、分镜图和参考资产关联；
- 视频提示词、视频任务、候选结果和轨道管理；
- 多模型供应商配置与可编程 Vendor；
- Agent 技能文件和本地记忆；
- SQLite 本地数据存储；
- Electron 桌面端与 HTTP 服务模式。

## 技术组成

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Node.js-24-5FA04E?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24" />
  <img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&amp;logo=express&amp;logoColor=white" alt="Express 5" />
  <img src="https://img.shields.io/badge/SQLite-本地数据-003B57?style=flat-square&amp;logo=sqlite&amp;logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Electron-40-47848F?style=flat-square&amp;logo=electron&amp;logoColor=white" alt="Electron 40" />
  <img src="https://img.shields.io/badge/Socket.IO-4.x-010101?style=flat-square&amp;logo=socketdotio&amp;logoColor=white" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/Yarn-Classic-2C8EBB?style=flat-square&amp;logo=yarn&amp;logoColor=white" alt="Yarn Classic" />
  <img src="https://img.shields.io/badge/Docker-Node_24-2496ED?style=flat-square&amp;logo=docker&amp;logoColor=white" alt="Docker" />
</p>

| 层级 | 主要技术 |
| --- | --- |
| 运行时 | Node.js 24 |
| 语言 | TypeScript 5 |
| 服务端 | Express 5、Express WebSocket、Socket.IO |
| 数据库 | SQLite、Knex、better-sqlite3 |
| AI 接入 | Vercel AI SDK 与可编程模型供应商 |
| 多模态能力 | 文本、图片、视频输入与受控工具调用 |
| 本地推理 | Hugging Face Transformers / ONNX |
| 图像处理 | Sharp |
| 媒体处理 | 固定版本 FFmpeg / FFprobe |
| 桌面端 | Electron 40、electron-builder |
| 构建 | esbuild、tsx |
| 内置前端 | 已构建 Web 资源 + 原生 JavaScript/CSS 二开补丁 |

## 目录说明

```text
.
├─ src/
│  ├─ agents/                         # ScriptAgent 与 ProductionAgent
│  ├─ constants/                      # 项目类型、转绘配置和工作流步骤定义
│  ├─ lib/                            # 数据库、资产统计、转绘媒体和通用能力
│  └─ routes/
│     ├─ redraw/                      # 转绘工作区、源视频、镜头和工作流接口
│     ├─ storyboardImport/            # 分镜表解析、提交和管理接口
│     └─ production/workflow/         # 生产步骤准备、进度和执行接口
├─ data/
│  ├─ serve/app.js                    # 构建后的生产服务入口
│  ├─ skills/                         # Agent 与美术风格技能文件
│  ├─ vendor/                         # 模型供应商实现
│  ├─ web/                            # 内置前端及二开页面
│  ├─ db2.sqlite                      # 本地业务数据库
│  └─ oss/                            # 本地生成素材
├─ scripts/                           # 构建、Electron 和打包脚本
├─ test/storyboardImport/             # 分镜表资产与解析回归测试
├─ test/redraw/                       # 转绘流程、模型能力和媒体处理测试
├─ docs/secondary-development-workflow.md
│                                      # 二开接口说明
├─ .zcode/plans/                       # 已有二次开发计划记录
└─ .codex/plans/                       # 当前协作计划记录
```

`data/web/index.html` 是已构建前端产物，并非完整可维护的 Vue 源码。本仓库新增页面通过 `secondary-dev-patch.js`、`product-promo-studio.js`、`redraw-studio.js` 及对应样式注入；“我的项目”中的转绘入口由 `scripts/patchRedrawWeb.ts` 进行带校验的确定性补丁。替换或重新构建 `data/web` 前，请先确认这些二开文件和入口引用不会被覆盖。

## 环境准备

建议使用：

- Node.js `24.x`；
- Yarn Classic；
- Git；
- 可用的多模态文本、图片和视频模型接口；
- Windows、macOS 或 Linux 桌面环境（运行 Electron 时）。

项目涉及 `better-sqlite3`、`sharp` 和 Electron 等原生或平台相关依赖。若依赖安装失败，请先确认 Node.js 版本、系统编译工具和当前平台架构一致。

转绘媒体处理使用项目固定版本的 FFmpeg/FFprobe，不依赖系统 `PATH` 中另行安装的版本。Electron 打包脚本会隔离准备桌面端所需的原生模块，避免 Electron ABI 与当前 Node.js ABI 相互覆盖。

## 获取与安装

```bash
git clone https://gitee.com/lan0811/toonflaw-2.0.git
cd toonflaw-2.0
yarn install --frozen-lockfile
```

如果只是研究原始 Toonflow，请从本页开头列出的 HBAI-Ltd 原始仓库获取代码；上面的地址对应本二次开发版本。

## 启动方式

### Electron 桌面端

```bash
yarn dev:gui
```

该命令会启动本地后端，并通过 Electron 加载仓库内置前端，是体验完整功能的推荐开发方式。

如需连接单独运行的前端开发服务器：

```bash
yarn dev:gui-vite
```

此模式默认连接 `http://localhost:50188`，需要另行准备兼容的前端开发服务。

### 本地 HTTP 服务

```bash
yarn dev
```

默认监听：

```text
http://localhost:10588
```

内置页面入口为：

```text
http://localhost:10588/index.html
```

### 生产模式

```bash
yarn build
yarn start
```

`yarn start` 运行 `data/serve/app.js`。每次修改 TypeScript 路由后都应重新执行 `yarn build`，否则生产服务仍会使用旧的路由包。

## 首次使用

首次初始化数据库时会创建默认账户：

```text
用户名：admin
密码：admin123
```

登录后请立即修改默认密码，然后在设置中心完成以下配置：

1. 添加或启用模型供应商；
2. 配置文本、图片和视频模型；
3. 完成模型映射；
4. 为普通 Agent 工作流选择通用文本模型；
5. 在 Agent 设置中选择简易或高级模式，并配置转绘 Agent；
6. 分别测试文本、图片和视频请求。

模型调用会产生外部服务费用，实际费用、内容合规和数据处理规则由所选择的服务商决定。

转绘还要求模型声明以下能力：

| 模型用途 | 必需能力 |
| --- | --- |
| 简易模式 `redrawAgent` | 文本、图片、视频输入和工具调用 |
| 高级模式各子 Agent | 满足“转绘 Agent 简易与高级配置”表中的最低能力 |
| 图片生成模型 | 至少支持目标图片生成；使用多张参考图时还需声明多参考能力 |
| 视频生成模型 | 在 `mode` 中声明 `videoReference:N`，并提供可用时长和分辨率 |

模型能力会在保存配置和执行任务时分别校验，旧前端或直接 API 调用不能绕过该检查。

## 使用分镜表工作流

1. 新建项目并选择“基于分镜表”。
2. 打开分镜表管理页，上传 TXT、Markdown 或 DOCX，或直接粘贴内容。
3. 检查解析后的镜头字段、资产统计和 warnings。
4. 确认导入并选择当前分镜批次。
5. 检查和编辑角色、场景、道具及其分镜关联。
6. 依次执行原始资产、衍生资产、分镜图和视频步骤。
7. 对失败项查看具体原因并按需重试。

同一项目可以存在多个导入批次。涉及资产、分镜和视频的操作应始终确认当前 `scriptId`，避免跨批次执行。

## 使用转绘工作流

1. 在“我的项目”中新建项目并选择“转绘”，设置与源视频一致的 `16:9` 或 `9:16` 比例，同时选择图片模型和支持视频参考的视频模型。
2. 打开转绘项目，上传一个 MP4、MOV 或 WebM 源视频。首版限制为单视频、最长 20 分钟、最大 2GB。
3. 填写目标风格和视觉约束，按需上传人物、场景或整体风格参考图，并选择需要转换的人物、服装、场景、道具和媒介质感。
4. 执行“分析源视频”，逐镜校对起止时间、场景、人物、动作、原对白、情绪、镜头语言和声音信息，然后点击“确认分析”。
5. 依次制作转绘剧本、原始资产、原始资产图、衍生资产、衍生资产图、分镜表和分镜图，并在检查点完成阶段确认。
6. 生成视频提示词。开始生成视频前确认片段数量和最高尝试次数；每个片段首次生成加两次自动保真重试，最多可能计费三次。
7. 检查逐片保真评分和失败原因。仍未通过的片段可以继续重生成，也可以在确认内容可接受后人工接受。
8. 所有片段通过或被接受后执行“合成短剧”，下载最终 MP4；存在字幕时还可以下载 SRT。

分析开始前可以直接更换源视频；已经产生分析结果后，需要先使用“重置转绘流程”。重置会删除分析及全部下游剧本、资产、分镜、视频和成片，但保留当前源视频与风格参考图。

## 使用产品宣传片工作区

1. 从侧边栏进入“产品宣传片”。
2. 新建项目并填写产品说明、画面比例、图片模型和视频模型。
3. 在默认画布中上传产品参考图。
4. 编辑图片节点和视频节点提示词。
5. 检查节点连线所代表的参考图依赖。
6. 单独生成节点，或使用“一键生成”按依赖顺序执行。
7. 在右侧结果区预览、打开或下载生成视频。

画布结构保存在当前浏览器或 Electron 用户数据目录对应的本地存储中。清理浏览器数据、删除项目或更换用户数据目录前，请自行确认是否需要保留画布信息。

## 常用检查

```bash
# TypeScript 类型检查
yarn lint

# 分镜表解析与资产关联回归测试
yarn test:storyboard-import

# 转绘工作流、模型能力与媒体处理测试
yarn test:redraw

# 二开前端脚本语法检查
node --check data/web/secondary-dev-patch.js
node --check data/web/product-promo-studio.js
node --check data/web/redraw-studio.js

# 校验并重新应用转绘入口补丁
yarn patch:redraw-web

# 生成生产服务和 Electron 主进程构建文件
yarn build

# 检查补丁中的空白和冲突标记
git diff --check
```

分镜表自动化测试不会导入真实数据库初始化链，也不应修改 `data/db2.sqlite`。转绘测试使用临时数据库和临时合成视频，覆盖项目类型、模型能力、数据库幂等迁移、时间轴、字幕和 FFmpeg/FFprobe 媒体流程。

## 桌面端打包

```bash
# 仅生成未封装目录
yarn pack

# 当前平台完整打包
yarn dist

# 指定平台
yarn dist:win
yarn dist:mac
yarn dist:linux
```

打包前应先完成类型检查、分镜表测试、转绘测试和生产构建。`yarn pack` 会在隔离目录准备 Electron 需要的 `better-sqlite3` 原生模块，并在打包后验证 Electron ABI，不应覆盖当前 Node.js 使用的原生模块。跨平台打包可能还需要对应系统的签名、图标或原生依赖环境。

## 二次开发 API

主要新增接口如下：

| 接口 | 用途 |
| --- | --- |
| `POST /api/storyboardImport/parse` | 解析并预览分镜表 |
| `POST /api/storyboardImport/commit` | 提交分镜、资产和轨道 |
| `POST /api/storyboardImport/list` | 查询导入批次、分镜和关联资产 |
| `POST /api/storyboardImport/update` | 更新单条分镜 |
| `POST /api/storyboardImport/updateAsset` | 调整分镜资产关系 |
| `POST /api/storyboardImport/delete` | 删除分镜记录 |
| `POST /api/production/workflow/getConfig` | 获取项目类型和工作流配置 |
| `POST /api/production/workflow/getProgress` | 查询各生产步骤进度 |
| `POST /api/production/workflow/getRunnableData` | 查询当前可执行对象 |
| `POST /api/production/workflow/prepareStepRequest` | 准备底层步骤请求体 |
| `POST /api/production/workflow/runStep` | 统一启动一个生产步骤 |
| `POST /api/production/workflow/generateDerivedAssets` | 创建并关联衍生资产 |
| `POST /api/redraw/workspace/get`、`update` | 获取转绘工作区或更新目标风格 |
| `POST /api/redraw/source/upload`、`reset` | 流式上传源视频或重置下游流程 |
| `POST /api/redraw/reference/upload`、`delete` | 管理目标风格参考图 |
| `POST /api/redraw/shot/update`、`confirm` | 校对并确认逐镜分析结果 |
| `POST /api/redraw/workflow/run`、`progress` | 执行转绘步骤或查询工作流进度 |
| `POST /api/redraw/segment/accept` | 人工接受未通过保真复核的片段 |

请求需要先登录并携带有效 Token。所有转绘写接口都会验证 `projectId` 对应的项目类型必须为 `redraw`；运行中的同一步骤重复提交会返回冲突。分镜生产接口字段、状态结构和调用示例见 [二次开发流程接口说明](./docs/secondary-development-workflow.md)，转绘设计约束见 [转绘开发计划](./.codex/plans/redraw-project.md)。

## 数据与升级注意事项

- `data/db2.sqlite` 保存本地业务数据，调试和测试前请先备份。
- `data/oss` 保存图片、视频和缩略图等生成素材。
- Electron 安装版会把运行数据复制到应用用户数据目录，源码目录不一定是实际数据目录。
- 转绘源视频、分析代理、镜头片段、关键帧、参考图和输出文件保存在项目对应的 OSS 目录；删除转绘项目时会同步清理专属记录和媒体文件。
- 新建数据库会创建转绘数据表与 Agent 配置，已有数据库会通过 `fixDB` 按键幂等补齐，不覆盖已有模型选择。
- 不要手工编辑 `data/serve/app.js`；它应由 `yarn build` 从 TypeScript 源码生成。
- 不要把 API Key、Token、真实数据库或生成素材提交到公开仓库。
- 更新内置前端时应重新验证分镜表页面、转绘项目类型与路由、宣传片路由、侧边栏入口和 Electron `file://` 模式。
- 模型供应商对参考图数量、时长、分辨率和音频参数的支持不同，提交前会按模型详情进行校验。

## 当前边界

- 内置 Web 前端是构建产物，注入式二开对原页面 DOM 和路由结构存在依赖。
- 转绘首版为单项目单视频，只支持 MP4、MOV、WebM，最长 20 分钟、最大 2GB，不包含多集共享资产、超长视频或批量导入。
- 转绘首版只接受与项目设置一致的 `16:9` 或 `9:16` 视频，比例误差不超过 2%，暂不支持 `1:1`、`4:3` 等比例。
- “一比一复刻”约束剧情、对白、动作、镜头顺序、时间轴和原音轨，不代表生成画面可以逐像素复现源视频。
- 无音轨视频保持静音；原语言、角色名称和对白不翻译、不重新配音。自动保真重试可能使单片段最多产生三次视频生成费用。
- 转绘依赖供应商真实支持视频输入、工具调用、多图片参考和 `videoReference:N`；仅修改模型声明不能让不兼容的接口获得相应能力。
- 宣传片工作区目前只生成单条视频，不负责多片段剪辑与字幕包装。
- AI 生成结果受模型、提示词、服务可用性和供应商限制影响，不能保证每次输出一致。
- 本项目默认以本地单机工作流为主，不等同于多租户生产平台。
- 计划文档用于记录设计与修复过程；功能状态应以当前代码、路由和测试结果为准。

## 协作规则

本二次开发仓库只在 `master` 分支进行开发、提交和推送。修改前请确认当前分支和工作区状态，并保留已有未提交内容：

```bash
git branch --show-current
git status --short
```

提交前至少运行与修改范围对应的检查。修改分镜表解析、转绘流程、生产工作流或前端补丁时，建议执行“常用检查”中的完整命令集。

## 许可证与版权

本仓库继续保留原项目的 [LICENSE](./LICENSE) 与 [NOTICES.txt](./NOTICES.txt)。使用、修改和分发本项目时，应同时遵守：

1. Apache License 2.0；
2. `LICENSE` 末尾由 HBAI-Ltd 提供的补充协议；
3. 原项目关于商标、标识和版权信息的保留要求；
4. 第三方依赖各自的许可证。

将本软件或衍生版本作为产品向两个及以上独立第三方分发、销售或提供使用前，请先阅读补充协议并向 HBAI-Ltd 确认是否需要书面商业授权。

本仓库对原项目的署名只用于说明代码来源和表达尊重，不代表 HBAI-Ltd 对本二次开发版本提供背书、担保或技术支持。
