# 巡盾御界｜空地一体化智能巡坝系统

[English](README_EN.md) · `V2.0.0` · Apache-2.0

巡盾御界是一个面向坝区巡检的可复现软件项目。V2.0.0 提供多模态算法分析、无人机与无人车协同调度、二维坝区仿真、历史回放和双语指挥台。项目使用合成数据演示完整流程，不依赖真实硬件或外部云服务。

![巡盾御界 V2.0.0 指挥台](data/console-overview.png)

## 当前能力

| 工作区 | 可运行内容 |
| --- | --- |
| 态势 | 二维坝区地图、设备轨迹、规划路径、风险点、障碍物、链路与实时事件 |
| 分析 | RGB 图像、热成像 CSV、传感器 CSV、短 MP4 分析及质量加权融合 |
| 场景 | 日常巡检、降雨渗漏、通信衰减、动态障碍四种可配置场景 |
| 协同 | 匈牙利与贪心分配对比、A* 与 Dijkstra 路径对比、DWA 局部避障、空中中继 |
| 回放 | 历史任务、事件时间轴、风险复核、JSON/CSV 导出和浏览器打印报告 |

界面支持中文与 English 切换；语言保存在浏览器的 `xundun.locale` 中。V1.1.0 的主要接口继续保留，便于已有调用方迁移。

## Docker 一条命令启动

需要 Docker 与 Docker Compose。项目只有一个应用服务，前后端运行在同一容器和端口。

```bash
docker compose up --build
```

打开 `http://localhost:8000`。SQLite 数据库和派生结果保存在 `xundun-runtime` 命名卷中。停止服务可使用：

```bash
docker compose down
```

如需同时删除本地运行数据，再显式执行 `docker compose down -v`。

## 本地开发

建议使用 Python 3.12、Node.js 22 和 pnpm。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd frontend
pnpm install
pnpm build
cd ..
python backend/server.py
```

生产构建由 FastAPI 同源托管，打开 `http://127.0.0.1:8000`。需要前端热更新时，可另开终端运行：

```bash
cd frontend
pnpm dev
```

Vite 默认运行在 `http://127.0.0.1:5173`，并将 `/api` 请求代理到后端。

## 合成样例

`data/samples` 包含项目生成的演示输入：

- `surface-anomaly.png`：表面异常候选区域图像。
- `thermal.csv`：二维温度矩阵。
- `sensor.csv`：包含 `timestamp,value` 的传感器时序。
- `patrol.mp4`：短时巡检视频。

分析工作区中的“加载多模态样例”和“加载视频样例”可直接运行这些数据。相同输入、参数和随机种子会得到一致结果。

## 算法逻辑

### RGB 图像与短视频

RGB 流程包含尺寸归一化、CLAHE、Canny、Sobel、形态学闭运算和连通域提取。结果包括图像质量、对比度、边缘密度、候选区域边界框、面积、线性度和异常分数。短视频按 2 FPS 抽取不超过 120 帧，形成逐帧风险曲线，并保存风险最高且时间不重复的最多 5 个关键帧。

输出描述为“表面异常候选区域”，不等同于工程裂缝诊断。

### 热成像与传感器

热成像使用温度中位数、MAD 和稳健 Z 分数定位连续热点或冷点。传感器时序完成排序、去重、等间隔重采样、去趋势、标准化、FFT 频域能量和 CUSUM 变化点检测。

### 多模态融合

基础权重为 RGB/视频 `0.45`、热成像 `0.30`、传感器 `0.25`。各模态分数先乘数据质量；缺失模态被移除，其余权重重新归一化。

```text
低风险：score < 0.45
中风险：0.45 <= score < 0.70
高风险：score >= 0.70
```

### 空地协同

固定编队由 1 架无人机和 2 台无人车组成。仿真执行匈牙利任务分配与 A* 全局路径，同时保存贪心分配和 Dijkstra 路径的对比指标。DWA 在当前速度窗口中采样候选轨迹并处理动态障碍；链路低于 60 时无人机转入中继，低于 35 时触发等待、离线或任务重分配。

四种场景均可调整随机种子、风险点数量、障碍物数量、初始链路质量和仿真速度。

## 输入限制

| 输入 | 格式 | 限制 |
| --- | --- | --- |
| RGB 图像 | JPEG、PNG | 最大 20 MB |
| 热成像 | CSV 数值矩阵 | 最大 5 MB |
| 传感器 | CSV，至少含 `timestamp,value` | 最大 5 MB |
| 短视频 | MP4 | 最大 100 MB、最长 60 秒 |

RGB 图像和视频互斥；热成像与传感器可同图像或视频组合。上传文件会分块读取、计算 SHA-256 并验证扩展名、MIME 与实际解码结果。分析结束后原始上传文件立即删除，只保留文件元数据、哈希、算法参数、结构化结果以及允许保留的标注缩略图或关键帧。

## API 摘要

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康状态与版本 |
| `GET` | `/api/v2/scenarios` | 四个场景模板 |
| `GET / POST` | `/api/v2/missions` | 查询或创建任务 |
| `POST` | `/api/v2/missions/{id}/commands` | 开始、暂停、单步、重置、调速 |
| `GET` | `/api/v2/missions/{id}/events` | 回放事件与快照 |
| `GET` | `/api/v2/missions/{id}/comparisons` | 分配、路径和 DWA 指标 |
| `POST` | `/api/v2/analyses` | 上传并提交分析任务 |
| `GET` | `/api/v2/analyses/{id}` | 查询分析进度和结果 |
| `WS` | `/api/v2/missions/{id}/stream` | 快照、事件、分析进度与心跳 |

创建任务示例：

```bash
curl -X POST http://localhost:8000/api/v2/missions \
  -H 'Content-Type: application/json' \
  -d '{"scenario_id":"rainfall-seepage","seed":20260915,"parameters":{"risk_count":5,"obstacle_count":8,"link_quality":82}}'
```

导出地址：

```text
/api/v2/missions/{id}/export.json
/api/v2/missions/{id}/export.csv?dataset=risks
/api/v2/missions/{id}/export.csv?dataset=events
/api/v2/missions/{id}/export.csv?dataset=comparisons
```

浏览器打印报告地址为 `/?view=report&mission={id}`。服务端不生成 PDF，可使用浏览器的打印功能保存。

## 项目结构

```text
backend/             FastAPI、分析算法、协同仿真与 SQLite
frontend/src/        React 指挥台、API、双语文本与样式
data/scenarios.json  四个确定性场景
data/samples/        项目生成的合成输入
runtime/             本地数据库与派生结果，已忽略
Dockerfile           前端构建与后端运行镜像
compose.yaml         单服务启动配置
```

## 技术边界

- 当前版本是算法逻辑与空地协同仿真演示，不包含真实硬件控制、ROS 节点或设备驱动。
- 不包含训练模型或模型权重，不依赖外部识别服务。
- 不包含真实水工数据、工程安全认证或生产环境安全保证。
- 分析结果不能替代水利工程专业检测、结构安全评估或现场处置结论。
- 接入真实设备前，应另行完成权限、审计、网络安全、故障保护和现场验证。

项目展示署名：西南大学。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。Copyright 2026 Southwest University。
