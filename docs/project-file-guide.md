# 广发项目目录与文件功能说明

更新时间：2026-07-14  
适用分支：`feature/refactor-main`  
盘点基线：`a33fda8`（本文加入版本库后，共覆盖 177 个受版本控制文件，包含本文自身）

## 1. 文档目的与范围

本文按真实文件目录说明项目中每个受版本控制文件包含的主要内容、承担的功能和所在业务链路，重点回答“出现某类需求或故障时应查看哪个文件”。

盘点范围包括：

- 根目录配置、依赖清单和测试样例；
- `src/` React 前端、OnlyOffice 前端桥接、DOCX 浏览器处理代码；
- `server/` 本地 API、AI、知识库、模板库和 OnlyOffice 服务端代码；
- `scripts/` 启动、补丁、导入、索引和诊断脚本；
- `tests/` 自动回归；
- `assets/`、`docs/` 中受版本控制的样例、原型和业务知识地图。

以下内容不逐文件盘点：`node_modules/`、`dist/`、`data/`、`logs/`、`tmp/`、`.git/`、`.venv-embedding/`、本地模型和运行日志。这些是依赖、构建结果或运行时数据，不是需要日常维护的业务源码。`.env.local` 含本机配置和密钥，也不属于版本库，严禁复制到文档或提交。

## 2. 项目定位与总体结构

该项目是一套面向招投标、技术方案和 Office 文档处理的本地工作台。前端使用 React + Vite，文档编辑以 OnlyOffice 为主，后端作为 Vite 本地中间件运行；AI 支持本地 Qwen 或云端 OpenAI 兼容模型，知识检索采用 SQLite + ZVec + Embedding，方案配图使用 PlantUML。

| 功能链路 | 主要文件与调用关系 |
| --- | --- |
| 页面与工作台 | `src/main.jsx` 挂载 `src/App.jsx`，由 `App.jsx` 编排模板标注、填充、方案编写、排版、格式审核、模板管理、知识库和设置页面。 |
| 本地 API | 浏览器请求 `/api/*`，`vite.config.js` 先做来源限制，再交给 `server/api/index.js`、注册表和具体 `*.routes.js`；路由处理器调用 `server/` 中的业务服务。 |
| OnlyOffice | React 通过 `src/features/docx/office/bridge.jsx` 和 Connector 发命令；`scripts/onlyoffice-*.js` 在编辑器内部调用 OnlyOffice API，负责大纲、选区、书签、正文替换、排版、保存和图片/表格插入。 |
| 字段填充 | 模板标注形成字段和精确书签；`server/ai/fill.js` 联合资料与知识库生成结构化结果；前端确认后通过 OnlyOffice 书签写入并下载回传保存。 |
| 知识库 | `server/knowledge/documents.js` 接收入库资料，经解析、切片、Embedding 和 ZVec 建索引；AI 或资料选择器通过统一检索范围取得文本、表格和图片。 |
| 方案编写 | OnlyOffice 大纲形成精确 `paragraph-N` 目标；`server/solution-writing/generator.js` 生成规划与正文；`solutionConnector.js` 只按保存的段落位置替换对应正文。 |
| AI 生图 | `SolutionAiImageModal.jsx` 提交标题和上下文；`plantuml-image.js` 生成、校验并渲染活动图/WBS/其他单一 PlantUML 图，再封装 PNG 和 DOCX 片段。 |
| 排版与审核 | 浏览器 DOCX XML 审核代码、AI 大纲审查和 OnlyOffice 排版脚本各自负责可可靠判断的部分；修复计划只执行明确支持的动作。 |

## 3. 顶层目录

```text
广发new/
├─ assets/                       原型截图、接口样例和测试资料
├─ docs/                         业务流程知识地图及本文件
├─ scripts/                      启动、OnlyOffice 注入、数据导入和诊断脚本
├─ server/                       本地 API 与服务端业务逻辑
├─ src/                          React 前端、OnlyOffice 前端适配和 DOCX 处理
├─ tests/                        Node 自动回归
├─ data/                         运行时 SQLite、知识库、草稿、设置和生成图片（不入库）
├─ logs/、server/logs/            运行与 AI 调试日志（不入库）
├─ dist/                         Vite 生产构建结果（不入库）
├─ node_modules/                 Node 依赖（不入库）
└─ 根目录配置与启动文件
```

## 4. 根目录文件

| 文件 | 功能说明 |
| --- | --- |
| `.env.example` | 环境变量示例。列出 DeepSeek、OpenAI 兼容本地 Qwen、BGE-M3 Embedding 的地址、模型、密钥占位、向量维度和超时配置；不包含真实密钥。 |
| `.gitignore` | Git 忽略规则。排除依赖、构建产物、运行数据、日志、临时文件、Python 缓存、Embedding 虚拟环境和 `.env.local`。 |
| `HANDOFF.md` | 项目权威交接文档。记录启动方式、端口、当前功能状态、OnlyOffice 通用接口、精确定位规则、补丁缓存号、已知问题和接手要求。 |
| `index.html` | Vite HTML 入口。声明中文页面、viewport、产品标题、React 挂载节点，并加载 `src/main.jsx`。 |
| `package.json` | Node 项目清单。声明 ES Module、React/Vite、ZVec、GSAP、JSZip、DOCX/PDF 预览依赖，以及开发、OnlyOffice、PlantUML、Embedding、测试和构建命令。 |
| `package-lock.json` | npm 依赖锁。固定所有直接和间接依赖的精确版本与校验值，保证不同机器安装结果一致。 |
| `requirements-embedding.txt` | 本地 Embedding Python 依赖。包含 FastAPI、Uvicorn、Sentence Transformers、Transformers、Accelerate 等。 |
| `start-all.bat` | Windows 双击启动入口。切到项目根目录后调用 `scripts/start-all-dev.ps1`，并保留窗口显示启动状态。 |
| `vite.config.js` | Vite 与本地后端集成配置。启用 React，把 `server/api/index.js` 挂到 `/api`，并只允许本机 Web 与本机 OnlyOffice 来源访问 API。 |
| `格式审核测试样例-故意不规范.docx` | 格式审核回归样例。刻意包含页边距、正文、标题层级、空行、目录和多节版式问题，用于验证审核与修复。 |

## 5. `assets/` 原型与测试资料

| 文件 | 功能说明 |
| --- | --- |
| `assets/prototypes/frontend-annotation-check.png` | 模板字段标注工作台检查截图，用于人工对比界面状态，不参与运行。 |
| `assets/prototypes/frontend-fill-check.png` | AI 填充工作台检查截图，用于人工对比填充结果界面。 |
| `assets/prototypes/tender-agent-prototype-v1.png` | 招标文件智能体第一版整体原型，记录早期产品布局和功能规划。 |
| `assets/prototypes/tender-agent-template-annotation-v1.png` | 模板标注第一版原型，记录字段标注流程和页面结构。 |
| `assets/samr-sample-national.json` | 市场监管总局合同示范文本接口样例。保存分页字段和示例记录，供抓取、清单和分类脚本核对接口结构。 |
| `assets/test-materials/测试资料A_市政道路改造工程采购方案.docx` | 工程类测试资料，用于知识入库、字段填充、检索和方案生成验证。 |
| `assets/test-materials/测试资料B_智慧校园安防系统技术方案.docx` | 信息化项目测试资料，用于知识入库、检索和技术方案生成验证。 |

## 6. `docs/` 业务文档

### 6.1 本项目说明

| 文件 | 功能说明 |
| --- | --- |
| `docs/project-file-guide.md` | 本文。按目录逐文件说明项目职责、业务位置和维护边界。 |

### 6.2 `docs/secondary-function-flows/` 填充业务知识地图

这些文档记录字段二级类型的业务规则和历史调用链。代码路径经历过重构时，应以当前源码为准，文档用于理解业务语义而不是作为可执行接口定义。

| 文件 | 功能说明 |
| --- | --- |
| `docs/secondary-function-flows/choice-amount-select.md` | “金额+选择”知识地图。说明 `amount-choice` 的标注、金额换算、选项勾选、OnlyOffice 联动、资料依据和质量检查。 |
| `docs/secondary-function-flows/choice-replace-select.md` | “替换+选择”知识地图。说明有资料时逐字替换整个选区、无资料时只勾选“无要求”的双分支链路。 |
| `docs/secondary-function-flows/choice-select.md` | “选择”知识地图。说明 `choice` 只改变候选项勾选、不替换选区原文的规则。 |
| `docs/secondary-function-flows/fill-amount.md` | “金额”知识地图。说明模板单位识别、金额换算、字段/输入点定位、AI 填充和保存验证。 |
| `docs/secondary-function-flows/fill-date.md` | “日期”知识地图。说明日期纯值输出、年月日空位/标签写入、AI 依据和导出检查。 |
| `docs/secondary-function-flows/fill-paragraph.md` | “长文本”知识地图。说明连续原文召回、整段书签替换、溯源和保存同步。 |
| `docs/secondary-function-flows/fill-short.md` | “短文本”知识地图。说明真实选区、AI JSON、知识溯源、字段/输入点写入和分包默认值特例。 |
| `docs/secondary-function-flows/images/choice-amount-select.png` | `choice-amount-select.md` 配图，展示金额与选择必须同时完成的流程。 |
| `docs/secondary-function-flows/images/choice-replace-select.png` | `choice-replace-select.md` 配图，展示整体替换和仅勾选两个分支。 |
| `docs/secondary-function-flows/images/choice-select.png` | `choice-select.md` 配图，展示候选识别、AI 选择和 OnlyOffice 勾选。 |
| `docs/secondary-function-flows/images/fill-amount.png` | `fill-amount.md` 配图，展示金额检索、单位换算和定位写入。 |
| `docs/secondary-function-flows/images/fill-date.png` | `fill-date.md` 配图，展示日期依据判断、格式归一和写入。 |
| `docs/secondary-function-flows/images/fill-paragraph.png` | `fill-paragraph.md` 配图，展示长文本召回、连续原文复制和整段替换。 |
| `docs/secondary-function-flows/images/fill-short.png` | `fill-short.md` 配图，展示短文本标注、检索、模型判断、溯源和回写。 |

## 7. `scripts/` 启动、注入、导入与诊断

| 文件 | 功能说明 |
| --- | --- |
| `scripts/check-knowledge-hybrid.mjs` | ZVec 混合检索独立检查。在临时索引验证知识库过滤、向量与全文融合、纯全文降级和库隔离。 |
| `scripts/check-knowledge-selection.mjs` | 真实知识库选择边界检查。验证未选择不扩库、选中库不泄漏、短词召回和全局库隔离。 |
| `scripts/check-paragraph-source-fallback.mjs` | 长文本候选提取检查。验证从相关片段提取连续原文并拒绝无关片段。 |
| `scripts/import-legal-regulations.py` | 法规批量导入。抓取政府/司法网站法规正文，清洗分块并写入法规资料目录、知识库元数据和报告。 |
| `scripts/import-samr-contract-samples.py` | 市监总局合同样例下载与模板导入。选择代表模板、识别格式、保存文件，并将支持的模板以 Base64 和分类元数据入库。 |
| `scripts/local_embedding_server.py` | 本地 BGE-M3 向量服务。用 FastAPI 提供 `/health` 和 OpenAI 兼容 `/v1/embeddings`，处理批量输入、设备选择、归一化和维度调整。 |
| `scripts/make_format_audit_fixture.py` | 格式审核样例生成器。使用 `python-docx` 创建各种故意错误并输出根目录测试 DOCX。 |
| `scripts/onlyoffice-layout-format.js` | OnlyOffice 排版体检/修复注入脚本。读取段落与 section，分析格式并执行页面、正文、标题、落款修复，通过排版消息与前端交互。 |
| `scripts/onlyoffice-outline-probe.js` | OnlyOffice 核心注入桥。读取大纲/样式/选区/页码，管理普通字段和复杂填充书签，执行字段、金额、选项、方案正文/子树替换，控制保存/修订，并插入表格和图片。 |
| `scripts/onlyoffice-placeholder-fields.js` | 占位变量注入脚本。用 `GF_PH_` 书签插入变量标签，支持跳转、选择、删除和按值替换。 |
| `scripts/patch-onlyoffice.py` | OnlyOffice 容器补丁。隐藏品牌入口，注入桥接脚本和“定制组件”，同步压缩资源与缓存号，调整 Service Worker 和原生 AI 插件行为。 |
| `scripts/rebuild-knowledge-vectors.mjs` | 知识向量索引重建。删除派生索引，批量重算向量、写入元数据、执行检索冒烟并更新文档索引状态。 |
| `scripts/samr-contracts-manifest.ps1` | 合同示范文本清单抓取。分页读取全国/地方模板，输出 JSON、CSV、Markdown 清单和统计。 |
| `scripts/samr_contract_catalog.py` | 合同范本二级分类。按标题关键词划分买卖、租赁、工程、服务等类别并输出分类目录。 |
| `scripts/start-all-dev.ps1` | 本地全栈编排。检查并后台启动 OnlyOffice 8080、PlantUML 8090、Embedding 8000、Qwen 8129、Vite 5173，等待就绪并汇总状态。 |
| `scripts/start-local-embedding.ps1` | Embedding 启动脚本。创建 Python 虚拟环境，可选安装 CPU 依赖，选择本地/镜像 BGE-M3 后运行服务。 |
| `scripts/start-local-qwen36-cpu.ps1` | Qwen CPU/Vulkan 启动脚本。校验 llama.cpp 与 GGUF，以较小上下文在 8129 提供 OpenAI 兼容接口。 |
| `scripts/start-local-qwen36-rocm.ps1` | Qwen AMD ROCm 启动脚本。配置 ROCm DLL、上下文和 GPU 层数，在 8129 启动本地模型；一键启动默认走此路径。 |
| `scripts/start-onlyoffice.ps1` | OnlyOffice 部署启动。准备 Docker、启动仅本机可访问的 DocumentServer、从系统字体目录及 Windows 字体注册表精确同步中文字体和方正字体、安装桥接脚本、写入本地 AI 配置、打补丁并健康检查。 |
| `scripts/start-plantuml.ps1` | PlantUML 部署启动。启动容器并映射 8090，复制中文字体、刷新缓存并验证服务。 |
| `scripts/test-qwen-vulkan-variants.ps1` | Qwen Vulkan 参数诊断。轮换 Flash Attention、卸载和 GPU 层数配置，检查健康、聊天结果、耗时和错误。 |

## 8. `server/` 本地后端

### 8.1 `server/ai/` AI 与知识召回

| 文件 | 功能说明 |
| --- | --- |
| `server/ai/chat-completions.js` | AI HTTP 底层适配。统一调用 OpenAI 兼容 `/chat/completions`，区分本地/云端超时，支持多 API Key 轮换，并处理 Gemini 参数、鉴权、限流和异常响应。 |
| `server/ai/chat.js` | 自研知识库聊天。校验问题和最近历史，召回知识片段后生成简短回答，过滤 OnlyOffice 宏/工具调用内容，并返回固定来源摘要。 |
| `server/ai/config.js` | AI 运行配置。集中定义默认模型、知识/资料字符上限和切片参数，并从环境变量选择本地或云端模型。 |
| `server/ai/core.js` | AI 兼容聚合出口。统一转出聊天、填充、大纲审查、检索、模型、日志和填充规则。 |
| `server/ai/debug-log.js` | AI 调试日志。将模型输入、召回、解析和最终判断以有限长度写入 `server/logs`，日志失败不影响业务。 |
| `server/ai/fill-rules.js` | 字段填充领域规则。识别短/长文本、日期、金额、选择、替换选择和金额选择，定义模型契约，并处理单位换算、标签清理、选项和证据校验。 |
| `server/ai/fill.js` | 单字段 AI 填充主流程。构造检索、合并知识库与临时资料、调用模型并后置校验；证据不足时返回“需补充资料”，不写模板占位内容。 |
| `server/ai/format-outline.js` | Word 大纲 AI 审查。判断候选段落应降正文还是调整 L1-L3，只返回带精确索引的安全计划，不改标题文字。 |
| `server/ai/knowledge-query.js` | AI 检索规划。提炼主词/必选词/排除词，调用知识库；还负责临时资料切片、关键词评分、同义词扩展和片段格式化。 |
| `server/ai/model.js` | 模型响应适配。提供文本/严格 JSON 调用，移除思考标签，解析完整或截断 JSON，校验对象并记录用量和调试上下文。 |

### 8.2 `server/api/` 统一 API 框架

| 文件 | 功能说明 |
| --- | --- |
| `server/api/http.js` | HTTP 通用读写。限制 JSON 请求体大小，返回 JSON 或带类型/下载头的 Buffer。 |
| `server/api/index.js` | API 聚合入口。一次注册 AI、草稿、知识库、Office、设置、模板路由并创建中间件。 |
| `server/api/openapi.js` | API 元数据生成。把内部定义转成路由清单和 OpenAPI 3.0.3 文档。 |
| `server/api/registry.js` | 路由注册表。校验 ID/方法/路径/处理器，防重复，并把 `:param` 编译为精确路径匹配。 |
| `server/api/router.js` | 请求分发器。提供元接口、读取声明的请求体、调用处理器、区分 JSON/Buffer，并统一错误状态。 |

### 8.3 `server/api/routes/` 接口声明

| 文件 | 功能说明 |
| --- | --- |
| `server/api/routes/ai.routes.js` | AI 路由声明。注册字段填充、大纲修复、聊天、检索、方案规划/正文/生图，以及生成图片 PNG 和 DOCX 下载接口。 |
| `server/api/routes/draft.routes.js` | 草稿路由。提供 `GET/POST /api/draft` 读取与保存当前工作台草稿。 |
| `server/api/routes/knowledge.routes.js` | 知识库路由。覆盖库和资料增删查、重建索引、原文件、表格、图片查询/预览/DOCX 下载。 |
| `server/api/routes/office.routes.js` | OnlyOffice 服务端路由。提供健康、文档创建/读取、保存回调、临时下载代理和大纲探针。 |
| `server/api/routes/settings.routes.js` | 模型设置路由。提供配置读取、脱敏保存，以及 LLM/Embedding 连接测试。 |
| `server/api/routes/templates.routes.js` | 模板库路由。提供模板库/类型查询，类型增删改，模板列表/单项读取和整批替换。 |

### 8.4 `server/knowledge/` 知识库实现

| 文件 | 功能说明 |
| --- | --- |
| `server/knowledge/chunker.js` | 文档切片。按页形成带段落序号的段落，再聚合为约 900 字、重叠一段的稳定知识块。 |
| `server/knowledge/db.js` | 知识库 SQLite 初始化。创建库、资料、页面、段落、切片表和索引，迁移旧 JSON，并初始化默认项目库/全局库。 |
| `server/knowledge/documents.js` | 知识文档主服务。串联上传、解析、切片、SQLite、Embedding、ZVec 入库；负责增删、重建、原文件读取和混合检索回溯。 |
| `server/knowledge/docx-convert.js` | DOCX 转 PDF 的 OnlyOffice 适配。调用 `ConvertService.ashx`，解析转换响应并下载 PDF，用于保留页码。 |
| `server/knowledge/images.js` | DOCX 图片提取。解析 OOXML 关系和媒体，识别标题/尺寸/页码，支持图片检索、预览和单图片 DOCX。 |
| `server/knowledge/parser.js` | 资料解析调度。文本直接读取；DOCX 优先转 PDF 分页，失败时解析 `document.xml`，过滤目录/域代码并保存清洗文本。 |
| `server/knowledge/pdf-text.js` | PDF 分页文本抽取。使用 `pdfjs-dist` 逐页读取并规范空白。 |
| `server/knowledge/scope.js` | 检索范围控制。根据显式项目库/全局库选择计算可访问库和切片；未选择时不隐式全库搜索。 |
| `server/knowledge/source-resolver.js` | 原文定位。按文档、页码、段落范围回查 SQLite，必要时退到整页，并生成可展示来源位置。 |
| `server/knowledge/tables.js` | DOCX 表格提取。解析表格、合并单元格、标题和页码，支持检索并生成单表格 DOCX 供 OnlyOffice 插入。 |
| `server/knowledge/text-ranking.js` | 关键词排序。清理查询、扩展招投标词，对短语和关键词评分，用于基础检索与混合召回。 |
| `server/knowledge/zvec-store.js` | ZVec 适配。定义向量/全文/元数据 schema，负责索引增删，并用向量与 FTS 的 RRF 融合返回限定范围切片。 |

### 8.5 `server/solution-writing/` 方案生成

| 文件 | 功能说明 |
| --- | --- |
| `server/solution-writing/generator.js` | 方案编写核心。识别功能模块、生成章节规划、任务规划和正文；丰富模式按证据拆分 1-4 个任务，再按精确 `targetId` 聚合为一份正文。缺失、未知、重复、标题不一致、空白或占位正文全部失败关闭。 |
| `server/solution-writing/plantuml-image.js` | 方案 AI 生图。依据标题正文、大纲和要求生成 PlantUML；流程图强制活动图、功能组成强制 WBS，校验单图型、SimHei/20pt，渲染 PNG 并封装 DOCX。 |

### 8.6 `server/` 根业务服务

| 文件 | 功能说明 |
| --- | --- |
| `server/draft.js` | 草稿持久化。把当前草稿原子写入 `data/drafts/current.json`，不存在时返回 `null`。 |
| `server/embedding.js` | Embedding 适配。调用 OpenAI 兼容 `/embeddings`，处理超时、数量校验及向量截断/补零。 |
| `server/knowledge-base.js` | 知识库兼容入口。旧 middleware 转向统一 API，同时继续导出搜索服务。 |
| `server/office.js` | OnlyOffice 服务端集成。接收 DOCX、生成编辑配置、返回当前文件、处理保存回调和导出下载，并校验 UUID、来源、大小和本地同源。 |
| `server/outline-probe.js` | 大纲调试持久化。保存最近一次 OnlyOffice 原生大纲到 `data/debug` 并提供读取。 |
| `server/settings.js` | 模型设置。合并 JSON 和环境变量，管理本地/云端 LLM 与 Embedding，脱敏 API Key、保存 `.env.local` 并测试连接。 |
| `server/template-db.js` | 模板 SQLite 主服务。管理模板库、类型和模板，保存 DOCX Base64、普通字段、占位变量/锚点、复杂字段/锚点，并迁移旧结构。 |

## 9. `src/` React 前端与浏览器文档逻辑

> 本章按当前源码职责填写。`src/main.jsx` 仅负责挂载，跨工作台状态集中在 `src/App.jsx`；具体业务应继续放在对应 `features/`、`pages/`、`services/` 中。

### 9.1 入口、根应用、通用组件和常量

| 文件 | 功能说明 |
| --- | --- |
| `src/main.jsx` | React 启动入口。把根组件 `App` 挂到 HTML 节点并加载全局样式；不承载业务逻辑。 |
| `src/App.jsx` | 前端根应用和工作流编排。管理工作台导航、模板/草稿/知识库范围、三类字段状态，并把页面动作连接到 OnlyOffice 保存、书签、填充、图片/表格插入和 Word 导出。 |
| `src/components/CitationDrawer.jsx` | 字段溯源抽屉。展示填充值、来源、置信度和引用原文，使用 GSAP 执行进入动画。 |
| `src/components/SaveStateNotice.jsx` | 模板保存状态提示。把待上传、未保存、保存中、已保存、不完整和存储失败转换成文案和色调。 |
| `src/components/SidebarItem.jsx` | 左侧主导航通用条目。渲染图标、标签、激活态和子菜单展开箭头。 |
| `src/components/StatusPill.jsx` | 标注/填充状态徽标。统一未填充、生成中、待确认、已确认、需补资料、人工填写、已标注的图标和颜色。 |
| `src/constants/templates.js` | 模板业务初始数据。定义示例文档槽位、默认模板/字段状态、项目 ID、模板分类和演示填充数据。 |

### 9.2 `src/features/complex-fill/` 复杂类填充

| 文件 | 功能说明 |
| --- | --- |
| `src/features/complex-fill/ComplexFillCards.jsx` | 复杂填充结果卡片。显示状态、正文编辑、AI 生成、写入操作和一个字段对应的多个 OnlyOffice 选区。 |
| `src/features/complex-fill/ComplexFillPanel.jsx` | 复杂字段标注维护面板。支持字段增删改、格式/内容要求、建立/跳转/删除选区书签和模板保存。 |
| `src/features/complex-fill/anchors.js` | 复杂字段领域规则。生成字段/锚点 ID 和双书签名，完成归一、合并、排序、页码、完整性和旧数据迁移。 |
| `src/features/complex-fill/docxBookmarks.js` | DOCX 书签校验。读取 `word/document.xml`，确认复杂业务/选区书签及自动字段书签真实存在，防止保存无效定位。 |
| `src/features/complex-fill/fill.js` | 复杂字段 AI 填充业务。把要求和锚点组装成卡片/请求，并统一生成成功、人工编辑、AI 失败和 OnlyOffice 写入失败状态。 |

### 9.3 `src/features/docx/annotate/` 模板标注辅助

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/annotate/markers.js` | 浏览器预览标注工具。创建、序列化、恢复和清理文本/块标记；DOM 路径失效时按字段上下文评分恢复可视标注。 |

### 9.4 `src/features/docx/audit/` AI 大纲审查

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/audit/aiOutline.js` | AI 大纲审查业务。把 OnlyOffice 大纲和 DOCX 结构转成候选，调用 AI 生成升降级计划，过滤不安全目标并转成格式问题。 |
| `src/features/docx/audit/config.js` | 格式审查配置。定义页面、文字、段落、标题和目录审查项、默认参数、问题映射及本地存储读取。 |

### 9.5 `src/features/docx/fill/` 普通字段填充

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/fill/FieldControls.jsx` | 普通字段表单与结果控件。支持类别/模式、输入点、日期/单选编辑、AI 生成、人工编辑、确认和证据查看。 |
| `src/features/docx/fill/FillCommonToolbar.jsx` | 填充工作台公共工具栏。承载资料临时上传/入库、项目库/全局库选择、召回数、修订模式、一键填充进度和导出。 |
| `src/features/docx/fill/OtherFieldFillPanel.jsx` | 普通字段填充列表。统计状态，按当前页筛选，并把生成/编辑/确认交给字段行。 |
| `src/features/docx/fill/docxXmlFill.js` | 离线 DOCX 写入与导出。直接修改 OpenXML，按日期、选择、上下文、章节和标签定位值，写入修订/书签并生成 DOCX。 |
| `src/features/docx/fill/draftState.js` | 草稿恢复兼容。把中断时的“生成中”普通/自动/复杂字段恢复为可继续状态，并迁移旧方案编写路由。 |
| `src/features/docx/fill/helpers.js` | 填充通用规则。生成字段/输入点书签名，解析日期和金额/选择值，构造日期替换文本并判断字段类型。 |
| `src/features/docx/fill/previewAndExport.js` | 浏览器 DOCX 预览填充。在 `docx-preview` DOM 中应用日期、金额、选项、空白、上下文和章节值，使预览与字段状态同步。 |

### 9.6 `src/features/docx/layout/` 公文排版

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/layout/FormatControls.jsx` | 排版控制面板。按标准域展示发现，选择可修复项，生成/执行 OnlyOffice 计划并导出。 |
| `src/features/docx/layout/analyzer/report.js` | 排版报告归一。生成待检报告，补齐 OnlyOffice 返回规则，汇总可修复/待确认并分域。 |
| `src/features/docx/layout/gbRules.js` | 国标兼容适配。将 GB/T 9704 标准暴露为旧接口，并把规则 ID 转为修复计划。 |
| `src/features/docx/layout/planner/plan.js` | 修复计划生成。筛选可执行发现，按 OnlyOffice 动作合并参数，保留人工项并生成摘要。 |
| `src/features/docx/layout/standards/gbt9704-2012.js` | GB/T 9704-2012 规则数据。定义纸张、文字、版头、主体、附件、版记、页码等条款、严重度和动作参数。 |

### 9.7 `src/features/docx/office/` OnlyOffice 前端接口层

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/office/bridge.jsx` | OnlyOffice 前端桥接主文件。创建/销毁编辑器，向当前 iframe 发送保存、排版、普通/自动/复杂字段、图片/表格、大纲和方案写入命令，按 requestId 等待回执并支持实时 Word 下载。 |
| `src/features/docx/office/connector.js` | Connector 生命周期封装。注册当前编辑器，创建/清理 Connector，报告可用状态，并带超时执行 `callCommand`。 |
| `src/features/docx/office/documentSync.js` | 文档二进制同步。优先 `downloadAs` 取得最新 DOCX，必要时触发保存并轮询服务端，通过 Buffer 比较确认变化。 |
| `src/features/docx/office/payload.js` | 字段消息构造。把标注/填充字段转成编辑器 payload，并生成日期、空白、单选场景的实时写入文本。 |
| `src/features/docx/office/solutionConnector.js` | 方案正文精确写入。按保存的段落索引和标题验证目标，替换正文或章节子树，复制 Word 样式并处理插入验证、回滚和最终位置校验。 |

### 9.8 `src/features/docx/preview/` 文档预览辅助

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/preview/outlineSearch.js` | DOCX 预览大纲与搜索。关联 OpenXML 大纲、渲染段落和页码，同步目录并执行全文高亮/切换/清理。 |
| `src/features/docx/preview/pageLayout.js` | DOCX 预览分页。编号渲染页，拆分超长段落/表格，计算页高和溢出，提供滚动定位和可见页判断。 |
| `src/features/docx/preview/pdfAuditPreview.jsx` | PDF 审查预览。使用 PDF.js 高亮器渲染，读取逐页文本和目录，提供搜索、跳页、当前页和闪烁反馈。 |

### 9.9 DOCX 运行时与结构解析

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/runtime.jsx` | 文档运行时主组件。按标注、填充、排版、审核模式选择 OnlyOffice/DOCX/PDF，统一上传、分页、缩放、搜索、大纲、滚动和字段页码回传。 |
| `src/features/docx/structure/docxStructure.js` | DOCX 结构解析。读取文档、样式和编号 XML，排除目录字段，解析标题层级、各种编号、段落和表格块。 |

### 9.10 `src/features/knowledge/` 知识表格和图片选择

| 文件 | 功能说明 |
| --- | --- |
| `src/features/knowledge/KnowledgeImagePicker.jsx` | 知识图片弹窗。在已选库检索，按来源文档分组预览，并把图片交给 OnlyOffice 插入当前光标。 |
| `src/features/knowledge/KnowledgeTablePicker.jsx` | 知识表格弹窗。检索并按 Word 来源组织表格，展示行列/单元格预览后调用 OnlyOffice 插入。 |

### 9.11 `src/features/placeholders/` 自动字段

| 文件 | 功能说明 |
| --- | --- |
| `src/features/placeholders/PlaceholderFillCards.jsx` | 自动字段填充卡片。显示值、AI 原因、原文位置，支持生成、人工修改、写入和多个书签跳转。 |
| `src/features/placeholders/fill.js` | 自动字段 AI 业务。清洗提示词、构造知识填充请求，并统一成功、编辑、AI 失败和 OnlyOffice 写入失败结果。 |
| `src/features/placeholders/variables.js` | 自动字段领域规则。创建/归一 `{{字段}}`、去重合并变量、对齐锚点、维护页码和组装卡片。 |

### 9.12 `src/features/solution-writing/` 方案编写

| 文件 | 功能说明 |
| --- | --- |
| `src/features/solution-writing/SolutionAiImageModal.jsx` | AI 生图弹窗。每次打开读取当前 OnlyOffice 大纲，以所选标题正文、全文和要求请求 PlantUML，并插入当前光标。 |
| `src/features/solution-writing/SolutionDraftingPanel.jsx` | 正文生成/写入面板。提交任务规划和全局提示词，按类展示正文，按精确索引倒序执行单段/单类/全部写入，并在变更后废弃旧定位。 |
| `src/features/solution-writing/SolutionWritingPanel.jsx` | 方案工作台主面板。编排章节模板、知识库、模块识别、规划、样式映射、任务和正文，并把规划绑定到 OnlyOffice 章节子树。 |
| `src/features/solution-writing/TaskPlanningPanel.jsx` | 任务规划面板。由大纲生成输入预览，支持简单/适中/丰富、知识召回测试和 AI 规划，并以版本阻止旧结果回写。 |
| `src/features/solution-writing/draftInsert.js` | 正文插入 payload 转换。把 section 拆成 Word 正文段落，保留样式/替换目标，并按相同目标聚合。 |
| `src/features/solution-writing/planningInsert.js` | 规划子树定位。校验根段落、结束边界、子树数量，并把合法精确目标绑定到插入 payload。 |
| `src/features/solution-writing/service.js` | 方案 AI 前端服务。统一封装模块识别、章节规划、任务规划、知识测试、正文和 PlantUML 请求。 |
| `src/features/solution-writing/taskPlanning.js` | 任务输入建模。按一级标题分组，把后续标题转成带路径、原文、父子边界、前序依赖、交付物和样式引用的任务。 |

### 9.13 `src/lib/docx/` 浏览器 OpenXML 审核与修订

| 文件 | 功能说明 |
| --- | --- |
| `src/lib/docx/formatAudit.js` | DOCX 格式审查引擎。检查页边距、字体字号、缩进间距、空行、标题/目录/表格，输出统计、证据和可修复目标。 |
| `src/lib/docx/formatRevise.js` | DOCX 格式修订引擎。按动作修改页面、正文、标题、大纲、目录、表格和 AI 计划，并重新打包 DOCX。 |
| `src/lib/docx/wordXml.js` | Word OpenXML 基础工具。加载/序列化 XML，创建/查找/删除节点和属性，解析段落样式/层级并采集结构。 |

### 9.14 `src/pages/` 页面级工作流

| 文件 | 功能说明 |
| --- | --- |
| `src/pages/AnnotateWorkspace.jsx` | 模板标注页面。组合文档、普通/自动/复杂字段和方案面板，维护模板、变量书签、跨模板复用和常用提示词。 |
| `src/pages/FillWorkspace.jsx` | 填充确认页面。组合 OnlyOffice、三类填充、资料/知识工具、修订和批量生成；优先导出实时文档，失败才走离线 XML。 |
| `src/pages/FormatAuditWorkspace.jsx` | 格式审核页面。运行脚本审查和 OnlyOffice+AI 大纲审查，管理参数/问题，执行 XML 修复并可存入模板库。 |
| `src/pages/KnowledgeBaseManagement.jsx` | 知识库管理。管理项目/全局库、资料上传删除、切片统计、指定库检索、命中高亮和原文预览。 |
| `src/pages/LayoutWorkspace.jsx` | 排版工作台。通过 OnlyOffice 执行 GB/T 9704 体检、计划、修复和实时文档导出。 |
| `src/pages/SystemSettings.jsx` | 模型设置。读取、编辑、保存和测试本地/云端 OpenAI 兼容模型与 Embedding，支持 Gemini 预设和多 Key。 |
| `src/pages/TemplateManagement.jsx` | 模板库管理。按类别/合同目录筛选，管理类别，调整分类，使用/编辑/删除模板并汇总字段和文件状态。 |

### 9.15 `src/services/` 浏览器服务与持久化

| 文件 | 功能说明 |
| --- | --- |
| `src/services/knowledgeBase.js` | 知识库 API 客户端。封装库/资料查询、创建、上传、删除，以及表格/图片检索。 |
| `src/services/templates.js` | 模板与草稿持久化。以后端模板库为权威、IndexedDB 为缓存，处理类别、自动草稿、旧数据迁移、Buffer/Base64 和敏感选区清理。 |
| `src/services/workspaceSession.js` | 工作台轻量会话。在 `localStorage` 保存并校验模块、工作台、侧栏、页码和字段，迁移旧方案入口。 |

### 9.16 `src/styles/` 样式分层

| 文件 | 功能说明 |
| --- | --- |
| `src/styles/index.css` | CSS 聚合入口。按顺序引入全部业务和响应式样式。 |
| `src/styles/base.css` | 全局字体、背景、控件、应用外壳、侧栏、品牌、顶栏和导航。 |
| `src/styles/layout.css` | 工作区公共布局与控件：标题、标签、文档/右栏网格、按钮、上传菜单和摘要。 |
| `src/styles/workspace.css` | 右侧工作区：折叠面板、三类填充标签、工具栏、修订开关、召回数和滚动区。 |
| `src/styles/preview.css` | OnlyOffice/DOCX/PDF 预览、工具栏、大纲、分页搜索、缩放、标注和浮动工具。 |
| `src/styles/fill.css` | 标注/填充字段、状态、自动字段、证据抽屉、常用文本弹窗和编辑控件。 |
| `src/styles/complex-fill.css` | 复杂字段卡片、选区列表、维护弹窗和要求编辑区。 |
| `src/styles/audit.css` | 内容/大纲审查、问题列表、修订表、配置弹窗、AI 状态和模板保存区。 |
| `src/styles/knowledge.css` | 知识库树、上传、检索、多选，以及图片/表格选择弹窗和预览。 |
| `src/styles/layout-format.css` | 排版工作台双栏、规则域、指标、计划、执行结果和导出区。 |
| `src/styles/settings.css` | 模板管理、目录、模型提供方、配置表单和消息状态。 |
| `src/styles/solution-writing.css` | 方案模板、知识范围、模块规划、任务、正文、样式映射和 AI 生图弹窗。 |
| `src/styles/responsive.css` | 窄桌面适配。调整侧栏、双栏布局、文档高度和右侧面板。 |

### 9.17 `src/utils/` 通用前端工具

| 文件 | 功能说明 |
| --- | --- |
| `src/utils/fields.js` | 字段领域规则。创建标注字段，合并模板/填充状态，推断类别/模式、写入方式、输入点、字段名和顺序。 |
| `src/utils/files.js` | 浏览器文件工具。读取资料/DOCX 文本、编码知识文件、格式化大小、生成导出名和触发 Blob/DOCX 下载。 |
| `src/utils/templates.js` | 模板分类工具。统计字段类型，推断/规范类别，生成合同两级目录和分类色调。 |

## 10. `tests/` 自动回归

| 文件 | 功能说明 |
| --- | --- |
| `tests/regressions.test.mjs` | 核心回归。覆盖会话恢复、旧草稿迁移、方案子树精确写入、API 来源、密钥脱敏、Office ID/下载安全、编辑配置和 AI 填充合同。 |
| `tests/solution-plantuml-image.test.mjs` | 生图策略回归。验证流程图活动图、功能组成 WBS、通用 UML、单图块和外部 include/错误层级拒绝。 |
| `tests/solution-writing.test.mjs` | 方案编写回归。验证丰富模式不固定三份、一目标一正文、同名类别按 `targetId` 隔离、失败关闭和完整批次知识查询。 |

## 11. 不受版本控制的运行时目录

| 目录/文件 | 内容与维护方式 |
| --- | --- |
| `data/guangfa.sqlite` | 模板库和知识库的 SQLite 主数据库，由服务端自动创建和迁移；不要手工按文本编辑。 |
| `data/templates/` | 旧模板 JSON 和迁移来源；新主数据以 SQLite 为准。 |
| `data/knowledge/` | 上传原文件、清洗文本、PDF、临时表格/图片 DOCX 和派生索引；通过知识库服务管理。 |
| `data/drafts/` | 当前工作台草稿。 |
| `data/settings/` | 本地模型设置 JSON。 |
| `data/solution-plantuml-images/` | AI 生图生成的 PNG、DOCX 和元数据。 |
| `server/logs/`、`logs/` | AI 请求、召回、模型响应和运行诊断日志；可能包含业务材料摘要，不应提交。 |
| `dist/` | `npm run build` 产生的前端静态文件，可随时重建。 |
| `node_modules/` | npm 安装依赖，以 `package-lock.json` 为准重装。 |
| `.venv-embedding/` | 本地 Embedding Python 虚拟环境，以 `requirements-embedding.txt` 和启动脚本重建。 |
| `.env.local` | 本机真实模型地址与密钥；只在本机保存，严禁提交。 |
| `tmp/`、`*_render/`、各类 `*.log` | 临时转换、渲染和服务输出；排障后可按使用情况清理。 |

## 12. 按需求定位文件

| 要修改的功能 | 优先查看 |
| --- | --- |
| 新增或调整本地 API | `server/api/routes/*.routes.js` → 对应 `server/` 业务模块；不要把业务规则写进路由。 |
| 修改 OnlyOffice 选区、书签、写入、保存 | 先读 `HANDOFF.md`，再查 `src/features/docx/office/bridge.jsx`、对应 Connector 和 `scripts/onlyoffice-*.js`。 |
| 修改普通 AI 填充 | `server/ai/fill.js`、`fill-rules.js`、`knowledge-query.js`，前端对应 `src/features/docx/fill/`。 |
| 修改知识入库或召回 | `server/knowledge/documents.js`，再按问题查 parser/chunker/zvec/text-ranking/scope/source-resolver。 |
| 修改方案任务与正文 | `server/solution-writing/generator.js`、`src/features/solution-writing/`；定位必须继续使用保存的 `targetId/styleRef`。 |
| 修改 AI 生图 | `server/solution-writing/plantuml-image.js` 和 `SolutionAiImageModal.jsx`。 |
| 修改公文排版 | `src/features/docx/layout/` 和 `scripts/onlyoffice-layout-format.js`。 |
| 修改浏览器 DOCX 审核/修复 | `src/lib/docx/formatAudit.js`、`formatRevise.js`、`wordXml.js`。 |
| 修改模板持久化 | 前端 `src/services/templates.js`，服务端 `server/template-db.js` 和模板路由。 |
| 修改模型设置 | `src/pages/SystemSettings.jsx`、`server/settings.js`、设置路由。 |

## 13. 维护原则

1. 先改责任所属文件：页面负责流程编排，组件负责展示和轻交互，业务规则放领域模块，API 协议放 service/route，OnlyOffice 调用放 bridge/adapter/注入脚本。
2. Office 类功能优先复用 OnlyOffice 原生 API 和现有桥接，不用标题模糊搜索、DOM 坐标或页码猜测代替精确书签/段落锚点。
3. `server/api/routes/` 只声明协议，不复制业务实现；`src/App.jsx` 和 `src/main.jsx` 不继续堆具体功能。
4. 修改共享 helper 后检查所有调用方，尤其写入/清除、保存/读取、申请/回滚等成对接口。
5. 修改 OnlyOffice 注入脚本后按 `HANDOFF.md` 更新缓存号、重新打补丁，并核对容器 `.js` 与 `.js.gz`。
6. 完成修改后至少运行与改动范围匹配的测试；公共链路同时运行 `npm test`、`npm run build` 和 `git diff --check`。
