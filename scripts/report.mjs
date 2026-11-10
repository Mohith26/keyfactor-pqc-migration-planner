// Prints the headline numbers shown on the page and in the README. Usage: node scripts/report.mjs
import { readFileSync } from 'node:fs';
import * as P from '../src/planner.js';
const data = JSON.parse(readFileSync(new URL('../data/inventory.json', import.meta.url)));
const S = data.systems;
for (const sc of Object.keys(P.SCENARIOS)) {
  const m = P.crqcModel(sc, data.planStart);
  console.log(`\n${sc}: mu ${m.mu.toFixed(3)} sigma ${m.sigma.toFixed(3)}, median CRQC ${(2027 + m.median).toFixed(1)}, P(by end-2030) ${(m.F(4) * 100).toFixed(1)}%, P(by end-2035) ${(m.F(9) * 100).toFixed(1)}%`);
  for (const cap of [1, 1.5, 2, 3, 4]) {
    const r = P.plan(data, sc, cap);
    const mc = P.monteCarlo(r.optimized.rows, S, r.model, 20000, 7), mcW = P.monteCarlo(r.waves.rows, S, r.model, 20000, 7);
    const wavesAt = (c) => P.simulate(P.dispatch(P.scoreWaves(S), S, c), S, r.model, c).total;
    let lo = cap, hi = cap * 4, eq = null;
    if (wavesAt(hi) <= r.optimized.total) { for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (wavesAt(mid) > r.optimized.total) lo = mid; else hi = mid; } eq = hi - cap; }
    const longAvg = (rows) => { const l = rows.filter((x) => S.find((s) => s.id === x.id).protectYears >= 10); return 2027 + l.reduce((t, x) => t + x.end, 0) / l.length; };
    console.log(`  capacity ${cap}: optimized ${r.optimized.total.toFixed(1)} (P90 ${mc.p90.toFixed(0)}, MC mean ${mc.mean.toFixed(1)}) | waves ${r.waves.total.toFixed(1)} (P90 ${mcW.p90.toFixed(0)}) | weakest-first ${r.weakest.total.toFixed(1)} | -${((1 - r.optimized.total / r.waves.total) * 100).toFixed(1)}% vs waves, -${((1 - r.optimized.total / r.weakest.total) * 100).toFixed(1)}% vs weakest | finish ${(2027 + r.optimized.makespan).toFixed(2)} vs ${(2027 + r.waves.makespan).toFixed(2)} | capacity-equivalent +${eq === null ? '>3x' : eq.toFixed(2)} | long-lived avg done ${longAvg(r.optimized.rows).toFixed(2)} vs ${longAvg(r.waves.rows).toFixed(2)}`);
  }
}
