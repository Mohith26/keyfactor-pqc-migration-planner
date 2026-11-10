// PQC migration planner: core algorithms (pure functions, no DOM). Used by the page and by `node --test`.
//
// Exposure model (Mosca's X + Y > Z, with Z uncertain):
//   Z = time until a cryptographically relevant quantum computer (CRQC), a random variable fitted to the
//   Global Risk Institute expert survey and conditioned on "no CRQC yet" at the plan start.
//   A system migrated at time t keeps producing classically protected traffic/signatures during [0, t].
//   Something produced at time s must stay protected until s + X (X = protection lifetime: data shelf life
//   for key establishment, remaining trust lifetime for signatures). It is exposed if Z <= s + X.
//   Expected exposure of system i = v_i * integral_0^{t_i} F(s + X_i) ds, F = CDF of Z.
// Scheduling: one migration team with capacity c engineer-weeks per calendar week works through systems in
// order; a system can start only after its dependencies finish and its vendor ships PQC support.
// The order minimising total expected exposure is found by precedence-aware ratio scheduling plus
// insertion local search. Baselines are the score-and-wave method and weakest-key-first.

export const WEEKS_PER_YEAR = 52.1775;
export const SURVEY_DATE = '2024-12-06'; // GRI Quantum Threat Timeline Report 2024 publication date

export const SCENARIOS = {
  'gri2024-pessimistic': { label: 'GRI 2024 expert survey, pessimistic reading', anchors: [[10, 0.19], [15, 0.39], [20, 0.60]],
    source: 'Mosca & Piani, Quantum Threat Timeline Report 2024 (GRI/evolutionQ): ~19% within 10y, ~39% by 15y, ~60% by 20y' },
  'gri2024-average': { label: 'GRI 2024 expert survey, average reading', anchors: [[5, 0.14], [10, 0.34]],
    source: 'Mosca & Piani, Quantum Threat Timeline Report 2024: ~14% within 5y, ~34% within 10y' },
};

// ---------- normal / lognormal ----------
export function erf(x) { // Abramowitz & Stegun 7.1.26, |err| < 1.5e-7
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
export function normInv(p) { // Acklam's rational approximation, refined by one Newton step
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425; let q, r, x;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - pl) { q = p - 0.5; r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const e = normCdf(x) - p; const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

/** Least-squares lognormal fit to cumulative anchors [[years, prob], ...] on the probit scale. */
export function fitLognormal(anchors) {
  const xs = anchors.map(([t]) => Math.log(t)), zs = anchors.map(([, p]) => normInv(p));
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, mz = zs.reduce((a, b) => a + b) / n;
  let sxx = 0, sxz = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxz += (xs[i] - mx) * (zs[i] - mz); }
  const slope = sxz / sxx; // z = slope * ln t + icpt
  const sigma = 1 / slope, mu = mx - mz * sigma;
  return { mu, sigma };
}

const yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86400000);

/**
 * CRQC arrival model in plan time (years after planStart), conditioned on no CRQC before planStart.
 * Returns F(t) and a precomputed cumulative integral so that integral_a^b F = C(b) - C(a).
 */
export function crqcModel(scenarioKey, planStart, { horizon = 60, step = 1 / WEEKS_PER_YEAR } = {}) {
  const sc = SCENARIOS[scenarioKey];
  const { mu, sigma } = fitLognormal(sc.anchors);
  const off = yearsBetween(SURVEY_DATE, planStart);
  const Fs = (y) => (y <= 0 ? 0 : normCdf((Math.log(y) - mu) / sigma));
  const F0 = Fs(off);
  const F = (t) => (t <= 0 ? 0 : (Fs(t + off) - F0) / (1 - F0));
  const n = Math.ceil(horizon / step);
  const cum = new Float64Array(n + 1);
  let prev = F(0);
  for (let k = 1; k <= n; k++) { const cur = F(k * step); cum[k] = cum[k - 1] + 0.5 * (prev + cur) * step; prev = cur; }
  const C = (u) => {
    if (u <= 0) return 0;
    const k = u / step; const i = Math.floor(k);
    if (i >= n) return cum[n] + (u - n * step); // F ~ 1 beyond horizon
    return cum[i] + (k - i) * step * 0.5 * (F(i * step) + F(u));
  };
  const sample = (rand) => { // inverse transform on the conditional distribution
    const p = F0 + rand * (1 - F0);
    return Math.exp(mu + sigma * normInv(Math.min(1 - 1e-12, Math.max(1e-12, p)))) - off;
  };
  return { key: scenarioKey, label: sc.label, source: sc.source, mu, sigma, offsetYears: off, F, C, sample,
    median: Math.exp(mu + sigma * normInv(F0 + 0.5 * (1 - F0))) - off };
}

/** Expected exposure of one system finishing at t (years): v * integral_0^t F(s + X) ds. */
export const exposure = (model, sys, t) => sys.value * (model.C(t + sys.protectYears) - model.C(sys.protectYears));

// ---------- schedule simulation ----------
/**
 * Simulate an order. Systems run one after another at capacity c (engineer-weeks per week). A system
 * starts at max(previous finish, its vendor-ready date, its dependencies' finish). Returns per-system
 * start/finish (years) and total expected exposure. Orders violating precedence are rejected.
 */
export function simulate(order, systems, model, capacity) {
  const byId = new Map(systems.map((s) => [s.id, s]));
  const finish = new Map(); let clock = 0; let total = 0; const rows = [];
  for (const id of order) {
    const s = byId.get(id);
    let start = Math.max(clock, s.vendorReadyYears || 0);
    for (const d of s.dependsOn) { if (!finish.has(d)) return { feasible: false }; start = Math.max(start, finish.get(d)); }
    const dur = s.effortWeeks / capacity / WEEKS_PER_YEAR;
    const end = start + dur; finish.set(id, end); clock = end;
    const e = exposure(model, s, end);
    total += e;
    rows.push({ id, start, end, exposure: e, mosca: model.F(end + s.protectYears) });
  }
  return { feasible: true, rows, total, makespan: clock };
}

/** Make any priority order precedence-feasible (stable topological sort that respects the given ranking). */
export function topoStable(rank, systems) {
  const pos = new Map(rank.map((id, i) => [id, i]));
  const deps = new Map(systems.map((s) => [s.id, s.dependsOn]));
  const done = new Set(), out = [];
  while (out.length < rank.length) {
    const ready = rank.filter((id) => !done.has(id) && deps.get(id).every((d) => done.has(d)));
    ready.sort((a, b) => pos.get(a) - pos.get(b));
    out.push(ready[0]); done.add(ready[0]);
  }
  return out;
}

/**
 * Non-delay dispatch of a priority list: whenever the team is free, start the highest-ranked system whose
 * dependencies are done and whose vendor support has shipped; wait only if nothing is startable. This is how
 * a sensible team would execute a ranked list, so baselines are not penalised for idling on blocked items.
 */
export function dispatch(rank, systems, capacity) {
  const byId = new Map(systems.map((s) => [s.id, s]));
  const done = new Map(), order = []; let clock = 0;
  while (order.length < rank.length) {
    const ready = rank.filter((id) => !done.has(id) && byId.get(id).dependsOn.every((d) => done.has(d)));
    const startOf = (id) => Math.max(clock, byId.get(id).vendorReadyYears || 0, ...byId.get(id).dependsOn.map((d) => done.get(d)));
    const now = ready.filter((id) => startOf(id) <= clock + 1e-9);
    const pick = now.length ? now[0] : ready.reduce((a, b) => (startOf(b) < startOf(a) ? b : a));
    const st = startOf(pick); const end = st + byId.get(pick).effortWeeks / capacity / WEEKS_PER_YEAR;
    done.set(pick, end); order.push(pick); clock = end;
  }
  return order;
}

// ---------- baselines ----------
export const SECURITY_BITS = { 'RSA-2048': 112, 'RSA-OAEP 2048': 112, 'DH group 14': 112, 'RSA-3072': 128, 'ECDSA P-256': 128, 'ECDHE P-256': 128, 'ECDHE X25519': 128, 'ECDH P-384': 192, 'RSA-4096': 152 };

/** The score-and-wave method from public PQC guidance: 1-3 per factor, sensitivity and exposure count double. */
export function scoreWaves(systems) {
  const score = (s) => 2 * s.sensitivity + 2 * s.exposure + s.criticality + s.regulatory;
  const rank = [...systems].sort((a, b) => score(b) - score(a) || a.effortWeeks - b.effortWeeks).map((s) => s.id);
  return topoStable(rank, systems);
}
/** Weakest keys first (bits of security ascending), then by certificate count. */
export function weakestFirst(systems) {
  const rank = [...systems].sort((a, b) => (SECURITY_BITS[a.algorithm] ?? 128) - (SECURITY_BITS[b.algorithm] ?? 128) || b.certificates - a.certificates).map((s) => s.id);
  return topoStable(rank, systems);
}

// ---------- optimiser ----------
function descendants(systems) {
  const kids = new Map(systems.map((s) => [s.id, []]));
  for (const s of systems) for (const d of s.dependsOn) kids.get(d).push(s.id);
  const memo = new Map();
  const walk = (id) => { if (memo.has(id)) return memo.get(id); const set = new Set(); for (const k of kids.get(id)) { set.add(k); for (const x of walk(k)) set.add(x); } memo.set(id, set); return set; };
  for (const s of systems) walk(s.id);
  return memo;
}

/**
 * Greedy list scheduling: at each step pick, among systems whose dependencies are done, the one with the
 * highest exposure-rate per unit of work, where a prerequisite also earns the rate of everything it unblocks
 * (max of own ratio and its descendant-closure ratio, a Sidney-style rule). Vendor-blocked systems are
 * deferred while unblocked work remains.
 */
export function greedy(systems, model, capacity) {
  const byId = new Map(systems.map((s) => [s.id, s]));
  const desc = descendants(systems);
  const done = new Set(), order = []; let clock = 0;
  const rate = (s, t) => s.value * model.F(t + s.protectYears);
  while (order.length < systems.length) {
    const avail = systems.filter((s) => !done.has(s.id) && s.dependsOn.every((d) => done.has(d)));
    const released = avail.filter((s) => (s.vendorReadyYears || 0) <= clock + 1e-9);
    const pool = released.length ? released : avail;
    let best = null, bestP = -Infinity;
    for (const s of pool) {
      const tEnd = Math.max(clock, s.vendorReadyYears || 0) + s.effortWeeks / capacity / WEEKS_PER_YEAR;
      const own = rate(s, tEnd) / s.effortWeeks;
      let r = rate(s, tEnd), p = s.effortWeeks;
      for (const d of desc.get(s.id)) { const ds = byId.get(d); if (!done.has(d)) { r += rate(ds, tEnd); p += ds.effortWeeks; } }
      const pr = Math.max(own, r / p) - (released.length ? 0 : (s.vendorReadyYears || 0) * 1e-9);
      if (pr > bestP) { bestP = pr; best = s; }
    }
    order.push(best.id); done.add(best.id);
    clock = Math.max(clock, best.vendorReadyYears || 0) + best.effortWeeks / capacity / WEEKS_PER_YEAR;
  }
  return order;
}

/** Insertion local search: move any system to any feasible position if it lowers expected exposure. */
export function localSearch(order, systems, model, capacity, maxPasses = 30) {
  let cur = [...order], curCost = simulate(cur, systems, model, capacity).total, passes = 0, moves = 0;
  let improved = true;
  while (improved && passes < maxPasses) {
    improved = false; passes++;
    for (let i = 0; i < cur.length; i++) {
      for (let j = 0; j < cur.length; j++) {
        if (i === j) continue;
        const cand = [...cur]; const [x] = cand.splice(i, 1); cand.splice(j, 0, x);
        const r = simulate(cand, systems, model, capacity);
        if (r.feasible && r.total < curCost - 1e-9) { cur = cand; curCost = r.total; improved = true; moves++; }
      }
    }
  }
  return { order: cur, total: curCost, passes, moves };
}

export function optimize(systems, model, capacity) {
  const starts = [greedy(systems, model, capacity), dispatch(scoreWaves(systems), systems, capacity), dispatch(weakestFirst(systems), systems, capacity)];
  let best = null;
  for (const s of starts) { const r = localSearch(s, systems, model, capacity); if (!best || r.total < best.total) best = r; }
  return best;
}

// ---------- Monte Carlo over the CRQC date ----------
/** Exposure for one sampled CRQC date z: v * |{s in [0,t]: s + X >= z}| = v * max(0, t - max(0, z - X)). */
export function realizedExposure(rows, systems, z) {
  const byId = new Map(systems.map((s) => [s.id, s]));
  let tot = 0;
  for (const r of rows) { const s = byId.get(r.id); tot += s.value * Math.max(0, r.end - Math.max(0, z - s.protectYears)); }
  return tot;
}

export function monteCarlo(rows, systems, model, n = 20000, seed = 7) {
  let a = seed >>> 0; const rand = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const vals = new Float64Array(n);
  for (let k = 0; k < n; k++) vals[k] = realizedExposure(rows, systems, model.sample(rand()));
  const sorted = Float64Array.from(vals).sort();
  const q = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
  const mean = vals.reduce((t, v) => t + v, 0) / n;
  return { mean, p50: q(0.5), p90: q(0.9), p99: q(0.99), zeroShare: sorted.findIndex((v) => v > 0) / n };
}

/** Full comparison for the UI. */
export function plan(data, scenarioKey, capacity) {
  const model = crqcModel(scenarioKey, data.planStart);
  const S = data.systems;
  const opt = optimize(S, model, capacity);
  const waves = dispatch(scoreWaves(S), S, capacity), weak = dispatch(weakestFirst(S), S, capacity);
  return {
    model,
    optimized: { order: opt.order, ...simulate(opt.order, S, model, capacity), moves: opt.moves },
    waves: { order: waves, ...simulate(waves, S, model, capacity) },
    weakest: { order: weak, ...simulate(weak, S, model, capacity) },
  };
}
