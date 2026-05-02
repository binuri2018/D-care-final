# Memory Aid (monorepo)

Clinical-style reminder and assistive stack: **FastAPI backend**, **React web**, **Flutter mobile**, plus optional **cognitive screening** (research prototype) and **dementia action** monitoring.

## Layout

| Path | Role |
|------|------|
| `backend/` | FastAPI app (`main.py`), reminders/mode/face/memory APIs, `dementia_action_subsystem/`, **`cognitive_screening/`** (predict / session / MRI / confusion routers mounted in `main.py`) |
| `web/` | React (CRA): reminders, analytics, memory/face UI, dementia action, **integrated cognitive screening** (`src/cognitive-screening/`, route `/screening`) |
| `mobile_flutter/` | Flutter client (BLE, FCM, reminders) — this is the mobile app folder in the monorepo |
| `docs/STRUCTURE.md` | Directory map and conventions for this monorepo |
| `pyproject.toml` | Pytest paths (`pythonpath = backend`, `testpaths = backend/tests`) |

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

## Docs & disclaimers

- Cognitive screening: see `backend/cognitive_screening/README.md`, `backend/cognitive_screening/RESEARCH.md`, and `backend/cognitive_screening/CLINICAL_VALIDATION.md` (decision-support / research only).
- Large or local artifacts: see `.gitignore` (models, `memory_data/`, incident exports, etc.).
