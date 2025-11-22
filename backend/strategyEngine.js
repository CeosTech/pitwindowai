export class PitStrategyEngine {
  constructor(raceData, pitLossSeconds = 22.0) {
    this.raceData = raceData;
    this.pitLossSeconds = pitLossSeconds;
    this.totalLaps = Math.max(...raceData.map(r => Number(r.lap)));
    this.avgLapTime = this._avg();
  }

  _avg() {
    const t = this.raceData
      .map(r => parseFloat(r.lap_time))
      .filter(x => !isNaN(x));
    return t.length ? t.reduce((a, b) => a + b, 0) / t.length : 90.0;
  }

  estimateLapTime(lap, age, comp) {
    const base = this.avgLapTime;
    const deg = 0.15 * age;
    const cf = { soft: -0.4, medium: 0.0, hard: 0.3 };
    return base + deg + (cf[comp] ?? 0);
  }

  simulate(curLap, curAge, curComp, pitLap) {
    let total = 0;
    let age = curAge;
    let comp = curComp;
    for (let lap = curLap; lap <= this.totalLaps; lap++) {
      if (lap === pitLap) {
        total += this.pitLossSeconds;
        age = 0;
        comp = "medium";
        continue;
      }
      total += this.estimateLapTime(lap, age, comp);
      age++;
    }
    return total;
  }

  findWindow(curLap, curAge, curComp, windowSize = 5) {
    const maxLap = Math.min(curLap + windowSize, this.totalLaps);
    const candidates = [];
    for (let lap = curLap + 1; lap <= maxLap; lap++) {
      candidates.push({
        pit_lap: lap,
        estimated_total_time: this.simulate(curLap, curAge, curComp, lap)
      });
    }
    let best = candidates[0];
    for (const c of candidates) {
      if (c.estimated_total_time < best.estimated_total_time) {
        best = c;
      }
    }
    return { bestPitLap: best?.pit_lap ?? null, candidates };
  }
}
