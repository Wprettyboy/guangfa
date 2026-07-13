# 项目交接文档

更新时间：2026-07-10

## 新会话先读

本项目根目录：`C:\Users\23811\Desktop\广发new`

当前已是可用 git 仓库，远端为 `https://github.com/Wprettyboy/guangfa.git`。当前工作分支为 `feature/refactor-main`，跟踪 `origin/feature/refactor-main`。改代码前先读文件，避免误改用户未提交内容。

不要把 `.env.local` 里的云端 API Key 发到聊天窗口或文档里。

Git 代码管理已切到 `https://github.com/Wprettyboy/guangfa.git`。以后代码发生变动，完成必要检查后记得 `git commit` 并推送到远端，除非用户明确要求暂不提交。

## Office 类功能开发规则

凡是新增或修改类似 Office 办公能力的功能，先做能力拆解，再查可复用接口：

1. 先查本交接文档的 `OnlyOffice 通用接口与本地封装`。
2. 再查项目内已有 OnlyOffice bridge、注入脚本、服务端 Office API 和本地 OnlyOffice SDK/容器资源。
3. 如果交接文档和本地资源没有记录该能力，必须联网检索 OnlyOffice 是否具备该能力、对应 API 名称和调用方式。
4. 能用 OnlyOffice 现有接口或项目已有封装完成的，不要先写 DOM 文本推断、页码推断、坐标推断或自造文档编辑逻辑。
5. 查到的通用接口和调用方式要沉淀回本节或 `OnlyOffice 通用接口与本地封装`，但不要把具体场景规则写进通用接口文档。

## 启动方式

优先一键启动：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-all-dev.ps1
```

单独启动：

```powershell
npm run dev
npm run office
npm run plantuml
npm run embedding:skip-install
```

服务端口：

- Web：`http://127.0.0.1:5173`
- OnlyOffice：`http://127.0.0.1:8080`
- PlantUML：`http://127.0.0.1:8090`
- 本地 Qwen：`http://127.0.0.1:8129/v1`
- Embedding：`http://127.0.0.1:8000/v1`

常用检查：

```powershell
npm run build
node --check server\api\routes\ai.routes.js
node --check server\office.js
Invoke-WebRequest http://127.0.0.1:8080/healthcheck -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:8129/v1/models
```

## 文件地图

### 先看这里

- `src/main.jsx`：前端入口，只做 React 挂载；不要再把业务逻辑堆回这里。
- `src/App.jsx`：根状态与工作台编排，目前仍偏重；只放跨页面状态、批量填充编排、草稿保存这类上层逻辑。
- `src/pages/AnnotateWorkspace.jsx`：模板标注与方案编写工作台页面组合；两者复用同一个 `DocumentFrame(mode="annotate")`，切换工作台时只切换右侧业务面板。
- `src/pages/FillWorkspace.jsx`：填充工作台页面组合。
- `src/pages/LayoutWorkspace.jsx`：排版工作台页面组合，复用 OnlyOffice 预览并调用排版 bridge。
- `src/pages/FormatAuditWorkspace.jsx`：格式审核页面组合。

### 填充工作台高频区

- `src/features/docx/fill/FieldControls.jsx`：字段卡片、AI 填充按钮、编辑/确认、依据原文展示。
- `src/features/docx/fill/FillCommonToolbar.jsx`：填充工作台顶部公共工具条，承载上传资料、一键填充、导出和知识库选择。
- `src/features/docx/fill/OtherFieldFillPanel.jsx`：旧模板字段/其他类型字段填充列表。
- `src/features/docx/fill/helpers.js`：填充字段类型、写入模式、输入点/选区判断等前端辅助。
- `src/features/docx/fill/previewAndExport.js`：填充工作台的浏览器预览写入、DOM 选区/空白定位。
- `src/features/docx/fill/docxXmlFill.js`：填充导出兜底的 DOCX XML 回写、修订痕迹、选择/日期/标签写入。
- `src/styles/fill.css`：填充工作台样式；字段卡片、依据原文、筛选条等样式优先改这里。

### 排版工作台

- `src/pages/LayoutWorkspace.jsx`：排版工作台编排，上传 DOCX、触发格式体检、生成修复计划、调用 OnlyOffice 执行修复并导出。
- `src/features/docx/layout/standards/gbt9704-2012.js`：GB/T 9704-2012 规则库，按纸张版面、基础文字、版头、主体、附件、版记、页码、横排表格、特定格式拆分；只放标准条款、修复能力和规则参数。
- `src/features/docx/layout/analyzer/report.js`：格式体检报告归一、缺失规则补齐和按规则域分组。
- `src/features/docx/layout/planner/plan.js`：把可自动修复的 findings 转成 OnlyOffice 可执行 plan；需人工确认的规则不强行自动执行。
- `src/features/docx/layout/gbRules.js`：旧导入兼容层，不再作为真实规则来源。
- `src/features/docx/layout/FormatControls.jsx`：排版工作台右侧治理面板，展示格式体检、规则域、修复计划和执行结果。
- `src/styles/layout-format.css`：排版工作台样式。
- `scripts/onlyoffice-layout-format.js`：注入 OnlyOffice 的排版执行脚本，接收 `analyze-layout-format` 做文档结构体检，接收 `apply-layout-format` 调用 OnlyOffice 文档 API 执行自动修复动作。

### OnlyOffice / DOCX 高频区

- `src/features/docx/runtime.jsx`：DOCX/OnlyOffice 运行时主组件，只导出 `DocumentFrame`、页码显示和少量运行时工具；不要再当总出口文件。
- `src/features/docx/office/bridge.jsx`：React 与 OnlyOffice 注入脚本之间的消息桥。
- `src/features/docx/office/payload.js`：字段写入 OnlyOffice 的 payload 组装。
- `src/features/docx/office/documentSync.js`：OnlyOffice 下载回传、刷新后文档状态同步。
- `src/features/docx/annotate/markers.js`：模板标注、高亮、字段标记辅助。
- `src/features/docx/preview/`：PDF/页面布局/大纲搜索等预览辅助模块。
- `src/features/docx/structure/docxStructure.js`：DOCX 结构解析。
- `scripts/onlyoffice-outline-probe.js`：注入 OnlyOffice 的桥接脚本，负责大纲、选区、页码、标注、输入点、保存、回填等消息。
- `scripts/onlyoffice-layout-format.js`：注入 OnlyOffice 的排版脚本，负责公文排版动作执行和结果回传。
- `src/features/placeholders/variables.js`：自动字段设置的变量/Token/锚点归一化、排序和填充卡片聚合工具，独立于旧模板字段。
- `src/features/placeholders/fill.js`：自动字段填充的 AI 请求字段构造、返回值归一化和写入失败状态辅助。
- `src/features/placeholders/PlaceholderFillCards.jsx`：填充工作台的自动字段卡片列表，只展示已有插入位置的字段。
- `src/features/solution-writing/`：方案编写工作台侧栏与前端服务，负责读取 OnlyOffice 大纲、选择章节模板组、确认功能模块清单、生成模块章节并写入当前光标。
- `scripts/onlyoffice-placeholder-fields.js`：注入 OnlyOffice 的占位符变量脚本，负责 `GF_PH_` 书签插入、跳转、删除和按书签替换填充值。
- `scripts/patch-onlyoffice.py`：补 OnlyOffice 前端，包括隐藏品牌、注入定制组件入口等。
- `scripts/start-onlyoffice.ps1`：启动 OnlyOffice Docker、拷贝字体、打补丁、写入 AI 配置。
- `server/api/routes/office.routes.js`：Office 接口注册入口；handler 调用 `server/office.js` 和 `server/outline-probe.js`，不要在路由里写 Office 业务规则。
- `server/office.js`：DOCX 上传保存、callback 保存、download-url、OnlyOffice 初始化配置等业务函数。

### 本地 API 管理

- `server/api/index.js`：本地 API 注册表入口，负责注册当前已迁移的路由并生成统一 middleware。
- `server/api/registry.js`：接口注册与 `:param` 路径匹配；新增接口优先通过 `defineRoute()` 登记，不要继续在 Vite 中间件里堆分支。
- `server/api/router.js`：统一分发已注册路由，并提供 `/api/_meta/routes` 与 `/api/_meta/openapi.json`。
- `server/api/openapi.js`：从注册表生成轻量 OpenAPI 3.0.3 文档；只描述通用入参、响应和路径，不写业务说明长文。
- `server/api/http.js`：通用 JSON body、JSON 响应、二进制响应辅助。
- `server/api/routes/*.routes.js`：按模块存放已迁移 API 的路由定义；handler 应调用现有业务模块，不在路由文件里重写业务规则。

### AI / 知识库高频区

- `server/api/routes/ai.routes.js`：AI 接口注册入口；handler 只调用 `server/ai/` 与 `server/solution-writing/` 业务模块，不写业务规则。
- `server/ai/fill.js`：`/api/ai/fill-field` 主链路，包含召回、提示词拼装、后置校验、最终返回。
- `server/ai/fill-rules.js`：填充模式、字段契约、金额/日期/选择型规则、证据约束辅助。
- `server/ai/knowledge-query.js`：AI 填充前的核心检索词提取与知识库召回查询。
- `server/ai/chat.js`：自研知识库聊天接口。
- `server/ai/chat-completions.js`：OpenAI-compatible `/chat/completions` 调用封装；支持同一配置内多个 API Key 轮询和限流/异常时切换下一个 Key。
- `server/ai/format-outline.js`：格式/大纲 AI 审查接口。
- `server/ai/model.js`：模型调用封装。
- `server/ai/debug-log.js`：AI 填充调试日志。
- `server/solution-writing/generator.js`：方案编写 AI 业务模块，复用现有知识库检索与 JSON 模型调用，提供功能模块识别和模块章节生成。
- `server/solution-writing/plantuml-image.js`：方案 AI 生图业务模块，只使用当前文档大纲/全文文本，调用本地 PlantUML 服务渲染 PNG，并生成可被 OnlyOffice 插入的 DOCX 图片片段；默认字体使用 `SimHei`，由 `scripts/start-plantuml.ps1` 把 Windows 黑体/微软雅黑等字体复制到 PlantUML 容器。
- `server/knowledge-base.js`：知识库兼容入口；当前返回 `apiMiddleware()` 并继续导出 `searchKnowledgeBase`，避免旧脚本和 AI 检索链路断开。
- `server/knowledge/documents.js`：知识库管理、资料原文件持久化、检索与召回业务实现。
- `server/knowledge/tables.js`：从知识库原 DOCX 文件抽取表格结构，按知识库范围检索可插入表格。

### 样式高频区

- `src/styles/index.css`：样式入口，只维护 import 顺序。
- `src/styles/base.css`：全局基础样式。
- `src/styles/layout.css`：主布局、左右面板、工作台栅格。
- `src/styles/workspace.css`：工作台通用布局和折叠面板。
- `src/styles/fill.css`：填充工作台。
- `src/styles/audit.css`：格式审核。
- `src/styles/knowledge.css`：知识库管理。
- `src/styles/settings.css`：系统设置/模板管理。
- `src/styles/responsive.css`：响应式修正。

### 本地数据

- `data/templates`：模板数据。
- `data/knowledge`：知识库数据。
- `data/drafts`：填充草稿。
- `assets/test-materials`：本地测试资料。

### 历史高频但不要继续堆

- `src/main.jsx`：已压缩成入口。
- `src/styles.css`：已删除，样式入口是 `src/styles/index.css`。
- `server/ai.js` 已删除；AI 路由统一登记在 `server/api/routes/ai.routes.js`，业务逻辑保留在 `server/ai/` 子模块。

## 当前技术路线

1. 文档预览已经切到 OnlyOffice，不再以 `docx-preview` 做主预览。
2. OnlyOffice 编辑器能力通过现有 bridge / `postMessage` 与 React 通信；工作台级入口由应用导航承载，编辑器上下文操作保留在“定制组件”。
3. 模板标注以 OnlyOffice 真实选区为准，字段保存的是选区原文、页码、bookmark/selection/inputPoint 等信息。
4. 填充确认工作台优先用 OnlyOffice 现场写入与下载回传保存，避免旧 HTML DOCX 预览链路导致状态丢失。
5. 格式审核工作台保留脚本审查 + AI 大纲审查；修复仍由脚本写 DOCX 副本。
6. 本地接口已统一进入 `server/api/` 注册表；新增或调整接口时以 `server/api/routes/*.routes.js`、`/api/_meta/routes` 和 `/api/_meta/openapi.json` 为准，`HANDOFF.md` 只记录规则和入口，不继续维护接口清单。

## 最近已完成

### 方案编写工作台迁移

- “方案编写”已从 OnlyOffice“定制组件”迁为一级“方案编写工作台”，同时加入侧栏与工作台标签导航。
- 新工作台复用 `AnnotateWorkspace` 和同一个 `DocumentFrame(mode="annotate")`，在模板标注与方案编写之间切换时不重建 OnlyOffice 编辑器；方案大纲读取、结构化文本写入、知识库配图和 AI 生图继续使用现有 bridge。
- 方案编写面板右上角使用“导出Word”，直接调用 `requestOnlyOfficeDocumentDownloadAs("docx")` 下载当前编辑器中的最新文档；编辑器未就绪或实时导出失败时不回退旧模板文件。
- 已删除 Toolbar 中的“方案编写”按钮、前端 `open-solution-writing-panel` 消息分支和对应回调 prop；旧会话/草稿中的 `annotate + solution-writing` 路由会精确迁到新工作台。
- RequireJS 缓存号已更新到 `gf=25`，工作台会话同时补齐 `layout` 与 `complex-fill` 的既有恢复白名单。
- 已验证默认配置与 `ONLYOFFICE_SERVER_URL=http://127.0.0.1:8090` 下各 7 项回归测试、生产构建和注入脚本语法；真实 Docker 补丁后 healthcheck 为 200，`ds:docservice` / `ds:converter` 为 `RUNNING`，Toolbar 已无旧入口且 `.js/.gz` 哈希一致。

### 方案编制按精确目标生成与丰富模式

- 任务规划和方案正文统一使用由保存的 `replaceTarget.styleRef.paragraphIndex` 派生的 `targetId`（如 `paragraph-33`）。模型必须逐字回传 `targetId + sourceHeading`；缺失、未知、重复、标题不一致或跨类别重复目标均失败关闭，不按标题或数组位置回配。
- 丰富模式不再固定把每个标题扩成 3 个任务。提示词先结合标题原文、知识库证据、标题路径、父子边界、前序规划和完整大纲识别可独立展开的事实维度；有依据时拆成 2-4 项，只有一个事项或资料不足时保持 1 项并说明待确认信息。
- 任务规划每批最多处理 6 个精确目标，方案正文每批最多处理 4 个精确目标；每批独立定向检索知识库，并把前批规划或正文摘要传给后批，避免批次边界造成重复和上下文断裂。
- 同一 `targetId` 下的多个规划任务在生成正文前先聚合；正文模型对每个目标只能返回一个 `sections` 项，在正文内部按证据组织多个自然段。正文缺失、重复、为空或仅返回“需结合资料补充”类占位语时直接报错，不再生成可写入占位内容。
- 正文替换目标必须同时包含保存的精确 `styleRef` 和一致标题；OnlyOffice connector 不接受仅标题目标，也不回退当前光标。刷新大纲会作废进行中的旧生成请求；任何成功或部分正文写入都会清除旧草稿、任务规划和大纲定位，必须重新读取后才能继续，防止陈旧 `bodyParagraphCount` 再次写入。
- 已增加同名类别隔离、全局目标唯一、一目标一正文、乱序回包、缺失/重复/未知/空白/占位失败、知识检索批次覆盖和仅标题目标拒绝等回归；默认配置与 `ONLYOFFICE_SERVER_URL=http://127.0.0.1:8080` 下各 16 项测试及生产构建通过。

### 方案规划按模板子树精确替换

- “方案大纲规划”的全部、单模块和单子章节写入都绑定生成时选中的章节模板组；切换模板或重新读取大纲会清空旧模块和规划结果，避免旧段落索引套用到新模板。
- OnlyOffice 大纲探针按真实 Paragraph 对象身份保存模板根标题 `styleRef`，并用下一条同级或更高级大纲节点生成 `subtreeEndRef`；`subtreeParagraphCount` 覆盖模板根标题及全部后代，文档末尾以显式 `subtreeEndRef: null` 表示。
- 写入使用 `replaceTarget.scope = "subtree"`，同时校验根标题索引/原文、子树段落数和结束边界；校验成功后在原根位置插入新规划，再按旧对象引用逆序删除原子树。任一边界失效均失败关闭，不按标题搜索、不扩大范围、不回退当前光标。
- 缺失的 `subtreeEndRef` 不会被归一化成文档末尾；子树目标必须带非空且一致的 `styleRef` 标题。大纲读取、AI 识别/生成和插入均绑定版本，消息只向当前 OnlyOffice 实例发送并校验回包来源，文档切换后的迟到结果不会复活旧目标。
- Probe 按 `requestId` 去重大纲读取和方案写入。新内容插入失败或删除旧子树前验证失败时会回滚并复核段落数/原标题；旧子树已部分删除等不可完整回滚场景返回 `partial: true`，前端立即废弃大纲和目标，强制重新读取。
- OnlyOffice 9.4 的 `CDocumentOutline.Elements[index]` 是 `{ Paragraph, Lvl }` 包装项；Probe 必须使用其 `.Paragraph` 与 `LogicDocument.GetAllParagraphs()` 做对象身份匹配。直接拿包装项匹配会让全部 `styleRef` 和子树元数据为空。
- 当前社区版外层 `api.js` 不提供 `DocsAPI.DocEditor.createConnector()`，编辑器主窗口也不是插件上下文，不能调用 `Asc.Editor.callCommand()`；注入层通过本地 SDK 已加载的 `AscBuilder.Api.GetDocument/CreateParagraph` 执行同一套精确替换命令，并用 `LogicDocument.StartAction/FinalizeAction` 包住历史动作。只有索引、标题、子树数量和结束边界全部校验通过才写入，逻辑文档当前光标 fallback 仍保持关闭。
- `ApiDocument.GetAllParagraphs()` 无参调用会按“页眉页脚、主文档、脚注尾注”返回全量段落，不能直接使用大纲读取保存的主文档索引。Probe 与 Connector 写入命令现在从 `ApiDocument.Document.GetAllParagraphs({ OnlyMainDocument: true, All: true })` 取得主文档 Paragraph，再按 `ApiParagraph.private_GetImpl()` 对象身份映射回同序 API wrapper；任一对象缺失即失败关闭，不使用固定偏移或标题扫描。
- 已验证默认配置与 `ONLYOFFICE_SERVER_URL=http://127.0.0.1:8080` 下各 11 项回归测试、生产构建、相关 JS/Python 语法和 `git diff --check`；真实 Docker 补丁后 healthcheck 为 200，`ds:docservice` / `ds:converter` 为 `RUNNING`，`index.html` 加载 outline `gf=123`，Probe 本地、容器 `.js` 与 `.js.gz` 解压内容 SHA-256 一致。

### 安全与失败语义加固

- 本地 Web 与 OnlyOffice 端口已只绑定回环地址；API CORS、Office 文档 UUID、OnlyOffice 下载/回调 URL、状态码、超时和下载体积均按配置白名单失败关闭，模型设置接口只返回脱敏 Key。
- AI 检索和模型调用异常不再伪装成“无资料”；非 JSON、字段缺失、类型错误、非法状态或置信度会返回 502。填充请求绑定启动时的模板 `previewId` 与 OnlyOffice 文档 ID，模板切换后旧请求不再写入或覆盖新模板状态。
- 普通字段清空只使用精确 `GF_FIELD_` 范围；文档已变更但书签修复失败时，前端以 `partial/cleared` 回执同步真实文档状态。自动字段写入成功后也会进入 DOCX 下载回传保存。
- OnlyOffice 消息重投会在请求收束后取消；排版 analyze/apply 按 `requestId` 去重。Connector 只有明确返回 `skipped: true`、确认命令未提交时才允许降级，超时、执行失败或部分成功禁止自动 fallback。
- 方案定向替换使用权威大纲段落对象映射、精确标题和正文段落计数，批量写入按段落索引倒序执行；排版应用成功后旧体检与修复计划立即失效，必须重新分析。
- `createOfficeDocument()` 统一从 `getOnlyOfficeServerUrl()` 取得返回地址，并有真实配置生成回归测试；填充工作台的 `onOfficeDocumentReady` 回调使用稳定引用，避免文档 ID 回执触发运行时重复重载。
- 已验证默认配置与 `ONLYOFFICE_SERVER_URL=http://127.0.0.1:8090` 下 5 项回归测试、生产构建及服务端/注入脚本语法。真实 Docker/OnlyOffice 回归已通过：容器服务正常、端口仅绑定 `127.0.0.1:8080`、宿主/容器/gzip 脚本一致，浏览器中现有草稿可在标注和填充工作台稳定打开，定制组件与 `gf=117/31/5` 实际加载正常，控制台无新增错误。

### 前端运行时继续瘦身

- `src/features/docx/runtime.jsx` 已去掉大批转出口，只保留运行时组件/工具出口，页面改为从真实模块直接 import。
- `src/features/docx/runtime.jsx` 已清理迁移后遗留的 DOCX XML 命名空间和修订计数器常量，XML 导出逻辑统一在 `src/features/docx/fill/docxXmlFill.js`。
- `src/features/docx/fill/previewAndExport.js` 已拆出 DOCX XML 导出兜底到 `src/features/docx/fill/docxXmlFill.js`，原文件聚焦浏览器预览写入。
- 已删除旧空壳 `src/styles.css`，主入口直接使用 `src/styles/index.css`。
- 已删除未使用的服务端 `server/docx-preview.js` 和 Vite 中间件；客户端 `docx-preview` fallback 仍在 `runtime.jsx` 中保留。
- 已验证：`npm run build`、`node --check server\api\routes\ai.routes.js`、`node --check server\office.js` 通过；浏览器打开 `http://127.0.0.1:5173` 后刷新无新增前端 error，模板标注/填充确认/格式审核三个工作台切换正常。

### 填充工作台修订模式开关

- 填充工作台标题旁提供“关闭/开启修订模式”按钮，默认关闭修订、进入正常模式；点击后通过 `src/features/docx/office/bridge.jsx` 向 OnlyOffice 注入脚本发送 `set-track-revisions`。
- `scripts/onlyoffice-outline-probe.js` 已将原只能开启的 `enableTrackRevisions()` 扩展为 `setTrackRevisions(enabled)`，可主动关闭修订模式；`scripts/patch-onlyoffice.py` 的 `guangfa-outline-probe.js?gf=` 已更新到 `60`。
- 一键填充期间如果写入字段导致 OnlyOffice 选区跳到字段所在页，`scripts/onlyoffice-outline-probe.js` 会在 `suppressPageSync` 分支记录写入前可见页并在写入后用 `WordControl.GoToPage` 拉回，避免进度中途停在第一页；脚本缓存号已更新到 `60`。
- 已修复修订模式“常关”：`server/office.js` 下发 `permissions.review=true`，填充预览在 `onDocumentReady` 后补发修订状态，`scripts/onlyoffice-outline-probe.js` 不再把编辑器 API 未就绪误判为设置成功；脚本缓存号已更新到 `60`。

### 本地 API 注册表

- 已新增 `server/api/` 轻量注册表，用代码维护接口清单，避免把接口长期散写在交接文档或 Vite middleware 分支里。
- Vite dev server 当前挂载 `apiMiddleware()`；注册表内置 `GET /api/_meta/routes` 查看已登记接口，`GET /api/_meta/openapi.json` 生成 OpenAPI 3.0.3 文档。
- 当前已迁移知识库、AI、草稿、模板库/模板类型、系统设置、Office 文档、OnlyOffice 大纲探针等本地 API；接口清单以 `/api/_meta/routes` 与 `/api/_meta/openapi.json` 为准。
- 迁移后的路由只做协议层定义，仍调用知识库、AI、模板、设置、草稿、Office 等原有业务函数；`server/knowledge-base.js` 保留兼容导出。
- 后续新增或迁移本地 API 时，优先新增对应 `server/api/routes/<module>.routes.js`，在 `server/api/index.js` 注册；不要把 handler 写成大路由分发文件。

### Gemini 3.1 Flash Lite 文本模型

- 系统设置的“云端 API”已提供 `Gemini 3.1 Flash Lite` 预设，使用 Google Gemini OpenAI-compatible 地址 `https://generativelanguage.googleapis.com/v1beta/openai` 和模型名 `gemini-3.1-flash-lite`。
- Gemini Flash Lite 属于普通文本输出模型，接入现有 `/chat/completions` 链路；不要把它和 Live API 实时音频翻译链路混用。
- 云端 API Key 字段支持多个 Key，用英文逗号、分号、换行或转义换行分隔；`server/ai/chat-completions.js` 会按请求轮询起始 Key，遇到 401、403、429、5xx 时尝试下一个 Key。
- 日志和调试输出不要记录完整 API Key；配置文件和 `.env.local` 里也不要写入文档或聊天窗口。

### OnlyOffice 通用接口与本地封装

这段只记录可复用接口和封装，不记录具体场景规则。新增 OnlyOffice 能力时先查这里和现有封装，优先复用，不要把 OnlyOffice 内部 API 直接散落到页面组件。

生产化接入优先级：

1. 外层 React 业务面板触发的 Office 操作，优先通过 `DocsAPI.DocEditor.createConnector()` 建立官方 Connector，再用 `connector.callCommand()` 执行 `Api.GetDocument()`、`Api.CreateParagraph()`、`ApiDocument.InsertContent()` 等公开文档 API。
2. 需要显示在 OnlyOffice 内部工具栏、右侧面板或弹窗里的工具，优先做官方 `sdkjs-plugins` 插件，通过 `Asc.plugin.callCommand()` 执行文档命令。
3. `scripts/patch-onlyoffice.py` 注入脚本只作为现有功能兼容层或 Connector/插件不可用时的 fallback；后续新业务能力不要默认继续堆到注入脚本里。
4. Connector 属于 OnlyOffice Automation API，部分部署版本可能不可用；调用方必须先探测能力并保留明确降级路径，不允许静默假装成功。
5. 需要“沿用原文标题/正文样式”时，优先保存参考段落定位信息，在写入命令同一 Office 上下文里重新定位参考段落，并用 `referenceParagraph.GetParaPr().GetStyle()` + `targetParagraph.GetParaPr().SetStyle(style)` 复制真实段落样式；只有参考段落缺失时才退回样式名匹配。
6. 需要把导航大纲项精确映射到正文段落时，兼容注入层使用 `CDocumentOutline.Elements[item.index].Paragraph` 保存的真实 `Paragraph` 对象，与 `LogicDocument.GetAllParagraphs()` 按对象身份取得 `paragraphIndex`；`Elements[item.index]` 本身是 `{ Paragraph, Lvl }` 包装项。对象或下一条大纲边界映射失败时返回空引用和空正文范围，不得按标题文本扫描补偿。
7. `CDocument.GetAllParagraphs({ OnlyMainDocument: true, All: true })` 会复用 `AllParagraphsList`；同一历史动作内的 `ApiDocumentContent.AddElement()`、内部 `AddToContent`、删除、重算和结束动作不会自动使该缓存失效。每次结构写入后的权威主文档重读都必须先同步调用 `CDocument.ClearListsCache()`，再按 Paragraph 对象身份映射；`ClearListsCache()` 缺失或调用失败时必须失败关闭，不得延时重试、按标题搜索或回退旧列表。
8. `ApiParagraph.GetText({ Numbering: true })` 返回当前自动编号后的显示文本。向编号标题前插入同级标题时，新标题会取得编号，原标题及后续标题也会同步重编号；因此写入中间态不能用保存标题或生成纯文本做相等校验。`ApiDocument.GetAllParagraphs()` 每次会创建新的 `ApiParagraph` wrapper，写后确认应比较 `private_GetImpl()` 对应的 Paragraph 对象身份，并同时复核段落总数、全部新增段落、原标题和结束边界；不得退回文本相等 fallback。

#### 通信约定

- React -> OnlyOffice：统一发送 `postMessage({ source: "guangfa-parent", action, ...payload }, "*")`。
- OnlyOffice -> React：注入脚本统一回传 `postMessage({ source: "guangfa-onlyoffice-custom", action, result|payload }, "*")`。
- 异步命令使用 `requestId` 关联请求和结果；桥接层负责超时和失败回传，iframe 重投函数返回取消器，请求成功、失败或超时收束后必须立即取消剩余重投。
- 需要重投的非幂等命令必须由执行端按 `requestId` 去重；排版 analyze/apply 已按 `action + requestId` 缓存并复用原结果 30 秒。
- `ok: false, partial: true` 表示文档可能已发生变更，禁止自动重试或 fallback；`cleared: true` 是权威文档状态，即使 `ok: false`，前端也必须清空本地值、同步 DOCX 并展示失败原因。
- 需要投递到编辑器 iframe 时，优先调用 `src/features/docx/office/bridge.jsx` 的本地封装，不直接在页面里遍历 iframe。

#### 服务端 Office 接口

- Office 服务端接口统一登记在 `server/api/routes/office.routes.js`；具体路径、方法、参数和响应以 `/api/_meta/routes` 与 `/api/_meta/openapi.json` 为准，不再在交接文档手工维护清单。
- `server/office.js` 负责生成 OnlyOffice `document.url`、`document.key`、`editorConfig.callbackUrl`、编辑权限和 AI 插件配置；前端不要手写 OnlyOffice 初始化配置。

#### 前端桥接函数

- `OnlyOfficePreview(config, ...)`：创建并销毁 `window.DocsAPI.DocEditor`，统一挂载 `onAppReady`、`onDocumentReady`、`onDownloadAs`、`onError`。
- `loadOnlyOfficeApi(serverUrl)`：加载 `${serverUrl}/web-apps/apps/api/documents/api.js?...`；重复调用会复用已加载脚本或已有 `window.DocsAPI.DocEditor`。
- `postOnlyOfficeCommand(container, message, attempts)`：向某个预览容器内的 iframe 重试投递消息，适合当前实例内命令。
- `postAllOnlyOfficeFrames(message, attempts)`：向页面内所有 iframe 和可访问子 iframe 重试投递消息，适合不知道命令实际落在哪层 iframe 的场景。
- `requestOnlyOfficeDocumentSave(trigger)`：发送 `save-document`，由注入脚本调用 `api.asc_Save(false)`。
- `requestOnlyOfficeDocumentDownloadAs(fileType, timeoutMs)`：调用当前活动编辑器的 `downloadAs(fileType)`，监听 `onDownloadAs`，再通过 `/api/office/download-url` 取回 `ArrayBuffer`。
- `fetchOnlyOfficeDownloadAsBuffer(url)`：下载 `downloadAs` 给出的临时文件地址。
- `requestOnlyOfficeFillField(field, options)`：组装写入 payload，发送 `fill-field-value`，等待 `field-fill` 回传。`{ clear: true }` 只按 `GF_FIELD_` 精确范围清空并重建空书签；`GF_INPUT_` 没有可确认的已写范围，必须失败关闭。内容已删除但书签重建失败，或普通替换已删除旧内容但新值写入失败时，均回传 `ok: false, partial: true, cleared: true`。
- `requestOnlyOfficeAddFieldBookmark(field)`：发送 `add-field-bookmark`，让注入脚本按已有选区状态写入书签。
- `requestOnlyOfficeAddInputPoint(field)`：发送 `add-input-point`，让注入脚本在当前光标处写入输入点书签。
- `requestOnlyOfficeAddComplexFillAnchor(anchor)`：发送 `add-complex-fill-anchor`，让注入脚本读取 OnlyOffice 当前真实选区并创建两类书签：`GF_CF_` 业务书签和 `GF_CF_SEL_` 选区范围书签；回传书签名、选区书签名、页码和选区原文。
- `requestOnlyOfficeSelectComplexFillAnchor(anchor)`：发送 `select-complex-fill-anchor`，优先按 `GF_CF_SEL_` 选区范围书签定位并选中对应范围，旧数据无选区书签时才回退到 `GF_CF_`。
- `requestOnlyOfficeDeleteComplexFillAnchor(anchor)`：发送 `delete-complex-fill-anchor`，删除 `GF_CF_` 业务书签；清高亮只通过 `GF_CF_SEL_` 选区范围书签定位，清除后保留 `GF_CF_SEL_`，不删除书签范围内的文档文字。
- `requestOnlyOfficeFillComplexFillField(complexFill)`：发送 `fill-complex-fill-field`，优先按 `GF_CF_SEL_` 选区范围书签替换选区内容，并在写入后重新保留 `GF_CF_SEL_` 和 `GF_CF_`。
- `requestOnlyOfficeInsertKnowledgeTable(table)`：发送 `insert-knowledge-table`，让注入脚本用 OnlyOffice `asc_insertTextFromUrl` / `CInsertDocumentManager.insertTextFromUrl()` 在当前光标插入表格片段 DOCX；只有旧数据缺少 DOCX 片段 URL 时才回退创建普通表格。
- `requestOnlyOfficeInsertKnowledgeImage(image)`：发送 `insert-knowledge-image`，桥接层先把图片预览地址读取为 Base64 data URL；注入脚本优先用 OnlyOffice `api.AddImageUrl([imageSrc])` 在当前光标插入图片，`Api.CreateImage(imageSrc, widthEmu, heightEmu)` + `ApiDocument.InsertContent()` 和图片片段 DOCX 只作为兜底。
- `requestOnlyOfficeOutline(options)`：发送 `request-outline`，等待注入脚本回传 `onlyoffice-outline-probe`，用于按需读取当前文档大纲和 `documentText` 全文文本；回传结果可包含 `documentStyles`，大纲项可带 `styleName/bodyStyleName`，供前端使用模板段落真实 Word 样式名。
- `requestOnlyOfficeInsertSolutionText(text, options)`：写入方案编制文本；`options.paragraphs` 可传结构化段落，段落支持 `type/level/style/styleName/styleFallback/text`，Connector/注入脚本会优先按精确 Word 样式名写入；普通 `options.replaceTarget` 可传保存的标题段落索引、标题原文和正文段落数，Connector 只在索引与原文同时匹配时定向替换。需要替换完整章节子树时传 `scope: "subtree" + styleRef + subtreeParagraphCount + subtreeEndRef`，其中 `subtreeEndRef: null` 只表示文档末尾，字段缺失或边界失效均失败。只有 Connector 明确返回 `skipped: true`、确认未提交命令时才允许走注入脚本 fallback；超时或执行失败直接返回，避免迟到命令造成重复写入。
- `requestOnlyOfficeAnalyzeLayoutFormat(standard)`：发送 `analyze-layout-format`，让排版注入脚本读取 OnlyOffice 文档段落并按标准规则返回 `layout-format-analyzed` findings。
- `requestOnlyOfficeApplyLayoutFormat(plan)`：发送 `apply-layout-format`，让排版注入脚本按修复计划调用 OnlyOffice 文档 API 执行页面、正文、标题、落款等格式调整，并等待 `layout-format-applied` 回传。
- `requestOnlyOfficeInsertPlaceholderVariable(variable, anchorIndex)`：发送 `insert-placeholder-variable`，等待 `placeholder-anchor-inserted` 回传。
- `requestOnlyOfficeSelectPlaceholderAnchor(anchor)`：发送 `select-placeholder-anchor`，等待 `placeholder-anchor-selected` 回传。
- `requestOnlyOfficeDeletePlaceholderAnchor(anchor)`：发送 `delete-placeholder-anchor`，等待 `placeholder-anchor-deleted` 回传。
- `requestOnlyOfficeFillPlaceholderVariable(variableFill, options)`：发送 `fill-placeholder-variable`，让注入脚本按 `GF_PH_` 书签替换自动字段填充值，并等待 `placeholder-variable-filled` 回传。
- `readOnlyOfficePageNumber(payload)`：把 OnlyOffice 返回的页码 payload 归一成正整数页码。

#### Payload 与文档同步函数

- `buildOnlyOfficeAnnotationFieldPayload(fields)`：把前端字段列表压缩成注入脚本可识别的标注字段 payload。
- `buildOnlyOfficeFillFieldPayload(fields)`：把前端字段列表压缩成写入 payload，包含目标书签、字段类型、原文、值和预计算写入文本。
- `buildOnlyOfficeLiveFillText(field)`：根据字段值和原文生成可直接写入的文本。
- `buildOnlyOfficeChoiceFillText(source, value)`：根据选项原文和值生成勾选后的文本。
- `resolveOfficeDocumentBuffer(officeDocId, baselineBuffer, options)`：优先走 `downloadAs("docx")` 取回文档；失败时触发保存并轮询 `/api/office/documents/:id/file`。
- `waitForChangedOfficeDocumentBuffer(officeDocId, baselineBuffer, options)`：轮询文档文件，直到内容与基线不同或超时。
- `fetchOfficeDocumentBuffer(officeDocId)`：直接读取 `/api/office/documents/:id/file`。
- `arrayBuffersEqual(left, right)`：比较两个 `ArrayBuffer` 是否完全相同。

#### 注入脚本通用函数

- `scripts/onlyoffice-outline-probe.js`
  - `getEditorApi()`：按 `window.DE -> Navigation.api -> window.Asc.editor -> window.editor` 顺序取 OnlyOffice API。
  - `getLogicDocument()`：取 `api.WordControl.m_oLogicDocument`，用于选区、段落、书签、修订等内部能力。
  - `extractOnlyOfficeOutline()`：读取 OnlyOffice 导航大纲。
  - `extractOnlyOfficeSelection()`：读取当前选区文本、页码和 `selectionState`。
  - `extractOnlyOfficePage(selectionState)`：从选区状态、编辑器 API 或逻辑文档推断当前页。
  - `extractOnlyOfficeVisiblePage()`：读取当前可见页，优先 DOM/编辑器可见页接口。
  - `highlightOnlyOfficeSelection(selectionState)`：恢复选区并调用高亮。
  - `applyTextHighlightToCurrentSelection(options)`：优先调用 OnlyOffice 工具栏高亮同源接口 `api.SetMarkerFormat(true, true, r, g, b)` 给当前选区加高亮，失败时兜底 `api.put_LineHighLight(true, r, g, b)`；不传 options 时默认黄色。
  - `clearTextHighlightFromCurrentSelection()`：优先调用 OnlyOffice 工具栏高亮同源接口 `api.SetMarkerFormat(true, false)` 清除当前选区高亮，随后 `api.SetMarkerFormat(false)` 关闭高亮工具状态；失败时兜底 `api.put_LineHighLight(false, 255, 255, 255)`。
  - `addComplexFillAnchor(payload)`：读取当前选区文本，优先用 OnlyOffice `ApiDocument.GetRangeBySelect()` + `ApiRange.AddBookmark()` 基于真实选区创建 `GF_CF_SEL_` 选区范围书签，并在创建后读回书签文本校验非空；随后添加灰色高亮，再回到选区起点创建 `GF_CF_` 业务书签，最后触发保存并回传 `{ anchor }`。
  - `selectComplexFillAnchor(payload)`：优先调用书签管理器的 `GoToBookmark` / `SelectBookmark` 或 `asc_*` 变体定位并选中 `GF_CF_SEL_` 选区范围书签，同时给该选区补灰色高亮；旧数据无选区书签时才回退到 `GF_CF_`。
  - `deleteComplexFillAnchor(payload)`：单独删除 `GF_CF_` 业务书签；再按 `GF_CF_SEL_` 选区范围书签选中原范围并调用 `clearTextHighlightFromCurrentSelection()` 清背景，清完保留 `GF_CF_SEL_` 供后续选区替换。
  - `fillComplexFillField(payload)`：优先按 `GF_CF_SEL_` 选区范围书签选中范围，先调用 `logicDocument.RemoveBeforePaste()` 删除当前选区原文，再用 `CSelectedContent`、`CParagraphBookmark`、`ParaRun.AddText()` 插入纯文本填充值，并重新保留 `GF_CF_SEL_` 和 `GF_CF_`。
  - `insertKnowledgeTable(payload)`：调用 `asc_insertTextFromUrl(url)` 或 `AscCommonWord.CInsertDocumentManager(api).insertTextFromUrl(url)` 插入后端生成的单表格 DOCX；只有旧数据缺少 DOCX 片段 URL 时才回退 `Asc.Editor.callCommand()` + `Api.CreateTable(rows, columns)` + `ApiDocument.InsertContent([table])` 创建普通表格；按 `requestId` 去重，失败时返回 `knowledge-table-inserted` 错误结果。
  - `insertKnowledgeImage(payload)`：优先调用 OnlyOffice 工具栏同源接口 `api.AddImageUrl([imageSrc])` 插入当前光标；`imageSrc` 优先使用前端桥接层由图片预览地址转换出的 Base64 data URL，避免 Docker 内外 `127.0.0.1` / `host.docker.internal` 可访问性不一致导致空白图；原生接口不可用时才回退 `Api.CreateImage(imageSrc, widthEmu, heightEmu)` + `ApiDocument.InsertContent()`，旧数据缺少图片源时再回退 `asc_insertTextFromUrl(url)` 或 `AscCommonWord.CInsertDocumentManager(api).insertTextFromUrl(url)` 插入单图片 DOCX；按 `requestId` 去重，失败时返回 `knowledge-image-inserted` 错误结果。
  - `request-outline` 消息：调用 `postOutline("request", requestId)`，回传当前 OnlyOffice 大纲。
  - `insertSolutionWritingText(payload)`：接收方案写入文本；当 payload 带 `paragraphs` 时，插件环境通过 `Asc.Editor.callCommand()` 执行结构化写入，当前社区版编辑器主窗口通过 SDK 已加载的 `AscBuilder.Api` 执行同一命令；两者均使用 `Api.CreateParagraph()`、`ApiDocument.InsertContent()`，并用 `ApiDocument.GetStyle()` + `ApiParagraph.SetStyle()` 套用 Word 段落样式。定向写入会先把主文档真实 Paragraph 按对象身份映射为同序 API wrapper，确保读取和写入使用同一主文档索引空间。如传入 `styleName` 则优先使用文档真实样式名，只有样式未命中时才对 `ApiParagraph.AddText()` 返回的 run 做字体/字号/加粗兜底。正文定向替换接受保存的 `paragraphIndex + 预期标题 + bodyParagraphCount`；子树替换接受 `scope: "subtree" + 根 styleRef + subtreeParagraphCount + subtreeEndRef`，校验成功后在原根位置插入新内容，再删除精确旧子树。任一定位信息缺失或失效均失败关闭，不按标题文本或“下一个标题”扫描补偿，带 `replaceTarget` 的请求也不回退当前光标写入。普通当前光标插入仍可使用 `enterTextAtSelection(text, "solution-writing")` fallback。
  - `saveOnlyOfficeDocument(trigger)`：调用 `api.asc_Save(false)` 并回传保存结果。
  - `setTrackRevisions(enabled)`：依次尝试 `asc_SetTrackRevisions`、`asc_setTrackRevisions`、`SetTrackRevisions`、`logicDocument.SetTrackRevisions`。
  - `postOutline()`、`postSelection()`、`postPageChange()`：把大纲、选区、页码变化回传给 React。
- `scripts/onlyoffice-layout-format.js`
  - `analyzeLayoutDocument(standard)`：格式体检入口，读取 OnlyOffice 文档段落，按标准规则返回 findings；无法可靠自动判断的规则标为需人工确认。
  - `applyLayoutPlan(plan)`：排版脚本入口，按计划执行页面、正文、标题、落款等动作并回传结果。
  - `applyPageLayout(documentApi, action)`：优先通过 OnlyOffice section API 设置 A4 页面与页边距。
  - `applyBodyLayout(paragraphs, action)`：给非标题正文段落设置字体、字号、首行缩进和行距；`SetFontSize` 传半磅值，`SetSpacingLine` 参数顺序为 `(twips, "exact")`。
  - `applyHeadingLayout(paragraphs, action)`：按公文标题编号规则识别标题层级并套用标题格式。
  - `applySignatureLayout(paragraphs, action)`：识别短落款/日期段落并右对齐。
- `scripts/onlyoffice-placeholder-fields.js`
  - `getEditorApi()`、`getLogicDocument()`：同上，用于取得编辑器 API 和逻辑文档。
  - `getBookmarkManager()`：优先 `api.asc_GetBookmarksManager()`，其次 `logicDocument.GetBookmarksManager()`。
  - `insertFormattedBookmarkedPlaceholder(text, bookmarkName, manager)`：使用 OnlyOffice 段落、run、`CSelectedContent` 和 `CParagraphBookmark` 生成带书签的内联标签文本。
  - `insertBookmarkedInlineText(text, bookmarkName, manager, options)`：复用 OnlyOffice 内联插入能力；`placeholderStyle` 控制是否应用标签视觉样式，`inheritDirectTextPr:false` 可按纯文本写入，不复制当前选区的直接字体属性。
  - `hasPlaceholderBookmark(manager, bookmarkName)`：优先 `asc_HaveBookmark`，其次 `HaveBookmark`。
  - `goToPlaceholderBookmark(manager, bookmarkName)`：优先 `asc_GoToBookmark`，其次 `GoToBookmark`。
  - `selectPlaceholderBookmark(bookmarkName)`：检查书签、跳转书签，并尝试 `asc_SelectBookmark` / `SelectBookmark` 选中范围。
  - `removeSelectedTextForReplacement()`：优先 `logicDocument.RemoveBeforePaste()` 删除当前选区，其次 `logicDocument.Remove(...)`。
  - `deletePlaceholderAnchor(payload)`：按书签定位并删除当前书签文本，再调用 `asc_RemoveBookmark` / `RemoveBookmark`。
  - `insertPlaceholderVariable(payload)`：生成书签名，插入带书签文本，确认书签可见后回传锚点信息。
  - `fillPlaceholderVariable(payload)`：遍历自动字段锚点，按书签选中、替换文本并重新保留同名书签。

#### 当前已用到的 OnlyOffice API 能力

- `DocsAPI.DocEditor(holderId, config)`：创建编辑器实例。
- `editor.downloadAs(fileType)`：触发 OnlyOffice 导出，并通过 `onDownloadAs` 返回临时下载地址。
- `api.asc_Save(false)`：请求 OnlyOffice 保存当前文档。
- `api.asc_GetBookmarksManager()` / `logicDocument.GetBookmarksManager()`：取得书签管理器。
- `asc_HaveBookmark` / `HaveBookmark`：判断书签是否存在。
- `asc_GoToBookmark` / `GoToBookmark`：跳转到书签。
- `asc_SelectBookmark` / `SelectBookmark`：选中书签范围。
- `asc_RemoveBookmark` / `RemoveBookmark`：删除书签。
- `logicDocument.GetSelectionState()` / `SetSelectionState()`：读取或恢复选区状态。
- `GetSelectedText` / `asc_GetSelectedText` / `getSelectedText`：读取当前选区文本。
- `Api.GetDocument()` / `ApiDocument.GetRangeBySelect()`：取得当前真实选区的 `ApiRange`，适合把用户鼠标选中的范围固化为后续可定位对象。
- `ApiRange.AddBookmark(name)`：给指定 `ApiRange` 创建书签；OnlyOffice SDK 对空 range 返回 `false`，适合创建前/创建后校验选区书签是否有效。
- `logicDocument.GetCurrentParagraph()` / `GetCurrentAnchorPosition()`：取得当前插入位置。
- `logicDocument.RemoveBeforePaste()` / `Remove(...)`：删除当前选区文本。
- `ParaRun.AddText(text)`：通过 OnlyOffice run 写入纯文本内容；不设置 run 直接字体属性时，字号等由当前位置的段落/样式体系决定。
- `Asc.Editor.callCommand(callback)`：在 OnlyOffice 命令上下文中执行文档编辑动作，适合插入表格等需要编辑器事务包裹的操作。
- `api.asc_insertTextFromUrl(url)` / `AscCommonWord.CInsertDocumentManager(api).insertTextFromUrl(url)`：把外部 DOCX 内容插入当前光标位置，适合 Word 到 Word 的内容复用。
- `api.AddImageUrl([imageSrc], undefined, token?)`：OnlyOffice 文档编辑器工具栏插入图片同源接口，适合把 URL/Base64 图片插入当前光标，项目图片插入优先走该接口。
- `Api.CreateTable(rows, columns)`：创建 OnlyOffice 表格对象。
- `Api.CreateImage(imageSrc, width, height)`：创建 OnlyOffice 图片对象；OnlyOffice 官方支持互联网 URL 或 Base64 图片源，`width/height` 使用 EMU。项目内图片插入优先传 Base64 data URL；只有明确确认 URL 在浏览器与 DocumentServer 容器两侧都可访问时才直接传 URL。
- `ApiDocument.InsertContent([element])`：把表格等文档对象插入当前光标位置。
- `ApiDocument.Document.GetAllParagraphs({ OnlyMainDocument: true, All: true })` + `ApiParagraph.private_GetImpl()`：将主文档内部 Paragraph 列表按对象身份映射为同序 API wrapper，适合在存在页眉页脚、脚注尾注时继续使用保存的主文档精确索引；映射不完整时必须失败关闭。
- `logicDocument.StartAction(...)` / `FinalizeAction()`：把一组内部编辑操作包成一次历史动作。
- `logicDocument.Recalculate()`、`UpdateInterface()`、`UpdateSelection()`：插入或删除后刷新文档状态和 UI。
- `logicDocument.MoveCursorRight(true, false)`：从当前位置向右扩展选区。
- `ApiParagraph.GetParaPr()` / `ApiParagraph.GetTextPr()`：取得段落属性和文本属性对象，格式调整优先改属性对象，不要只猜测段落对象上是否有同名 setter。
- `ApiDocument.GetAllStyles()`：读取当前文档可用 Word 样式列表；涉及插入内容样式匹配时，优先使用它返回的真实样式名，不要只靠 `标题2`、`Heading 2` 这类静态猜测。
- `ApiParaPr.GetStyle()` / `ApiStyle.GetName()`：读取某个已有段落实际绑定的 Word 样式名。需要“按模板原文样式写入”时，应优先从模板段落读取真实样式名，再调用 `ApiDocument.GetStyle(name)` 绑定到新段落。
- `ApiDocument.GetStyle(name)` / `ApiParagraph.SetStyle(style)`：取得并套用 Word 段落样式，适合让插入内容匹配文档内已有 `正文`、`Heading 2`、`标题2` 等样式；可与 `Api.CreateParagraph()`、`ApiDocument.InsertContent()` 一起使用。
- 通过 `ApiDocument.InsertContent()` 向当前光标插入结构化段落时，先插入一个 `Api.CreateParagraph()` 空段落建立当前位置插入锚点，再插入真实内容；否则可能出现命令返回成功但内容未落到当前可见正文的情况。
- `ApiRun.SetFontFamily(font)` / `SetFontSize(halfPoints)` / `SetBold(enabled)`：对 `ApiParagraph.AddText()` 返回的 run 设置文字字体、字号、加粗；字号单位是半磅值，例如 16pt 传 `32`。插入新文本且段落样式不稳定时，优先在 run 级做可见格式兜底。
- `ApiTextPr.SetFontFamily(font)` / `SetFontSize(halfPoints)` / `SetBold(enabled)`：设置文本属性对象的字体、字号、加粗；字号单位是半磅值，例如 16pt 传 `32`。
- `ApiParaPr.SetJc(value)` / `SetIndFirstLine(twips)` / `SetSpacingLine(twips, "exact")` / `SetSpacingBefore(twips)` / `SetSpacingAfter(twips)`：设置段落对齐、首行缩进和段前段后/行距；行距接口参数顺序不要写反。
- `api.SetMarkerFormat(true, true, r, g, b)`：OnlyOffice 工具栏高亮按钮同源接口，给当前选区套用指定高亮色。
- `api.SetMarkerFormat(true, false)`：OnlyOffice 工具栏“无高亮/透明色”同源接口，用于清除当前选区高亮。
- `api.put_LineHighLight(true, r, g, b)`：给当前选区加高亮，可作为 `SetMarkerFormat` 不可用时的兜底。
- `api.asc_ShowDocumentOutline()` / `api.asc_GetDocumentOutlineManager()`：打开并读取文档大纲管理器。
- `api.asc_SetTrackRevisions(enabled)` / `api.asc_setTrackRevisions(enabled)` / `SetTrackRevisions(enabled)`：设置修订模式。
- `AscWord.CParagraphBookmark` / `AscCommonWord.CParagraphBookmark`：创建书签开始/结束节点。
- `AscCommonWord.CSelectedContent` / `CSelectedElement`：组装并插入 OnlyOffice 内部选中内容。

#### 缓存与补丁

- 改 `scripts/onlyoffice-outline-probe.js`、`scripts/onlyoffice-placeholder-fields.js` 或 `scripts/onlyoffice-layout-format.js` 后，要同步 bump `scripts/patch-onlyoffice.py` 里的脚本 `?gf=` 版本。
- 改 Toolbar 注入或 RequireJS 资源加载后，要同步 bump `scripts/patch-onlyoffice.py` 里的 `urlArgs`。
- 改 `api.js` 相关缓存参数后，要同步 bump `_dc=9.4.0-129-gf*`。
- 当前有效缓存号：outline `gf=123`、placeholder `gf=31`、layout `gf=5`、RequireJS `urlArgs gf=25`、API `_dc=9.4.0-129-gf30`。
- 重新运行 `npm run office` 会复制注入脚本、执行补丁并重写 `.js.gz`；手动 patch 时也要确认 `.js` 和 `.js.gz` 内容一致。

### OnlyOffice 原生 AI 接本地模型

已完成配置：

- `server/office.js` 会在 `editorConfig.aiPluginSettings` 下发 `Local Qwen [qwen3.6-35b-a3b]`。
- `scripts/start-onlyoffice.ps1` 会写入 DocumentServer 的 `/etc/onlyoffice/documentserver/local.json` -> `aiSettings`。
- Docker 容器内访问宿主机模型要用 `http://host.docker.internal:8129`，不能用容器内的 `127.0.0.1:8129`。
- OnlyOffice AI 插件已出现：聊天机器人、摘要、翻译、拼写与语法检查、创建 AI 助手。

验证过：

- 容器内请求 `http://host.docker.internal:8129/v1/chat/completions` 可返回 `OK`。
- Web 返回给 OnlyOffice 的配置中 provider 为 `OpenAI`，url 为 `http://host.docker.internal:8129`。
- `npm run build` 通过。

注意：

- 业务聊天、知识库问答、内容审查等项目链路默认走自研接口和自研面板，不把 OnlyOffice 原生 AI Chatbot 当业务默认入口。
- 手工 POST `http://127.0.0.1:8080/ai-proxy` 会 403，因为缺 OnlyOffice 编辑器运行时 JWT；这不是模型地址问题。
- OnlyOffice 原生 AI 插件只作为独立编辑器能力记录；需要验证时必须先获得用户允许再使用浏览器控制。

### OnlyOffice 自定义组件

定制组件目前承载：

- 内容审查
- 大纲审查
- 标注字段
- 自动字段设置（占位符变量）
- 复杂类填充

不要再污染 OnlyOffice 原生工具按钮。编辑器上下文按钮放在“定制组件”里，工作台入口放在应用导航中。

## 历史坑位

- 功能调试要站在产品能力角度处理“一类问题”，测试用例和截图有局限性，只能作为复现场景，不能把样例里的字段名、项目内容或临时表现当成路由条件。修复前先抽象字段特征和用户标注意图，再改公共链路。
- 旧 HTML DOCX/docx-preview 链路会导致页码、显示、字段列表和 Word/OnlyOffice 不一致；现在应优先走 OnlyOffice。
- 字段高亮如果用“搜索文本”恢复，容易高亮到相同文本的错误位置；用户选区标注时应尽量使用 OnlyOffice 当前真实选区。
- 填充链路不能把“填空无输入点”一刀切拦截；标注工作台已完成类型匹配时，应先判断标注选区原文是否自带可填写空位/标签。能定位的用字段书签写入选区，不能定位的再提示补输入点。
- `单选项/替换+选择` 的安全校验不能把所有“复印件、发票、证明材料”等词一刀切判为无效；业绩、资质、人员等有效要求正文可能本身包含证明材料要求。应只拦真正空占位或纯证明材料说明。
- `单选项/替换+选择` 的有资料分支不是只替换“有”选项；应基于知识库/资料依据生成可直接替换整个标注选区的要求文本。只有无对应资料时才走“无xx要求”勾选。
- OnlyOffice 的 `asc_enterText` 只是输入文字，不会自动删除当前书签选区；凡是用 `GF_FIELD_` 字段书签做替换，必须先删除选区再输入，否则原模板选项（如“无业绩要求”）会残留。`GF_INPUT_` 输入点仍只插入。
- OnlyOffice 的 `GetSelectedText` 返回文本可能比 `GF_FIELD_` 真实书签范围更长，常见表现是前端 `sourceText` 含“□无xx要求”，但书签实际只包住前半段；`替换+选择` 有资料分支回写后要按原 `sourceText` 清理残留的“□无xx要求”，不能只相信书签范围。
- 页面刷新后高亮/填充丢失，优先考虑调用 OnlyOffice 下载接口回传保存，而不是只保存前端字段 JSON。
- 删除字段、刷新页面、切换工作台时不要重载旧模板文件，否则预览会回到旧文档。
- `scripts/start-onlyoffice.ps1` 会重启容器并重新打补丁，调试 OnlyOffice 注入脚本后要跑它或手动 `docker cp`。
- `.js` 和 `.js.gz` 缓存都可能影响 OnlyOffice 前端脚本。调试 `guangfa-outline-probe.js` 后要确认容器内 `.js.gz` 解压内容和 `.js` 哈希一致，并 bump `index.html` 里脚本的 `?gf=` 缓存号；否则浏览器可能继续加载旧桥接脚本，表现为“代码改了但 OnlyOffice 仍按旧逻辑写入”。
- OnlyOffice 右侧“聊天机器人”快捷入口不能再调用原生 `window.chatWindowShow()` 或点击原生 AI 插件 Chatbot。原生 AI Chat 会进入 OnlyOffice 宏/工具代理链路，表现为“运行宏、格式化文本、重写文本”等工具调用，并且知识库上下文不稳定；应打开自研 `guangfa-ai-chat-panel`，通过 `/api/ai/chat` 使用当前选择的知识库。
- OnlyOffice 内部浮层可能继承编辑器禁选文本/拦截复制的体验；自定义聊天、审查等浮层里有可复用文本时，要显式设置 `user-select:text`，必要时提供复制按钮。
- 自研聊天回复要简明扼要；溯源不要让 AI 写在回答正文里，应由前端固定挂载 `知识库 / 文件 / 片段` 引用项，点击引用项查看召回原文。
- 自研聊天回复右上角按钮当前为“写入”，调用 OnlyOffice `asc_enterText`/`EnterText` 把回复正文写入当前光标或选区位置；引用来源只用于查看原文，不随回复写入文档。
- `/api/ai/fill-field` 的字段填充不要在模型调用前加“项目名称/地点”等语义正则捷径；这会绕过 AI 的复制范围判断，且容易把后续标题、采购人、目录、TOC 等连续文本一起截入 value。通用填充应先召回，再交给 AI 输出 JSON，后置校验只负责拦错。
- 填充工作台的“溯源”展示必须是系统根据召回结果固定生成的引用，不展示 AI 总结句。当前 `/api/ai/fill-field` 成功返回时会用最高相关片段覆盖 `source/evidence/sourceSnippetText`；前端默认只显示一行来源，展开后查看片段原文。`modelParsed.evidence` 仅用于日志排查。

## 当前建议接手方式

1. 先运行 `npm run build`、`node --check server\api\routes\ai.routes.js`、`node --check server\office.js`。
2. 浏览器控制默认关闭；只有用户明确允许浏览器 QA 时，才打开 `http://127.0.0.1:5173` 做页面验证。
3. 如果 OnlyOffice 没起来，运行 `npm run office`。
4. 如果 AI 不响应，先测：

```powershell
Invoke-RestMethod http://127.0.0.1:8129/v1/models
docker exec guangfa-onlyoffice bash -lc "python3 - <<'PY'
import urllib.request
print(urllib.request.urlopen('http://host.docker.internal:8129/v1/models', timeout=5).read(120))
PY"
```

5. 做业务修复前，先按上面的文件地图找完整调用链，不要从 `src/main.jsx` 入口文件下手，也不要只改当前按钮事件。

## 备选方向记录

以下只作为历史备选方向，不代表新会话可主动开展；只有用户明确提出对应需求时再处理。

- 验证 OnlyOffice 原生 AI 插件在聊天/摘要/翻译中的实际响应效果。
- 优化填充确认工作台：填空输入点、选择型字段、长文本字段的通用写入策略。
- 稳定模板标注工作台：刷新后字段高亮持久化、字段页码与当前页联动。
- 评估是否能移除客户端 `docx-preview` fallback；确认 OnlyOffice 覆盖所有预览场景后，再删除依赖和 `.docx-preview-host` 样式。
