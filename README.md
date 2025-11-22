# GR PitWindow Engine

Toyota Gazoo Racing pit wall dashboard (Next.js) driven by an Express pit-strategy API. Built for the hackathon demo with live replay, AI stubs, and GR-branded UI.

## Quick start

Backend:
```bash
cd backend
npm install
npm run dev      # http://localhost:8000
```

Frontend:
```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```
If the backend runs elsewhere, set `NEXT_PUBLIC_BACKEND_URL` in `frontend/.env.local`.

## Environment examples
Frontend `.env.local`:
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
# NEXT_PUBLIC_SHOW_LANDING=true
```

Backend (optional `.env` if you want to override port):
```
PORT=8000
NODE_ENV=development
# TRUST_PROXY=1
# USE_VERTEX_AI=1
# GCP_PROJECT_ID=your-project
# GCP_LOCATION=us-central1
# VERTEX_GEMINI_MODEL=gemini-1.5-flash
# VERTEX_TS_MODEL=your-forecast-model
# GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
# (Vertex/Gemini: strategist endpoint will use mocks unless USE_VERTEX_AI=1 and creds are provided)
```

## Datasets
Add your CSVs under `backend/data/<DATASET_ID>/` and register them in `backend/datasetsConfig.js`, e.g.:
```js
export const DATASETS = {
  VIR_R1: {
    label: "VIR Race 1",
    telemetry: "data/VIR_R1/R1_vir_telemetry_data.csv",
    laps: "data/VIR_R1/vir_lap_time_R1.csv"
  }
};
```
The loader assigns `CAR_01` if no `car_id` column exists; include `car_id` to support multiple cars.

## Features (frontend)
- Landing splash with GR visuals.
- Header: dataset/driver selectors, live/sim status, latency chip, Settings panel.
- Top cards: lap, tire age + compound badge, alert stub.
- Hero: optimal pit lap, gain text, apply button.
- Charts: pit lap vs total time line chart with best-lap marker; timeline showing pit window and history.
- AI stubs: natural-language strategist + anomaly scan (calls `/ai/*` mocks).
- Settings modal: pit window span, safety car toggle, compound filter.

## Features (backend)
- Dataset selection, driver selection, live telemetry stream (simulated), strategy recommendation.
- AI stub endpoints (mocked for hackathon): `/ai/pit-strategist`, `/ai/anomaly`, `/ai/explain`.

## Deploy tips
- Cloud Run: deploy backend with `--min-instances=1`; add health checks. Frontend on Cloud Run or Firebase Hosting.
- Env: set `NEXT_PUBLIC_BACKEND_URL` on the frontend; keep API base on backend via `PORT`.
- Observability: enable Cloud Logging/Trace/Error Reporting; alert on 5xx/latency.
