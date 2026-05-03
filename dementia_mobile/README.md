# Dementia companion (Flutter) — Memory Aid monorepo

This app is **not** merged into `mobile_flutter/`. It is a **second mobile client** that should use the **shared FastAPI** in `../../backend/` (`main.py`, default **port 8000**).

## API base URL

- **Default:** `http://127.0.0.1:8000/api` (same prefix as the React app’s `REACT_APP_BACKEND_URL` + `/api`).
- **Emulator → host (Android):**  
  `flutter run --dart-define=MEMORY_AID_API_BASE=http://10.0.2.2:8000/api`
- **Physical device → dev machine:** use your PC’s LAN IP, e.g.  
  `--dart-define=MEMORY_AID_API_BASE=http://192.168.1.10:8000/api`
- **External / legacy API** (e.g. another server on port 4000): set URL in **Settings** inside the app, or:  
  `--dart-define=MEMORY_AID_API_BASE=http://127.0.0.1:4000/api`

> Many screens still call routes such as `/auth/login`, `/pairing/*`, `/alerts/*`, etc. Those are **not** all implemented on FastAPI yet. Point the app at **`backend/`** for integrated behaviour as routes are added, or use a separate API that implements those paths.

## Run

```bash
cd dementia_mobile
flutter pub get
flutter run
```

## Web UI

Use the repo’s **`web/`** app (`npm start` from `web/`) for the integrated Memory Aid web experience.
