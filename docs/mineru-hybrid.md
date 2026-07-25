# MinerU Hybrid 知识解析部署

## 架构

项目固定使用 MinerU `3.4.4` 的 Hybrid 路线：

- PDF 与图片使用 `hybrid-http-client`。默认 `effort=medium`，Pipeline 负责版面与 bbox，MinerU VLM 负责版面块内容提取；需要整页高精度解析时可切换 `effort=high`。
- DOCX、PPTX、XLSX 由 MinerU 自带 Office parser 解析，不经过 OnlyOffice 转 PDF。
- TXT 继续使用项目内原生文本解析。
- 原始上传文件始终保留在 `data/knowledge/files/<documentId>/source.<ext>`；Markdown、middle JSON、content list 和图片保存在同目录的 `mineru/`。
- Markdown 用于人工查看。入库定位以 content list / middle JSON 的页码、bbox、块类型和标题级别为准。

NVIDIA 容器拓扑：

- `guangfa-mineru-vlm`：运行 MinerU 官方文档视觉模型 `opendatalab/MinerU2.5-Pro-2605-1.2B`，仅在 Compose 内网提供 OpenAI-compatible 端口 `30000`。
- `guangfa-mineru-api`：运行 MinerU API、Hybrid Pipeline 和 Office parser，仅将 `127.0.0.1:8010` 暴露给本项目。

## 当前机器与硬件前提

当前仓库内的 Dockerfile 基于 `vllm/vllm-openai:v0.21.0`，只适用于 Docker 内可见的 NVIDIA GPU。它不适用于本机的 AMD Radeon 8060S；本机的 `npm run mineru` 已固定走 WSL/ROCm，NVIDIA 主机使用 `npm run mineru:nvidia`。

本机已确认是 Ryzen AI MAX+ 395、Radeon 8060S、`gfx1151`、WSL2 Ubuntu 24.04，并已完成 AMD ROCm 7.2.1、ROCm PyTorch 和 MinerU 3.4.4 部署。部署就绪不等于自动切换业务解析器；`KNOWLEDGE_PARSER` 默认仍为 `legacy`，切换到 `mineru` 需要显式配置。

## AMD WSL 部署与启动

当前 NVIDIA Compose 在本机不可启动，不能复用 NVIDIA 的 `--gpus` 配置。本机使用 WSL Ubuntu 24.04 中的 ROCm/PyTorch 运行 MinerU：

- `scripts/complete-mineru-deployment.ps1`：下载并暂存与现有 ROCm 7.2.1 同包族的 BLAS、FFT、随机数、稀疏计算、求解器、MIOpen 和 RCCL 依赖，随后执行安装、启动和真实 PDF 冒烟。可用 `MINERU_SMOKE_PDF` 指定样本；未指定时要求 `output/` 中恰有一份 `*OnlyOffice*.pdf`。
- `scripts/bootstrap-mineru-wsl.sh`：校验 ROCm PyTorch/Triton/TorchVision wheel，安装 `mineru[pipeline,vlm]==3.4.4` 与其缺失的 `six` 运行依赖，用 GPU 张量实算验证 Radeon 8060S，并从 ModelScope 下载 Pipeline 与 VLM 模型。
- `scripts/mineru_transformers_server.py`：在 `127.0.0.1:30000` 提供官方 `MinerU2.5-Pro-2605-1.2B` 的 OpenAI-compatible VLM 接口。
- `scripts/start-mineru-wsl.sh`：启动 VLM 与 MinerU API，日志写入 `/opt/guangfa-mineru/logs/`，API 临时解析产物写入 `/opt/guangfa-mineru/output/`，不污染仓库。
- `scripts/start-mineru-wsl.ps1`：Windows 入口，经 `C:\llm\guangfa-repo` 稳定路径调用 WSL 脚本并检查 VLM/API 健康状态；`npm run mineru` 与全栈启动均复用此入口。

部署完成必须同时满足：PyTorch GPU 张量实算正确、VLM `30000/health` 正常、API `8010/health` 正常、真实 PDF 任务完成且 ZIP 中包含 content list。只安装驱动、ROCm 或 Python 包都不能视为完成。

首次部署会下载 MinerU Pipeline 与 VLM 模型，耗时和磁盘占用较大；后续启动复用本地模型。AMD WSL 服务日志：

```powershell
Get-Content \\wsl.localhost\Ubuntu-24.04\opt\guangfa-mineru\logs\bootstrap.log -Wait
Get-Content \\wsl.localhost\Ubuntu-24.04\opt\guangfa-mineru\logs\vlm.log -Wait
Get-Content \\wsl.localhost\Ubuntu-24.04\opt\guangfa-mineru\logs\api.log -Wait
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
| `KNOWLEDGE_PARSER` | `legacy` | 业务链路验收时显式设为 `mineru`；MinerU 失败时不会自动回退。 |
| `MINERU_API_URL` | `http://127.0.0.1:8010` | Node 服务调用 MinerU API 的地址。 |
| `MINERU_BACKEND` | `hybrid-http-client` | 只接受 `hybrid-http-client` 或 `hybrid-engine`。 |
| `MINERU_EFFORT` | `medium` | `medium` 或 `high`。 |
| `MINERU_VLM_URL` | `http://127.0.0.1:30000` | WSL MinerU API 访问本机 VLM 的地址；NVIDIA Compose 路线需显式设为 `http://mineru-vlm:30000`。 |
| `MINERU_DOWNLOAD_SOURCE` | `modelscope` | WSL 首次部署下载 Pipeline 模型的来源。 |
| `MINERU_VL_MODEL_PATH` | `/opt/guangfa-mineru/models/MinerU2.5-Pro-2605-1.2B` | WSL VLM 本地模型目录。 |
| `MINERU_VL_MODEL_NAME` | `opendatalab/MinerU2.5-Pro-2605-1.2B` | API 与 vLLM 共同使用的模型服务名。 |
| `MINERU_PARSE_TIMEOUT_MS` | `3600000` | 单个解析任务总超时，范围 1 至 4 小时。 |
| `MINERU_VLM_GPU_DEVICE` | `0` | VLM 容器使用的 NVIDIA GPU。 |
| `MINERU_API_GPU_DEVICE` | `0` | Hybrid Pipeline 容器使用的 NVIDIA GPU。 |
| `MINERU_VLM_GPU_MEMORY_UTILIZATION` | `0.55` | vLLM KV cache 显存比例。 |
| `MINERU_PROCESSING_WINDOW_SIZE` | `16` | Hybrid 分页处理窗口。 |
| `MINERU_HYBRID_BATCH_RATIO` | `1` | Pipeline 小模型批处理倍率。 |

多 GPU 主机建议把 VLM 与 API 分配到不同设备。单 GPU 部署需要按显存实测下调 vLLM 比例和处理窗口。

## 本机验收结果

- ROCm PyTorch 2.9.1 GPU 张量实算通过，设备为 `AMD Radeon(TM) 8060S Graphics`。
- VLM `http://127.0.0.1:30000/health` 与 API `http://127.0.0.1:8010/health` 均返回 `healthy`。
- 一份真实 11 页 PDF 使用 `hybrid-http-client + effort=medium` 约 3 分 10 秒完成；结果 ZIP 包含 Markdown、middle JSON、content list V1/V2。
- V1 共 70 个结构块，全部带 `page_idx` 与 `bbox`；V2 保留 11 页及标题级别。样本没有表格，因此表格抽取仍由结构化单元测试覆盖。
- 将真实页面 PNG 直接提交给 VLM 后，模型正确返回中文文档标题、章节与正文，确认视觉模型不是仅健康检查可用。

## 入库与溯源语义

- PDF 块同时具备页码与 bbox 时，`locatorGrade=exact`，可通过原始 PDF 精确定位。
- Office 文件保留原格式；标题路径或 Office anchor 可用于容器级/书签级定位，但不伪装成 PDF bbox。
- 标题和完整表格保存为父块；普通正文按 MinerU 块边界生成有界子块，超长正文只在段落/标点边界切分。
- 表格父块始终保留完整内容，检索使用带表头的有界行组子块，表格行不会跨两个子块。命中后，小表扩展为完整表格，大表扩展为表头和命中行附近的有界窗口。
- 关键词与向量索引只写入检索子块；父块仅用于上下文扩展。没有子块的孤立标题仍可检索。
- 返回给 AI 的上下文可扩展相邻兄弟子块，但引用文本、页码、bbox 与定位等级始终来自实际命中的子块。
- SQLite 保存正文、原始块文本、块类型、标题路径、父块 ID、bbox、anchor、定位等级、表格标记和星号项标记。
