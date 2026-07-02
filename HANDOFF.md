# 项目交接文档

更新时间：2026-07-02

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

## 核心文件

- `src/main.jsx`：主前端，包含模板标注、填充确认、格式审核、OnlyOffice 预览。
- `server/office.js`：DOCX 上传给 OnlyOffice、callback 保存、download-url、OnlyOffice 初始化配置。
- `server/ai.js`：AI 填充接口 `/api/ai/fill-field` 和大纲审查接口 `/api/ai/format-outline-plan`。
- `server/knowledge-base.js`：知识库检索与召回。
- `scripts/start-onlyoffice.ps1`：启动 OnlyOffice Docker、拷贝字体、打补丁、写入 AI 配置。
- `scripts/patch-onlyoffice.py`：补 OnlyOffice 前端，包括隐藏品牌、注入定制组件入口等。
- `scripts/onlyoffice-outline-probe.js`：注入 OnlyOffice 的桥接脚本，负责大纲、选区、页码、标注、输入点、保存、回填等消息。
- `data/templates`、`data/knowledge`、`data/drafts`：本地业务数据。

## 当前技术路线

1. 文档预览已经切到 OnlyOffice，不再以 `docx-preview` 做主预览。
2. 自定义业务功能通过 OnlyOffice 的“定制组件”按钮和 `postMessage` 与 React 通信。
3. 模板标注以 OnlyOffice 真实选区为准，字段保存的是选区原文、页码、bookmark/selection/inputPoint 等信息。
4. 填充确认工作台优先用 OnlyOffice 现场写入与下载回传保存，避免旧 HTML DOCX 预览链路导致状态丢失。
5. 格式审核工作台保留脚本审查 + AI 大纲审查；修复仍由脚本写 DOCX 副本。

## 最近已完成

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

- `填空`：必须有输入点，AI 只生成值，写入输入点。当前二级分类为：
  - `短文本`：短文本填空。
  - `长文本`：段落/清单/表格类长内容统一走长文本填空。
  - `日期`：日期填空，优先匹配模板日期空位。
  - `金额`：金额填空，优先匹配模板金额空位和单位。
- `单选项`：必须按用户标注时选择的二级分类执行，不要再靠“财务要求/业绩要求/人员要求”等字段语义硬分流。当前二级分类为：
  - `选择`：只勾选对应选项，不改写原文。
  - `替换+选择`：资料有明确要求时替换标注选区；资料无明确要求时只勾选模板里的“无xx要求”选项。
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
- 页面刷新后高亮/填充丢失，优先考虑调用 OnlyOffice 下载接口回传保存，而不是只保存前端字段 JSON。
- 删除字段、刷新页面、切换工作台时不要重载旧模板文件，否则预览会回到旧文档。
- `scripts/start-onlyoffice.ps1` 会重启容器并重新打补丁，调试 OnlyOffice 注入脚本后要跑它或手动 `docker cp`。
- `.js` 和 `.js.gz` 缓存都可能影响 OnlyOffice 前端脚本。调试 `guangfa-outline-probe.js` 后要确认容器内 `.js.gz` 解压内容和 `.js` 哈希一致，并 bump `index.html` 里脚本的 `?gf=` 缓存号；否则浏览器可能继续加载旧桥接脚本，表现为“代码改了但 OnlyOffice 仍按旧逻辑写入”。

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

5. 做业务修复前，先从 `src/main.jsx` 找完整调用链，不要只改当前按钮事件。

## 下一步可能继续的方向

- 继续验证 OnlyOffice 原生 AI 插件在聊天/摘要/翻译中的实际响应效果。
- 继续优化填充确认工作台：填空输入点、选择型字段、长文本字段的通用写入策略。
- 继续稳定模板标注工作台：刷新后字段高亮持久化、字段页码与当前页联动。
- 继续减少旧 `docx-preview/html docx` 逻辑残留。
