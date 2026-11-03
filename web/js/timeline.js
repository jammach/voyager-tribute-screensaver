// Maps tour time (real seconds) -> mission time. Cruises last 60 s, planetary encounters 240 s.
// Mission time runs at a rate proportional to the distance from the nearest planets (so approaches look like
// smooth exponential zooms) and the proportionality constants are solved so the segment durations are exact.
import { planetPos, len, sub, PLANETS, smoothstep } from './astro.js';

export const CRUISE_SECONDS = 60, ENCOUNTER_SECONDS = 240;

export function buildTimeline(traj) {
  const { flybys, t0, t1, craftState } = traj;
  const n = flybys.length;

  // ---- segments --------------------------------------------------------
  const segs = [];
  let cur = t0;
  for (let i = 0; i < n; i++) {
    const f = flybys[i];
    segs.push({ kind: 'cruise', idx: i, a: cur, b: f.tca - f.Tw, target: CRUISE_SECONDS });
    segs.push({ kind: 'enc', idx: i, a: f.tca - f.Tw, b: f.tca + f.Tw, target: ENCOUNTER_SECONDS, fly: f });
    cur = f.tca + f.Tw;
  }
  segs.push({ kind: 'cruise', idx: n, a: cur, b: t1, target: CRUISE_SECONDS });
  segs.forEach((s) => (s.K = 1e-3));

  // ---- sample grid ---------------------------------------------------------
  const set = new Set([t0, t1]);
  const span = t1 - t0;
  const geo = (c, lo, hi) => { for (let d = lo; d < span; d *= 1.012) { if (c + d < hi) set.add(c + d); if (c - d > lo) set.add(c - d); } };
  for (const s of segs) { set.add(s.a); set.add(s.b); }
  for (const f of flybys) { for (let d = 120; d < span; d *= 1.012) { if (f.tca + d <= t1) set.add(f.tca + d); if (f.tca - d >= t0) set.add(f.tca - d); } }
  for (let d = 900; d < span; d *= 1.012) { set.add(t0 + d); set.add(t1 - d); }
  const T = [...set].filter((x) => x >= t0 && x <= t1).sort((a, b) => a - b);
  const N = T.length;

  // effective distance at each sample
  const stopsAll = [{ name: 'earth', f: 4e4 }, ...flybys.map((f) => ({ name: f.planet, f: 1.5 * f.enc.rp }))];
  const dEff = new Float64Array(N), wEnc = [], cruiseIdx = new Int16Array(N);
  for (let k = 0; k < N; k++) {
    const t = T[k], r = craftState(t).r;
    let j = 0; while (j < n && t >= flybys[j].tca) j++;
    cruiseIdx[k] = j;
    let inv = 0;
    for (const si of [j, j + 1]) { // stopsAll index: 0 = earth, i+1 = flyby i ; previous = j, next = j+1
      if (si > n) continue;
      const st = stopsAll[si];
      const d = len(sub(r, planetPos(st.name, t)));
      inv += 1 / Math.sqrt(d * d + st.f * st.f);
    }
    dEff[k] = 1 / inv;
  }

  // ---- K(t) ------------------------------------------------------------------
  const cruiseK = (j) => segs.find((s) => s.kind === 'cruise' && s.idx === j).K;
  const encK = (i) => segs.find((s) => s.kind === 'enc' && s.idx === i).K;
  const Kat = (k) => {
    const t = T[k], j = cruiseIdx[k];
    let lk = Math.log(cruiseK(j));
    for (let i = 0; i < n; i++) {
      const f = flybys[i], w = 1 - smoothstep(0.7 * f.Tw, 1.6 * f.Tw, Math.abs(t - f.tca));
      if (w > 0) lk = lk * (1 - w) + Math.log(encK(i)) * w;
    }
    return Math.exp(lk);
  };
  const segIndexOf = (k) => { const t = T[k]; for (let s = 0; s < segs.length; s++) if (t >= segs[s].a && t <= segs[s].b) return s; return segs.length - 1; };
  const sOf = new Int16Array(N); for (let k = 0; k < N; k++) sOf[k] = segIndexOf(k);

  const integrate = () => {
    const dtau = new Float64Array(N); // tau increment between sample k-1 and k
    const Kk = new Float64Array(N);
    for (let k = 0; k < N; k++) Kk[k] = Kat(k);
    for (let k = 1; k < N; k++) {
      const dt = T[k] - T[k - 1];
      const a = 1 / (Kk[k - 1] * dEff[k - 1]), b = 1 / (Kk[k] * dEff[k]);
      dtau[k] = 0.5 * (a + b) * dt;
    }
    return { dtau, Kk };
  };

  let res;
  for (let it = 0; it < 80; it++) {
    res = integrate();
    const tot = new Float64Array(segs.length);
    for (let k = 1; k < N; k++) {
      // attribute the interval to the segment containing its midpoint
      const mid = 0.5 * (T[k] + T[k - 1]);
      let s = 0; while (s < segs.length - 1 && mid > segs[s].b) s++;
      tot[s] += res.dtau[k];
    }
    let worst = 0;
    segs.forEach((s, i) => { const r = tot[i] / s.target; worst = Math.max(worst, Math.abs(r - 1)); s.K *= Math.pow(r, 0.8); });
    if (worst < 1e-3) break;
  }
  res = integrate();
  const tau = new Float64Array(N);
  for (let k = 1; k < N; k++) tau[k] = tau[k - 1] + res.dtau[k];
  const total = tau[N - 1];

  function tAt(s) {
    if (s <= 0) return T[0];
    if (s >= total) return T[N - 1];
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tau[m] <= s) lo = m; else hi = m; }
    const u = (s - tau[lo]) / (tau[hi] - tau[lo]);
    return T[lo] + (T[hi] - T[lo]) * u;
  }
  function tauAt(t) {
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return tau[lo] + (tau[hi] - tau[lo]) * ((t - T[lo]) / (T[hi] - T[lo]));
  }
  // tour-time boundaries of each segment
  const bounds = segs.map((s) => ({ kind: s.kind, idx: s.idx, a: tauAt(s.a), b: tauAt(s.b) }));
  return { total, tAt, tauAt, segs, bounds };
}
