# API 生产部署与多用户治理

## 部署模型

项目保留一套 API 注册表，三种运行方式复用同一个网关：

- `npm run dev`：本机开发，未显式配置时允许 `API_AUTH_MODE=disabled`。
- `npm run preview`：构建预览，同样挂载真实 API，不再只有静态前端。
- `npm start`：正式 Node 服务，强制认证、OnlyOffice JWT 和生产安全检查。

正式启动：

```powershell
npm ci
npm test
npm run build
npm start
```

正式服务默认只监听 `127.0.0.1:5173`。推荐由 Nginx、Caddy、IIS 或负载均衡器提供 HTTPS；确需直接监听其他网卡时设置 `API_HOST=0.0.0.0`，并确保防火墙和认证配置已经生效。

## API 版本

稳定入口为 `/api/v1/...`，OpenAPI 位于 `/api/v1/_meta/openapi.json`。旧 `/api/...` 暂时保留兼容，并返回 `Link: rel="successor-version"`；新增客户端必须使用 v1。

## 身份和角色

生产环境必须设置：

```dotenv
API_AUTH_MODE=required
API_AUTH_BEARER_TOKENS={"a-random-token-of-at-least-32-bytes":{"id":"user-001","roles":["editor"]}}
API_AUTH_API_KEYS={"another-random-key-of-at-least-32-bytes":{"id":"onlyoffice-service","roles":["service"]}}
```

凭证必须是至少 32 字节的随机值。可用 Node 生成：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

浏览器图片和 Document Server 下载使用独立的短期能力票据，不会把用户 Bearer Token 放入 URL。生产环境还必须配置与登录凭证不同的签名密钥：

```dotenv
API_CAPABILITY_SECRET=another-independent-random-secret-of-at-least-32-bytes
API_CAPABILITY_TTL_SECONDS=600
API_CAPABILITY_MAX_TTL_SECONDS=1800
```

能力票据使用 HMAC-SHA256 签名并精确绑定接口 scope 和单个资源，默认 10 分钟、最长不超过 1 小时。资源接口在收到 Bearer/API Key 时仍按正常角色授权；只有完全没有认证头时才接受对应的 `accessToken`。不要在日志、页面持久化数据或外部消息中长期保存签名 URL。

角色含义：

- `viewer`：读取模板、知识库和业务结果。
- `editor`：包含 viewer 权限，可上传、生成和修改业务数据。
- `admin`：包含全部普通权限，可管理模型配置和调试接口。
- `service`：供受控的服务间调用使用，不等同管理员。

浏览器端凭证只保存在当前标签页的 `sessionStorage`，关闭标签页后失效；不要把用户 Token 写入源码、构建变量或 OnlyOffice 的持久化存储。生产上应为每位用户发放独立 Token，以便审计和撤销。

前后端同源部署时保持 `VITE_API_BASE_URL` 为空；仅在前端与 API 分离部署时设置为 API 的 HTTPS Origin，并在构建环境和 Node 运行环境保持同一值，以便前端地址和 CSP `connect-src` 同步。`VITE_API_TIMEOUT_MS` 控制普通请求超时，AI 请求仍至少等待 180 秒。

## 多用户数据边界

- 草稿按认证身份隔离，并采用临时文件加原子替换保存。
- 模板与知识库是组织级共享资源，写操作要求 editor/admin；模板使用 revision/ETag 和 `If-Match` 防止静默覆盖。
- 知识上传的幂等键按“知识库 + 认证身份 + Idempotency-Key”隔离；同一身份用同一键提交不同内容返回 409。原始身份和幂等键只以哈希形式存储，内容哈希 + 安全文件名仍在组织范围内去重。
- Office 临时文档使用不可猜测 ID、短期访问令牌和 TTL 清理；Document Server 回调使用独立 JWT 验签。
- 模型配置属于系统级配置，仅 admin 可读取、测试或修改。

## OnlyOffice JWT

`ONLYOFFICE_JWT_SECRET` 必须与 Document Server 容器完全一致且至少 32 字节。`scripts/start-onlyoffice.ps1` 以 `JWT_ENABLED=true`、`JWT_SECRET` 和 `JWT_HEADER` 启动容器；应用按 OnlyOffice 官方 HS256 协议签发编辑器配置和临时文件 Token，并验证回调 Token、文档 key、状态和时效。

Document Server 对带 `accessToken` 的精确资源 URL 禁止附加 outbox `Authorization`，否则它会被 API 认证层当成用户 Bearer。启动脚本通过官方 `services.CoAuthoring.token.outbox.urlExclusionRegex` 配置 `[?&]accessToken=`；callback 不含该查询参数，仍保留 outbox JWT。

不要把普通用户 Bearer Token 放进 OnlyOffice localStorage。注入脚本只在内存中使用当前会话 Token，持久化知识库上下文时会剔除凭证。

OnlyOffice AI 插件配置会进入浏览器，`ONLYOFFICE_AI_CLIENT_API_KEY` 因此只能是无外部权限的本地占位值（默认 `sk-local`），不能复用 `LOCAL_LLM_API_KEY`、云模型 Key 或任何服务端凭证。

## CORS、TLS 和代理

生产环境把所有浏览器 Origin 显式写入 `API_ALLOWED_ORIGINS`，逗号分隔，不支持 `*`。网关允许的请求头包括 `Authorization`、`X-API-Key`、`If-Match`、`Idempotency-Key` 和 `X-Request-ID`。

经反向代理部署时，仅在代理会覆盖并清洗 `X-Forwarded-Proto`、`X-Forwarded-Host` 和 `X-Forwarded-For` 的前提下设置：

```dotenv
API_TRUST_PROXY=true
API_HSTS=true
```

直接由 Node 终止 TLS 时同时设置 `TLS_CERT_FILE` 与 `TLS_KEY_FILE`。不要在明文公网 HTTP 上传输 Token。

云端模型的出站代理与 `API_TRUST_PROXY` 是两类配置。Windows 的“系统代理”不会自动进入 Node 进程；本机代理软件使用 Fake-IP DNS 时，在 `.env.local` 显式设置：

```dotenv
AI_PROXY_URL=http://127.0.0.1:7890
```

`AI_PROXY_URL` 优先于标准的 `HTTPS_PROXY`、`HTTP_PROXY` 和 `ALL_PROXY`；云端模型通常是 HTTPS，因此未配置项目变量时先读取 `HTTPS_PROXY`，再读取 `ALL_PROXY`。代理地址仅允许不带路径、查询参数、片段或凭据的 HTTP(S) URL。需要明确关闭继承到进程中的标准代理时，设置 `AI_PROXY_URL=off`。

修改 `.env.local` 后需要重启 Node/Vite 进程，运行中的服务不会自动重载代理环境变量。

本地回环模型和本地 Embedding 默认直连，不经过云端代理。HTTPS 云模型通过代理建立 CONNECT 隧道，目标域名和 SNI 保持为原始模型域名，不使用本机 Fake-IP 作为目标地址；未使用代理的直连请求仍执行 DNS/SSRF 校验。不要为兼容 Fake-IP 删除 `198.18.0.0/15` 等禁止网段。

## 资源和安全限制

- JSON、DOCX、PDF、TXT 均按字节限制；DOCX 同时限制 ZIP 条目数、单条目大小、解压总量和压缩比。
- 知识库图片只允许经过魔数验证的 PNG/JPEG/GIF/BMP/WebP；SVG 不以内联同源内容提供。
- 云端 AI Base URL 只允许 HTTPS，主机名和字面 IP 不能指向受限地址；直连时 DNS 解析结果也不能落到本机、内网、链路本地或云元数据地址。
- Office 文档下载只允许配置的本地 Document Server 协议、主机和端口。
- 方案生图文件按创建用户隔离，默认保存 24 小时且最多保留 200 组；可通过 `SOLUTION_IMAGE_TTL_MS` 和 `SOLUTION_IMAGE_MAX_ITEMS` 在安全范围内调整。
- 默认按用户和路由限流；多实例部署还应在共享反向代理或 API Gateway 配置分布式限流。

当前持久化模型支持单个可写 Node 实例承载多个认证用户。草稿、Office 临时文件以及 SQLite/WAL 都是本机状态；如需水平 active-active，必须先迁移到共享数据库和对象存储，并增加分布式锁、幂等存储与限流，不能直接启动两个可写实例指向同一数据目录。

## 运行观测

每个 API 响应返回 `X-Request-ID`，错误体固定包含 `code`、`message` 和 `requestId`。服务端向标准输出写 JSON 请求完成日志和错误日志，生产环境应采集到集中日志系统。

探针：

- `/healthz`：进程存活。
- `/readyz`：生产前端构建存在且可提供服务。

上线前最小门禁：

```powershell
npm test
npm run build
node --check server/index.js
```
