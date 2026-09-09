# 巡盾御界｜空地一体化智能巡坝系统

[English](README.en.md) · `V1.0.0` · Apache-2.0

巡盾御界是一个面向坝体巡检场景的**软件数字孪生、AI 风险识别与空地协同控制原型**。它将表观特征、热异常和传感器时间序列纳入可解释的融合评分，并在同一指挥台中演示无人机扫描、地面复核、任务分派、路径规划与通信故障降级。

本仓库只包含软件代码与合成演示数据，不包含原始策划材料、真实工程数据、设备驱动、硬件接入或现场运行声明。

## V1.0.0 能力

| 模块 | 已实现的可运行能力 |
| --- | --- |
| 风险融合 | RGB 边缘能量、热成像温差、时序频域异常的加权融合评分 |
| 空地协同 | UAV 覆盖扫描、UGV 复核任务、最小代价匹配分派 |
| 路径与控制 | A* 全局路径规划与 DWA 局部速度/航向更新 |
| 通信韧性 | MESH 健康度、空中中继、链路衰减与离线缓存的仿真状态 |
| 指挥界面 | 坝段数字孪生图、风险复核、协同控制、任务事件回放 |

## 快速启动

运行环境：Python 3.10+、Node.js 20+、pnpm 9+。

```bash
cd backend
python3 server.py
```

另开一个终端：

```bash
cd frontend
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:5173`。后端 API 默认运行于 `http://127.0.0.1:8000`，Vite 已配置 `/api` 代理。

## 关键算法边界

系统的风险分数由下式计算：

```text
risk = 0.48 × rgb_edge + 0.30 × clamp(thermal_delta / 15) + 0.22 × spectrum_anomaly
```

其中 `spectrum_anomaly` 从合成时间序列的离散频率能量中计算。该实现用于演示特征融合、任务流与前后端联调，不能作为真实坝体诊断、结构安全评估或现场处置依据。

地面复核任务使用匈牙利算法求解最小代价匹配；全局路线使用 A*，局部控制以障碍密度调整 DWA 速度窗。所有位置、信号与风险事件均为合成场景。

## API

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` | `/api/overview` | 获取完整指挥态势 |
| `POST` | `/api/mission/start` | 启动空地协同任务并分派风险 |
| `POST` | `/api/mission/pause` | 暂停任务并保持航迹 |
| `POST` | `/api/mission/reset` | 恢复合成场景 |
| `POST` | `/api/simulation/tick` | 推进一个控制周期 |
| `POST` | `/api/fault?kind=mesh` | 注入通信、障碍、热源或定位故障 |
| `POST` | `/api/risks/{id}/review` | 人工确认风险事件 |

## 项目结构

```text
backend/server.py       Python 标准库 API 与算法仿真
frontend/src/App.tsx    React 指挥台界面
frontend/src/styles.css 界面视觉与响应式样式
```

## 路线说明

V1.0.0 关注软件原型闭环。后续如需对接相机、热成像、飞控、机器人底盘、消息总线或工程数据平台，应通过独立适配层接入，并补充数据治理、权限、审计、容错和现场安全验证。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。Copyright 2026 Southwest University。
