# Knowledge API 接入指南

## 1. 服务边界

Knowledge API 是独立的知识入库与检索服务，负责原文件保存、MinerU 解析、结构切片、BGE-M3 Dense/Sparse 编码、ZVec V4 混合检索、Reranker 和引用定位。调用方不需要直接访问 SQLite、ZVec、MinerU、Retrieval 或 OnlyOffice。

本机地址：

```text
Base URL: http://127.0.0.1:8787/api/v1
Health:   http://127.0.0.1:8787/healthz
Ready:    http://127.0.0.1:8787/readyz
OpenAPI:  http://127.0.0.1:8787/api/v1/_meta/openapi.json
```

跨机器部署必须通过 HTTPS 反向代理暴露。当前服务采用单写实例，不能让多个 Knowledge API 容器同时挂载同一个数据卷。

## 2. 认证与项目隔离

所有业务请求在服务器端携带：

```http
X-API-Key: <service-api-key>
```

每个 API Key 在服务端绑定角色和 `projectIds`。项目库只能被拥有对应 `projectId` 的身份访问；全局库可读，但非管理员不能写。请求正文中的 `projectId` 不能扩大 Key 的权限范围。

API Key 只能放在后端环境变量或 Secret Manager，不能写进 React/Vue 页面、移动端包或公开仓库。浏览器应用应调用自己的后端，再由后端转发到 Knowledge API。

新增调用方时，由运维人员在 `API_AUTH_API_KEYS` 中添加独立 Key、principal ID、角色及项目范围，然后安全下发给该服务。不要让多个业务系统共用同一 Key。

## 3. 标准调用流程

```text
创建或选择知识库
→ multipart 上传原文件（稳定 Idempotency-Key）
→ 收到 202 和 document.id
→ 轮询 document status 至终态
→ 使用显式 kbIds / globalKbIds 检索
→ 按结果中的 documentId、page、bbox、image/table 信息溯源
```

### 3.1 创建和列出知识库

```bash
curl -H "X-API-Key: $KNOWLEDGE_API_KEY" \
  http://127.0.0.1:8787/api/v1/knowledge-bases
```

```bash
curl -X POST \
  -H "X-API-Key: $KNOWLEDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"项目资料库","scope":"project","projectId":"project-a","description":"项目 A 资料"}' \
  http://127.0.0.1:8787/api/v1/knowledge-bases
```

`scope` 为 `project` 或 `global`。普通项目 Key 创建项目库时，服务端会以 Key 绑定的项目范围为准。

### 3.2 上传资料

推荐 multipart 接口：

```bash
curl -X POST \
  -H "X-API-Key: $KNOWLEDGE_API_KEY" \
  -H "Idempotency-Key: project-a-contract-20260728-v1" \
  -F "name=采购合同" \
  -F "file=@./采购合同.pdf" \
  http://127.0.0.1:8787/api/v1/knowledge-bases/KB_ID/documents/upload
```

支持 PDF、DOCX、PPTX、XLSX 和 TXT，单请求上限 120 MiB。相同业务上传必须复用同一个 `Idempotency-Key`：

- 首次接收通常返回 `202`。
- 相同 Key 和相同文件重放返回已有资料。
- 相同 Key 搭配不同文件返回 `409`。
- 网络超时后不要生成新 Key 盲目重传，否则可能创建重复业务操作。

兼容接口 `POST /knowledge-bases/{kbId}/documents` 接受 Base64 JSON，但新服务应优先使用 multipart。

### 3.3 轮询处理状态

```http
GET /api/v1/knowledge-documents/{documentId}/status
```

上传响应中的 `id` 就是 `documentId`。建议每 1 至 2 秒轮询一次，并设置业务总超时。`processingStage` 非空或状态为 `解析中/索引中` 时继续等待；常见终态如下：

| 状态 | 含义 |
| --- | --- |
| `已索引` | 解析、图片说明和 V4 索引可用 |
| `部分可用` | 正文可检索，但图片说明或部分派生能力失败 |
| `关键词可用` | 向量能力降级，仍可走关键词检索 |
| `解析失败` | 文档没有形成可检索内容，查看 `error` |

### 3.4 检索

```bash
curl -X POST \
  -H "X-API-Key: $KNOWLEDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query":"注册资本 5000 万 资质要求",
    "projectId":"project-a",
    "kbIds":["KB_PROJECT_A"],
    "globalKbIds":["KB_GLOBAL"],
    "topK":5,
    "filters":{
      "documentIds":["DOC_ID"],
      "pageFrom":3,
      "pageTo":20,
      "isTable":false,
      "hasStar":true,
      "blockTypes":["text"],
      "headingPaths":["第三章>资格要求"]
    }
  }' \
  http://127.0.0.1:8787/api/v1/knowledge-bases/search
```

`kbIds`、`globalKbIds` 和 `filters` 都是显式约束。无结果时服务端不会自动取消过滤。`topK` 支持 1 至 10；业务默认建议填充/聊天使用 5，长方案使用 8。

响应结构：

```json
{
  "items": [
    {
      "id": "CHUNK_ID",
      "documentId": "DOC_ID",
      "documentName": "采购合同.pdf",
      "text": "用于送入大模型的有界上下文",
      "sourceText": "命中原文",
      "page": 7,
      "bbox": [120, 180, 900, 260],
      "headingPath": "第三章>资格要求",
      "blockType": "text",
      "isTable": false,
      "fusionScore": 0.03,
      "rerankScore": 0.91,
      "score": 0.91,
      "mode": "dense-sparse-fts"
    }
  ],
  "diagnostics": {
    "indexVersion": 4,
    "channels": ["dense", "sparse", "fts"],
    "candidateCount": 20,
    "finalCount": 5,
    "reranker": true,
    "filtersApplied": {},
    "degradedReasons": [],
    "contextTokensEstimated": 1800,
    "elapsedMs": 320
  }
}
```

定位字段以实际响应为准：PDF 可能提供物理页 `page` 和 MinerU 0-1000 坐标 `bbox`；非 PDF 不会伪造 bbox。上下文扩展不会改写命中证据的 `documentId/page/bbox/sourceText`。

## 4. 原文、图片和表格

| 用途 | 接口 |
| --- | --- |
| 原始上传文件 | `GET /knowledge-documents/{documentId}/file` |
| 分页溯源 PDF（存在时） | `GET /knowledge-documents/{documentId}/source-pdf` |
| DOCX 只读预览配置 | `POST /knowledge-documents/{documentId}/office-preview` |
| 文档图片清单 | `GET /knowledge-documents/{documentId}/images` |
| MinerU 图片证据 | `GET /knowledge-document-images/{imageId}/file` |
| 图片检索 | `POST /knowledge-images/search` |
| 文档表格清单 | `GET /knowledge-documents/{documentId}/tables` |
| 命中块原始表格结构 | `GET /knowledge-chunks/{chunkId}/table` |
| 表格检索 | `POST /knowledge-tables/search` |

图片/表格清单或检索结果可能返回带短期 `accessToken` 的能力 URL，浏览器可直接使用该 URL，不应把 API Key拼到查询参数。能力 URL 有有效期，过期后重新获取清单或检索结果。

## 5. 删除、重试和重建

```text
DELETE /knowledge-bases/{kbId}/documents/{documentId}
DELETE /knowledge-bases/{kbId}
POST   /knowledge-bases/{kbId}/documents/{documentId}/retry-images
POST   /knowledge-bases/{kbId}/reindex
```

`reindex` 会生成新的不可变 ZVec V4 generation，并在校验通过后切换 manifest。它是管理操作，不应在每次查询前调用。

## 6. 错误和重试

错误统一为：

```json
{
  "error": "可读错误",
  "code": "STABLE_ERROR_CODE",
  "message": "可读错误",
  "requestId": "request-id",
  "details": []
}
```

| HTTP | 处理建议 |
| --- | --- |
| `400/415/422` | 修正参数、Content-Type 或文件，不重试原请求 |
| `401/403` | 检查 Key、角色和 `projectIds`，不要自动重试 |
| `404` | 核对资源 ID 或资料是否已删除 |
| `409` | 检查幂等键冲突或资源状态 |
| `413` | 文件超过 120 MiB，调用方先阻止上传 |
| `429` | 遵循 `Retry-After` 并指数退避 |
| `502/503/504` | 可有限重试；查询建议最多 1 至 2 次，上传必须复用原幂等键 |

每个调用方应记录 `requestId`、接口、HTTP 状态、业务 `documentId/kbId` 和耗时，但不能记录 API Key 或整份业务原文。

## 7. 代码示例

### Node.js 22+

```js
import fs from "node:fs";

const baseUrl = process.env.KNOWLEDGE_API_BASE_URL;
const apiKey = process.env.KNOWLEDGE_API_KEY;

const form = new FormData();
form.append("name", "采购需求");
form.append("file", new Blob([await fs.promises.readFile(filePath)]), "采购需求.pdf");

const response = await fetch(`${baseUrl}/knowledge-bases/${kbId}/documents/upload`, {
  method: "POST",
  headers: {
    "X-API-Key": apiKey,
    "Idempotency-Key": stableBusinessUploadId,
  },
  body: form,
  signal: AbortSignal.timeout(10 * 60 * 1000),
});
if (!response.ok) throw new Error(`Knowledge upload failed: ${response.status}`);
const document = await response.json();
```

### Python requests

```python
import os
import requests

base_url = os.environ["KNOWLEDGE_API_BASE_URL"]
headers = {
    "X-API-Key": os.environ["KNOWLEDGE_API_KEY"],
    "Idempotency-Key": stable_business_upload_id,
}
with open(file_path, "rb") as source:
    response = requests.post(
        f"{base_url}/knowledge-bases/{kb_id}/documents/upload",
        headers=headers,
        files={"file": ("source.pdf", source, "application/pdf")},
        data={"name": "采购需求"},
        timeout=(5, 600),
    )
response.raise_for_status()
document = response.json()
```

## 8. 上线检查清单

1. 为调用方创建独立 Key，并绑定最小角色和准确 `projectIds`。
2. 设置 HTTPS、`KNOWLEDGE_PUBLIC_BASE_URL` 和允许的前端 Origin。
3. 调用 `/healthz`、`/readyz` 和认证后的知识库列表。
4. 用小型资料跑通上传、轮询、检索、原文和图片/表格资源。
5. 确认检索 `diagnostics.indexVersion=4`，记录并监控 `degradedReasons`。
6. 为 Docker volume 做定期备份；升级或迁移前先停写并备份。
