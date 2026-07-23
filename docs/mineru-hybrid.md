# MinerU Hybrid 知识解析部署

## 架构

项目固定使用 MinerU `3.4.4` 的 Hybrid 路线：

- PDF 与图片使用 `hybrid-http-client`。默认 `effort=medium`，Pipeline 负责版面与 bbox，MinerU VLM 负责版面块内容提取；需要整页高精度解析时可切换 `effort=high`。
- DOCX、PPTX、XLSX 由 MinerU 自带 Office parser 解析，不经过 OnlyOffice 转 PDF。
- TXT 继续使用项目内原生文本解析。
- 原始上传文件始终保留在 `data/knowledge/files/<documentId>/source.<ext>`；Markdown、middle JSON、content list 和图片保存在同目录的 `mineru/`。
- Markdown 用于人工查看。入库定位以 content list / middle JSON 的页码、bbox、块类型和标题级别为准。

容器拓扑：

- `guangfa-mineru-vlm`：运行 MinerU 官方文档视觉模型 `opendatalab/MinerU2.5-Pro-2605-1.2B`，仅在 Compose 内网提供 OpenAI-compatible 端口 `30000`。
- `guangfa-mineru-api`：运行 MinerU API、Hybrid Pipeline 和 Office parser，仅将 `127.0.0.1:8010` 暴露给本项目。

## 硬件前提

当前 Dockerfile 基于 `vllm/vllm-openai:v0.21.0`，需要 Docker 内可见的 NVIDIA GPU。启动前先验证：

```powershell
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu22.04 nvidia-smi
```

仅在 `docker info` 中出现 `nvidia` runtime 不代表 GPU 可用。若命令返回 `no adapters were found`，应迁移到带 NVIDIA GPU 的 Docker 主机；不要把知识解析静默降级为旧 Pipeline 或 OnlyOffice 转换。

## 启动

```powershell
npm run mineru
Invoke-RestMethod http://127.0.0.1:8010/health
```

首次构建会下载 MinerU Pipeline 与 VLM 模型，耗时和磁盘占用较大。服务日志：

```powershell
docker compose -f docker/mineru/compose.yaml logs -f mineru-vlm mineru-api
```

一键开发启动会把宿主进程日志写到：

- `C:\llm\guangfa-mineru.log`
- `C:\llm\guangfa-mineru.err.log`

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `KNOWLEDGE_PARSER` | `mineru` | 设为 `legacy` 才启用旧解析器；MinerU 失败时不会自动回退。 |
| `MINERU_API_URL` | `http://127.0.0.1:8010` | Node 服务调用 MinerU API 的地址。 |
| `MINERU_BACKEND` | `hybrid-http-client` | 只接受 `hybrid-http-client` 或 `hybrid-engine`。 |
| `MINERU_EFFORT` | `medium` | `medium` 或 `high`。 |
| `MINERU_VLM_URL` | `http://mineru-vlm:30000` | MinerU API 容器访问 VLM 服务的地址。 |
| `MINERU_VL_MODEL_NAME` | `opendatalab/MinerU2.5-Pro-2605-1.2B` | API 与 vLLM 共同使用的模型服务名。 |
| `MINERU_PARSE_TIMEOUT_MS` | `3600000` | 单个解析任务总超时，范围 1 至 4 小时。 |
| `MINERU_VLM_GPU_DEVICE` | `0` | VLM 容器使用的 NVIDIA GPU。 |
| `MINERU_API_GPU_DEVICE` | `0` | Hybrid Pipeline 容器使用的 NVIDIA GPU。 |
| `MINERU_VLM_GPU_MEMORY_UTILIZATION` | `0.55` | vLLM KV cache 显存比例。 |
| `MINERU_PROCESSING_WINDOW_SIZE` | `16` | Hybrid 分页处理窗口。 |
| `MINERU_HYBRID_BATCH_RATIO` | `1` | Pipeline 小模型批处理倍率。 |

多 GPU 主机建议把 VLM 与 API 分配到不同设备。单 GPU 部署需要按显存实测下调 vLLM 比例和处理窗口。
## 入库与溯源语义

- PDF 块同时具备页码与 bbox 时，`locatorGrade=exact`，可通过原始 PDF 精确定位。
- Office 文件保留原格式；标题路径或 Office anchor 可用于容器级/书签级定位，但不伪装成 PDF bbox。
- 表格以完整结构块入库，不跨块切分；普通内容按 MinerU 块边界入库，并注入 `路径: 一级标题>二级标题`。
- SQLite 保存正文、原始块文本、块类型、标题路径、父块 ID、bbox、anchor、定位等级、表格标记和星号项标记。
