import express from "express";
import cors from "cors";
import { loadCSV } from "./dataLoader.js";
import { DATASETS } from "./datasetsConfig.js";
import { PitStrategyEngine } from "./strategyEngine.js";
import { hasVertex, initVertex, runAnomalyScan, runExplanation, runPitStrategist } from "./vertexClient.js";

const latencySimMs = () => 150 + Math.floor(Math.random() * 120);

const app = express();
app.use(cors());
app.use(express.json());

let CURRENT_DATASET = "VIR_R1";
let CURRENT_CAR_ID = "CAR_01";
let CURRENT_STATE = { lap: 1, tire_age: 1, compound: "soft" };

let lapsAll = [];
let telemAll = [];
let engine = null;
let telemetryIndex = 0;
const vertexReady = initVertex();

function reloadDataset() {
  const cfg = DATASETS[CURRENT_DATASET];
  lapsAll = loadCSV(cfg.laps);
  telemAll = loadCSV(cfg.telemetry);

  // fallbacks if no car_id column
  if (!lapsAll[0].car_id) {
    lapsAll = lapsAll.map(row => ({ car_id: "CAR_01", ...row }));
  }
  if (!telemAll[0].car_id) {
    telemAll = telemAll.map(row => ({ car_id: "CAR_01", ...row }));
  }

  telemetryIndex = 0;

  const carLaps = lapsAll.filter(r => r.car_id === CURRENT_CAR_ID);
  engine = new PitStrategyEngine(carLaps);

  // init CURRENT_STATE from first lap
  if (carLaps.length) {
    CURRENT_STATE.lap = Number(carLaps[0].lap) || 1;
    CURRENT_STATE.tire_age = 1;
    CURRENT_STATE.compound = "soft";
  }
}

// initial load
reloadDataset();

// advance telemetry index regularly to simulate live stream
setInterval(() => {
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

// ---- API ENDPOINTS ----

// list datasets
app.get("/datasets", (req, res) => {
  const list = Object.entries(DATASETS).map(([id, cfg]) => ({
    id,
    label: cfg.label
  }));
  res.json(list);
});

// select dataset
app.post("/datasets/select", (req, res) => {
  const { id } = req.body;
  if (!DATASETS[id]) {
    return res.status(400).json({ error: "Unknown dataset" });
  }
  CURRENT_DATASET = id;
  reloadDataset();
  res.json({ ok: true, current_dataset: CURRENT_DATASET });
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
app.post("/drivers/select", (req, res) => {
  const { id } = req.body;
  const carExists = telemAll.some(r => r.car_id === id);
  if (!carExists) {
    return res.status(400).json({ error: "Unknown car/driver id" });
  }
  CURRENT_CAR_ID = id;
  reloadDataset();
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

// ---- AI MOCK ENDPOINTS ----

// Natural-language pit strategist (mocked for hackathon)
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

// Anomaly detector (mocked)
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

// Strategy explanation (mocked)
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
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
