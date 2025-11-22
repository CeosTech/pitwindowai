"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import styles from "./page.module.css";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type Dataset = { id: string; label: string };
type Driver = { id: string; label: string };
type LiveState = {
  lap: number;
  speed: number;
  gear?: string;
  throttle: number;
  brake_front: number;
  brake_rear: number;
  index: number;
  car_id: string;
};
type StrategyCandidate = { pit_lap: number; estimated_total_time: number };
type StrategyResponse = {
  current_state: { lap: number; tire_age: number; compound: string };
  best_pit_lap: number;
  candidates: StrategyCandidate[];
};
type AiAction = { pit_lap: number; rationale: string; confidence: number; json_patch?: Record<string, unknown> };
type PitStrategistResponse = { text: string; actions: AiAction[]; latency_ms: number };
type Anomaly = { signal: string; zscore: number; message: string; severity: string };
type AnomalyResponse = { lap: number; anomalies: Anomaly[]; latency_ms: number };

type TimelineEntry = { lap: number; best_pit_lap: number | null; ts: number };

const getCompoundVariant = (compound?: string) => {
  const normalized = (compound ?? "soft").toLowerCase();
  if (normalized.includes("medium")) return "medium";
  if (normalized.includes("hard")) return "hard";
  return "soft";
};

const Skeleton = ({ className = "" }: { className?: string }) => (
  <div className={`${styles.skeleton} ${className}`} />
);

const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1.5 1V21a2 2 0 1 1-4 0v-.12a1.7 1.7 0 0 0-1.5-1q-.27-.06-.55-.15a1.7 1.7 0 0 0-1.8.35l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .35-1.8q-.08-.27-.14-.55a1.7 1.7 0 0 0-1-1.5H3a2 2 0 1 1 0-4h.12a1.7 1.7 0 0 0 1-1.5q.06-.28.14-.55a1.7 1.7 0 0 0-.35-1.8L3.9 6.4a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.8.35q.27-.08.55-.14a1.7 1.7 0 0 0 1-1V3a2 2 0 1 1 4 0v.12a1.7 1.7 0 0 0 1 1q.28.06.55.14a1.7 1.7 0 0 0 1.8-.35l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.35 1.8q.08.27.14.55a1.7 1.7 0 0 0 1 1H21a2 2 0 1 1 0 4h-.12a1.7 1.7 0 0 0-1 1q-.06.28-.14.55Z" />
  </svg>
);

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7.5 13.5 4.5 10.5 3.5 11.5 7.5 15.5 17.5 5.5 16.5 4.5 7.5 13.5Z" fill="currentColor" />
  </svg>
);

const DriverIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="7" r="4" />
    <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
  </svg>
);

const GRLogoSvg = () => (
  <svg viewBox="0 0 120 50" role="img" aria-label="Toyota Gazoo Racing">
    <defs>
      <linearGradient id="grGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#111" />
        <stop offset="50%" stopColor="#111" />
        <stop offset="50%" stopColor="#eb0029" />
        <stop offset="100%" stopColor="#eb0029" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="116" height="46" rx="6" fill="url(#grGrad)" stroke="#333" strokeWidth="3" />
    <text x="20" y="32" fill="#fff" fontSize="18" fontWeight="800" letterSpacing="2">GR</text>
    <text x="60" y="21" fill="#fff" fontSize="10" fontWeight="700" letterSpacing="1">TOYOTA</text>
    <text x="60" y="34" fill="#fff" fontSize="10" fontWeight="700" letterSpacing="1">GAZOO</text>
    <text x="60" y="47" fill="#fff" fontSize="10" fontWeight="700" letterSpacing="1">RACING</text>
  </svg>
);

const GRCarSvg = () => (
  null
);

export default function Page() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [strategy, setStrategy] = useState<StrategyResponse | null>(null);
  const [replayRunning, setReplayRunning] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [stintLength, setStintLength] = useState(4);
  const [safetyCarMode, setSafetyCarMode] = useState(false);
  const [compoundFilter, setCompoundFilter] = useState<"all" | "soft" | "medium" | "hard">("all");
  const [datasetSearch, setDatasetSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [showLanding, setShowLanding] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [aiQuestion, setAiQuestion] = useState("If safety car on lap 18, when should we pit?");
  const [aiResponse, setAiResponse] = useState<PitStrategistResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      setInitialLoading(true);
      const start = performance.now();
      try {
        const dsRes = await fetch(`${BACKEND_URL}/datasets`);
        const dsData: Dataset[] = await dsRes.json();
        if (!mounted) return;
        setDatasets(dsData);
        if (!dsData.length) {
          setBackendError("No datasets available");
          setInitialLoading(false);
          return;
        }
        const firstDataset = dsData[0].id;
        setSelectedDataset(firstDataset);
        await fetch(`${BACKEND_URL}/datasets/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: firstDataset })
        });
        const driversRes = await fetch(`${BACKEND_URL}/drivers`);
        const driversData: Driver[] = await driversRes.json();
        if (!mounted) return;
        setDrivers(driversData);
        if (driversData.length) {
          const firstDriver = driversData[0].id;
          setSelectedDriver(firstDriver);
          await fetch(`${BACKEND_URL}/drivers/select`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: firstDriver })
          });
        }
        setBackendError(null);
        setLastUpdate(Date.now());
        setLatencyMs(Math.round(performance.now() - start));
      } catch (error) {
        if (!mounted) return;
        setBackendError("Backend unreachable");
      } finally {
        if (!mounted) return;
        setInitialLoading(false);
      }
    };
    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!replayRunning) return;
    let mounted = true;
    const tick = async () => {
      const start = performance.now();
      try {
        const liveRes = await fetch(`${BACKEND_URL}/state/live`);
        const liveData: LiveState = await liveRes.json();
        if (!mounted) return;
        setLive(liveData);
        const stratRes = await fetch(`${BACKEND_URL}/strategy/recommendation`);
        const strategyData: StrategyResponse = await stratRes.json();
        if (!mounted) return;
        setStrategy(strategyData);
        setTimeline(prev => {
          const lap = strategyData.current_state.lap;
          if (prev.some(e => e.lap === lap)) return prev;
          return [...prev, { lap, best_pit_lap: strategyData.best_pit_lap, ts: Date.now() }];
        });
        setBackendError(null);
        setLastUpdate(Date.now());
        setLatencyMs(Math.round(performance.now() - start));
      } catch (error) {
        if (!mounted) return;
        setBackendError("Backend unreachable");
      }
    };
    const interval = setInterval(tick, 1000);
    tick();
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [replayRunning]);

  const handleDatasetChange = async (id: string) => {
    setSelectedDataset(id);
    await fetch(`${BACKEND_URL}/datasets/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    const driversRes = await fetch(`${BACKEND_URL}/drivers`);
    const driversData: Driver[] = await driversRes.json();
    setDrivers(driversData);
    if (driversData.length) {
      setSelectedDriver(driversData[0].id);
      await fetch(`${BACKEND_URL}/drivers/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: driversData[0].id })
      });
    }
    setTimeline([]);
  };

  const handleDriverChange = async (id: string) => {
    setSelectedDriver(id);
    await fetch(`${BACKEND_URL}/drivers/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    setTimeline([]);
  };

  const handleAskStrategist = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/ai/pit-strategist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: aiQuestion,
          state_snapshot: {
            lap: currentLap,
            best_pit_lap: bestLap,
            tire_age: strategy?.current_state.tire_age
          }
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PitStrategistResponse = await res.json();
      setAiResponse(data);
    } catch (err: any) {
      setAiError(err?.message || "Strategist unavailable");
    } finally {
      setAiLoading(false);
    }
  };

  const handleScanAnomalies = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/ai/anomaly`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lap: currentLap,
          signals: {
            degradation: strategy?.current_state.tire_age,
            brake_temp: live?.brake_front
          }
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AnomalyResponse = await res.json();
      setAnomalies(data);
    } catch (err: any) {
      setAnomalies({
        lap: currentLap ?? 0,
        anomalies: [{ signal: "error", zscore: 0, message: err?.message || "Could not scan anomalies", severity: "high" }],
        latency_ms: 0
      });
    }
  };

  const strategyCandidates = strategy?.candidates ?? [];

  const bestCandidate = useMemo<StrategyCandidate | null>(() => {
    if (!strategyCandidates.length) return null;
    return strategyCandidates.reduce((best, candidate) =>
      candidate.estimated_total_time < best.estimated_total_time ? candidate : best
    );
  }, [strategyCandidates]);

  const bestLap = strategy?.best_pit_lap ?? bestCandidate?.pit_lap ?? null;
  const currentLap = strategy?.current_state.lap ?? live?.lap ?? null;

  const estimatedGainSeconds = useMemo(() => {
    if (!strategyCandidates.length) return null;
    const times = strategyCandidates.map(c => c.estimated_total_time);
    const max = Math.max(...times);
    const min = Math.min(...times);
    return max - min;
  }, [strategyCandidates]);

  const lapRangeEnd = useMemo(() => {
    const candidateMax = strategyCandidates.reduce((max, c) => Math.max(max, c.pit_lap), 0);
    return Math.max(30, candidateMax, bestLap ?? 0, currentLap ?? 0);
  }, [strategyCandidates, bestLap, currentLap]);

  const lapPoints = useMemo(
    () => Array.from({ length: lapRangeEnd - 15 + 1 }, (_, i) => 15 + i),
    [lapRangeEnd]
  );

  const candidateLapSet = useMemo(() => new Set(strategyCandidates.map(c => c.pit_lap)), [strategyCandidates]);
  const compoundVariant = getCompoundVariant(strategy?.current_state.compound);

  const renderDot = (props: any) => {
    const { cx, cy, payload } = props;
    const isBest = bestLap !== null && payload?.pit_lap === bestLap;
    const color = isBest ? "var(--gr-green)" : "var(--gr-red)";
    return (
      <g>
        <circle cx={cx} cy={cy} r={isBest ? 6 : 4} fill={color} stroke="var(--gr-gray-dark)" strokeWidth={2} />
        {isBest && (
          <text x={cx} y={(cy ?? 0) - 12} fill="var(--gr-green)" textAnchor="middle" fontSize={12} fontWeight="700">
            Best: {payload?.pit_lap}
          </text>
        )}
      </g>
    );
  };

  const heroSubtitle = estimatedGainSeconds !== null
    ? `Estimated gain: ${estimatedGainSeconds.toFixed(1)} seconds (+1 position)`
    : "Waiting for strategy telemetry";
  const heroSubtitleClass =
    estimatedGainSeconds !== null && estimatedGainSeconds < 0 ? styles.heroSubtitleLoss : styles.heroSubtitle;

  const badgeClass =
    compoundVariant === "hard"
      ? `${styles.badge} ${styles.badgeHard}`
      : compoundVariant === "medium"
        ? `${styles.badge} ${styles.badgeMedium}`
        : `${styles.badge} ${styles.badgeSoft}`;

  const filteredDatasets = datasets.filter(d =>
    d.label.toLowerCase().includes(datasetSearch.toLowerCase())
  );
  const filteredDrivers = drivers.filter(d =>
    d.label.toLowerCase().includes(driverSearch.toLowerCase())
  );

  const latencyLabel = latencyMs !== null ? `${latencyMs} ms` : "-";
  const lastUpdateLabel = lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : "-";
  const sourceLabel = replayRunning ? "Live" : "Simulated";

  const bestWindowStart = bestLap !== null ? Math.max(0, bestLap - stintLength) : null;
  const bestWindowEnd = bestLap !== null ? bestLap + stintLength : null;

  if (showLanding) {
    return (
      <div className={styles.landing}>
        <div className={styles.landingBg}>
          <div className={styles.landingGrid} />
          <div className={styles.landingGlow} />
        </div>
        <div className={styles.landingContent}>
          <div className={styles.landingBadge}>Toyota Gazoo Racing</div>
          <h1 className={styles.landingTitle}>GR PitWindow Engine</h1>
          <p className={styles.landingSubtitle}>
            Real-time strategy, telemetry, and AI copilots built for the pit wall. Enter to launch the dashboard.
          </p>
          <div className={styles.landingVisual}>
            <div className={styles.landingPlaceholderText}>Landing hero removed</div>
          </div>
          <div className={styles.landingActions}>
            <button className={styles.landingButton} onClick={() => setShowLanding(false)}>
              Enter the dashboard
            </button>
            <button className={styles.landingGhost} onClick={() => setShowLanding(false)}>
              Skip intro
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {showSettings && (
        <div className={styles.settingsOverlay} onClick={() => setShowSettings(false)}>
          <div className={styles.settingsPanel} onClick={e => e.stopPropagation()}>
            <div className={styles.settingsHeader}>
              <div>
                <p className={styles.panelHeader}>Parameters</p>
                <p className={styles.cardSubtitle}>Tune strategy defaults</p>
              </div>
              <button className={styles.alertButton} type="button" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>
            <div className={styles.settingsBody}>
              <div className={styles.settingsItem}>
                <p className={styles.cardTitle}>Pit window span</p>
                <input
                  type="range"
                  min={2}
                  max={10}
                  value={stintLength}
                  onChange={e => setStintLength(Number(e.target.value))}
                  className={styles.rangeInput}
                />
                <p className={styles.cardSubtitle}>{stintLength} laps around best</p>
              </div>
              <div className={styles.settingsItem}>
                <p className={styles.cardTitle}>Safety car mode</p>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={safetyCarMode}
                    onChange={e => setSafetyCarMode(e.target.checked)}
                  />
                  <span className={styles.toggleTrack}>
                    <span className={styles.toggleThumb} />
                  </span>
                  <span className={styles.toggleText}>{safetyCarMode ? "On" : "Off"}</span>
                </label>
                <p className={styles.cardSubtitle}>Adjust recommendations when SC risk is high.</p>
              </div>
              <div className={styles.settingsItem}>
                <p className={styles.cardTitle}>Compound focus</p>
                <div className={styles.segmented}>
                  {["all", "soft", "medium", "hard"].map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setCompoundFilter(option as typeof compoundFilter)}
                      className={`${styles.segmentedButton} ${compoundFilter === option ? styles.segmentedActive : ""}`}
                    >
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
                <p className={styles.cardSubtitle}>Filter strategy visuals.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>
            <div className={styles.logoMark}>GR</div>
          </div>
          <div>
            <div className={styles.title}>GR PitWindow Engine</div>
            <div className={styles.subtitle}>Real-Time Strategy & Telemetry Engine</div>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.metaRow}>
            <span className={`${styles.statusPill} ${replayRunning ? styles.pillLive : styles.pillSim}`}>
              {sourceLabel}
            </span>
            <span className={styles.metaChip}>Last update: {lastUpdateLabel}</span>
            <span className={`${styles.metaChip} ${latencyMs !== null && latencyMs > 500 ? styles.latencySlow : styles.latencyFast}`}>
              Latency: {latencyLabel}
            </span>
          </div>
          <button className={styles.iconButton} aria-label="Settings" type="button" onClick={() => setShowSettings(true)}>
            <GearIcon />
          </button>
          <button
            className={`${styles.replayButton} ${replayRunning ? styles.replayButtonActive : ""}`}
            onClick={() => setReplayRunning(v => !v)}
            type="button"
          >
            <span className={styles.replayStatusDot} />
            {replayRunning ? "Pause Replay" : "Start Replay"}
          </button>
        </div>
      </header>

      {backendError && (
        <div className={styles.errorBanner}>
          {backendError}
        </div>
      )}

      <main className={styles.main}>
        <section className={styles.controlsBar}>
          <div className={styles.controlBlock}>
            <label className={styles.controlLabel}><GlobeIcon /> Dataset search</label>
            <input
              className={styles.searchInput}
              placeholder="Search dataset"
              value={datasetSearch}
              onChange={e => setDatasetSearch(e.target.value)}
            />
            <select
              className={styles.select}
              value={selectedDataset ?? ""}
              onChange={e => handleDatasetChange(e.target.value)}
              disabled={!filteredDatasets.length}
            >
              {filteredDatasets.length === 0 && <option value="">No datasets</option>}
              {filteredDatasets.map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.controlBlock}>
            <label className={styles.controlLabel}><DriverIcon /> Driver search</label>
            <input
              className={styles.searchInput}
              placeholder="Search driver"
              value={driverSearch}
              onChange={e => setDriverSearch(e.target.value)}
            />
            <select
              className={styles.select}
              value={selectedDriver ?? ""}
              onChange={e => handleDriverChange(e.target.value)}
              disabled={!filteredDrivers.length}
            >
              {filteredDrivers.length === 0 && <option value="">No drivers</option>}
              {filteredDrivers.map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.controlBlock}>
            <label className={styles.controlLabel}>Stint window</label>
            <input
              type="range"
              min={2}
              max={10}
              value={stintLength}
              onChange={e => setStintLength(Number(e.target.value))}
              className={styles.rangeInput}
            />
            <div className={styles.rangeValue}>{stintLength} lap span around best</div>
          </div>
          <div className={styles.controlBlock}>
            <label className={styles.controlLabel}>Safety car mode</label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={safetyCarMode}
                onChange={e => setSafetyCarMode(e.target.checked)}
              />
              <span className={styles.toggleTrack}>
                <span className={styles.toggleThumb} />
              </span>
              <span className={styles.toggleText}>{safetyCarMode ? "On" : "Off"}</span>
            </label>
            <div className={styles.rangeValue}>Adjust projections when safety car risk is high</div>
          </div>
          <div className={styles.controlBlock}>
            <label className={styles.controlLabel}>Compound focus</label>
            <div className={styles.segmented}>
              {["all", "soft", "medium", "hard"].map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCompoundFilter(option as typeof compoundFilter)}
                  className={`${styles.segmentedButton} ${compoundFilter === option ? styles.segmentedActive : ""}`}
                >
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
            <div className={styles.rangeValue}>Filters strategy visuals only</div>
          </div>
        </section>

        <section className={styles.cardGrid}>
          <div className={styles.card}>
            {initialLoading ? (
              <>
                <Skeleton className={styles.skeletonText} />
                <Skeleton className={styles.skeletonValue} />
                <Skeleton className={styles.skeletonLine} />
              </>
            ) : (
              <>
                <p className={styles.cardTitle}>Current Lap</p>
                <p className={styles.cardValueXL}>{currentLap ?? "--"}</p>
                <p className={styles.cardSubtitle}>Lap in progress</p>
              </>
            )}
          </div>

          <div className={styles.card}>
            {initialLoading ? (
              <>
                <Skeleton className={styles.skeletonText} />
                <Skeleton className={styles.skeletonValue} />
                <Skeleton className={styles.skeletonPill} />
              </>
            ) : (
              <>
                <p className={styles.cardTitle}>Tire Age</p>
                <p className={styles.cardValue}>{strategy?.current_state.tire_age ?? "--"} laps</p>
                <div className={styles.badgeRow}>
                  <span className={badgeClass}>
                    {compoundVariant.charAt(0).toUpperCase() + compoundVariant.slice(1)}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className={styles.card}>
            {initialLoading ? (
              <>
                <Skeleton className={styles.skeletonText} />
                <Skeleton className={styles.skeletonLine} />
                <Skeleton className={styles.skeletonLine} />
              </>
            ) : (
              <>
                <p className={styles.cardTitle}>Red Flag Alerts</p>
                <p className={styles.cardSubtitle}>Degradation: Medium (up)</p>
                <p className={styles.cardSubtitle}>Grip forecast: Stable</p>
              </>
            )}
          </div>
        </section>

        <section className={styles.hero}>
          <div className={styles.heroText}>
            <div className={styles.heroPills}>
              <span className={`${styles.statusPill} ${styles.pillLive}`}>Source: {sourceLabel}</span>
              {safetyCarMode && <span className={styles.metaChip}>Safety car high</span>}
              <span className={styles.metaChip}>Latency {latencyLabel}</span>
            </div>
            <p className={styles.heroLabel}>Optimal Pit Lap</p>
            <p className={styles.heroTitle}>{bestLap ?? "--"}</p>
            <p className={heroSubtitleClass}>{heroSubtitle}</p>
          </div>
          <div className={styles.heroActions}>
            <button className={styles.heroButton} type="button">
              <CheckIcon />
              <span>Apply Strategy</span>
            </button>
            <p className={styles.heroMeta}>Auto-updates from live telemetry</p>
          </div>
        </section>

        <section className={styles.chartRow}>
          <div className={`${styles.panel} ${styles.panelLarge}`}>
            <div className={styles.panelHeader}>Pit Lap vs Estimated Total Time</div>
            {strategyCandidates.length ? (
              <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={strategyCandidates}
                    margin={{ top: 16, right: 24, left: 12, bottom: 16 }}
                  >
                    <CartesianGrid stroke="#1f1f1f" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="pit_lap"
                      tick={{ fontSize: 11, fill: "#c4c4c4" }}
                      label={{
                        value: "Pit Lap (18 to 22)",
                        position: "insideBottom",
                        dy: 10,
                        fill: "#c4c4c4",
                        fontSize: 11
                      }}
                      stroke="#333333"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#c4c4c4" }}
                      label={{
                        value: "Total Time",
                        angle: -90,
                        position: "insideLeft",
                        fill: "#c4c4c4",
                        fontSize: 11
                      }}
                      stroke="#333333"
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#111111", border: "1px solid #272727", fontSize: 12 }}
                      labelStyle={{ color: "#ffffff" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="estimated_total_time"
                      stroke="var(--gr-red)"
                      strokeWidth={2}
                      dot={renderDot}
                      activeDot={{ r: 5, stroke: "#0c0c0c", strokeWidth: 2 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className={styles.placeholder}>Start replay to generate the strategy curve.</div>
            )}
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>Simulation Timeline</div>
            <div className={styles.timeline}>
              <div className={styles.timelineTrack} />
              <div className={styles.timelineDots}>
                {lapPoints.map(lap => {
                  const isBest = bestLap !== null && lap === bestLap;
                  const isCurrent = currentLap !== null && lap === currentLap;
                  const isCandidate = candidateLapSet.has(lap);
                  const inWindow = bestWindowStart !== null && bestWindowEnd !== null && lap >= bestWindowStart && lap <= bestWindowEnd;
                  const dotClass = isBest
                    ? styles.timelineDotBest
                    : isCandidate
                      ? styles.timelineDotCandidate
                      : isCurrent
                        ? styles.timelineDotCurrent
                        : inWindow
                          ? styles.timelineDotWindow
                          : styles.timelineDotFuture;
                  const title = `Lap ${lap}${isBest ? " (best pit)" : isCandidate ? " (pit tested)" : isCurrent ? " (current lap)" : inWindow ? " (in pit window)" : ""}`;
                  return (
                    <div key={lap} className={styles.timelinePoint} title={title}>
                      <div className={`${styles.timelineDot} ${dotClass}`} />
                      <span className={styles.timelineLabel}>{lap}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className={styles.timelineLegend}>
              <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendDotCurrent}`} />Current</span>
              <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendDotCandidate}`} />Pit tested</span>
              <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendDotBest}`} />Best pit</span>
              <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendDotWindow}`} />Pit window</span>
              <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendDotFuture}`} />Upcoming</span>
            </div>
            <div className={styles.timelineHistory}>
              {timeline.length === 0 ? (
                <p className={styles.cardSubtitle}>Change history will appear as the replay runs.</p>
              ) : (
                timeline.map(entry => (
                  <div key={entry.lap} className={styles.historyItem}>
                    <span className={styles.historyLap}>Lap {entry.lap}</span>
                    <span className={styles.historyBest}>Best pit: {entry.best_pit_lap ?? "--"}</span>
                    <span className={styles.historyTime}>{new Date(entry.ts).toLocaleTimeString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={styles.aiRow}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>AI Strategist (Gemini-ready stub)</div>
            <textarea
              className={styles.aiInput}
              value={aiQuestion}
              onChange={e => setAiQuestion(e.target.value)}
              placeholder="Ask a pit question..."
              rows={3}
            />
            <div className={styles.aiActions}>
              <button className={styles.heroButton} type="button" onClick={handleAskStrategist} disabled={aiLoading}>
                {aiLoading ? "Thinking..." : "Ask strategist"}
              </button>
              {aiResponse && (
                <span className={styles.metaChip}>Latency {aiResponse.latency_ms} ms</span>
              )}
            </div>
            {aiError && <p className={styles.cardSubtitle}>{aiError}</p>}
            {aiResponse && (
              <div className={styles.aiResults}>
                <p className={styles.cardSubtitle}>{aiResponse.text}</p>
                <div className={styles.aiActionsList}>
                  {aiResponse.actions.map(action => (
                    <div key={action.pit_lap} className={styles.aiActionCard}>
                      <div className={styles.aiActionHeader}>
                        <span className={styles.cardValue}>{action.pit_lap}</span>
                        <span className={styles.metaChip}>Conf {Math.round(action.confidence * 100)}%</span>
                      </div>
                      <p className={styles.cardSubtitle}>{action.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>AI Anomaly Scan</div>
            <div className={styles.aiActions}>
              <button className={styles.replayButton} type="button" onClick={handleScanAnomalies}>
                Scan signals
              </button>
              {anomalies && <span className={styles.metaChip}>Latency {anomalies.latency_ms} ms</span>}
            </div>
            <div className={styles.aiResults}>
              {anomalies ? (
                anomalies.anomalies.map((a, idx) => (
                  <div key={`${a.signal}-${idx}`} className={`${styles.aiAnomaly} ${styles[`severity-${a.severity}`] || ""}`}>
                    <div className={styles.aiAnomalyTop}>
                      <span className={styles.cardTitle}>{a.signal}</span>
                      <span className={styles.metaChip}>z {a.zscore.toFixed(2)}</span>
                    </div>
                    <p className={styles.cardSubtitle}>{a.message}</p>
                  </div>
                ))
              ) : (
                <p className={styles.cardSubtitle}>Run a scan to surface anomalies.</p>
              )}
            </div>
          </div>
        </section>

        <section className={styles.alert}>
          <div>
            <p className={styles.alertTitle}>Strategy Updated (Lap {currentLap ?? "--"})</p>
            <p className={styles.alertText}>
              Degradation rising quickly - pit window shortened. Track grip steady; monitor tyre temps.
            </p>
          </div>
          <button className={styles.alertButton} type="button">
            View updated strategy
          </button>
        </section>
      </main>
    </div>
  );
}
