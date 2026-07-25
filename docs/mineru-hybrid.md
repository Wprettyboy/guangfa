# MinerU Hybrid 知识解析部署

## 架构

项目固定使用 MinerU `3.4.4` 的 Hybrid 路线：

- PDF 与图片使用 `hybrid-http-client`。默认 `effort=medium`，Pipeline 负责版面与 bbox，MinerU VLM 负责版面块内容提取；需要整页高精度解析时可切换 `effort=high`。
- DOCX、PPTX、XLSX 由 MinerU 自带 Office parser 解析；DOCX 解析主链不依赖 OnlyOffice，入库后的标题物理页映射才会异步调用 OnlyOffice。
- TXT 继续使用项目内原生文本解析。
- 原始上传文件始终保留在 `data/knowledge/files/<documentId>/source.<ext>`；Markdown、middle JSON、content list 和图片保存在同目录的 `mineru/`。
- Markdown 用于人工查看。入库定位以 content list / middle JSON 的页码、bbox、块类型和标题级别为准。
- DOCX 入库完成后会用 OnlyOffice 同一渲染链生成临时 PDF，仅按 MinerU 标题路径映射章节起始物理页码；临时 PDF 会立即删除，不替代原始 DOCX，也不把章节页伪装成子块精确页。

Docker 容器拓扑：

- `guangfa-mineru-vlm`：可选的本地 Qwen/MinerU 视觉模型，仅在 `local-vlm` profile 下启动并提供 OpenAI-compatible 端口 `30000`。
- `guangfa-mineru-api`：运行 MinerU API、Hybrid Pipeline 和 Office parser，默认通过宿主 Node 网关把 VLM 请求转发到 Gemini，仅将 `127.0.0.1:8010` 暴露给本项目。

## 当前机器与硬件前提

本机的 `npm run mineru` 使用 `docker/mineru/compose.amd.yaml`，通过 Docker Desktop 的 `/dev/dxg` 和 ROCDXG 访问 Radeon 8060S。原有 `docker/mineru/compose.yaml` 保留为 NVIDIA 主机路线，由 `npm run mineru:nvidia` 启动。

本机已确认是 Ryzen AI MAX+ 395、Radeon 8060S、`gfx1151`、Docker Desktop 4.74.0 和 WSL2 Ubuntu 24.04，并已完成 AMD ROCm 7.2.1、ROCm PyTorch 和 MinerU 3.4.4 的 Docker 部署。`KNOWLEDGE_PARSER` 默认使用 `mineru`；只有临时诊断旧链路时才显式改为 `legacy`。

## AMD Docker 部署与启动

AMD Compose 不复用 NVIDIA 的 `--gpus` 配置。服务进程全部运行在 Docker 容器中；首次准备时把已经过 GPU 实算验证的 WSL ROCm、MinerU 虚拟环境和模型导入三个只读 Docker named volumes，避免重复下载约 20 GB 运行时：

- `docker/mineru/Dockerfile.amd`：仅安装 Ubuntu、Python、OpenCV 和 ROCm 动态链接所需的系统库；ROCm、Python 包和模型不烘焙进镜像。
- `docker/mineru/compose.amd.yaml`：把 `/dev/dxg` 与 WSL GPU 用户态库映射给 VLM/API 容器，并挂载 `guangfa-mineru-rocm`、`guangfa-mineru-runtime`、`guangfa-mineru-modelscope` 三个只读 volume。
- `scripts/prepare-mineru-docker-amd.ps1`：只在 volume 未准备时，从 WSL 导入已验证的 ROCm、MinerU 虚拟环境、VLM 模型和 Pipeline 模型；完成标记存在时直接复用。
- `scripts/start-mineru-docker-amd.ps1`：构建 AMD 镜像，先在临时容器中执行 GPU 张量实算，再停止旧 WSL MinerU 进程并启动 API；本地视觉模型需显式使用 `--profile local-vlm` 启动。
- `scripts/complete-mineru-deployment.ps1`：首次下载和准备 WSL ROCm/MinerU 运行时，随后导入 Docker volumes、启动容器并提交真实 PDF 冒烟任务。
- `scripts/bootstrap-mineru-wsl.sh`：校验 ROCm PyTorch/Triton/TorchVision wheel，安装 `mineru[pipeline,vlm]==3.4.4` 与其缺失的 `six` 运行依赖，用 GPU 张量实算验证 Radeon 8060S，并从 ModelScope 下载 Pipeline 与 VLM 模型。
- `scripts/mineru_transformers_server.py`：在 `127.0.0.1:30000` 提供官方 `MinerU2.5-Pro-2605-1.2B` 的 OpenAI-compatible VLM 接口。
- `scripts/start-mineru-wsl.ps1` / `.sh`：仅作为运行时准备和诊断后备，由 `npm run mineru:wsl` 显式启动；默认入口与全栈入口均不再运行 WSL Python 服务。

部署完成必须同时满足：`docker compose ps` 显示 VLM/API 健康、容器内 PyTorch GPU 张量实算正确、真实页面 VLM 推理成功、真实 PDF 任务完成且 ZIP 中包含 content list。只看见 `/dev/dxg`、只安装运行时或只通过健康接口都不能视为完成。

AMD Docker 日志：

```powershell
docker compose -f docker/mineru/compose.amd.yaml ps
docker compose -f docker/mineru/compose.amd.yaml logs -f mineru-api

# 需要本地 Qwen/MinerU 回退时才启动
docker compose -f docker/mineru/compose.amd.yaml --profile local-vlm up -d mineru-vlm
docker compose -f docker/mineru/compose.amd.yaml logs -f mineru-vlm
```

NVIDIA Compose 日志：

```powershell
docker compose -f docker/mineru/compose.yaml logs -f mineru-vlm mineru-api
```

一键开发启动会把宿主进程日志写到：

- `C:\llm\guangfa-mineru.log`
- `C:\llm\guangfa-mineru.err.log`

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `KNOWLEDGE_PARSER` | `mineru` | 默认使用 MinerU；设为 `legacy` 可临时诊断旧解析链路，MinerU 失败时不会自动回退。 |
| `MINERU_API_URL` | `http://127.0.0.1:8010` | Node 服务调用 MinerU API 的地址。 |
| `MINERU_BACKEND` | `hybrid-http-client` | 只接受 `hybrid-http-client` 或 `hybrid-engine`。 |
| `MINERU_EFFORT` | `medium` | `medium` 或 `high`。 |
| `MINERU_VLM_URL` | 空（按 provider 选择） | 显式覆盖 MinerU API 的 VLM 地址；通常留空，让 Gemini 优先模式使用 `MINERU_VLM_GATEWAY_URL`，本地模式使用 `http://mineru-vlm:30000`。 |
| `MINERU_VLM_PROVIDER` | `gemini-first` | VLM 路由：`gemini-first` 优先 Gemini、失败回退本地；`cloud` 只用 Gemini；`local` 只用本地。 |
| `MINERU_VLM_GATEWAY_URL` | `http://host.docker.internal:5173` | Gemini 优先模式下，MinerU API 容器访问宿主 Node VLM 网关的地址。 |
| `MINERU_VLM_LOCAL_BASE_URL` | `http://127.0.0.1:30000` | Node 网关回退本地 MinerU VLM 时使用的地址。 |
| `MINERU_DOWNLOAD_SOURCE` | `modelscope` | WSL 首次部署下载 Pipeline 模型的来源。 |
| `MINERU_VL_MODEL_PATH` | `/opt/guangfa-mineru/models/MinerU2.5-Pro-2605-1.2B` | Docker runtime volume 内的 VLM 模型目录。 |
| `MINERU_VL_MODEL_NAME` | `opendatalab/MinerU2.5-Pro-2605-1.2B` | API 与 vLLM 共同使用的模型服务名。 |
| `MINERU_PARSE_TIMEOUT_MS` | `3600000` | 单个解析任务总超时，范围 1 至 4 小时。 |
| `MINERU_VLM_GPU_DEVICE` | `0` | VLM 容器使用的 NVIDIA GPU。 |
| `MINERU_API_GPU_DEVICE` | `0` | Hybrid Pipeline 容器使用的 NVIDIA GPU。 |
| `MINERU_VLM_GPU_MEMORY_UTILIZATION` | `0.55` | vLLM KV cache 显存比例。 |
| `MINERU_PROCESSING_WINDOW_SIZE` | `16` | Hybrid 分页处理窗口。 |
| `MINERU_HYBRID_BATCH_RATIO` | `1` | Pipeline 小模型批处理倍率。 |

多 GPU 主机建议把 VLM 与 API 分配到不同设备。单 GPU 部署需要按显存实测下调 vLLM 比例和处理窗口。

## 本机验收结果

- 默认仅 `guangfa-mineru-api` 运行；本地 Qwen/MinerU 只有使用 `--profile local-vlm` 时才启动，宿主端口仍只绑定 `127.0.0.1`。
- 容器内 ROCm PyTorch 2.9.1 GPU 张量实算通过，设备为 `AMD Radeon(TM) 8060S Graphics`，`0..15` 求和结果为 `120`。
- 一份真实 11 页 PDF 使用 `hybrid-http-client + effort=medium` 在 Docker 中约 2 分 10 秒完成；结果 ZIP 包含 Markdown、middle JSON、content list V1/V2。
- V1 共 70 个结构块，全部带 `page_idx` 与 `bbox`；V2 保留 11 页及标题级别。样本没有表格，因此表格抽取仍由结构化单元测试覆盖。
- 将真实页面 PNG 直接提交给 VLM 后，模型正确返回中文文档标题、章节与正文，确认视觉模型不是仅健康检查可用。
- 默认解析器切换后，真实知识库 API 验收得到 11 页、54 段和 65 个父子结构块；Embedding/ZVec 状态为“已索引”，查询命中包含 PDF 页码、bbox 和可读取的原文 PDF。验收临时知识库及索引已删除。

## 入库与溯源语义

- PDF 块同时具备页码与 bbox 时，`locatorGrade=exact`，可通过原始 PDF 精确定位。
- Office 文件保留原格式；标题路径或 Office anchor 可用于容器级/书签级定位，但不伪装成 PDF bbox。
- DOCX 入库时由 `server/knowledge/docx-heading-pages.js` 调用 OnlyOffice 转换链，按标题路径建立章节起始物理页码映射，保存到 `knowledge_document_heading_pages`。检索详情优先显示 `physicalPage`；没有映射时显示等待映射并继续按标题定位。
- DOCX 检索详情可通过 `POST /api/knowledge-documents/:documentId/office-preview` 打开原始 DOCX 的只读 OnlyOffice 预览。定位优先消费 MinerU `headingPath`，通过 OnlyOffice 大纲管理器按完整标题链跳转到原文；物理页码仅作为章节起始页回退，不替代标题定位。临时映射 PDF 不作为用户原文保存。如果原始 DOCX 已被删除，接口返回 `KNOWLEDGE_SOURCE_FILE_MISSING`，用户需要重新上传资料。
- 标题和完整表格保存为父块；普通正文按 MinerU 块边界生成有界子块，超长正文只在段落/标点边界切分。
- 表格父块始终保留完整内容，检索使用带表头的有界行组子块，表格行不会跨两个子块。命中后，小表扩展为完整表格，大表扩展为表头和命中行附近的有界窗口。
- 关键词与向量索引只写入检索子块；父块仅用于上下文扩展。没有子块的孤立标题仍可检索。
- 返回给 AI 的上下文可扩展相邻兄弟子块，但引用文本、页码、bbox 与定位等级始终来自实际命中的子块。
- SQLite 保存正文、原始块文本、块类型、标题路径、父块 ID、bbox、anchor、定位等级、表格标记和星号项标记。
