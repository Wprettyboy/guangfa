# 项目交接文档

更新时间：2026-07-04

## 新会话先读

本项目根目录：`C:\Users\23811\Desktop\广发new`

当前已是可用 git 仓库，远端为 `https://github.com/Wprettyboy/guangfa.git`，本地 `main` 跟踪 `origin/main`。改代码前先读文件，避免误改用户未提交内容。

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
npm run embedding:skip-install
```

服务端口：

- Web：`http://127.0.0.1:5173`
- OnlyOffice：`http://127.0.0.1:8080`
- 本地 Qwen：`http://127.0.0.1:8129/v1`
- Embedding：`http://127.0.0.1:8000/v1`

常用检查：

```powershell
npm run build
node --check server\ai.js
node --check server\office.js
Invoke-WebRequest http://127.0.0.1:8080/healthcheck -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:8129/v1/models
```

## 文件地图

### 先看这里

- `src/main.jsx`：前端入口，只做 React 挂载；不要再把业务逻辑堆回这里。
- `src/App.jsx`：根状态与工作台编排，目前仍偏重；只放跨页面状态、批量填充编排、草稿保存这类上层逻辑。
- `src/pages/AnnotateWorkspace.jsx`：模板标注页面组合。
- `src/pages/FillWorkspace.jsx`：填充工作台页面组合。
- `src/pages/FormatAuditWorkspace.jsx`：格式审核页面组合。

### 填充工作台高频区

- `src/features/docx/fill/FieldControls.jsx`：字段卡片、AI 填充按钮、编辑/确认、依据原文展示。
- `src/features/docx/fill/FillCommonToolbar.jsx`：填充工作台顶部公共工具条，承载上传资料、一键填充、导出和知识库选择。
- `src/features/docx/fill/OtherFieldFillPanel.jsx`：旧模板字段/其他类型字段填充列表。
- `src/features/docx/fill/helpers.js`：填充字段类型、写入模式、输入点/选区判断等前端辅助。
- `src/features/docx/fill/previewAndExport.js`：填充工作台的浏览器预览写入、DOM 选区/空白定位。
- `src/features/docx/fill/docxXmlFill.js`：填充导出兜底的 DOCX XML 回写、修订痕迹、选择/日期/标签写入。
- `src/styles/fill.css`：填充工作台样式；字段卡片、依据原文、筛选条等样式优先改这里。

### OnlyOffice / DOCX 高频区

- `src/features/docx/runtime.jsx`：DOCX/OnlyOffice 运行时主组件，只导出 `DocumentFrame`、页码显示和少量运行时工具；不要再当总出口文件。
- `src/features/docx/office/bridge.jsx`：React 与 OnlyOffice 注入脚本之间的消息桥。
- `src/features/docx/office/payload.js`：字段写入 OnlyOffice 的 payload 组装。
- `src/features/docx/office/documentSync.js`：OnlyOffice 下载回传、刷新后文档状态同步。
- `src/features/docx/annotate/markers.js`：模板标注、高亮、字段标记辅助。
- `src/features/docx/preview/`：PDF/页面布局/大纲搜索等预览辅助模块。
- `src/features/docx/structure/docxStructure.js`：DOCX 结构解析。
- `scripts/onlyoffice-outline-probe.js`：注入 OnlyOffice 的桥接脚本，负责大纲、选区、页码、标注、输入点、保存、回填等消息。
- `src/features/placeholders/variables.js`：自动字段设置的变量/Token/锚点归一化、排序和填充卡片聚合工具，独立于旧模板字段。
- `src/features/placeholders/fill.js`：自动字段填充的 AI 请求字段构造、返回值归一化和写入失败状态辅助。
- `src/features/placeholders/PlaceholderFillCards.jsx`：填充工作台的自动字段卡片列表，只展示已有插入位置的字段。
- `scripts/onlyoffice-placeholder-fields.js`：注入 OnlyOffice 的占位符变量脚本，负责 `GF_PH_` 书签插入、跳转、删除和按书签替换填充值。
- `scripts/patch-onlyoffice.py`：补 OnlyOffice 前端，包括隐藏品牌、注入定制组件入口等。
- `scripts/start-onlyoffice.ps1`：启动 OnlyOffice Docker、拷贝字体、打补丁、写入 AI 配置。
- `server/office.js`：DOCX 上传给 OnlyOffice、callback 保存、download-url、OnlyOffice 初始化配置。

### AI / 知识库高频区

- `server/ai.js`：AI 路由分发入口；保持薄，不要放业务规则。
- `server/ai/fill.js`：`/api/ai/fill-field` 主链路，包含召回、提示词拼装、后置校验、最终返回。
- `server/ai/fill-rules.js`：填充模式、字段契约、金额/日期/选择型规则、证据约束辅助。
- `server/ai/knowledge-query.js`：AI 填充前的核心检索词提取与知识库召回查询。
- `server/ai/chat.js`：自研知识库聊天接口。
- `server/ai/format-outline.js`：格式/大纲 AI 审查接口。
- `server/ai/model.js`：模型调用封装。
- `server/ai/debug-log.js`：AI 填充调试日志。
- `server/knowledge-base.js`：知识库管理、检索与召回。

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
- `server/ai.js`：已拆为 `server/ai/` 子模块。

## 当前技术路线

1. 文档预览已经切到 OnlyOffice，不再以 `docx-preview` 做主预览。
2. 自定义业务功能通过 OnlyOffice 的“定制组件”按钮和 `postMessage` 与 React 通信。
3. 模板标注以 OnlyOffice 真实选区为准，字段保存的是选区原文、页码、bookmark/selection/inputPoint 等信息。
4. 填充确认工作台优先用 OnlyOffice 现场写入与下载回传保存，避免旧 HTML DOCX 预览链路导致状态丢失。
5. 格式审核工作台保留脚本审查 + AI 大纲审查；修复仍由脚本写 DOCX 副本。

## 最近已完成

### 前端运行时继续瘦身

- `src/features/docx/runtime.jsx` 已去掉大批转出口，只保留运行时组件/工具出口，页面改为从真实模块直接 import。
- `src/features/docx/runtime.jsx` 已清理迁移后遗留的 DOCX XML 命名空间和修订计数器常量，XML 导出逻辑统一在 `src/features/docx/fill/docxXmlFill.js`。
- `src/features/docx/fill/previewAndExport.js` 已拆出 DOCX XML 导出兜底到 `src/features/docx/fill/docxXmlFill.js`，原文件聚焦浏览器预览写入。
- 已删除旧空壳 `src/styles.css`，主入口直接使用 `src/styles/index.css`。
- 已删除未使用的服务端 `server/docx-preview.js` 和 Vite 中间件；客户端 `docx-preview` fallback 仍在 `runtime.jsx` 中保留。
- 已验证：`npm run build`、`node --check server\ai.js`、`node --check server\office.js` 通过；浏览器打开 `http://127.0.0.1:5173` 后刷新无新增前端 error，模板标注/填充确认/格式审核三个工作台切换正常。

### 填充工作台修订模式开关

- 填充工作台标题旁新增“关闭/开启修订模式”按钮，默认仍开启修订；点击后通过 `src/features/docx/office/bridge.jsx` 向 OnlyOffice 注入脚本发送 `set-track-revisions`。
- `scripts/onlyoffice-outline-probe.js` 已将原只能开启的 `enableTrackRevisions()` 扩展为 `setTrackRevisions(enabled)`，可主动关闭修订模式；`scripts/patch-onlyoffice.py` 的 `guangfa-outline-probe.js?gf=` 已更新到 `60`。
- 一键填充期间如果写入字段导致 OnlyOffice 选区跳到字段所在页，`scripts/onlyoffice-outline-probe.js` 会在 `suppressPageSync` 分支记录写入前可见页并在写入后用 `WordControl.GoToPage` 拉回，避免进度中途停在第一页；脚本缓存号已更新到 `60`。
- 已修复修订模式“常关”：`server/office.js` 下发 `permissions.review=true`，填充预览在 `onDocumentReady` 后补发修订状态，`scripts/onlyoffice-outline-probe.js` 不再把编辑器 API 未就绪误判为设置成功；脚本缓存号已更新到 `60`。

### OnlyOffice 通用接口与本地封装

这段只记录可复用接口和封装，不记录具体场景规则。新增 OnlyOffice 能力时先查这里和现有封装，优先复用，不要把 OnlyOffice 内部 API 直接散落到页面组件。

#### 通信约定

- React -> OnlyOffice：统一发送 `postMessage({ source: "guangfa-parent", action, ...payload }, "*")`。
- OnlyOffice -> React：注入脚本统一回传 `postMessage({ source: "guangfa-onlyoffice-custom", action, result|payload }, "*")`。
- 异步命令使用 `requestId` 关联请求和结果；桥接层负责超时、去重和失败回传。
- 需要投递到编辑器 iframe 时，优先调用 `src/features/docx/office/bridge.jsx` 的本地封装，不直接在页面里遍历 iframe。

#### 服务端 Office 接口

- `GET /api/office/health`：返回 OnlyOffice 服务地址、当前公开回调地址和可用状态。
- `POST /api/office/documents?title=...&previewId=...`：接收 DOCX 二进制，写入本地临时目录，返回 `{ id, config, serverUrl, available }`；`config` 直接传给 `DocsAPI.DocEditor`。
- `GET /api/office/documents/:id/file`：读取当前文档二进制，供预览刷新、同步、导出前取回。
- `POST /api/office/callback/:id`：OnlyOffice 回调入口；当回调状态为 `2` 或 `6` 且带 `url` 时，下载最新文档覆盖本地临时文件。
- `POST /api/office/download-url`：代理下载 OnlyOffice `downloadAs` 事件返回的文件地址；只允许 `127.0.0.1`、`localhost`、`host.docker.internal`。
- `server/office.js` 的 `buildOnlyOfficeConfig()` 负责生成 `document.url`、`document.key`、`editorConfig.callbackUrl` 和编辑权限；不要在前端手写 OnlyOffice 初始化配置。

#### 前端桥接函数

- `OnlyOfficePreview(config, ...)`：创建并销毁 `window.DocsAPI.DocEditor`，统一挂载 `onAppReady`、`onDocumentReady`、`onDownloadAs`、`onError`。
- `loadOnlyOfficeApi(serverUrl)`：加载 `${serverUrl}/web-apps/apps/api/documents/api.js?...`；重复调用会复用已加载脚本或已有 `window.DocsAPI.DocEditor`。
- `postOnlyOfficeCommand(container, message, attempts)`：向某个预览容器内的 iframe 重试投递消息，适合当前实例内命令。
- `postAllOnlyOfficeFrames(message, attempts)`：向页面内所有 iframe 和可访问子 iframe 重试投递消息，适合不知道命令实际落在哪层 iframe 的场景。
- `requestOnlyOfficeDocumentSave(trigger)`：发送 `save-document`，由注入脚本调用 `api.asc_Save(false)`。
- `requestOnlyOfficeDocumentDownloadAs(fileType, timeoutMs)`：调用当前活动编辑器的 `downloadAs(fileType)`，监听 `onDownloadAs`，再通过 `/api/office/download-url` 取回 `ArrayBuffer`。
- `fetchOnlyOfficeDownloadAsBuffer(url)`：下载 `downloadAs` 给出的临时文件地址。
- `requestOnlyOfficeFillField(field, options)`：组装写入 payload，发送 `fill-field-value`，等待 `field-fill` 回传。
- `requestOnlyOfficeAddFieldBookmark(field)`：发送 `add-field-bookmark`，让注入脚本按已有选区状态写入书签。
- `requestOnlyOfficeAddInputPoint(field)`：发送 `add-input-point`，让注入脚本在当前光标处写入输入点书签。
- `requestOnlyOfficeAddComplexFillAnchor(anchor)`：发送 `add-complex-fill-anchor`，让注入脚本读取 OnlyOffice 当前真实选区并创建 `GF_CF_` 选区书签，回传书签名、页码和选区原文。
- `requestOnlyOfficeSelectComplexFillAnchor(anchor)`：发送 `select-complex-fill-anchor`，按 `GF_CF_` 书签定位并选中对应范围，回传动态页码。
- `requestOnlyOfficeDeleteComplexFillAnchor(anchor)`：发送 `delete-complex-fill-anchor`，只移除对应 `GF_CF_` 书签，不删除书签范围内的文档文字。
- `requestOnlyOfficeFillComplexFillField(complexFill)`：发送 `fill-complex-fill-field`，让注入脚本按 `GF_CF_` 书签替换选区内容并保留同名书签。
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
  - `addComplexFillAnchor(payload)`：读取当前选区文本和 `selectionState`，先基于用户真实选区调用书签管理器 `AddBookmark()` 创建 `GF_CF_` 选区书签，再按书签范围选中并调用高亮工具，最后触发保存并回传 `{ anchor }`。
  - `selectComplexFillAnchor(payload)`：调用书签管理器的 `GoToBookmark` / `SelectBookmark` 或 `asc_*` 变体定位并选中 `GF_CF_` 书签，同时给该选区补灰色高亮。
  - `deleteComplexFillAnchor(payload)`：调用书签管理器的 `RemoveBookmark` / `asc_RemoveBookmark` 删除 `GF_CF_` 书签，保留原文内容，并尝试清除该选区高亮。
  - `fillComplexFillField(payload)`：按 `GF_CF_` 书签选中范围，先调用 `logicDocument.RemoveBeforePaste()` 删除当前书签选区原文，再用 `CSelectedContent`、`CParagraphBookmark`、`ParaRun.AddText()` 插入纯文本填充值，并重新保留同名书签；不要先删除书签，否则选区可能塌缩成光标，导致新内容插在旧内容前。
  - `saveOnlyOfficeDocument(trigger)`：调用 `api.asc_Save(false)` 并回传保存结果。
  - `setTrackRevisions(enabled)`：依次尝试 `asc_SetTrackRevisions`、`asc_setTrackRevisions`、`SetTrackRevisions`、`logicDocument.SetTrackRevisions`。
  - `postOutline()`、`postSelection()`、`postPageChange()`：把大纲、选区、页码变化回传给 React。
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
- `logicDocument.GetCurrentParagraph()` / `GetCurrentAnchorPosition()`：取得当前插入位置。
- `logicDocument.RemoveBeforePaste()` / `Remove(...)`：删除当前选区文本。
- `ParaRun.AddText(text)`：通过 OnlyOffice run 写入纯文本内容；不设置 run 直接字体属性时，字号等由当前位置的段落/样式体系决定。
- `logicDocument.StartAction(...)` / `FinalizeAction()`：把一组内部编辑操作包成一次历史动作。
- `logicDocument.Recalculate()`、`UpdateInterface()`、`UpdateSelection()`：插入或删除后刷新文档状态和 UI。
- `logicDocument.MoveCursorRight(true, false)`：从当前位置向右扩展选区。
- `api.SetMarkerFormat(true, true, r, g, b)`：OnlyOffice 工具栏高亮按钮同源接口，给当前选区套用指定高亮色。
- `api.SetMarkerFormat(true, false)`：OnlyOffice 工具栏“无高亮/透明色”同源接口，用于清除当前选区高亮。
- `api.put_LineHighLight(true, r, g, b)`：给当前选区加高亮，可作为 `SetMarkerFormat` 不可用时的兜底。
- `api.asc_ShowDocumentOutline()` / `api.asc_GetDocumentOutlineManager()`：打开并读取文档大纲管理器。
- `api.asc_SetTrackRevisions(enabled)` / `api.asc_setTrackRevisions(enabled)` / `SetTrackRevisions(enabled)`：设置修订模式。
- `AscWord.CParagraphBookmark` / `AscCommonWord.CParagraphBookmark`：创建书签开始/结束节点。
- `AscCommonWord.CSelectedContent` / `CSelectedElement`：组装并插入 OnlyOffice 内部选中内容。

#### 缓存与补丁

- 改 `scripts/onlyoffice-outline-probe.js` 或 `scripts/onlyoffice-placeholder-fields.js` 后，要同步 bump `scripts/patch-onlyoffice.py` 里的脚本 `?gf=` 版本。
- 改 Toolbar 注入或 RequireJS 资源加载后，要同步 bump `scripts/patch-onlyoffice.py` 里的 `urlArgs`。
- 改 `api.js` 相关缓存参数后，要同步 bump `_dc=9.4.0-129-gf*`。
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

- 手工 POST `http://127.0.0.1:8080/ai-proxy` 会 403，因为缺 OnlyOffice 编辑器运行时 JWT；这不是模型地址问题。
- 浏览器自动化向 OnlyOffice 插件 iframe 输入测试消息不稳定，但聊天面板能打开且没有未配置模型/403 报错。

### OnlyOffice 自定义组件

定制组件目前承载：

- 内容审查
- 大纲审查
- 标注字段
- 自动字段设置（占位符变量）
- 复杂类填充

不要再污染 OnlyOffice 原生工具按钮。业务按钮放在“定制组件”里。

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

1. 先运行 `npm run build`、`node --check server\ai.js`、`node --check server\office.js`。
2. 打开 `http://127.0.0.1:5173`。
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

## 下一步可能继续的方向

- 继续验证 OnlyOffice 原生 AI 插件在聊天/摘要/翻译中的实际响应效果。
- 继续优化填充确认工作台：填空输入点、选择型字段、长文本字段的通用写入策略。
- 继续稳定模板标注工作台：刷新后字段高亮持久化、字段页码与当前页联动。
- 继续评估是否能移除客户端 `docx-preview` fallback；确认 OnlyOffice 覆盖所有预览场景后，再删除依赖和 `.docx-preview-host` 样式。
