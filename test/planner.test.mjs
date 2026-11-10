import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as P from '../src/planner.js';
import { generate } from '../scripts/generate.mjs';

const data = JSON.parse(readFileSync(new URL('../data/inventory.json', import.meta.url)));
const S = data.systems;

test('generator is deterministic and matches the committed inventory', () => {
  assert.equal(JSON.stringify(generate(data.seed), null, 1), JSON.stringify(data, null, 1));
  assert.equal(S.length, 36);
});

test('normal CDF / inverse are consistent', () => {
  for (const p of [0.001, 0.05, 0.19, 0.5, 0.6, 0.97]) assert.ok(Math.abs(P.normCdf(P.normInv(p)) - p) < 1e-7);
  assert.ok(Math.abs(P.normCdf(1.959964) - 0.975) < 1e-6);
});

test('lognormal fit reproduces the GRI anchors it was fitted to', () => {
  for (const key of Object.keys(P.SCENARIOS)) {
    const { mu, sigma } = P.fitLognormal(P.SCENARIOS[key].anchors);
    for (const [t, p] of P.SCENARIOS[key].anchors) {
      const fit = P.normCdf((Math.log(t) - mu) / sigma);
      assert.ok(Math.abs(fit - p) < 0.03, `${key} ${t}y: ${fit} vs ${p}`);
    }
  }
});

test('conditional CRQC CDF starts at 0, is monotone, and its integral table matches quadrature', () => {
  const m = P.crqcModel('gri2024-pessimistic', data.planStart);
  assert.equal(m.F(0), 0);
  let prev = 0; for (let t = 0.5; t < 40; t += 0.5) { const f = m.F(t); assert.ok(f >= prev - 1e-12); prev = f; }
  // Simpson check of integral_2^9 F
  let simp = 0; const a = 2, b = 9, n = 2000, h = (b - a) / n;
  for (let i = 0; i <= n; i++) simp += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * m.F(a + i * h);
  simp *= h / 3;
  assert.ok(Math.abs(m.C(b) - m.C(a) - simp) < 1e-3, `${m.C(b) - m.C(a)} vs ${simp}`);
});

test('Monte Carlo mean of realized exposure matches the analytic expectation', () => {
  const r = P.plan(data, 'gri2024-pessimistic', 2);
  const mc = P.monteCarlo(r.optimized.rows, S, r.model, 40000, 11);
  assert.ok(Math.abs(mc.mean / r.optimized.total - 1) < 0.03, `${mc.mean} vs ${r.optimized.total}`);
  assert.ok(mc.p90 >= mc.p50);
});

test('simulate enforces dependencies and vendor dates', () => {
  const m = P.crqcModel('gri2024-pessimistic', data.planStart);
  const bad = ['root-ca', ...S.map((s) => s.id).filter((x) => x !== 'root-ca')];
  assert.equal(P.simulate(bad, S, m, 2).feasible, false);
  const r = P.simulate(P.scoreWaves(S), S, m, 2);
  const end = new Map(r.rows.map((x) => [x.id, x]));
  for (const s of S) {
    assert.ok(end.get(s.id).start >= (s.vendorReadyYears || 0) - 1e-12);
    for (const d of s.dependsOn) assert.ok(end.get(s.id).start >= end.get(d).end - 1e-12);
  }
});

test('optimizer finds the exact optimum on small instances (brute force over all feasible orders)', () => {
  const m = P.crqcModel('gri2024-average', data.planStart);
  const pickSets = [['hsm-fw', 'root-ca', 'web-portal', 'backup-wrap', 'hr-system', 'status-page', 'swift-gw'],
    ['partner-b2b', 'core-banking', 'issuing-tls', 'mesh', 'remote-vpn', 'app-signing', 'smime']];
  for (const ids of pickSets) {
    const sub = S.filter((s) => ids.includes(s.id)).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => ids.includes(d)) }));
    let best = Infinity;
    const perm = (arr, k = 0) => {
      if (k === arr.length) { const r = P.simulate(arr, sub, m, 1); if (r.feasible) best = Math.min(best, r.total); return; }
      for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; perm(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
    };
    perm(sub.map((s) => s.id));
    const opt = P.optimize(sub, m, 1);
    assert.ok(opt.total <= best * 1.0001, `opt ${opt.total} vs brute ${best}`);
  }
});

test('optimized plan beats both baselines (executed with non-delay dispatch) under both scenarios and capacities', () => {
  for (const sc of Object.keys(P.SCENARIOS)) for (const cap of [1, 2, 3]) {
    const r = P.plan(data, sc, cap);
    assert.ok(r.optimized.total < r.waves.total && r.optimized.total < r.weakest.total, `${sc} ${cap}`);
    assert.ok(Math.abs(r.optimized.makespan - r.waves.makespan) < 0.05, 'gain is not from finishing earlier overall');
  }
});

test('dispatch never idles while a startable system exists', () => {
  const ord = P.dispatch(P.scoreWaves(S), S, 2);
  const m = P.crqcModel('gri2024-pessimistic', data.planStart);
  const r = P.simulate(ord, S, m, 2);
  for (let i = 1; i < r.rows.length; i++) {
    const gap = r.rows[i].start - r.rows[i - 1].end;
    if (gap > 1e-9) { // then every remaining system must have been blocked at that moment
      const remaining = new Set(ord.slice(i));
      const doneEnd = new Map(r.rows.slice(0, i).map((x) => [x.id, x.end]));
      for (const s of S.filter((x) => remaining.has(x.id))) {
        const startable = (s.vendorReadyYears || 0) <= r.rows[i - 1].end + 1e-9 && s.dependsOn.every((d) => doneEnd.has(d));
        assert.ok(!startable, `${s.id} was startable during idle gap`);
      }
    }
  }
});
