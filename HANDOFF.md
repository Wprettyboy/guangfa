# 项目交接文档

更新时间：2026-07-03

## 新会话先读

本项目根目录：`C:\Users\23811\Desktop\广发new`

当前已是可用 git 仓库，远端为 `https://github.com/Wprettyboy/guangfa.git`，本地 `main` 跟踪 `origin/main`。改代码前先读文件，避免误改用户未提交内容。

不要把 `.env.local` 里的云端 API Key 发到聊天窗口或文档里。

Git 代码管理已切到 `https://github.com/Wprettyboy/guangfa.git`。以后代码发生变动，完成必要检查后记得 `git commit` 并推送到远端，除非用户明确要求暂不提交。

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

### 选择型字段兜底

已修复 `server/ai.js` 选择型字段误填模板占位内容的问题。

场景：`业绩要求`、`人员要求` 这类 `单选项/choice` 字段，AI 以前会把模板里的“具有 证书”“证明材料复印件”“社保缴费证明”等占位/说明文字当成填充值。

现在规则：

- AI 返回 `需补充资料` 时强制 `value=""`、`confidence=0`。
- 模板占位、证明材料说明、未填写候选项不得写入。
- 有明确资料时仍允许返回有效选项，例如 `无业绩要求。`、`无人员要求。`。

已用模板 `3.16询比采购文件【工程类】` 的这些字段测过：

- `F-017` 业绩要求
- `F-018` 人员要求
- `F-042` 业绩要求
- `F-043` 人员要求

## 关键业务约定

### 字段类型

当前字段类型包括：

- `填空`
- `单选项`

约定：

- `填空`：优先写入已设置的输入点；如果模板已用 OnlyOffice 真实选区标注，且选区原文本身包含可填写目标（如引号空位、冒号标签、日期空位、金额空位、句末空白占位等），可直接使用标注选区作为填写范围，AI 只生成值，前端/OnlyOffice 负责把值写入空位并保留模板固定文本。当前二级分类为：
  - `短文本`：短文本填空。当前特例：框选原文为分包/分标段/标段划分时，知识库/资料有对应内容或值就按原值填写；没有对应内容时默认填写 `1`。
  - `长文本`：段落/清单/表格类长内容统一走长文本填空；AI 可以基于知识库/资料召回片段归纳、合并和规范表述，但关键事实、数字、日期、名称、资质、人员、业绩等必须能被召回资料支撑，不得编造资料中没有的信息。
  - `日期`：日期/时间填空，常见选区是“ 年 月 日”“ 年 月 日 时 分”这类日期/时间空位，以及“日期：”标签；前两类按模板空位拆分写入，模板含时分时资料必须明确到时、分，标签类只写日期/时间值。
  - `金额`：金额填空，优先匹配模板金额空位和单位；能识别模板单位时必须换算成模板单位下的纯数字，识别不到模板单位时保留资料金额单位。
- `单选项`：必须按用户标注时选择的二级分类执行，不要再靠“财务要求/业绩要求/人员要求”等字段语义硬分流。当前二级分类为：
  - `选择`：只勾选对应选项，不改写原文。
  - `替换+选择`：知识库/资料有对应内容时，由 AI 语义判断同类依据，并整理为可整体替换用户标注选区的完整要求文本；关键事实必须被召回资料支撑；没有命中对应内容时只勾选模板里的“无xx要求”选项。
  - `金额+选择`：按模板单位写入金额，并勾选对应选项。
- `单选项` 的截图或测试字段只是样例，财务要求、业绩要求、人员要求、资质要求等都应走同一类通用逻辑；不得为单个测试用例写专门分支。

### 填空提示词方向

模板选区原文只是“要填哪里”的上下文，不是资料来源。AI 不能复制招标文件模板中的空白项、字段标签、选区原文当作答案。

知识库/上传资料是编制依据。比如资料写“项目名称统一使用 XXX”，即使出现“后续”等上下文词，也应视为可用命名依据。

### OnlyOffice 自定义组件

定制组件目前承载：

- 内容审查
- 大纲审查
- 标注字段

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
