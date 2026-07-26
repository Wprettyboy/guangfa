# MinerU 知识解析部署

## 架构

项目固定使用 MinerU `3.4.4`，默认走 Pipeline，Hybrid 作为显式高精度路线：

- PDF 与图片默认使用 `pipeline`，由 PP-OCR、版面模型和表格模型提取文字、bbox、图片与跨页表格；复杂扫描件需要高精度视觉解析时，显式改为 `hybrid-http-client` 并启动官方 MinerU2.5 VLM。
- DOCX、PPTX、XLSX 由 MinerU 自带 Office parser 解析；DOCX 解析主链不依赖 OnlyOffice，入库后的标题物理页映射才会异步调用 OnlyOffice。
- TXT 继续使用项目内原生文本解析。
- 原始上传文件始终保留在 `data/knowledge/files/<documentId>/source.<ext>`；Markdown、middle JSON、content list 和图片保存在同目录的 `mineru/`。
- Markdown 用于人工查看。入库定位以 content list / middle JSON 的页码、bbox、块类型和标题级别为准。
- DOCX 入库完成后会用 OnlyOffice 同一渲染链生成临时 PDF，仅按 MinerU 标题路径映射章节起始物理页码；临时 PDF 会立即删除，不替代原始 DOCX，也不把章节页伪装成子块精确页。

Docker 容器拓扑：

- `guangfa-mineru-vlm`：运行官方 `MinerU2.5-Pro-2605-1.2B`，仅在 Hybrid 高精度模式下按需启动并提供 OpenAI-compatible 端口 `30000`。
- `guangfa-mineru-api`：运行 MinerU API、Pipeline 和 Office parser；默认 Pipeline 不依赖 VLM，Hybrid 固定连接 Compose 内的官方模型，不经过 Gemini。

## 当前机器与硬件前提

本机的 `npm run mineru` 使用 `docker/mineru/compose.amd.yaml` 启动默认 Pipeline API；`npm run mineru:hybrid` 才同时加载官方 VLM。两条路线均通过 Docker Desktop 的 `/dev/dxg` 和 ROCDXG 访问 Radeon 8060S。原有 `docker/mineru/compose.yaml` 保留为 NVIDIA 主机路线，由 `npm run mineru:nvidia` 启动。

本机已确认是 Ryzen AI MAX+ 395、Radeon 8060S、`gfx1151`、Docker Desktop 4.74.0 和 WSL2 Ubuntu 24.04，并已完成 AMD ROCm 7.2.1、ROCm PyTorch 和 MinerU 3.4.4 的 Docker 部署。`KNOWLEDGE_PARSER` 默认使用 `mineru`；只有临时诊断旧链路时才显式改为 `legacy`。

## AMD Docker 部署与启动

AMD Compose 不复用 NVIDIA 的 `--gpus` 配置。服务进程全部运行在 Docker 容器中；首次准备时把已经过 GPU 实算验证的 WSL ROCm、MinerU 虚拟环境和模型导入三个只读 Docker named volumes，避免重复下载约 20 GB 运行时：

- `docker/mineru/Dockerfile.amd`：仅安装 Ubuntu、Python、OpenCV 和 ROCm 动态链接所需的系统库；ROCm、Python 包和模型不烘焙进镜像。
- `docker/mineru/compose.amd.yaml`：把 `/dev/dxg` 与 WSL GPU 用户态库映射给 VLM/API 容器，并挂载 `guangfa-mineru-rocm`、`guangfa-mineru-runtime`、`guangfa-mineru-modelscope` 三个只读 volume，另外挂载三个可写的 ROCm 缓存 volume 用于跨容器保留内核编译与卷积调优结果。
- ROCm 缓存 volume：`guangfa-mineru-kernel-cache` -> `/root/.cache/comgr`（内核编译缓存）、`guangfa-mineru-miopen-cache` -> `/root/.cache/miopen`（MIOpen 内核缓存）、`guangfa-mineru-miopen-userdb` -> `/root/.config/miopen`（MIOpen find-db，保存每个卷积形状实测出的最优算法，是三者中决定性的一个）。缓存全空时首次解析实测约 210 秒，命中后约 10 秒；删除这三个 volume 或换 ROCm/MIOpen 版本会退回冷启动耗时。`x-mineru-amd-common` 锚点和 `mineru-api` 服务各自声明一次 `volumes`，服务级 `volumes` 会整体覆盖锚点，新增挂载必须两处同步。
- `scripts/prepare-mineru-docker-amd.ps1`：只在 volume 未准备时，从 WSL 导入已验证的 ROCm、MinerU 虚拟环境、VLM 模型和 Pipeline 模型；完成标记存在时直接复用。
- `scripts/start-mineru-docker-amd.ps1`：构建 AMD 镜像并执行 GPU 张量实算；`-WithVlm` 同时启动官方 VLM 并等待两个健康接口，省略时只启动 API。
- `scripts/complete-mineru-deployment.ps1`：首次下载和准备 WSL ROCm/MinerU 运行时，随后导入 Docker volumes、启动容器并提交真实 PDF 冒烟任务。
- `scripts/bootstrap-mineru-wsl.sh`：校验 ROCm PyTorch/Triton/TorchVision wheel，安装 `mineru[pipeline,vlm]==3.4.4` 与其缺失的 `six` 运行依赖，用 GPU 张量实算验证 Radeon 8060S，并从 ModelScope 下载 Pipeline 与 VLM 模型。
- `scripts/mineru_transformers_server.py`：在 `127.0.0.1:30000` 提供官方 `MinerU2.5-Pro-2605-1.2B` 的 OpenAI-compatible VLM 接口。
- `scripts/start-mineru-wsl.ps1` / `.sh`：仅作为运行时准备和诊断后备，由 `npm run mineru:wsl` 显式启动；默认入口与全栈入口均不再运行 WSL Python 服务。

默认 Pipeline 部署必须满足 API 健康、GPU 张量实算和真实 PDF 结构产物检查；Hybrid 还必须满足 VLM 健康、真实页面 OTSL 推理与完整任务检查。只看健康接口不能视为完成。

AMD Docker 日志：

```powershell
docker compose -f docker/mineru/compose.amd.yaml ps
npm run mineru
docker compose -f docker/mineru/compose.amd.yaml logs -f mineru-api

# 显式高精度 Hybrid，按需加载官方 VLM
npm run mineru:hybrid
docker compose -f docker/mineru/compose.amd.yaml logs -f mineru-vlm mineru-api
```

`npm run mineru:hybrid` 只管理 Docker 服务，不修改应用配置。使用 Hybrid 时还必须设置 `MINERU_BACKEND=hybrid-http-client` 并重启 Web/Node；切回 Pipeline 时恢复 `MINERU_BACKEND=pipeline` 并执行 `npm run mineru`，该入口会停止 VLM 释放资源。

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
| `MINERU_BACKEND` | `pipeline` | 接受 `pipeline`、`hybrid-http-client` 或 `hybrid-engine`；默认不自动升级或回退。 |
| `MINERU_EFFORT` | `medium` | 仅 Hybrid 使用，接受 `medium` 或 `high`。 |
| `MINERU_VLM_URL` | `http://mineru-vlm:30000` | MinerU API 容器访问官方 MinerU2.5 VLM 的 Compose 地址；不要配置为通用 Gemini/OpenAI 模型。 |
| `MINERU_DOWNLOAD_SOURCE` | `modelscope` | WSL 首次部署下载 Pipeline 模型的来源。 |
| `MINERU_VL_MODEL_PATH` | `/opt/guangfa-mineru/models/MinerU2.5-Pro-2605-1.2B` | Docker runtime volume 内的 VLM 模型目录。 |
| `MINERU_VL_MODEL_NAME` | `opendatalab/MinerU2.5-Pro-2605-1.2B` | API 与 vLLM 共同使用的模型服务名。 |
| `MINERU_PARSE_TIMEOUT_MS` | `3600000` | 单个解析任务总超时，范围 1 至 4 小时。 |
| `MINERU_VIRTUAL_VRAM_SIZE` | `8` | AMD Pipeline 使用的虚拟显存档位；避免把 8060S 统一内存误判为 80GB 独立显存。 |
| `MINERU_VLM_GPU_DEVICE` | `0` | VLM 容器使用的 NVIDIA GPU。 |
| `MINERU_API_GPU_DEVICE` | `0` | Hybrid Pipeline 容器使用的 NVIDIA GPU。 |
| `MINERU_VLM_GPU_MEMORY_UTILIZATION` | `0.55` | vLLM KV cache 显存比例。 |
| `MINERU_PROCESSING_WINDOW_SIZE` | `16` | Hybrid 分页处理窗口。 |
| `MINERU_HYBRID_BATCH_RATIO` | `4` | Pipeline 小模型批处理倍率；本机 Radeon 8060S 用 8 页 `测试.pdf` 实测 4 最快（139 秒 vs 16 档 171 秒），因此 AMD Compose 默认 4。修改后需重启 MinerU 容器生效。 |

多 GPU 主机建议把 VLM 与 API 分配到不同设备。单 GPU 部署需要按显存实测下调 vLLM 比例和处理窗口。

## 本机验收结果

- 一键开发启动和 `npm run mineru` 默认只运行 Pipeline API；`npm run mineru:hybrid` 才按需加载官方 VLM，两个宿主端口仍只绑定 `127.0.0.1`。
- 容器内 ROCm PyTorch 2.9.1 GPU 张量实算通过，设备为 `AMD Radeon(TM) 8060S Graphics`，`0..15` 求和结果为 `120`。
- AMD VLM 推理日志记录输入/输出 token、图片数、耗时和显存；只有缓存保留量比实际分配量高 2GiB 以上时才执行 `empty_cache()`。AOTriton 实验注意力内核在 Radeon 8060S 的实测中没有加速，因此保持关闭。
- 一份真实 11 页 PDF 使用 `hybrid-http-client + effort=medium` 在 Docker 中约 2 分 10 秒完成；结果 ZIP 包含 Markdown、middle JSON、content list V1/V2。
- V1 共 70 个结构块，全部带 `page_idx` 与 `bbox`；V2 保留 11 页及标题级别。样本没有表格，因此表格抽取仍由结构化单元测试覆盖。
- 将真实页面 PNG 直接提交给 VLM 后，模型正确返回中文文档标题、章节与正文，确认视觉模型不是仅健康检查可用。
- MinerU 的专用 `Table Recognition`/OTSL 输出必须由官方 MinerU2.5 模型生成；Gemini 只在结构解析完成后生成图片语义说明，不能作为 `hybrid-http-client` 的模型服务器。
- 2026-07-26 使用 8 页 `测试.pdf` 验收 Pipeline：原配置与 Retrieval 共存时约 208 秒；隔离 Retrieval 后，Batch Ratio 16/8/4 分别约 171/168/139 秒；Batch Ratio 4 与 Retrieval 共存约 158 秒。AMD Compose 因此默认设置 `MINERU_VIRTUAL_VRAM_SIZE=8`。四轮均得到 8 页、29 个块、6 个表格和 1 张图片，跨页表格 HTML 保持完整，仅有无业务影响的空格级 OCR 波动。
- Retrieval 常驻会使当前样本首次解析变慢约 14%，但解析结束后立即需要它完成向量索引，业务服务不自动启停 Retrieval；需要离线批量解析时可由运维显式暂停 Retrieval。
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
