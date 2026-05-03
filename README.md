# Memory Aid (monorepo)

Clinical-style reminder and assistive stack: **FastAPI backend**, **React web**, **Flutter mobile**, plus optional **cognitive screening** (research prototype), **dementia action** monitoring, and **Dementia Guardian** (patient/guardian pairing, alerts, clinical form, MRI upload, Socket.IO).

There is **one** integrated API on port **8000** (`backend/main.py`), **one** canonical web UI (`web/`), and **three** Flutter trees: primary `mobile_flutter/`, companion `dementia_mobile/`, and the upstream bundle copy `Flutter_App-Dimentia-master/mobile_app/` (same product line; keep separate per project layout).

## Layout

| Path | Role |
|------|------|
| `backend/` | FastAPI: reminders/mode/face/memory, `dementia_action_subsystem/`, **`cognitive_screening/`**, **`guardian_api/`** (Dementia Guardian REST + Socket.IO when MongoDB is configured) |
| `web/` | React (CRA): Memory Aid pages + **Dementia Guardian** at **`/dg`** (MUI), sharing `REACT_APP_BACKEND_URL` (default `http://127.0.0.1:8000`) |
| `mobile_flutter/` | Flutter client (BLE, FCM, reminders) |
| `dementia_mobile/` | Flutter dementia companion (guardian/patient flows) → same API host |
| `Flutter_App-Dimentia-master/` | Upstream bundle: **`mobile_app/`** (Flutter), **`MRI_Data_set/`** + **`Clinical Model/`** (artifacts used by `guardian_api` inference), optional reference **`web_app/`** (Vite; superseded by `web/src/guardian`) |
| `pyproject.toml` | Pytest paths (`pythonpath = backend`, `testpaths = backend/tests`) |

### Dementia Guardian backend

- Mounted when **`ENABLE_GUARDIAN_API`** is not `0`/`false` and **`MONGO_URI`** is set in `backend/.env` (same pattern as cognitive screening).
- Guardian ML defaults resolve under **`Flutter_App-Dimentia-master/MRI_Data_set/`** and **`Flutter_App-Dimentia-master/Clinical Model/`** unless overridden via settings/env.
- Disable the subsystem (e.g. in CI): `ENABLE_GUARDIAN_API=0`.

## Quick run (development)

**Backend**:

```bash
cd backend
pip install -r requirements.txt
py -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Web:**

```bash
cd web
npm install
npm start
```

Set `REACT_APP_BACKEND_URL` if the API is not on `http://127.0.0.1:8000`.

**Tests:**

```bash
py -m pytest
```

Use `ENABLE_GUARDIAN_API=0` if you want imports/tests without configuring Guardian MongoDB.

## Docs & disclaimers

- Cognitive screening: see `backend/cognitive_screening/README.md`, `backend/cognitive_screening/RESEARCH.md`, and `backend/cognitive_screening/CLINICAL_VALIDATION.md` (decision-support / research only).
- Large or local artifacts: see `.gitignore` (models, `memory_data/`, incident exports, etc.).
