// Orbital mechanics for the Voyager tour. Units: km, s. Frame: J2000 equatorial (Z = celestial north). t = seconds since J2000.
export const AU = 149597870.7;
export const MU_SUN = 1.32712440018e11;
export const DEG = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
export const tFromUTC = (y, mo, d, h = 0, mi = 0) => (Date.UTC(y, mo - 1, d, h, mi) - J2000_MS) / 1000;
export const dateFromT = (t) => new Date(J2000_MS + t * 1000);

// ---- tiny vector library (arrays) --------------------------------------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- planetary ephemeris (JPL/Standish approximate Keplerian elements, 1800-2050) ------
//            a, da,  e, de,  I, dI,  L, dL,  varpi, dvarpi,  Omega, dOmega   (AU, deg, per Julian century)
const EL = {
  mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  venus: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
  mars: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  jupiter: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  saturn: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
  uranus: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589],
  neptune: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664],
};
const OBL = 23.43928 * DEG;
const cO = Math.cos(OBL), sO = Math.sin(OBL);
export const ECLIPTIC_NORTH = [0, -sO, cO];

export function planetPos(name, t) {
  if (name === 'sun') return [0, 0, 0];
  const e = EL[name], T = t / 86400 / 36525;
  const a = (e[0] + e[1] * T) * AU, ec = e[2] + e[3] * T, I = (e[4] + e[5] * T) * DEG;
  const L = e[6] + e[7] * T, wb = e[8] + e[9] * T, Om = e[10] + e[11] * T;
  const M = (((L - wb) % 360) + 360) % 360 * DEG, om = (wb - Om) * DEG, Omr = Om * DEG;
  let E = M;
  for (let i = 0; i < 12; i++) E -= (E - ec * Math.sin(E) - M) / (1 - ec * Math.cos(E));
  const xp = a * (Math.cos(E) - ec), yp = a * Math.sqrt(1 - ec * ec) * Math.sin(E);
  const co = Math.cos(om), so = Math.sin(om), cOm = Math.cos(Omr), sOm = Math.sin(Omr), cI = Math.cos(I), sI = Math.sin(I);
  const x = (co * cOm - so * sOm * cI) * xp + (-so * cOm - co * sOm * cI) * yp;
  const y = (co * sOm + so * cOm * cI) * xp + (-so * sOm + co * cOm * cI) * yp;
  const z = so * sI * xp + co * sI * yp;
  return [x, y * cO - z * sO, y * sO + z * cO];
}
export function planetVel(name, t) {
  const h = 1800;
  return mul(sub(planetPos(name, t + h), planetPos(name, t - h)), 1 / (2 * h));
}

// ---- universal-variable Kepler propagation / Lambert ----------------------
function stumpff(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / (s * s * s)]; }
  if (z < -1e-6) { const s = Math.sqrt(-z); return [(Math.cosh(s) - 1) / -z, (Math.sinh(s) - s) / (s * s * s)]; }
  return [0.5 - z / 24, 1 / 6 - z / 120];
}
export function propagate(r0, v0, dt, mu = MU_SUN) {
  if (dt === 0) return { r: r0.slice(), v: v0.slice() };
  const r0n = len(r0), vr0 = dot(r0, v0) / r0n, sm = Math.sqrt(mu);
  const alpha = 2 / r0n - dot(v0, v0) / mu;
  const sign = dt < 0 ? -1 : 1, adt = Math.abs(dt);
  const F = (chi) => {
    const z = alpha * chi * chi, [C, S] = stumpff(z);
    return r0n * vr0 / sm * chi * chi * C + (1 - alpha * r0n) * chi * chi * chi * S + r0n * chi - sm * adt;
  };
  let lo = 0, hi = Math.max(1, sm * Math.abs(alpha) * adt) ;
  hi = Math.max(hi, adt * 1e-3);
  let guard = 0;
  while (F(hi) < 0 && guard++ < 200) hi *= 2;
  let chi = hi * 0.5;
  for (let i = 0; i < 80; i++) {
    const z = alpha * chi * chi, [C, S] = stumpff(z);
    const f = F(chi);
    if (f < 0) lo = chi; else hi = chi;
    const df = r0n * vr0 / sm * chi * (1 - z * S) + (1 - alpha * r0n) * chi * chi * C + r0n;
    let nx = chi - f / df;
    if (!(nx > lo && nx < hi)) nx = 0.5 * (lo + hi);
    if (Math.abs(nx - chi) < 1e-10 * Math.max(1, chi)) { chi = nx; break; }
    chi = nx;
  }
  const z = alpha * chi * chi, [C, S] = stumpff(z);
  const f = 1 - chi * chi / r0n * C, g = adt - chi * chi * chi / sm * S;
  const r = add(mul(r0, f), mul(v0, g));
  const rn = len(r);
  const fd = sm / (rn * r0n) * (z * S - 1) * chi, gd = 1 - chi * chi / rn * C;
  let v = add(mul(r0, fd), mul(v0, gd));
  if (sign < 0) { /* backward propagation not needed */ }
  return { r, v };
}

export function lambert(r1, r2, dt, mu = MU_SUN) {
  const n1 = len(r1), n2 = len(r2), cd = dot(r1, r2) / (n1 * n2);
  let dth = Math.acos(Math.max(-1, Math.min(1, cd)));
  if (cross(r1, r2)[2] < 0) dth = 2 * Math.PI - dth;
  const A = Math.sin(dth) * Math.sqrt(n1 * n2 / (1 - cd));
  const y = (z) => { const [C, S] = stumpff(z); return n1 + n2 + A * (z * S - 1) / Math.sqrt(C); };
  const F = (z) => { const [C, S] = stumpff(z), yy = y(z); return Math.pow(yy / C, 1.5) * S + A * Math.sqrt(yy) - Math.sqrt(mu) * dt; };
  let lo = -4e4, hi = 4 * Math.PI * Math.PI;
  if (y(lo) < 0) { // find where y(z) crosses zero, then search above it
    let a = lo, b = 0;
    for (let i = 0; i < 100; i++) { const m = 0.5 * (a + b); if (y(m) < 0) a = m; else b = m; }
    lo = b + 1e-9 * Math.abs(b) + 1e-12;
  }
  for (let i = 0; i < 200; i++) { const m = 0.5 * (lo + hi); if (F(m) < 0) lo = m; else hi = m; }
  const yy = y(0.5 * (lo + hi));
  const f = 1 - yy / n1, g = A * Math.sqrt(yy / mu), gd = 1 - yy / n2;
  return { v1: mul(sub(r2, mul(r1, f)), 1 / g), v2: mul(sub(mul(r2, gd), r1), 1 / g) };
}

// ---- hyperbolic flyby (planet-centred) -----------------------------------
// uIn: unit vector of the incoming asymptote velocity direction, w: unit vector (perpendicular to uIn) towards which the path bends.
export function makeFlyby(mu, vinf, rp, uIn, w) {
  const a = mu / (vinf * vinf), e = 1 + rp / a, s = Math.sqrt(e * e - 1) / e;
  const p = add(mul(uIn, 1 / e), mul(w, -s));   // periapsis direction
  const q = mul(sub(uIn, mul(p, 1 / e)), 1 / s); // direction of motion at periapsis
  const uOut = add(mul(uIn, 1 - 2 / (e * e)), mul(w, 2 * s / e));
  const n = Math.sqrt(mu / (a * a * a)), b = a * Math.sqrt(e * e - 1);
  const solveH = (M) => { let H = Math.asinh(M / e) ; for (let i = 0; i < 60; i++) { const f = e * Math.sinh(H) - H - M; H -= f / (e * Math.cosh(H) - 1); } return H; };
  return {
    a, e, rp, vinf, uIn, uOut, p, q, delta: 2 * Math.asin(1 / e),
    at(dt) { // dt seconds from periapsis
      const H = solveH(n * dt), ch = Math.cosh(H), sh = Math.sinh(H);
      const x = a * (e - ch), y = b * sh, Hd = n / (e * ch - 1);
      const vx = -a * sh * Hd, vy = b * ch * Hd;
      return { r: add(mul(p, x), mul(q, y)), v: add(mul(p, vx), mul(q, vy)) };
    },
  };
}

// ---- bodies ---------------------------------------------------------------
// pole RA/Dec (deg), rotation period (hours, negative = retrograde), radii (km), flattening, geometric albedo
export const PLANETS = {
  mercury: { r: 2440, albedo: 0.14, color: [0.6, 0.57, 0.53] },
  venus: { r: 6052, albedo: 0.69, color: [0.95, 0.85, 0.65] },
  earth: { r: 6371, albedo: 0.37, color: [0.5, 0.65, 1.0] },
  mars: { r: 3390, albedo: 0.17, color: [0.95, 0.6, 0.4] },
  jupiter: { r: 71492, f: 0.06487, pole: [268.057, 64.495], rot: 9.9250, mu: 1.26686534e8, albedo: 0.54, color: [0.95, 0.85, 0.7], ringBoost: 1 },
  saturn: { r: 60268, f: 0.09796, pole: [40.589, 83.537], rot: 10.656, mu: 3.7931187e7, albedo: 0.47, color: [0.95, 0.88, 0.7], ringBoost: 2.2 },
  uranus: { r: 25559, f: 0.0229, pole: [257.311, -15.175], rot: -17.24, mu: 5.793939e6, albedo: 0.51, color: [0.7, 0.9, 0.95], ringBoost: 1 },
  neptune: { r: 24764, f: 0.0171, pole: [299.36, 43.46], rot: 16.11, mu: 6.836529e6, albedo: 0.41, color: [0.4, 0.55, 1.0], ringBoost: 1 },
};
export const poleVec = (p) => { const ra = p[0] * DEG, de = p[1] * DEG; return [Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)]; };
export function bodyFrame(pole) { // columns x,y,z of body frame in world
  const z = poleVec(pole);
  let x = cross([0, 0, 1], z); x = len(x) < 1e-6 ? [1, 0, 0] : norm(x);
  const y = cross(z, x);
  return { x, y, z };
}

// satellites: radius km, a km, period days (negative = retrograde), tilt deg (orbit-plane tilt to the planet equator), type, colours
export const MOONS = {
  jupiter: [
    { id: 'io', r: 1821.6, a: 421700, P: 1.769138, type: 'io', albedo: 0.63 },
    { id: 'europa', r: 1560.8, a: 671034, P: 3.551181, type: 'europa', albedo: 0.67 },
    { id: 'ganymede', r: 2631.2, a: 1070412, P: 7.154553, type: 'ganymede', albedo: 0.43 },
    { id: 'callisto', r: 2410.3, a: 1882709, P: 16.689017, type: 'callisto', albedo: 0.22 },
    { id: 'amalthea', r: 84, a: 181366, P: 0.498179, type: 'amalthea', albedo: 0.09 },
  ],
  saturn: [
    { id: 'mimas', r: 198.2, a: 185539, P: 0.942422, type: 'mimas', albedo: 0.96 },
    { id: 'enceladus', r: 252.1, a: 238042, P: 1.370218, type: 'enceladus', albedo: 1.0 },
    { id: 'tethys', r: 531.1, a: 294619, P: 1.887802, type: 'icy', albedo: 0.8 },
    { id: 'dione', r: 561.4, a: 377396, P: 2.736915, type: 'dione', albedo: 0.7 },
    { id: 'rhea', r: 763.8, a: 527108, P: 4.5175, type: 'icy', albedo: 0.65 },
    { id: 'titan', r: 2574.7, a: 1221870, P: 15.945421, type: 'titan', albedo: 0.22 },
    { id: 'hyperion', r: 135, a: 1481009, P: 21.276609, type: 'hyperion', albedo: 0.3 },
    { id: 'iapetus', r: 734.5, a: 3560820, P: 79.3215, type: 'iapetus', albedo: 0.3 },
  ],
  uranus: [
    { id: 'miranda', r: 235.8, a: 129390, P: 1.413479, type: 'miranda', albedo: 0.32 },
    { id: 'ariel', r: 578.9, a: 191020, P: 2.520379, type: 'ariel', albedo: 0.39 },
    { id: 'umbriel', r: 584.7, a: 266300, P: 4.144176, type: 'umbriel', albedo: 0.21 },
    { id: 'titania', r: 788.4, a: 435910, P: 8.705867, type: 'ariel', albedo: 0.27 },
    { id: 'oberon', r: 761.4, a: 583520, P: 13.463234, type: 'umbriel', albedo: 0.23 },
  ],
  neptune: [
    { id: 'proteus', r: 210, a: 117647, P: 1.122315, type: 'amalthea', albedo: 0.1 },
    { id: 'triton', r: 1353.4, a: 354759, P: -5.876854, tilt: 23, type: 'triton', albedo: 0.76 },
    { id: 'nereid', r: 170, a: 5513818, P: 360.13, type: 'icy', albedo: 0.2 },
  ],
};

// ---- missions ---------------------------------------------------------------
const U = tFromUTC;
export const MISSIONS = [
  {
    id: 'V1', name: 'VOYAGER 1', launch: U(1977, 9, 5, 12, 56), launchText: 'Launched September 5, 1977',
    encounters: [
      { planet: 'jupiter', tca: U(1979, 3, 5, 12, 5), rp: 349000, moons: [['io', U(1979, 3, 5, 15, 14), 22400], ['ganymede', U(1979, 3, 5, 18, 12), 114710], ['callisto', U(1979, 3, 6, 3, 40), 126400]] },
      { planet: 'saturn', tca: U(1980, 11, 12, 23, 46), rp: 184300, side: 1, moons: [['titan', U(1980, 11, 12, 5, 41), 6970], ['dione', U(1980, 11, 13, 0, 20), 161520], ['rhea', U(1980, 11, 13, 2, 0), 73980], ['mimas', U(1980, 11, 13, 4, 40), 88440], ['enceladus', U(1980, 11, 13, 9, 0), 202040]] },
    ],
    end: U(1990, 2, 14, 0, 0),
  },
  {
    id: 'V2', name: 'VOYAGER 2', launch: U(1977, 8, 20, 14, 29), launchText: 'Launched August 20, 1977',
    encounters: [
      { planet: 'jupiter', tca: U(1979, 7, 9, 22, 29), rp: 570000, moons: [['callisto', U(1979, 7, 8, 8, 0), 214930], ['ganymede', U(1979, 7, 9, 7, 14), 62130], ['europa', U(1979, 7, 9, 15, 0), 205720]] },
      { planet: 'saturn', tca: U(1981, 8, 26, 3, 24), rp: 161300, moons: [['hyperion', U(1981, 8, 25, 0, 0), 470840], ['titan', U(1981, 8, 25, 12, 0), 665960], ['rhea', U(1981, 8, 25, 20, 0), 645280], ['enceladus', U(1981, 8, 26, 1, 25), 87140], ['tethys', U(1981, 8, 26, 6, 40), 93000]] },
      { planet: 'uranus', tca: U(1986, 1, 24, 17, 59), rp: 107100, moons: [['oberon', U(1986, 1, 24, 7, 0), 470600], ['titania', U(1986, 1, 24, 9, 0), 365200], ['umbriel', U(1986, 1, 24, 11, 0), 325000], ['ariel', U(1986, 1, 24, 13, 30), 127000], ['miranda', U(1986, 1, 24, 15, 30), 31000]] },
      { planet: 'neptune', tca: U(1989, 8, 25, 3, 56), rp: 29300, side: -1, moons: [['triton', U(1989, 8, 25, 9, 10), 40000]] },
    ],
    end: U(1990, 2, 14, 0, 0),
  },
];
MISSIONS[1].end = U(1994, 8, 25, 0, 0);

// Builds ballistic legs, flybys and the heliocentric trajectory function for a mission.
export function buildTrajectory(m) {
  const stops = [{ name: 'earth', t: m.launch }, ...m.encounters.map((e) => ({ name: e.planet, t: e.tca }))];
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const r1 = planetPos(stops[i].name, stops[i].t), r2 = planetPos(stops[i + 1].name, stops[i + 1].t);
    const l = lambert(r1, r2, stops[i + 1].t - stops[i].t);
    legs.push({ t0: stops[i].t, r0: r1, v0: l.v1, v1: l.v2 });
  }
  const flybys = [];
  m.encounters.forEach((enc, i) => {
    const P = PLANETS[enc.planet], vp = planetVel(enc.planet, enc.tca);
    const vIn = sub(legs[i].v1, vp), uIn = norm(vIn);
    let vinf = len(vIn), w;
    if (i < legs.length - 1) {
      const vOut = sub(legs[i + 1].v0, vp);
      vinf = 0.5 * (vinf + len(vOut));
      const uo = norm(vOut);
      w = norm(sub(uo, mul(uIn, dot(uo, uIn))));
    } else {
      const N = ECLIPTIC_NORTH, wN = norm(sub(N, mul(uIn, dot(N, uIn))));
      w = mul(wN, enc.side || 1);
    }
    const fb = makeFlyby(P.mu, vinf, enc.rp, uIn, w);
    const rWin = 250 * P.r;
    flybys.push({ enc, fb, tca: enc.tca, planet: enc.planet, Tw: rWin / vinf, rWin });
    if (i === legs.length - 1) {
      // exit leg: leaves the planet along the outgoing asymptote
      const vOutH = add(vp, mul(fb.uOut, vinf));
      legs.push({ t0: enc.tca, r0: planetPos(enc.planet, enc.tca), v0: vOutH, exit: true });
    }
  });
  const nEnc = flybys.length;
  function craftState(t) {
    // pick leg
    let li = 0;
    while (li < nEnc && t >= flybys[li].tca) li++;
    const leg = legs[li], st = propagate(leg.r0, leg.v0, t - leg.t0);
    let r = st.r, v = st.v;
    for (let i = 0; i < nEnc; i++) {
      const f = flybys[i], dt = t - f.tca, ad = Math.abs(dt);
      if (ad < f.Tw) {
        const h = f.fb.at(dt), pp = planetPos(f.planet, t), pv = planetVel(f.planet, t);
        const hr = add(pp, h.r), hv = add(pv, h.v);
        const k = 1 - smoothstep(0.55 * f.Tw, f.Tw, ad);
        r = lerp3(r, hr, k); v = lerp3(v, hv, k);
      }
    }
    return { r, v };
  }
  return { stops, legs, flybys, craftState, t0: m.launch + 0.35 * 86400, t1: m.end };
}
