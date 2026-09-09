# Xundun Yujie | Integrated Air-Ground Intelligent Dam Patrol System

[中文说明](README.md) · `V1.0.0` · Apache-2.0

Xundun Yujie is a **software prototype for digital-twin visualization, explainable AI risk scoring, and air-ground coordination** in dam patrol scenarios. It combines visual cues, thermal anomalies, and sensor time-series signals into an interpretable score, then demonstrates UAV scanning, UGV verification, task assignment, route planning, and degraded communication states in one command console.

This repository contains software source code and synthetic demo data only. It does not include original planning materials, real engineering data, device drivers, hardware integration, or claims of field deployment.

## V1.0.0 capabilities

| Area | Runnable capability |
| --- | --- |
| Risk fusion | Weighted scoring from RGB edge energy, thermal delta, and spectral anomaly |
| Air-ground coordination | UAV coverage scan, UGV verification tasks, and minimum-cost assignment |
| Planning and control | A* global route planning with DWA local speed and heading updates |
| Communication resilience | Simulated MESH health, aerial relay, link degradation, and offline-cache state |
| Command UI | Dam digital-twin map, risk review, coordination controls, and event playback |

## Run locally

Requirements: Python 3.10+, Node.js 20+, and pnpm 9+.

```bash
cd backend
python3 server.py
```

In another terminal:

```bash
cd frontend
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. The API runs on `http://127.0.0.1:8000`; Vite proxies `/api` requests during development.

## Algorithm scope

The demo calculates a risk score with:

```text
risk = 0.48 × rgb_edge + 0.30 × clamp(thermal_delta / 15) + 0.22 × spectrum_anomaly
```

`spectrum_anomaly` is derived from discrete frequency energy of a synthetic time series. This implementation demonstrates feature fusion, operational flows, and frontend-backend integration. It must not be used as a real dam diagnosis, structural safety assessment, or field-response basis.

Ground verification tasks are matched with a Hungarian minimum-cost assignment. Global routes use A*, while local control adjusts a DWA velocity window according to obstacle density. Every position, signal, and risk event is synthetic.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/overview` | Retrieve the complete command state |
| `POST` | `/api/mission/start` | Start the coordinated mission and assign risks |
| `POST` | `/api/mission/pause` | Pause the mission while retaining tracks |
| `POST` | `/api/mission/reset` | Restore the synthetic scenario |
| `POST` | `/api/simulation/tick` | Advance one control cycle |
| `POST` | `/api/fault?kind=mesh` | Inject communication, obstacle, thermal, or positioning faults |
| `POST` | `/api/risks/{id}/review` | Confirm a risk event manually |

## Layout

```text
backend/server.py       Python standard-library API and simulation
frontend/src/App.tsx    React command-console UI
frontend/src/styles.css Visual system and responsive styling
```

## Next integration boundary

V1.0.0 closes the software-prototype loop. Future adapters for cameras, thermal sensors, flight control, robot chassis, message buses, or engineering-data platforms should be isolated from the core domain and accompanied by data governance, access control, auditing, fault tolerance, and field-safety validation.

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Southwest University.
