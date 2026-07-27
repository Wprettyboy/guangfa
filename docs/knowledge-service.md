# 独立知识库服务

知识库服务复用现有 MinerU、BGE-M3、Reranker、ZVec V4 和知识库 API，但使用独立 SQLite、文件目录和 Docker volume。完整的业务接口、认证、上传、轮询、检索、溯源和多语言示例见 [Knowledge API 接入指南](./knowledge-api-integration.md)。

## 启动

先确保 MinerU、Retrieval 和 OnlyOffice 已启动，再执行：

```powershell
npm run knowledge:docker
```

首次启动会在被 Git 忽略的 `data/knowledge-service/` 下创建：

- `service.env`：容器环境、API 凭证和模型连接配置。
- `client-config.json`：供本机其它项目调用的 Base URL、API Key header 和项目范围。

服务监听 `http://127.0.0.1:8787`，健康检查为 `/healthz`，就绪检查为 `/readyz`，OpenAPI 为 `/api/v1/_meta/openapi.json`。

## 从主项目迁移

首次部署并确认空服务健康后，停止主 Web 服务，再执行：

```powershell
npm run knowledge:migrate
```

迁移脚本会先备份 `guangfa-knowledge-data`，再复制知识表、Embedding 缓存、原文件和 MinerU 产物；Windows ZVec 不会复制，而是在 Linux 容器中重建新的 V4 generation。数量、引用文件和真实检索探针全部通过后，脚本才会把 `KNOWLEDGE_SERVICE_BASE_URL` 和服务器端 API Key 写入被 Git 忽略的 `.env.local`。失败时自动恢复迁移前的 volume。

迁移完成后重新启动主 Web 服务。浏览器仍调用主项目 `/api/v1`，由主项目在用户认证之后转发知识路由；API Key 不会下发到前端。迁移后的旧 `data/guangfa.sqlite` 只作为回退快照，不再是活动知识库写入目标。

## 调用约定

所有业务接口都携带 `X-API-Key`。API Key 在 `API_AUTH_API_KEYS` 中绑定一个或多个 `projectIds`；启用 `KNOWLEDGE_TENANT_MODE=required` 后，服务端会拒绝越权知识库、文档、图片和表格访问。

上传优先使用：

```text
POST /api/v1/knowledge-bases/{kbId}/documents/upload
Content-Type: multipart/form-data
Idempotency-Key: <每次业务上传的稳定唯一值>
file: <原文件>
name: <可选显示名>
```

兼容的 Base64 JSON 上传接口仍保留。上传返回 `202` 后，通过 `GET /api/v1/knowledge-documents/{documentId}/status` 读取解析和索引状态。

## 持久化与边界

- Docker volume `guangfa-knowledge-data` 保存 `knowledge.sqlite`、原文件、MinerU 产物和 ZVec generations。
- Knowledge API 保持单实例；当前后台任务和 ZVec 写队列是进程内状态，不允许多个写实例挂载同一个 volume。
- MinerU、Retrieval 和 OnlyOffice 通过 `host.docker.internal` 调用宿主已发布端口，仅 Knowledge API 对业务项目开放。
- 对外开放时应放在 HTTPS 反向代理后，并按实际域名配置 `API_ALLOWED_ORIGINS`。
- `KNOWLEDGE_PUBLIC_BASE_URL` 是浏览器访问图片/表格能力 URL 的服务 Origin；本机为 `http://127.0.0.1:8787`，远程部署必须改成实际 HTTPS 地址。
