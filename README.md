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

这是一个面向 AI 短剧、漫剧和产品宣传片生产的本地工作台。项目保留 Toonflow 原有的小说、剧本、资产、分镜和视频生产能力，并在此基础上补充了两条独立业务线：

1. 以分镜表为起点的 AI 短剧生产闭环。
2. 以节点画布为核心的单条产品宣传片生成工作区。

当前版本号为 `1.1.9`。应用可作为 Electron 桌面端运行，也可以单独启动本地 HTTP 服务。业务数据、生成素材和工作流状态默认保存在本机。

## 本仓库新增内容

### 1. 基于分镜表的独立项目类型

项目类型现统一为：

| 值 | 页面含义 | 主要输入 |
| --- | --- | --- |
| `novel` | 基于小说原文 | 小说章节与事件 |
| `script` | 基于剧本 | 单集或批量剧本 |
| `storyboard` | 基于分镜表 | 结构化分镜表 |

`storyboard` 项目拥有独立的分镜表管理入口，不再被当作普通剧本项目显示或跳转。

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

### 5. 产品宣传片独立工作区

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
- ScriptAgent 与 ProductionAgent；
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
| 本地推理 | Hugging Face Transformers / ONNX |
| 图像处理 | Sharp |
| 桌面端 | Electron 40、electron-builder |
| 构建 | esbuild、tsx |
| 内置前端 | 已构建 Web 资源 + 原生 JavaScript/CSS 二开补丁 |

## 目录说明

```text
.
├─ src/
│  ├─ agents/                         # ScriptAgent 与 ProductionAgent
│  ├─ constants/                      # 项目类型和工作流步骤定义
│  ├─ lib/                            # 数据库、资产统计和通用能力
│  └─ routes/
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
├─ docs/secondary-development-workflow.md
│                                      # 二开接口说明
├─ .zcode/plans/                       # 已有二次开发计划记录
└─ .codex/plans/                       # 当前协作计划记录
```

`data/web/index.html` 是已构建前端产物，并非完整可维护的 Vue 源码。本仓库新增页面通过 `secondary-dev-patch.js`、`product-promo-studio.js` 及对应样式注入。替换或重新构建 `data/web` 前，请先确认这些二开文件和入口引用不会被覆盖。

## 环境准备

建议使用：

- Node.js `24.x`；
- Yarn Classic；
- Git；
- 可用的文本、图片和视频模型接口；
- Windows、macOS 或 Linux 桌面环境（运行 Electron 时）。

项目涉及 `better-sqlite3`、`sharp` 和 Electron 等原生或平台相关依赖。若依赖安装失败，请先确认 Node.js 版本、系统编译工具和当前平台架构一致。

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
4. 为 Agent 工作流选择通用文本模型；
5. 分别测试文本、图片和视频请求。

模型调用会产生外部服务费用，实际费用、内容合规和数据处理规则由所选择的服务商决定。

## 使用分镜表工作流

1. 新建项目并选择“基于分镜表”。
2. 打开分镜表管理页，上传 TXT、Markdown 或 DOCX，或直接粘贴内容。
3. 检查解析后的镜头字段、资产统计和 warnings。
4. 确认导入并选择当前分镜批次。
5. 检查和编辑角色、场景、道具及其分镜关联。
6. 依次执行原始资产、衍生资产、分镜图和视频步骤。
7. 对失败项查看具体原因并按需重试。

同一项目可以存在多个导入批次。涉及资产、分镜和视频的操作应始终确认当前 `scriptId`，避免跨批次执行。

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

# 二开前端脚本语法检查
node --check data/web/secondary-dev-patch.js
node --check data/web/product-promo-studio.js

# 生成生产服务和 Electron 主进程构建文件
yarn build

# 检查补丁中的空白和冲突标记
git diff --check
```

分镜表自动化测试不会导入真实数据库初始化链，也不应修改 `data/db2.sqlite`。

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

打包前应先完成类型检查、分镜表测试和生产构建。跨平台打包可能还需要对应系统的签名、图标或原生依赖环境。

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

请求需要先登录并携带有效 Token。接口字段、状态结构和调用示例见 [二次开发流程接口说明](./docs/secondary-development-workflow.md)。

## 数据与升级注意事项

- `data/db2.sqlite` 保存本地业务数据，调试和测试前请先备份。
- `data/oss` 保存图片、视频和缩略图等生成素材。
- Electron 安装版会把运行数据复制到应用用户数据目录，源码目录不一定是实际数据目录。
- 不要手工编辑 `data/serve/app.js`；它应由 `yarn build` 从 TypeScript 源码生成。
- 不要把 API Key、Token、真实数据库或生成素材提交到公开仓库。
- 更新内置前端时应重新验证分镜表页面、宣传片路由、侧边栏入口和 Electron `file://` 模式。
- 模型供应商对参考图数量、时长、分辨率和音频参数的支持不同，提交前会按模型详情进行校验。

## 当前边界

- 内置 Web 前端是构建产物，注入式二开对原页面 DOM 和路由结构存在依赖。
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

提交前至少运行与修改范围对应的检查。修改分镜表解析、生产工作流或前端补丁时，建议执行“常用检查”中的完整命令集。

## 许可证与版权

本仓库继续保留原项目的 [LICENSE](./LICENSE) 与 [NOTICES.txt](./NOTICES.txt)。使用、修改和分发本项目时，应同时遵守：

1. Apache License 2.0；
2. `LICENSE` 末尾由 HBAI-Ltd 提供的补充协议；
3. 原项目关于商标、标识和版权信息的保留要求；
4. 第三方依赖各自的许可证。

将本软件或衍生版本作为产品向两个及以上独立第三方分发、销售或提供使用前，请先阅读补充协议并向 HBAI-Ltd 确认是否需要书面商业授权。

本仓库对原项目的署名只用于说明代码来源和表达尊重，不代表 HBAI-Ltd 对本二次开发版本提供背书、担保或技术支持。
