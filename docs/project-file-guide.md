# 广发项目目录与文件功能说明

更新时间：2026-07-22<br>
适用分支：`feature/refactor-main`<br>
盘点基线：`167e7e1`（共覆盖 206 个受版本控制文件，包含本文自身）

## 1. 文档目的与范围

本文按真实文件目录说明项目中每个受版本控制文件包含的主要内容、承担的功能和所在业务链路，重点回答“出现某类需求或故障时应查看哪个文件”。

盘点范围包括：

- 根目录配置、依赖清单和测试样例；
- `src/` React 前端、OnlyOffice 前端桥接、DOCX 浏览器处理代码；
- `server/` 统一 API Gateway、生产服务、AI、知识库、模板库和 OnlyOffice 服务端代码；
- `scripts/` 启动、补丁、导入、索引和诊断脚本；
- `tests/` 自动回归；
- `assets/`、`docs/` 中受版本控制的样例、原型和业务知识地图。

以下内容不逐文件盘点：`node_modules/`、`dist/`、`data/`、`logs/`、`tmp/`、`.git/`、`.venv-embedding/`、本地模型和运行日志。这些是依赖、构建结果或运行时数据，不是需要日常维护的业务源码。`.env.local` 含本机配置和密钥，也不属于版本库，严禁复制到文档或提交。

## 2. 项目定位与总体结构

该项目是一套面向招投标、技术方案和 Office 文档处理的工作台。前端使用 React + Vite，文档编辑以 OnlyOffice 为主；开发和预览模式把统一 API Gateway 挂载到 Vite，生产模式由独立 Node 服务同时提供静态前端和 API。AI 支持本地 Qwen 或云端 OpenAI 兼容模型，知识检索采用 SQLite + ZVec + Embedding，方案配图使用 PlantUML。

| 功能链路 | 主要文件与调用关系 |
| --- | --- |
| 页面与工作台 | `src/main.jsx` 先通过 `ApiAuthGate.jsx` 校验身份，再挂载 `src/App.jsx`；`App.jsx` 按 viewer/editor/admin 角色编排模板标注、填充、方案编写、排版、格式审核、模板管理、知识库和设置页面。 |
| 统一 API | 浏览器经 `src/services/apiClient.js` 请求稳定入口 `/api/v1/*`；`server/api/gateway.js` 处理版本兼容和 CORS，再由 Router 完成认证、RBAC、限流、参数校验、错误信封与请求日志，最后调用具体 `*.routes.js` 和业务服务。 |
| 开发与生产运行 | `vite.config.js` 在 dev/preview 复用统一网关；`server/index.js` 和 `server/http-server.js` 负责生产配置门禁、TLS/反向代理边界、静态文件、健康探针和优雅退出。 |
| OnlyOffice | React 通过 `src/features/docx/office/bridge.jsx` 和 Connector 发命令；`scripts/onlyoffice-*.js` 在编辑器内部调用 OnlyOffice API。服务端使用 JWT、文档所有权、短期资源地址和 TTL 管理编辑配置、文件与回调。 |
| 字段填充 | 模板标注形成字段和精确书签；`server/ai/fill.js` 联合资料与知识库生成结构化结果；前端确认后通过 OnlyOffice 书签写入并下载回传保存。 |
| 知识库 | `server/knowledge/documents.js` 校验并幂等接收入库资料，经解析、切片、Embedding 和 ZVec 建索引；AI 或资料选择器通过统一检索范围取得文本、表格和图片。 |
| 方案编写 | OnlyOffice 大纲形成精确 `paragraph-N` 目标；`server/solution-writing/generator.js` 生成规划与正文；`solutionConnector.js` 只按保存的段落位置替换对应正文。 |
| 方案配图 | `SolutionAiImageModal.jsx` 支持 AI 生成和手工 PlantUML 两种模式；`plantuml-image.js` 校验并渲染单图，封装 PNG/DOCX，再通过所有者校验和短期签名 URL 提供资源。 |
| 排版与审核 | 浏览器 DOCX XML 审核代码、AI 大纲审查和 OnlyOffice 排版脚本各自负责可可靠判断的部分；修复计划只执行明确支持的动作。 |

## 3. 顶层目录

```text
广发new/
├─ assets/                       原型截图、接口样例和测试资料
├─ docs/                         项目说明、生产部署和业务流程知识地图
├─ scripts/                      启动、OnlyOffice 注入、数据导入和诊断脚本
├─ server/                       API Gateway、生产服务与后端业务逻辑
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
| `.env.example` | 环境变量示例。集中列出 LLM/Embedding 与出站代理、OnlyOffice JWT、前后端地址、API 认证与能力票据、CORS/TLS/反向代理、限流、请求超时以及临时资源 TTL；只含占位值，不含真实密钥。 |
| `.gitignore` | Git 忽略规则。排除依赖、构建产物、运行数据、日志、临时文件、Python 缓存、Embedding 虚拟环境和 `.env.local`。 |
| `HANDOFF.md` | 项目权威交接文档。记录启动方式、端口、当前功能状态、OnlyOffice 通用接口、精确定位规则和补丁缓存号；同时说明 API v1/共享网关、生产入口、AI 代理、填充状态规范及 JWT/能力票据约束。 |
| `index.html` | Vite HTML 入口。声明中文页面、viewport、产品标题、React 挂载节点，并加载 `src/main.jsx`。 |
| `package.json` | Node 项目清单。声明 ES Module、React/Vite、ZVec、GSAP、JSZip、DOCX/PDF 预览依赖，以及开发、预览、正式服务、OnlyOffice、PlantUML、Embedding、测试和构建命令；`npm start` 进入生产 Node 服务。 |
| `package-lock.json` | npm 依赖锁。固定所有直接和间接依赖的精确版本与校验值，保证不同机器安装结果一致。 |
| `requirements-embedding.txt` | 本地 Embedding Python 依赖。包含 FastAPI、Uvicorn、Sentence Transformers、Transformers、Accelerate 等。 |
| `start-all.bat` | Windows 双击启动入口。切到项目根目录后调用 `scripts/start-all-dev.ps1`，并保留窗口显示启动状态。 |
| `vite.config.js` | Vite 集成配置。加载环境变量并在开发服务器和构建预览中复用 `server/api/gateway.js`，使 dev/preview 与生产使用同一套路由、来源校验和 API 版本规则。 |
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
| `docs/api-production.md` | API 生产部署与多用户治理说明。记录 `/api/v1`、认证与角色、短期能力票据、OnlyOffice JWT、多用户数据边界、CORS/TLS/代理、安全限制、运行探针和上线门禁。 |
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
| `scripts/onlyoffice-font-aliases.conf` | OnlyOffice 容器 Fontconfig 别名配置。将没有独立字体文件的 `黑体_GB2312` 精确映射到标准黑体 `SimHei`。 |
| `scripts/onlyoffice-layout-format.js` | OnlyOffice 排版体检/修复注入脚本。读取段落与 section，分析格式并执行页面、正文、标题、落款修复，通过排版消息与前端交互。 |
| `scripts/onlyoffice-outline-probe.js` | OnlyOffice 核心注入桥。读取大纲/样式/选区/页码，管理字段书签，执行方案正文/子树替换、保存、修订及表格/图片插入；内置知识聊天改走 `/api/v1` 并只在内存转发 Bearer Token，持久化上下文会剔除凭证。 |
| `scripts/onlyoffice-placeholder-fields.js` | 占位变量注入脚本。用 `GF_PH_` 书签插入变量标签，支持跳转、选择、删除和按值替换。 |
| `scripts/patch-onlyoffice.py` | OnlyOffice 容器补丁。隐藏品牌入口，注入桥接脚本和“定制组件”，同步压缩资源与缓存号，调整 Service Worker 和原生 AI 插件行为；知识检索调用 `/api/v1` 并从内存上下文附加 Bearer Token。 |
| `scripts/rebuild-knowledge-vectors.mjs` | 知识向量索引重建。删除派生索引，批量重算向量、写入元数据、执行检索冒烟并更新文档索引状态。 |
| `scripts/samr-contracts-manifest.ps1` | 合同示范文本清单抓取。分页读取全国/地方模板，输出 JSON、CSV、Markdown 清单和统计。 |
| `scripts/samr_contract_catalog.py` | 合同范本二级分类。按标题关键词划分买卖、租赁、工程、服务等类别并输出分类目录。 |
| `scripts/start-all-dev.ps1` | 本地全栈编排。检查并后台启动 OnlyOffice 8080、PlantUML 8090、Embedding 8000、MinerU 8010、Qwen 8129、Vite 5173，等待就绪并汇总状态。 |
| `scripts/start-local-embedding.ps1` | Embedding 启动脚本。创建 Python 虚拟环境，可选安装 CPU 依赖，选择本地/镜像 BGE-M3 后运行服务。 |
| `scripts/start-local-qwen36-cpu.ps1` | Qwen CPU/Vulkan 启动脚本。校验 llama.cpp 与 GGUF，以较小上下文在 8129 提供 OpenAI 兼容接口。 |
| `scripts/start-local-qwen36-rocm.ps1` | Qwen AMD ROCm 启动脚本。配置 ROCm DLL、上下文和 GPU 层数，在 8129 启动本地模型；一键启动默认走此路径。 |
| `scripts/start-mineru.ps1` | MinerU Hybrid Docker 启动脚本。先验证 Docker 可访问 NVIDIA GPU，再构建并启动 API/VLM 服务并等待 8010 健康检查。 |
| `scripts/start-onlyoffice.ps1` | OnlyOffice 部署启动。准备 Docker、同步指定中文/方正字体和别名、安装桥接并健康检查；还会生成或读取独立 JWT Secret，校验并重建不合规容器，配置 inbox/outbox JWT、签名资源 URL 例外及无外部权限的 AI 客户端占位 Key。 |
| `scripts/start-plantuml.ps1` | PlantUML 部署启动。启动容器并映射 8090，复制中文字体、刷新缓存并验证服务。 |
| `scripts/test-qwen-vulkan-variants.ps1` | Qwen Vulkan 参数诊断。轮换 Flash Attention、卸载和 GPU 层数配置，检查健康、聊天结果、耗时和错误。 |

## 8. `server/` API 与后端业务服务

### 8.1 `server/ai/` AI 与知识召回

| 文件 | 功能说明 |
| --- | --- |
| `server/ai/chat-completions.js` | AI HTTP 与网络安全适配。统一调用 OpenAI 兼容接口，处理多 Key、Gemini 参数、超时和有界响应；本地模型只允许回环直连，云端端点执行 HTTPS、DNS 和 SSRF 校验，并支持 `AI_PROXY_URL`/标准代理变量建立 HTTP(S) CONNECT 隧道。 |
| `server/ai/chat.js` | 自研知识库聊天。校验问题和最近历史，召回知识片段后生成简短回答，过滤 OnlyOffice 宏/工具调用内容，并返回固定来源摘要。 |
| `server/ai/config.js` | AI 运行配置。集中定义默认模型、知识/资料字符上限和切片参数，并从环境变量选择本地或云端模型。 |
| `server/ai/core.js` | AI 兼容聚合出口。统一转出聊天、填充、大纲审查、检索、模型、日志和填充规则。 |
| `server/ai/debug-log.js` | AI 调试日志。将模型输入、召回、解析和最终判断以有限长度写入 `server/logs`，日志失败不影响业务。 |
| `server/ai/fill-rules.js` | 字段填充领域规则。识别各填充类型，定义模型契约，处理单位、标签、选项和证据；把 Gemini 等模型输出的“已确认/已完成/资料不足”等状态规范到持久化合同“待确认/需补充资料”。 |
| `server/ai/fill.js` | 单字段 AI 填充主流程。构造检索、合并知识库与临时资料、调用模型并后置校验；明确约束模型状态，先规范常见等价状态再校验，证据不足时返回“需补充资料”。 |
| `server/ai/format-outline.js` | Word 大纲 AI 审查。判断候选段落应降正文还是调整 L1-L3，只返回带精确索引的安全计划，不改标题文字。 |
| `server/ai/knowledge-query.js` | AI 检索规划。提炼主词/必选词/排除词，调用知识库；还负责临时资料切片、关键词评分、同义词扩展和片段格式化。 |
| `server/ai/model.js` | 模型响应适配。提供文本/严格 JSON 调用，移除思考标签，解析完整或截断 JSON，校验对象并记录用量和调试上下文。 |

### 8.2 `server/api/` 统一 API 框架

| 文件 | 功能说明 |
| --- | --- |
| `server/api/auth.js` | API 身份与 RBAC。解析 Bearer Token/API Key，以恒定时间比较凭证，规范 principal 和 viewer/editor/admin/service 角色，并处理可选认证资源。 |
| `server/api/capability.js` | 精确资源能力票据。使用 HMAC-SHA256 签发和校验有 TTL、scope、resource 绑定的短期 `accessToken`，供图片和 DOCX 等资源匿名读取。 |
| `server/api/errors.js` | API 错误模型。定义 `ApiError`，把业务异常归一为稳定 HTTP 状态、公开错误码/消息、详情和响应头，避免暴露内部异常。 |
| `server/api/gateway.js` | API Gateway。验证 Origin/CORS 与预检请求，将稳定 `/api/v1` 重写到内部路由，为旧 `/api` 返回后继版本提示，并在网关失败时生成请求 ID 和统一错误体。 |
| `server/api/http.js` | HTTP 通用读写。按字节限制并严格解码 JSON，处理超限、中止和非法 UTF-8，统一发送 JSON 或带 MIME/下载头的 Buffer，并支持 HEAD。 |
| `server/api/index.js` | API 聚合入口。一次注册认证、AI、草稿、知识库、Office、PlantUML、设置和模板路由，并用统一 Router 创建中间件。 |
| `server/api/openapi.js` | API 元数据生成。把路由 schema、角色、认证方式、MIME、并发请求头和标准错误转换为 `/api/v1` 路由清单与 OpenAPI 3.0.3。 |
| `server/api/rate-limit.js` | 进程内限流器。按 principal/客户端地址与路由维护窗口，区分读取、写入、AI 和上传额度，并返回剩余额度与重试时间。 |
| `server/api/registry.js` | 路由注册表。校验 ID、方法、路径、认证和角色策略、请求体上限，拒绝重复签名，并把 `:param` 编译为精确路径匹配。 |
| `server/api/router.js` | 请求分发器。串联请求 ID、安全响应头、认证授权、限流、query/header/body schema、HEAD/方法判断、处理器、稳定错误信封和结构化请求日志。 |
| `server/api/schema.js` | 轻量请求结构规则。规范并校验对象、数组、字符串和数值约束，报告精确字段路径，同时把同一 schema 转成 OpenAPI 定义。 |

### 8.3 `server/api/routes/` 接口声明

| 文件 | 功能说明 |
| --- | --- |
| `server/api/routes/ai.routes.js` | AI 路由协议。全部路由声明 editor 角色，配图资源也可凭精确能力票据访问；同时声明请求 schema 与响应 MIME，注册字段填充、大纲、聊天、检索、方案规划/正文/生图和图片 PNG/DOCX。 |
| `server/api/routes/auth.routes.js` | 登录态路由。提供 `GET /api/v1/auth/me`，返回当前 principal 的 ID、角色和认证方式，供前端认证门禁和权限界面使用。 |
| `server/api/routes/draft.routes.js` | 草稿路由。按当前认证身份提供工作台草稿读取与保存，写接口要求 editor 角色并受请求 schema/大小约束。 |
| `server/api/routes/knowledge.routes.js` | 知识库路由。覆盖库与资料增删查、幂等上传、重建索引、原文件、表格和图片资源；声明角色、大小限制、`Idempotency-Key` 与短期资源访问策略。 |
| `server/api/routes/office.routes.js` | OnlyOffice 路由。声明健康、文档创建/所有者读取、JWT 保存回调、受限下载代理和大纲探针；文件端点可使用精确短期票据。 |
| `server/api/routes/plantuml.routes.js` | 手工 PlantUML 路由。接收单个完整且不含外部 include/import 的源码，调用本地服务渲染并返回受保护的配图资源。 |
| `server/api/routes/settings.routes.js` | 系统模型设置路由。仅 admin 可读取、脱敏保存和测试 LLM/Embedding/代理配置，并声明严格请求 schema。 |
| `server/api/routes/templates.routes.js` | 共享模板库路由。提供库/类型/模板读写；写操作要求 editor，认证模式下还必须携带 `If-Match`，通过 revision/ETag 阻止多用户静默覆盖。 |

### 8.4 `server/knowledge/` 知识库实现

| 文件 | 功能说明 |
| --- | --- |
| `server/knowledge/chunker.js` | 文档切片。旧文本按页和段落聚合；MinerU 结果按结构块与标题树切片，保留完整表格并注入章节路径。 |
| `server/knowledge/db.js` | 知识库 SQLite 初始化。创建库、资料、页面、段落、切片和上传幂等表/索引，迁移旧 JSON，并初始化默认项目库/全局库。 |
| `server/knowledge/documents.js` | 知识文档主服务。先做类型/内容安全校验，再按“知识库+身份+幂等键”预留、内容去重、解析、切片、Embedding 和 ZVec 入库；并处理并发上传、删除、重建和检索回溯。 |
| `server/knowledge/docx-convert.js` | DOCX 转 PDF 的 OnlyOffice 适配。用带 inbox JWT 和短期文档地址的转换命令调用 `ConvertService.ashx`，有界下载 PDF 以保留页码。 |
| `server/knowledge/images.js` | DOCX 图片提取。安全读取 OOXML 媒体并验证栅格魔数，识别标题/尺寸/页码，支持检索及带能力票据的预览和单图片 DOCX。 |
| `server/knowledge/mineru-client.js` | MinerU 3.4.4 适配。提交/轮询 Hybrid 任务、安全展开 ZIP 产物，并把 content list V1/V2 归一为页、块、标题级别和 bbox。 |
| `server/knowledge/parser.js` | 有界资料解析调度。默认非 TXT 文件交给 MinerU；只有 `KNOWLEDGE_PARSER=legacy` 才恢复旧 PDF/DOCX 解析。 |
| `server/knowledge/pdf-text.js` | PDF 分页文本抽取。使用 `pdfjs-dist` 在页数、文本量和截止时间限制内逐页读取并规范空白。 |
| `server/knowledge/scope.js` | 检索范围控制。根据显式项目库/全局库选择计算可访问库和切片；未选择时不隐式全库搜索。 |
| `server/knowledge/source-resolver.js` | 原文定位。按文档、页码、段落范围回查 SQLite，必要时退到整页，并生成可展示来源位置。 |
| `server/knowledge/tables.js` | DOCX 表格提取。安全解析表格、合并单元格、标题和页码，支持检索并生成带短期能力票据的单表格 DOCX 供 OnlyOffice 插入。 |
| `server/knowledge/text-ranking.js` | 关键词排序。清理查询、扩展招投标词，对短语和关键词评分，用于基础检索与混合召回。 |
| `server/knowledge/zvec-store.js` | ZVec 适配。定义向量/全文/元数据 schema，负责索引增删，并用向量与 FTS 的 RRF 融合返回限定范围切片。 |

### 8.5 `server/solution-writing/` 方案生成

| 文件 | 功能说明 |
| --- | --- |
| `server/solution-writing/generator.js` | 方案编写核心。识别功能模块、生成章节规划、任务规划和正文；丰富模式按证据拆分 1-4 个任务，再按精确 `targetId` 聚合为一份正文。缺失、未知、重复、标题不一致、空白或占位正文全部失败关闭。 |
| `server/solution-writing/plantuml-image.js` | 方案配图服务。AI 模式强制流程图使用活动图、功能组成使用 WBS，也支持校验并渲染手工单图；生成 PNG/DOCX 后按所有者隔离，以短期签名 URL 提供资源，并按 TTL 和数量清理。 |

### 8.6 `server/` 根业务服务

| 文件 | 功能说明 |
| --- | --- |
| `server/document-security.js` | 文档与图片安全边界。校验 DOCX/PDF/TXT 的扩展名、MIME、魔数和字节上限，限制 DOCX ZIP 条目/解压量/压缩比并拒绝宏；同时只放行验证过的栅格图片。 |
| `server/draft.js` | 草稿持久化。认证用户按身份哈希隔离到 `data/drafts/by-actor/`，同一草稿串行原子写入；未认证开发模式继续兼容 `data/drafts/current.json`。 |
| `server/embedding.js` | Embedding 适配。复用 AI 安全网络请求层调用 OpenAI 兼容 `/embeddings`，执行本地/云端端点策略、代理、超时和响应上限，并校验数量及向量维度。 |
| `server/http-server.js` | 生产 HTTP(S) 服务。启动前检查 dist、认证和独立强密钥，复用 API Gateway，托管 SPA/静态资源，设置 CSP/缓存/安全头，提供 health/ready 探针、TLS 边界和优雅退出。 |
| `server/index.js` | 正式服务入口。加载 `.env.local`，固定 production 部署模式，再动态启动 `server/http-server.js`。 |
| `server/knowledge-base.js` | 知识库兼容入口。旧 middleware 转向统一 API，同时继续导出搜索服务。 |
| `server/office.js` | OnlyOffice 服务端集成。安全接收 DOCX，记录不可猜测 ID、所有者和 TTL，签发编辑配置/文件 JWT；校验并串行处理回调、防重放和旧保存，原子落盘，限制 Document Server 下载来源并清理过期/超量文档。 |
| `server/outline-probe.js` | 大纲调试持久化。保存最近一次 OnlyOffice 原生大纲到 `data/debug` 并提供读取。 |
| `server/settings.js` | 系统模型设置。合并 JSON 和环境变量，管理本地/云端 LLM、Embedding 与 AI 出站代理，校验端点策略、脱敏 Key、保存 `.env.local` 并测试连接；模型地址改变时不沿用旧脱敏 Key。 |
| `server/template-db.js` | 共享模板 SQLite 主服务。管理模板库、类型、DOCX 和字段/锚点，启用 WAL/busy timeout；以一致快照、全库 revision/ETag 和事务内 `If-Match` 校验防止并发覆盖。 |

## 9. `src/` React 前端与浏览器文档逻辑

> 本章按当前源码职责填写。`src/main.jsx` 只负责认证门禁与挂载，跨工作台状态集中在 `src/App.jsx`；具体业务应继续放在对应 `features/`、`pages/`、`services/` 中。

### 9.1 入口、根应用、通用组件和常量

| 文件 | 功能说明 |
| --- | --- |
| `src/main.jsx` | React 启动入口。加载全局样式，以 `ApiAuthGate` 包裹 `App`，把已验证 principal 和退出动作传给根应用。 |
| `src/App.jsx` | 前端根应用和工作流编排。按 principal 角色控制编辑工作台和系统设置，管理模板/草稿/知识范围与字段状态，连接 OnlyOffice 和导出；向编辑器传当前内存凭证，并在模板 revision 冲突时重新加载权威状态。 |
| `src/components/ApiAuthGate.jsx` | API 认证门禁。启动时探测 `/api/v1/auth/me`，支持输入、验证和清除当前标签页 Token，区分 401 与服务不可用，并把可交互 principal 传给应用。 |
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
| `src/features/docx/fill/FillCommonToolbar.jsx` | 填充工作台公共工具栏。承载资料临时上传/入库、项目库/全局库选择、召回数、修订模式、一键填充/取消、导出，并在外部点击时收起知识库菜单。 |
| `src/features/docx/fill/OtherFieldFillPanel.jsx` | 普通字段填充列表。统计状态，按当前页筛选，并把生成/编辑/确认交给字段行。 |
| `src/features/docx/fill/docxXmlFill.js` | 离线 DOCX 写入与导出。直接修改 OpenXML，按日期、选择、上下文、章节和标签定位值，写入修订/书签并生成 DOCX。 |
| `src/features/docx/fill/draftState.js` | 草稿恢复兼容。把中断时的“生成中”普通/自动/复杂字段恢复为可继续状态，并迁移旧方案编写路由。 |
| `src/features/docx/fill/helpers.js` | 填充通用规则。生成字段/输入点书签名，解析日期和金额/选择值，构造日期替换文本并判断字段类型。 |
| `src/features/docx/fill/previewAndExport.js` | 浏览器 DOCX 预览填充。在 `docx-preview` DOM 中应用日期、金额、选项、空白、上下文和章节值，使预览与字段状态同步。 |

### 9.6 `src/features/fill/` 填充工作流编排

| 文件 | 功能说明 |
| --- | --- |
| `src/features/fill/FillWorkspaceContext.jsx` | 填充页局部 Context。分离只读状态与语义动作，供普通、自动和复杂字段卡片消费，避免页面继续向下透传大量 props。 |
| `src/features/fill/useFillTaskController.js` | 批量填充任务生命周期。管理唯一活动任务、`AbortController`、进度、取消和卸载清理，防止旧任务覆盖新状态。 |
| `src/features/fill/useFillWorkflow.js` | 三类批量填充业务编排。筛选待处理项、校验精确定位、串行传递取消信号，并在当前文档身份仍有效时同步 DOCX。 |
| `src/features/fill/useFillWorkspaceViewModel.js` | 填充页视图模型。计算当前页字段、三类标签数量、一键填充文案和按钮可用性，使页面专注布局组合。 |

### 9.7 `src/features/docx/layout/` 公文排版

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/layout/FormatControls.jsx` | 排版控制面板。按标准域展示发现，选择可修复项，生成/执行 OnlyOffice 计划并导出。 |
| `src/features/docx/layout/analyzer/report.js` | 排版报告归一。生成待检报告，补齐 OnlyOffice 返回规则，汇总可修复/待确认并分域。 |
| `src/features/docx/layout/gbRules.js` | 国标兼容适配。将 GB/T 9704 标准暴露为旧接口，并把规则 ID 转为修复计划。 |
| `src/features/docx/layout/planner/plan.js` | 修复计划生成。筛选可执行发现，按 OnlyOffice 动作合并参数，保留人工项并生成摘要。 |
| `src/features/docx/layout/standards/gbt9704-2012.js` | GB/T 9704-2012 规则数据。定义纸张、文字、版头、主体、附件、版记、页码等条款、严重度和动作参数。 |

### 9.8 `src/features/docx/office/` OnlyOffice 前端接口层

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/office/bridge.jsx` | OnlyOffice 前端桥接主文件。创建/销毁编辑器，以精确 Origin 向 iframe 发送保存、排版、字段、图片/表格、大纲和方案命令；通过统一 API 客户端读取受保护资源并支持实时 Word 下载。 |
| `src/features/docx/office/connector.js` | Connector 生命周期封装。注册当前编辑器，创建/清理 Connector，报告可用状态，并带超时执行 `callCommand`。 |
| `src/features/docx/office/documentSync.js` | 文档二进制同步。优先 `downloadAs` 取得最新 DOCX，必要时触发保存，再以认证 API 轮询服务端并通过 Buffer 比较确认变化。 |
| `src/features/docx/office/payload.js` | 字段消息构造。把标注/填充字段转成编辑器 payload，并生成日期、空白、单选场景的实时写入文本。 |
| `src/features/docx/office/solutionConnector.js` | 方案正文精确写入。按保存的段落索引和标题验证目标，替换正文或章节子树，复制 Word 样式并处理插入验证、回滚和最终位置校验。 |

### 9.9 `src/features/docx/preview/` 文档预览辅助

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/preview/outlineSearch.js` | DOCX 预览大纲与搜索。关联 OpenXML 大纲、渲染段落和页码，同步目录并执行全文高亮/切换/清理。 |
| `src/features/docx/preview/pageLayout.js` | DOCX 预览分页。编号渲染页，拆分超长段落/表格，计算页高和溢出，提供滚动定位和可见页判断。 |
| `src/features/docx/preview/pdfAuditPreview.jsx` | PDF 审查预览。使用 PDF.js 高亮器渲染，读取逐页文本和目录，提供搜索、跳页、当前页和闪烁反馈。 |

### 9.10 DOCX 运行时与结构解析

| 文件 | 功能说明 |
| --- | --- |
| `src/features/docx/runtime.jsx` | 文档运行时主组件。按标注、填充、排版、审核模式选择 OnlyOffice/DOCX/PDF，统一上传、分页、缩放、搜索、大纲、滚动和字段页码回传。 |
| `src/features/docx/structure/docxStructure.js` | DOCX 结构解析。读取文档、样式和编号 XML，排除目录字段，解析标题层级、各种编号、段落和表格块。 |

### 9.11 `src/features/knowledge/` 知识表格和图片选择

| 文件 | 功能说明 |
| --- | --- |
| `src/features/knowledge/KnowledgeImagePicker.jsx` | 知识图片弹窗。在已选库检索，按来源文档分组，通过受保护资源 Hook 加载预览，并把图片交给 OnlyOffice 插入当前光标。 |
| `src/features/knowledge/KnowledgeTablePicker.jsx` | 知识表格弹窗。检索并按 Word 来源组织表格，展示行列/单元格预览后调用 OnlyOffice 插入。 |

### 9.12 `src/features/placeholders/` 自动字段

| 文件 | 功能说明 |
| --- | --- |
| `src/features/placeholders/PlaceholderFillCards.jsx` | 自动字段填充卡片。显示值、AI 原因、原文位置，支持生成、人工修改、写入和多个书签跳转。 |
| `src/features/placeholders/fill.js` | 自动字段 AI 业务。清洗提示词、构造知识填充请求，并统一成功、编辑、AI 失败和 OnlyOffice 写入失败结果。 |
| `src/features/placeholders/variables.js` | 自动字段领域规则。创建/归一 `{{字段}}`、去重合并变量、对齐锚点、维护页码和组装卡片。 |

### 9.13 `src/features/solution-writing/` 方案编写

| 文件 | 功能说明 |
| --- | --- |
| `src/features/solution-writing/SolutionAiImageModal.jsx` | 配图生成弹窗。AI 页签读取 OnlyOffice 大纲并按标题上下文生成 PlantUML；手工页签校验并渲染粘贴源码。两种模式均以受保护 Blob 预览/下载，并可插入当前光标。 |
| `src/features/solution-writing/SolutionDraftingPanel.jsx` | 正文生成/写入面板。提交任务规划和全局提示词，按类展示正文，按精确索引倒序执行单段/单类/全部写入，并在变更后废弃旧定位。 |
| `src/features/solution-writing/SolutionWritingPanel.jsx` | 方案工作台主面板。编排章节模板、知识库、模块识别、规划、样式映射、任务和正文，并把规划绑定到 OnlyOffice 章节子树。 |
| `src/features/solution-writing/TaskPlanningPanel.jsx` | 任务规划面板。由大纲生成输入预览，支持简单/适中/丰富、知识召回测试和 AI 规划，并以版本阻止旧结果回写。 |
| `src/features/solution-writing/draftInsert.js` | 正文插入 payload 转换。把 section 拆成 Word 正文段落，保留样式/替换目标，并按相同目标聚合。 |
| `src/features/solution-writing/planningInsert.js` | 规划子树定位。校验根段落、结束边界、子树数量，并把合法精确目标绑定到插入 payload。 |
| `src/features/solution-writing/service.js` | 方案 AI 前端服务。通过统一 API 客户端封装模块识别、章节规划、任务规划、知识测试、正文、AI 配图和手工 PlantUML 渲染请求。 |
| `src/features/solution-writing/taskPlanning.js` | 任务输入建模。按一级标题分组，把后续标题转成带路径、原文、父子边界、前序依赖、交付物和样式引用的任务。 |

### 9.14 `src/lib/docx/` 浏览器 OpenXML 审核与修订

| 文件 | 功能说明 |
| --- | --- |
| `src/lib/docx/formatAudit.js` | DOCX 格式审查引擎。检查页边距、字体字号、缩进间距、空行、标题/目录/表格，输出统计、证据和可修复目标。 |
| `src/lib/docx/formatRevise.js` | DOCX 格式修订引擎。按动作修改页面、正文、标题、大纲、目录、表格和 AI 计划，并重新打包 DOCX。 |
| `src/lib/docx/wordXml.js` | Word OpenXML 基础工具。加载/序列化 XML，创建/查找/删除节点和属性，解析段落样式/层级并采集结构。 |

### 9.15 `src/pages/` 页面级工作流

| 文件 | 功能说明 |
| --- | --- |
| `src/pages/AnnotateWorkspace.jsx` | 模板标注页面。组合文档、普通/自动/复杂字段和方案面板，维护模板、变量书签、跨模板复用和常用提示词。 |
| `src/pages/FillWorkspace.jsx` | 填充确认页面。组合 OnlyOffice、三类填充、资料/知识工具、修订和批量生成；优先导出实时文档，失败才走离线 XML。 |
| `src/pages/FormatAuditWorkspace.jsx` | 格式审核页面。运行脚本审查和 OnlyOffice+AI 大纲审查，管理参数/问题，执行 XML 修复并可存入模板库。 |
| `src/pages/KnowledgeBaseManagement.jsx` | 知识库管理。管理项目/全局库、资料上传删除、切片统计、指定库检索、命中高亮和认证原文预览；viewer 只显示读取能力。 |
| `src/pages/LayoutWorkspace.jsx` | 排版工作台。通过 OnlyOffice 执行 GB/T 9704 体检、计划、修复和实时文档导出。 |
| `src/pages/SystemSettings.jsx` | 管理员模型设置。读取、编辑、保存和测试本地/云端 OpenAI 兼容模型、Embedding 与云端出站代理，支持 Gemini 预设、多 Key 和代理地址校验。 |
| `src/pages/TemplateManagement.jsx` | 模板库管理。按类别/合同目录筛选，管理类别、分类和模板并汇总字段/文件状态；viewer 只读，写冲突由上层重载最新 revision。 |

### 9.16 `src/hooks/` 与 `src/services/` 浏览器服务和持久化

| 文件 | 功能说明 |
| --- | --- |
| `src/hooks/useApiAssetUrl.js` | 受保护图片 Hook。识别 API 资源地址，通过认证客户端下载 Blob，创建浏览器 Object URL，并在来源变化或卸载时取消请求、释放 URL。 |
| `src/services/apiClient.js` | 统一浏览器 API 客户端。将旧 `/api` 规范为 `/api/v1`，处理 Base URL、sessionStorage Bearer、请求 ID、JSON/二进制、AI/普通超时、取消、稳定错误和 401 失效通知。 |
| `src/services/knowledgeBase.js` | 知识库 API 客户端。通过统一客户端封装库/资料查询、创建、删除及表格/图片检索；上传自动携带稳定 `Idempotency-Key`。 |
| `src/services/templates.js` | 模板与草稿持久化。以后端为权威、IndexedDB 为缓存，处理迁移和敏感数据清理；缓存模板 ETag，写入携带 `If-Match`，并把 412/428 转为可恢复的并发冲突。 |
| `src/services/workspaceSession.js` | 工作台轻量会话。在 `localStorage` 保存并校验模块、工作台、侧栏、页码和字段，迁移旧方案入口。 |

### 9.17 `src/styles/` 样式分层

| 文件 | 功能说明 |
| --- | --- |
| `src/styles/index.css` | CSS 聚合入口。按顺序引入全部业务和响应式样式。 |
| `src/styles/base.css` | 全局字体、背景、控件、应用外壳、侧栏、品牌、顶栏和导航，以及 API 登录/服务不可用门禁页面。 |
| `src/styles/layout.css` | 工作区公共布局与控件：标题、标签、文档/右栏网格、按钮、上传菜单、摘要，以及当前认证身份和退出动作。 |
| `src/styles/workspace.css` | 右侧工作区：折叠面板、三类填充标签、工具栏、修订开关、召回数和滚动区。 |
| `src/styles/preview.css` | OnlyOffice/DOCX/PDF 预览、工具栏、大纲、分页搜索、缩放、标注和浮动工具。 |
| `src/styles/fill.css` | 标注/填充字段、状态、自动字段、证据抽屉、常用文本弹窗和编辑控件。 |
| `src/styles/complex-fill.css` | 复杂字段卡片、选区列表、维护弹窗和要求编辑区。 |
| `src/styles/audit.css` | 内容/大纲审查、问题列表、修订表、配置弹窗、AI 状态和模板保存区。 |
| `src/styles/knowledge.css` | 知识库树、上传、检索、多选，以及图片/表格选择弹窗和预览。 |
| `src/styles/layout-format.css` | 排版工作台双栏、规则域、指标、计划、执行结果和导出区。 |
| `src/styles/settings.css` | 模板管理、目录、模型提供方、配置表单和消息状态。 |
| `src/styles/solution-writing.css` | 方案模板、知识范围、模块规划、任务、正文、样式映射，以及 AI/手工 PlantUML 双模式配图弹窗。 |
| `src/styles/responsive.css` | 窄桌面适配。调整侧栏、双栏布局、文档高度和右侧面板。 |

### 9.18 `src/utils/` 通用前端工具

| 文件 | 功能说明 |
| --- | --- |
| `src/utils/fields.js` | 字段领域规则。创建标注字段，合并模板/填充状态，推断类别/模式、写入方式、输入点、字段名和顺序。 |
| `src/utils/files.js` | 浏览器文件工具。读取资料/DOCX 文本、编码知识文件、格式化大小、生成导出名和触发 Blob/DOCX 下载。 |
| `src/utils/templates.js` | 模板分类工具。统计字段类型，推断/规范类别，生成合同两级目录和分类色调。 |

## 10. `tests/` 自动回归

| 文件 | 功能说明 |
| --- | --- |
| `tests/api-capability.test.mjs` | 资源票据回归。验证签名声明、规范 URL、TTL 上限、过期/篡改/跨资源拒绝、生产强密钥，以及 principal 或精确票据二选一访问。 |
| `tests/api-client.test.mjs` | 浏览器 API 客户端竞态回归。验证旧请求返回的 401 不会清除用户随后写入的新凭证。 |
| `tests/api-core.test.mjs` | API 核心回归。覆盖严格 JSON/字节限制、安全头、标准协议错误、开发/生产认证、RBAC、运行时 schema、OpenAPI 同源定义和路由防重。 |
| `tests/api-gateway.test.mjs` | 网关回归。验证 `/api/v1` 与旧地址兼容、CORS/预检，以及按 principal 或匿名客户端地址隔离的限流和重试元数据。 |
| `tests/api-routes-contract.test.mjs` | 业务接口合同回归。核对生产角色、OpenAPI JSON/原始 DOCX/MIME 定义，以及 `If-Match`、幂等键等并发前置条件。 |
| `tests/api-security.test.mjs` | 安全边界回归。覆盖云端 SSRF/Fake-IP/CONNECT 代理、模型 Key 切换、DOCX/SVG、OnlyOffice JWT 回调防重放、文档所有权和转换签名。 |
| `tests/fill-task-controller.test.mjs` | 填充任务回归。验证新批量任务会废弃旧任务，且被取消的旧任务不能回收新任务的进度与活动状态。 |
| `tests/multi-user-state.test.mjs` | 多用户状态回归。验证草稿按身份原子隔离、模板 revision 原子推进，以及知识上传幂等、冲突与删除后不可检索。 |
| `tests/production-server.test.mjs` | 生产服务回归。验证 SPA/静态资源、探针和安全响应头，并确保认证、OnlyOffice JWT 与能力票据强密钥缺失或复用时启动失败。 |
| `tests/regressions.test.mjs` | 核心回归。覆盖会话恢复、方案子树精确写入、API 来源、密钥脱敏、Office 配置，以及 Gemini 填充状态别名规范化和结果合同。 |
| `tests/solution-plantuml-image.test.mjs` | 配图回归。验证活动图/WBS/通用 UML 策略、手工单图、外部 include/错误层级拒绝，以及生成资源的所有者和签名匿名访问。 |
| `tests/solution-writing.test.mjs` | 方案编写回归。验证丰富模式不固定三份、一目标一正文、同名类别按 `targetId` 隔离、失败关闭和完整批次知识查询。 |

## 11. 不受版本控制的运行时目录

| 目录/文件 | 内容与维护方式 |
| --- | --- |
| `data/guangfa.sqlite` | 模板库和知识库的 SQLite 主数据库，由服务端自动创建和迁移；不要手工按文本编辑。 |
| `data/templates/` | 旧模板 JSON 和迁移来源；新主数据以 SQLite 为准。 |
| `data/knowledge/` | 上传原文件、清洗文本、PDF、临时表格/图片 DOCX 和派生索引；通过知识库服务管理。 |
| `data/drafts/current.json` | 未认证本地开发模式的兼容草稿。 |
| `data/drafts/by-actor/` | 认证用户草稿。文件名是 principal ID 的 SHA-256，不直接暴露身份。 |
| `data/settings/` | 本地模型设置 JSON。 |
| `data/solution-plantuml-images/` | AI/手工 PlantUML 生成的 PNG、DOCX 和所有者/过期元数据，由服务按 TTL 和容量清理。 |
| 系统临时目录 `guangfa-office-documents/` | OnlyOffice 临时 DOCX 与会话元数据，包含 owner、文档 key 和过期时间，由服务自动清理。 |
| `server/logs/`、`logs/` | AI 请求、召回、模型响应和运行诊断日志；可能包含业务材料摘要，不应提交。 |
| `dist/` | `npm run build` 产生的前端静态文件，可随时重建。 |
| `node_modules/` | npm 安装依赖，以 `package-lock.json` 为准重装。 |
| `.venv-embedding/` | 本地 Embedding Python 虚拟环境，以 `requirements-embedding.txt` 和启动脚本重建。 |
| `.env.local` | 本机真实模型地址与密钥；只在本机保存，严禁提交。 |
| `tmp/`、`*_render/`、各类 `*.log` | 临时转换、渲染和服务输出；排障后可按使用情况清理。 |

## 12. 按需求定位文件

| 要修改的功能 | 优先查看 |
| --- | --- |
| 新增或调整业务 API | `server/api/routes/*.routes.js` → 对应 `server/` 业务模块 → `src/services/apiClient.js`/领域 service；稳定客户端地址使用 `/api/v1`。 |
| 修改认证、角色或资源票据 | `server/api/auth.js`、`capability.js`、`registry.js`、对应 routes，以及 `ApiAuthGate.jsx`。 |
| 修改 API 版本、CORS 或限流 | `server/api/gateway.js`、`router.js`、`rate-limit.js`、`schema.js`、`errors.js`。 |
| 修改生产部署 | `docs/api-production.md`、`.env.example`、`server/index.js`、`server/http-server.js`。 |
| 修改上传/文档安全限制 | `server/document-security.js`，再查知识解析、Office 或具体资源调用方。 |
| 修改 OnlyOffice 选区、书签、写入、保存 | 先读 `HANDOFF.md`，再查 `src/features/docx/office/bridge.jsx`、对应 Connector 和 `scripts/onlyoffice-*.js`。 |
| 修改普通 AI 填充 | `server/ai/fill.js`、`fill-rules.js`、`knowledge-query.js`，前端对应 `src/features/docx/fill/`。 |
| 修改知识入库或召回 | `server/knowledge/documents.js`，再按问题查 parser/chunker/zvec/text-ranking/scope/source-resolver。 |
| 修改方案任务与正文 | `server/solution-writing/generator.js`、`src/features/solution-writing/`；定位必须继续使用保存的 `targetId/styleRef`。 |
| 修改 AI/PlantUML 配图 | `server/solution-writing/plantuml-image.js`、PlantUML route、`SolutionAiImageModal.jsx` 和 `useApiAssetUrl.js`。 |
| 修改公文排版 | `src/features/docx/layout/` 和 `scripts/onlyoffice-layout-format.js`。 |
| 修改浏览器 DOCX 审核/修复 | `src/lib/docx/formatAudit.js`、`formatRevise.js`、`wordXml.js`。 |
| 修改模板持久化或并发控制 | 前端 `src/services/templates.js`，服务端 `server/template-db.js` 和模板路由；保持 ETag/`If-Match` 成对。 |
| 修改模型设置或 AI 出站代理 | `src/pages/SystemSettings.jsx`、`server/settings.js`、`server/ai/chat-completions.js` 和设置路由。 |

## 13. 维护原则

1. 先改责任所属文件：页面负责流程编排，组件负责展示和轻交互，业务规则放领域模块，API 协议放 service/route，OnlyOffice 调用放 bridge/adapter/注入脚本。
2. Office 类功能优先复用 OnlyOffice 原生 API 和现有桥接，不用标题模糊搜索、DOM 坐标或页码猜测代替精确书签/段落锚点。
3. `server/api/routes/` 只声明协议，不复制业务实现；新接口使用 `/api/v1` 和 `src/services/apiClient.js`；`src/App.jsx` 和 `src/main.jsx` 不继续堆具体功能。
4. 修改共享 helper 后检查所有调用方，尤其写入/清除、保存/读取、申请/回滚等成对接口。
5. 修改 OnlyOffice 注入脚本后按 `HANDOFF.md` 更新缓存号、重新打补丁，并核对容器 `.js` 与 `.js.gz`。
6. 完成修改后至少运行与改动范围匹配的测试；公共链路同时运行 `npm test`、`npm run build` 和 `git diff --check`。
