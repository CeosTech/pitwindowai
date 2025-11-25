import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { loadCSV, saveToGCS, saveToLocal } from "./dataLoader.js";
import { DATASETS } from "./datasetsConfig.js";
import { PitStrategyEngine } from "./strategyEngine.js";
import { hasVertex, initVertex, runAnomalyScan, runExplanation, runPitStrategist } from "./vertexClient.js";

const latencySimMs = () => 150 + Math.floor(Math.random() * 120);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB per file
});
const GCS_DATA_BUCKET = process.env.GCS_DATA_BUCKET;
const DATA_ROOT = process.env.DATA_DIR || path.join(process.cwd(), "data");

const app = express();
app.use(cors());
app.use(express.json());

const datasets = { ...DATASETS };
let CURRENT_DATASET = null;
let CURRENT_CAR_ID = "CAR_01";
let CURRENT_STATE = { lap: 1, tire_age: 1, compound: "soft" };

let lapsAll = [];
let telemAll = [];
let engine = null;
let telemetryIndex = 0;
let tickerStarted = false;
const vertexReady = initVertex();

const ROW_LIMIT = Number.parseInt(process.env.CSV_ROW_LIMIT || "0", 10);
const effectiveRowLimit = Number.isFinite(ROW_LIMIT) && ROW_LIMIT > 0 ? ROW_LIMIT : null;

const startTelemetryTicker = () => {
  if (tickerStarted) return;
  tickerStarted = true;
  setInterval(() => {
    if (!telemAll.length) return;
    const carTelem = telemAll.filter(r => r.car_id === CURRENT_CAR_ID);
    if (!carTelem.length) return;
    telemetryIndex = Math.min(telemetryIndex + 1, carTelem.length - 1);

    const row = carTelem[telemetryIndex];
    if (row && row.lap) {
      const newLap = Number(row.lap);
      if (newLap > CURRENT_STATE.lap) {
        CURRENT_STATE.lap = newLap;
        CURRENT_STATE.tire_age += 1;
      }
    }
  }, 800);
};

async function reloadDataset(datasetId = CURRENT_DATASET) {
  const cfg = datasets[datasetId];
  if (!cfg) {
    engine = null;
    lapsAll = [];
    telemAll = [];
    return;
  }

  lapsAll = await loadCSV(cfg.laps, { rowLimit: effectiveRowLimit });
  telemAll = await loadCSV(cfg.telemetry, { rowLimit: effectiveRowLimit });

  // fallbacks if no car_id column
  if (lapsAll[0] && !lapsAll[0].car_id) {
    lapsAll = lapsAll.map(row => ({ car_id: "CAR_01", ...row }));
  }
  if (telemAll[0] && !telemAll[0].car_id) {
    telemAll = telemAll.map(row => ({ car_id: "CAR_01", ...row }));
  }

  telemetryIndex = 0;

  const carLaps = lapsAll.filter(r => r.car_id === CURRENT_CAR_ID);
  engine = carLaps.length ? new PitStrategyEngine(carLaps) : null;

  // init CURRENT_STATE from first lap
  if (carLaps.length) {
    CURRENT_STATE.lap = Number(carLaps[0].lap) || 1;
    CURRENT_STATE.tire_age = 1;
    CURRENT_STATE.compound = "soft";
  }
}

async function bootstrapDataset() {
  const first = Object.keys(datasets)[0];
  if (first) {
    CURRENT_DATASET = first;
    try {
      await reloadDataset(first);
      startTelemetryTicker();
    } catch (err) {
      console.error("Initial dataset load failed", err);
    }
  } else {
    console.warn("No default dataset configured. Upload a dataset to begin.");
  }
}

const listDatasets = () =>
  Object.entries(datasets).map(([id, cfg]) => ({
    id,
    label: cfg.label || id
  }));

// ---- API ENDPOINTS ----

// list datasets
app.get("/datasets", (req, res) => {
  res.json(listDatasets());
});

// upload new dataset (telemetry + laps) to GCS and register it
app.post(
  "/datasets/upload",
  upload.fields([
    { name: "telemetry", maxCount: 1 },
    { name: "laps", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { id, label } = req.body || {};
      const telemetryFile = req.files?.telemetry?.[0];
      const lapsFile = req.files?.laps?.[0];
      const rawId = (id || "").trim();
      const datasetId = rawId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const useGcs = Boolean(GCS_DATA_BUCKET);

      if (!datasetId) return res.status(400).json({ error: "Missing dataset id" });
      if (!telemetryFile && !lapsFile) {
        return res.status(400).json({ error: "Provide at least one file (telemetry or laps)" });
      }

      const entry = datasets[datasetId] || {};
      entry.label = label || entry.label || rawId || datasetId;

      if (useGcs) {
        if (!GCS_DATA_BUCKET) {
          return res.status(400).json({ error: "GCS_DATA_BUCKET not configured" });
        }
        if (telemetryFile) {
          entry.telemetry = await saveToGCS(
            GCS_DATA_BUCKET,
            `${datasetId}/telemetry.csv`,
            telemetryFile.buffer,
            telemetryFile.mimetype
          );
        }
        if (lapsFile) {
          entry.laps = await saveToGCS(
            GCS_DATA_BUCKET,
            `${datasetId}/laps.csv`,
            lapsFile.buffer,
            lapsFile.mimetype
          );
        }
      } else {
        if (telemetryFile) {
          entry.telemetry = await saveToLocal(
            DATA_ROOT,
            path.join(datasetId, "telemetry.csv"),
            telemetryFile.buffer
          );
        }
        if (lapsFile) {
          entry.laps = await saveToLocal(
            DATA_ROOT,
            path.join(datasetId, "laps.csv"),
            lapsFile.buffer
          );
        }
      }

      // allow a single CSV to be used for both streams if only one was provided
      if (!entry.telemetry && entry.laps) entry.telemetry = entry.laps;
      if (!entry.laps && entry.telemetry) entry.laps = entry.telemetry;

      // Require both paths to be set to consider the dataset usable
      if (!entry.telemetry || !entry.laps) {
        datasets[datasetId] = entry;
        return res.status(400).json({
          error: "Dataset registered but missing telemetry or laps path",
          dataset: { id: datasetId, ...entry },
          storage: useGcs ? "gcs" : "local"
        });
      }

      datasets[datasetId] = entry;
      if (!CURRENT_DATASET) CURRENT_DATASET = datasetId;
      if (datasetId === CURRENT_DATASET) {
        await reloadDataset(datasetId).catch(err => {
          console.error("Failed to reload dataset after upload", err);
        });
        startTelemetryTicker();
      }

      res.json({ ok: true, dataset: { id: datasetId, ...entry }, storage: useGcs ? "gcs" : "local" });
    } catch (err) {
      console.error("Upload error", err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

// select dataset
app.post("/datasets/select", async (req, res) => {
  const { id } = req.body;
  if (!datasets[id]) {
    return res.status(400).json({ error: "Unknown dataset" });
  }
  CURRENT_DATASET = id;
  try {
    await reloadDataset(id);
    startTelemetryTicker();
    res.json({ ok: true, current_dataset: CURRENT_DATASET });
  } catch (err) {
    console.error("Dataset reload error", err);
    res.status(500).json({ error: "Failed to load dataset" });
  }
});

// list drivers / cars for current dataset
app.get("/drivers", (req, res) => {
  const unique = {};
  for (const row of telemAll) {
    const id = row.car_id;
    if (!unique[id]) {
      unique[id] = {
        id,
        label: row.driver_id || row.Driver || id
      };
    }
  }
  res.json(Object.values(unique));
});

// select car / driver
app.post("/drivers/select", async (req, res) => {
  const { id } = req.body;
  const carExists = telemAll.some(r => r.car_id === id);
  if (!carExists) {
    return res.status(400).json({ error: "Unknown car/driver id" });
  }
  CURRENT_CAR_ID = id;
  await reloadDataset();
  res.json({ ok: true, current_car_id: CURRENT_CAR_ID });
});

// live telemetry state
app.get("/state/live", (req, res) => {
  const carTelem = telemAll.filter(r => r.car_id === CURRENT_CAR_ID);
  if (!carTelem.length) {
    return res.json({ error: "No telemetry for current car", lap: CURRENT_STATE.lap });
  }
  const row = carTelem[telemetryIndex] || carTelem[carTelem.length - 1];
  res.json({
    lap: Number(row.lap),
    speed: Number(row.Speed || row.speed || 0),
    gear: row.Gear,
    throttle: Number(row.aps || 0),
    brake_front: Number(row.pbrake_f || 0),
    brake_rear: Number(row.pbrake_r || 0),
    index: telemetryIndex,
    car_id: CURRENT_CAR_ID
  });
});

// pit strategy recommendation
app.get("/strategy/recommendation", (req, res) => {
  if (!engine) {
    return res.status(500).json({ error: "Engine not initialized" });
  }
  const windowSize = parseInt(req.query.windowSize || "5");
  const { bestPitLap, candidates } = engine.findWindow(
    CURRENT_STATE.lap,
    CURRENT_STATE.tire_age,
    CURRENT_STATE.compound,
    windowSize
  );
  res.json({
    current_state: CURRENT_STATE,
    best_pit_lap: bestPitLap,
    candidates
  });
});

// ---- AI ENDPOINTS ----

// Natural-language pit strategist
app.post("/ai/pit-strategist", (req, res) => {
  const { question = "" } = req.body || {};
  const baseLap = CURRENT_STATE.lap || 1;
  const suggestedLap = Math.max(baseLap + 2, baseLap + 1);
  if (hasVertex()) {
    runPitStrategist({
      question,
      currentLap: CURRENT_STATE.lap,
      bestLap: suggestedLap,
      tireAge: CURRENT_STATE.tire_age
    })
      .then(data => res.json(data))
      .catch(err => {
        console.error("Vertex strategist error", err?.message || err);
        const actions = [
          {
            pit_lap: suggestedLap,
            rationale: "Fallback after Vertex error; balances degradation with projected traffic.",
            confidence: 0.4,
            json_patch: { best_pit_lap: suggestedLap }
          }
        ];
        res.json({
          question,
          latency_ms: latencySimMs(),
          actions,
          text: `Fallback: pit around lap ${suggestedLap} (Vertex unavailable).`
        });
      });
  } else {
    const actions = [
      {
        pit_lap: suggestedLap,
        rationale: "Balances current degradation with projected traffic. Keeps tire age under control.",
        confidence: 0.72,
        json_patch: { best_pit_lap: suggestedLap }
      },
      {
        pit_lap: suggestedLap + 1,
        rationale: "Alternative if safety car expected. Slightly higher total time.",
        confidence: 0.48,
        json_patch: { best_pit_lap: suggestedLap + 1 }
      }
    ];
    res.json({
      question,
      latency_ms: latencySimMs(),
      actions,
      text: `Recommended pit around lap ${suggestedLap}. Secondary option lap ${suggestedLap + 1}.`
    });
  }
});

// Anomaly detector
app.post("/ai/anomaly", (req, res) => {
  const { signals = {}, lap } = req.body || {};
  if (hasVertex()) {
    runAnomalyScan({ signals, lap })
      .then(data => res.json(data))
      .catch(err => {
        console.error("Vertex anomaly error", err?.message || err);
        res.json({
          lap: lap ?? CURRENT_STATE.lap,
          anomalies: [
            { signal: "error", zscore: 0, message: "Vertex error; fallback to mock", severity: "info" }
          ],
          latency_ms: latencySimMs(),
          provider: "fallback"
        });
      });
  } else {
    const anomalies = [];
    const degradation = Number(signals.degradation ?? CURRENT_STATE.tire_age / 10);
    const brakeTemp = Number(signals.brake_temp ?? 0);
    if (degradation > 0.65) {
      anomalies.push({
        signal: "degradation",
        zscore: 2.1,
        message: "Tyre degradation rising faster than baseline.",
        severity: "medium"
      });
    }
    if (brakeTemp > 900) {
      anomalies.push({
        signal: "brake_temp",
        zscore: 2.8,
        message: "Front brake temps spiking; consider cooldown.",
        severity: "high"
      });
    }
    if (!anomalies.length) {
      anomalies.push({
        signal: "none",
        zscore: 0.0,
        message: "No anomalies detected.",
        severity: "info"
      });
    }
    res.json({
      lap: lap ?? CURRENT_STATE.lap,
      anomalies,
      latency_ms: latencySimMs(),
      provider: "mock"
    });
  }
});

// Strategy explanation
app.post("/ai/explain", (req, res) => {
  const { strategy: incoming } = req.body || {};
  const bestLap = incoming?.best_pit_lap ?? CURRENT_STATE.lap + 3;
  if (hasVertex()) {
    runExplanation({ strategy: incoming, prev: { best_pit_lap: CURRENT_STATE.lap } })
      .then(data => res.json(data))
      .catch(err => {
        console.error("Vertex explanation error", err?.message || err);
        res.json({
          summary: `Pit on lap ${bestLap} to minimize total time given current degradation.`,
          delta: "Fallback after Vertex error.",
          best_pit_lap: bestLap,
          latency_ms: latencySimMs(),
          provider: "fallback"
        });
      });
  } else {
    res.json({
      summary: `Pit on lap ${bestLap} to minimize total time given current degradation.`,
      delta: "Improves expected total time by ~3.2s vs previous plan.",
      best_pit_lap: bestLap,
      latency_ms: latencySimMs(),
      provider: "mock"
    });
  }
});

const PORT = process.env.PORT || 8000;

bootstrapDataset()
  .catch(err => {
    console.error("Failed to load dataset on startup", err);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
      if (effectiveRowLimit) {
        console.log(`Loaded datasets with row limit: ${effectiveRowLimit}`);
      }
    });
  });
