# Dementia Guardian App (Flutter + Python + MongoDB)

Local-first dementia support app with two roles in one mobile app:
- `Patient` (minimal safety UI: heartbeat + SOS)
- `Guardian` (dashboard, alerts, AI chat, MRI + clinical assessment, reports)

This project runs fully on your local machine (no cloud deployment required).

## Repository
- GitHub: `https://github.com/MrAlfaa/Flutter_App-Dimentia.git`

## What This App Does
- Role-based login/register (`patient` / `guardian`)
- Secure pairing: **patient** creates a pair key, **guardian** enters it to link accounts
- Tracking consent flow (patient must approve guardian tracking)
- Patient heartbeat (location + battery) to backend
- Guardian dashboard with:
  - live patient location (Google Maps)
  - cognitive trend chart
  - current hybrid risk status
- MRI upload + dementia severity prediction (real `.tflite` model path supported)
- Daily clinical check-in + probability/risk prediction (real `.joblib` model path supported)
- Hybrid risk + streak detection
- AI guardian chat over patient records (with fallback summary if cloud unavailable)
- Alerts center:
  - SOS alerts
  - risk alerts
  - report-generated alerts
  - mark all as read
- Doctor report PDF generation + download/share/email flow

## Project Structure
- `mobile_app/` Flutter app
- `python_backend/` FastAPI + Socket.IO API (MongoDB)
- `web_app/` React (Vite) guardian/patient web portal
- `MRI_Data_set/` MRI model artifacts (example: `.tflite`)
- `Clinical Model/` clinical model artifacts (example: `.joblib`, thresholds, metrics)

## Prerequisites (Windows + macOS)
- Git
- Node.js `>= 20` and npm
- Python `>= 3.10` + pip
- Flutter SDK (stable)
- Android Studio (Android SDK + emulator)
- ADB (`platform-tools`) available in PATH
- MongoDB Atlas URI (or local MongoDB)

## 1) Clone From GitHub
```bash
git clone https://github.com/MrAlfaa/Flutter_App-Dimentia.git
cd Flutter_App-Dimentia
```

## 2) Backend Setup (Python)
```bash
cd python_backend
py -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
copy .env.example .env
```

Fill `python_backend/.env` with your values.

Important keys:
- `MONGO_URI` (required)
- `JWT_SECRET` (use a long random string in production)
- `PYTHON_BIN` (interpreter used to run `ml/infer_clinical.py` and `ml/infer_mri.py`)
- `MRI_TFLITE_PATH` / `CLINICAL_JOBLIB_PATH` (defaults point at repo model folders)
- `OLLAMA_API_KEY` / `OLLAMA_BASE_URL` / `OLLAMA_MODEL` (optional; OpenAI-compatible chat for guardian AI)

For MRI inference, install TensorFlow **or** `tflite-runtime` into the same environment as `PYTHON_BIN` (the subprocess that runs `ml/infer_mri.py`).

Run backend (from `python_backend`):
```bash
py -m uvicorn app.main:app --host 0.0.0.0 --port 4000
```

(`app.main:socket_app` is the same object if you prefer that name.)

Backend should start at:
- `http://localhost:4000`
- REST + Socket.IO share this port (`/api/...` for HTTP)
- Health check: `http://localhost:4000/health`

Web portal (optional): in another terminal, `cd web_app && npm install && npm run dev` (defaults to `http://localhost:5173/` with API at `http://localhost:4000/api`).

## 3) Flutter App Setup
```bash
cd ../mobile_app
flutter pub get
```

### Google Maps API checklist (required for in-app map tiles)
1. In Google Cloud Console, enable:
   - `Maps SDK for Android`
2. Ensure billing is enabled for the same project.
3. Set `GOOGLE_MAPS_API_KEY` in `mobile_app` (Android manifest / Gradle) for map tiles; it is not required for the Python API.
4. For local debug validation on Windows + macOS, use an **unrestricted** key first.
5. After map works, harden the key:
   - restrict by Android app
   - package name: `com.example.mobile_app`
   - add debug SHA-1 fingerprints for each development machine.

## 4) Run On Physical Android Phone (USB Debugging)
### Android phone preparation
1. Enable Developer Options.
2. Enable USB Debugging.
3. Connect phone with USB cable.
4. Accept USB debugging prompt on phone.

### Run commands (Windows/macOS)
```bash
adb devices
```
Confirm your phone is listed.

Forward backend port to phone:
```bash
adb reverse tcp:4000 tcp:4000
```

Run app:
```bash
flutter run
```

In app Settings, API base URL should be:
- `http://localhost:4000/api`

## 5) Run Without USB (Android Emulator - Windows/macOS)
1. Open Android Studio.
2. Start an Android emulator from Device Manager.
3. Run:
```bash
cd mobile_app
flutter run
```

Set API base URL in app Settings to:
- `http://10.0.2.2:4000/api`

Notes:
- `10.0.2.2` is Android emulator alias to host machine `localhost`.
- If you still want to use `http://localhost:4000/api` inside emulator, run:
```bash
adb reverse tcp:4000 tcp:4000
```

## 6) Run On macOS (MacBook)
Same steps as above.

Typical macOS flow:
1. Start backend in Terminal 1:
```bash
cd python_backend
py -m uvicorn app.main:app --host 0.0.0.0 --port 4000
```
2. Start app in Terminal 2:
```bash
cd mobile_app
flutter run
```
3. Use:
- Physical Android via USB: `adb reverse` + `http://localhost:4000/api`
- Android emulator: `http://10.0.2.2:4000/api`

## 7) First-Time App Flow
1. Register two accounts:
   one `patient` and one `guardian`.
2. Patient creates pair key.
3. Guardian joins with pair key.
4. Guardian requests tracking.
5. Patient approves tracking.
6. Patient heartbeats start sending.
7. Guardian sees location/trend/risk in dashboard.
8. Use MRI upload + clinical form to generate risk insights.
9. Generate report and share with neurologist.

## 8) Reports and Email Behavior
- `Download PDF` saves report and opens share chooser.
- `Send via Email App` tries to open installed email app with attachment.
- If no email app is installed on phone, app falls back to share sheet.

## 9) Common Troubleshooting
- Map tiles blank:
  - check `GOOGLE_MAPS_API_KEY` in the Android app configuration
  - ensure `Maps SDK for Android` is enabled
  - ensure billing is enabled on that Google Cloud project
  - start with unrestricted debug key, then apply package + SHA-1 restrictions after validation
  - rebuild app: `flutter clean && flutter pub get && flutter run`

- Backend unreachable from app:
  - backend must be running on port `4000`
  - USB mode: run `adb reverse tcp:4000 tcp:4000`
  - emulator mode: use `10.0.2.2` base URL

- Plugin/runtime mismatch after dependency changes:
```bash
flutter clean
flutter pub get
flutter run
```

- Model inference fallback appears:
  - verify model paths in `.env`
  - verify Python packages installed
  - check backend logs for worker startup errors

## 10) Test Commands
Backend (smoke import):
```bash
cd python_backend
py -c "from app.main import app; print('ASGI OK')"
```

Flutter:
```bash
cd mobile_app
flutter analyze
flutter test
```

## 11) Security Notes
- Do not commit real secrets to GitHub (`.env` should stay local).
- Rotate any keys that were shared in chats/screenshots.
- Keep MongoDB credentials private.
