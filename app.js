import * as P from './src/planner.js';

const $ = (id) => document.getElementById(id);
const COL = { optimized: '#3e37dc', waves: '#8c8c8c', weakest: '#e8892a', crqc: '#b03a2e', grid: '#e6e6e6', axis: '#666' };
const CAPS = [1, 1.5, 2, 3, 4];
const state = { scenario: 'gri2024-pessimistic', capacity: 2, tab: 'plan' };
let DATA, R, BYID;

const fmt = (x, d = 1) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const dateOf = (t) => new Date(Date.parse(DATA.planStart) + t * 365.25 * 86400000);
const qtr = (t) => { const q = Math.floor(t * 4 + 1e-6); return `Q${(q % 4) + 1} ${2027 + Math.floor(q / 4)}`; };
const mdy = (t) => { const d = dateOf(t); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`; };
const NIST_2030 = (Date.parse('2031-01-01') - Date.parse('2027-01-01')) / (365.25 * 86400000);

function capacityEquivalent() {
  // extra capacity the score-ranked waves would need to reach the optimized plan's expected exposure
  const target = R.optimized.total; const S = DATA.systems;
  const wavesAt = (c) => P.simulate(P.dispatch(P.scoreWaves(S), S, c), S, R.model, c).total;
  let lo = state.capacity, hi = state.capacity * 4;
  if (wavesAt(hi) > target) return null;
  for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (wavesAt(mid) > target) lo = mid; else hi = mid; }
  return hi - state.capacity;
}

function compute() {
  R = P.plan(DATA, state.scenario, state.capacity);
  R.mc = P.monteCarlo(R.optimized.rows, DATA.systems, R.model, 20000, 7);
  R.mcW = P.monteCarlo(R.waves.rows, DATA.systems, R.model, 20000, 7);
  R.capEq = capacityEquivalent();
}

function renderTiles() {
  const longAvg = (rows) => { const l = rows.filter((r) => BYID.get(r.id).protectYears >= 10); return l.reduce((t, r) => t + r.end, 0) / l.length; };
  const nLong = DATA.systems.filter((s) => s.protectYears >= 10).length;
  const red = 1 - R.optimized.total / R.waves.total, redW = 1 - R.optimized.total / R.weakest.total;
  const funnel = `<svg class="f" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="1.6" stroke-linejoin="round"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/></svg>`;
  const tile = (t, n, cls, s, icon = 'fa-filter') => `<div class="tile">${icon === 'fa-filter' ? funnel : `<i class="fa-regular ${icon} f" style="font-size:17px;color:#333"></i>`}<div class="t">${t}</div><div class="n ${cls}">${n}</div><div class="s">${s}</div></div>`;
  $('tiles').innerHTML =
    tile('Expected Exposure', fmt(R.optimized.total), 'c-total', `risk-years, optimized order<br>P90 ${fmt(R.mc.p90, 0)}`) +
    tile('Score-Ranked Waves', fmt(R.waves.total), 'c-crit', `same team, same finish date<br>P90 ${fmt(R.mcW.p90, 0)}`) +
    tile('Reduction', '−' + pct(red), 'c-low', `vs. waves · −${pct(redW)} vs.<br>weakest-keys-first`) +
    tile('Capacity Equivalent', R.capEq === null ? '> 4×' : '+' + fmt(R.capEq, 1), 'c-min', `engineers the waves plan<br>would need to match`) +
    tile('Long-Lived Data Migrated', qtr(longAvg(R.optimized.rows)), 'c-high', `average for the ${nLong} systems<br>with X ≥ 10 yr · waves: ${qtr(longAvg(R.waves.rows))}`, 'fa-calendar-check');
}

function cumulativeCurve(rows, t) {
  let tot = 0;
  for (const r of rows) { const s = BYID.get(r.id); const u = Math.min(t, r.end); if (u > 0) tot += s.value * (R.model.C(u + s.protectYears) - R.model.C(s.protectYears)); }
  return tot;
}

function renderChart() {
  const el = $('chart'); const W = el.clientWidth || 760, H = 300, L = 54, Rr = 52, T = 14, B = 34;
  const tMax = Math.ceil((Math.max(R.optimized.makespan, R.waves.makespan, R.weakest.makespan) + 0.5) * 4) / 4;
  const n = 120; const ts = Array.from({ length: n + 1 }, (_, k) => (k / n) * tMax);
  const curves = { optimized: ts.map((t) => cumulativeCurve(R.optimized.rows, t)), waves: ts.map((t) => cumulativeCurve(R.waves.rows, t)), weakest: ts.map((t) => cumulativeCurve(R.weakest.rows, t)) };
  const ymaxRaw = Math.max(...curves.waves, ...curves.weakest, ...curves.optimized);
  const step = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => s * 5 >= ymaxRaw) || 1000; const ymax = step * 5;
  const pmax = Math.max(0.05, Math.ceil(R.model.F(tMax) * 20) / 20);
  const X = (t) => L + (t / tMax) * (W - L - Rr), Y = (v) => T + (1 - v / ymax) * (H - T - B), Yp = (p) => T + (1 - p / pmax) * (H - T - B);
  let g = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  for (let k = 0; k <= 5; k++) { const y = Y(k * step); g += `<line x1="${L}" x2="${W - Rr}" y1="${y}" y2="${y}" stroke="${COL.grid}"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${COL.axis}">${k * step}</text>`; }
  for (let k = 0; k <= 5; k++) { const p = (pmax * k) / 5; g += `<text x="${W - Rr + 8}" y="${Yp(p) + 4}" font-size="11" fill="${COL.crqc}">${pct(p, 0)}</text>`; }
  for (let y = 0; y <= tMax + 1e-9; y += 0.5) { const x = X(y); const lab = Math.abs(y % 1) < 1e-9 ? `${2027 + Math.round(y)}` : `Q3 ${2027 + Math.floor(y)}`; g += `<line x1="${x}" x2="${x}" y1="${H - B}" y2="${H - B + 4}" stroke="#999"/><text x="${x}" y="${H - B + 17}" text-anchor="middle" font-size="11" fill="${COL.axis}">${lab}</text>`; }
  if (NIST_2030 < tMax) { const x = X(NIST_2030); g += `<line x1="${x}" x2="${x}" y1="${T}" y2="${H - B}" stroke="#bbb" stroke-dasharray="4 3"/><text x="${x - 4}" y="${T + 10}" text-anchor="end" font-size="10" fill="#777">NIST IR 8547: 2030</text>`; }
  g += `<path d="${ts.map((t, i) => (i ? 'L' : 'M') + X(t).toFixed(1) + ' ' + Yp(R.model.F(t)).toFixed(1)).join('')}" fill="none" stroke="${COL.crqc}" stroke-width="1.4" stroke-dasharray="2 3"/>`;
  for (const k of ['weakest', 'waves', 'optimized']) {
    g += `<path d="${ts.map((t, i) => (i ? 'L' : 'M') + X(t).toFixed(1) + ' ' + Y(curves[k][i]).toFixed(1)).join('')}" fill="none" stroke="${COL[k]}" stroke-width="${k === 'optimized' ? 2.6 : 1.8}" ${k === 'weakest' ? 'stroke-dasharray="6 4"' : ''}/>`;
  }
  const endO = R.optimized.makespan;
  g += `<circle cx="${X(endO)}" cy="${Y(R.optimized.total)}" r="4" fill="${COL.optimized}"/><text x="${X(endO) - 6}" y="${Y(R.optimized.total) - 9}" text-anchor="end" font-size="11" font-weight="700" fill="${COL.optimized}">${fmt(R.optimized.total)}</text>`;
  g += `<circle cx="${X(R.waves.makespan)}" cy="${Y(R.waves.total)}" r="4" fill="${COL.waves}"/><text x="${X(R.waves.makespan) - 6}" y="${Y(R.waves.total) - 9}" text-anchor="end" font-size="11" font-weight="700" fill="#555">${fmt(R.waves.total)}</text>`;
  g += `<text x="${L}" y="${H - 2}" font-size="10" fill="#888">cumulative expected exposure (risk-years), left · CRQC probability, right</text>`;
  g += `<line id="hl" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#bbb" style="display:none"/><rect id="hr" x="${L}" y="${T}" width="${W - L - Rr}" height="${H - T - B}" fill="transparent"/></svg>`;
  el.innerHTML = g;
  $('legend').innerHTML = `<span><i style="background:${COL.optimized};height:3px"></i>Optimized order</span><span><i style="background:${COL.waves}"></i>Score-ranked waves</span><span><i style="background:repeating-linear-gradient(90deg,${COL.weakest} 0 6px,transparent 6px 9px)"></i>Weakest keys first</span><span><i style="background:repeating-linear-gradient(90deg,${COL.crqc} 0 2px,transparent 2px 5px)"></i>P(CRQC by date)</span>`;
  $('chartNote').textContent = `${R.model.label} · median CRQC ${dateOf(R.model.median).getUTCFullYear()}`;
  const rect = el.querySelector('#hr'), hl = el.querySelector('#hl'), tip = $('tip');
  rect.addEventListener('mousemove', (e) => {
    const bb = rect.getBoundingClientRect(); const t = Math.max(0, Math.min(tMax, ((e.clientX - bb.left) / bb.width) * tMax));
    hl.setAttribute('x1', X(t)); hl.setAttribute('x2', X(t)); hl.style.display = '';
    const done = (rows) => rows.filter((r) => r.end <= t).length;
    tip.innerHTML = `${qtr(t)}<br>P(CRQC by then): ${pct(R.model.F(t))}<br><span style="color:#a9a5ff">■</span> Optimized: ${fmt(cumulativeCurve(R.optimized.rows, t))} (${done(R.optimized.rows)}/36 done)<br><span style="color:#bbb">■</span> Waves: ${fmt(cumulativeCurve(R.waves.rows, t))} (${done(R.waves.rows)}/36 done)`;
    tip.classList.remove('hidden'); tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY - 30 + 'px';
  });
  rect.addEventListener('mouseleave', () => { tip.classList.add('hidden'); hl.style.display = 'none'; });
}

function renderWhy() {
  const posO = new Map(R.optimized.order.map((id, i) => [id, i])), posW = new Map(R.waves.order.map((id, i) => [id, i]));
  const rowO = new Map(R.optimized.rows.map((r) => [r.id, r])), rowW = new Map(R.waves.rows.map((r) => [r.id, r]));
  const deltas = DATA.systems.map((s) => ({ s, d: posW.get(s.id) - posO.get(s.id), gain: P.exposure(R.model, s, rowW.get(s.id).end) - P.exposure(R.model, s, rowO.get(s.id).end) }));
  const up = deltas.filter((x) => x.d > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);
  const down = deltas.filter((x) => x.d < 0 && (x.s.protectYears <= 3 || x.s.effortWeeks >= 12 || x.s.vendorReadyYears >= 1)).sort((a, b) => a.d - b.d).slice(0, 2);
  const kids = (s) => DATA.systems.filter((o) => o.dependsOn.includes(s.id)).length;
  const reason = (x) => {
    const s = x.s; const bits = [];
    if (x.d > 0) {
      if (s.protectYears >= 10) bits.push(`what it protects must stay secret or trusted for ${s.protectYears} years, so anything captured or signed now lands inside the CRQC window`);
      if (kids(s)) bits.push(`it unblocks ${kids(s)} dependent system${kids(s) > 1 ? 's' : ''}`);
      if (!bits.length) bits.push(`its exposure per engineer-week (${s.effortWeeks} wk of work) is higher than the systems it overtakes`);
    } else {
      if (s.protectYears <= 3) bits.push(`its protection only has to hold ${s.protectYears < 1 ? fmt(s.protectYears * 12, 0) + ' months' : s.protectYears + ' years'}, so traffic harvested today loses value before a CRQC is likely`);
      if (s.effortWeeks >= 12) bits.push(`it is ${fmt(s.effortWeeks, 0)} engineer-weeks of work that would hold back faster, longer-lived wins`);
      if (s.vendorReadyYears >= 1) bits.push(`its vendor PQC support only ships ${qtr(s.vendorReadyYears)}`);
    }
    return bits.join('; ');
  };
  const li = (x, dir) => `<li><b>${x.s.name}</b> ${dir === 'up' ? `<span class="move-up">▲ ${x.d} places</span>` : `<span class="move-down">▼ ${-x.d} places</span>`}: ${reason(x)}. P(X+Y&gt;Z) ${pct(rowW.get(x.s.id).mosca, 0)} → ${pct(rowO.get(x.s.id).mosca, 0)}.</li>`;
  const firstGate = DATA.systems.filter((s) => s.vendorReadyYears > 0).sort((a, b) => a.vendorReadyYears - b.vendorReadyYears)[0];
  $('why').innerHTML = `Both plans finish ${qtr(R.optimized.makespan)} with the same team. The optimized order spends the same engineer-weeks on long-lived secrets first, and clears quick, ready-now systems while vendors ship PQC support (first: ${firstGate.name}, ${qtr(firstGate.vendorReadyYears)}).<ol>${up.map((x) => li(x, 'up')).join('')}${down.map((x) => li(x, 'down')).join('')}</ol><span class="small">Local search made ${R.optimized.moves} improving moves from the best of three starting orders; on 7-system subsets it matches brute force (see tests).</span>`;
}

function renderTable() {
  const posW = new Map(R.waves.order.map((id, i) => [id, i + 1]));
  const sevCls = (p) => (p >= 0.5 ? 'c-crit' : p >= 0.3 ? 'c-high' : p >= 0.15 ? 'c-low' : 'c-min');
  let h = `<thead><tr><th></th><th>Order</th><th>System</th><th>Algorithm</th><th>Use</th><th class="r">Certificates</th><th class="r">Protect (X)</th><th class="r">Effort</th><th>Start</th><th>Complete</th><th class="r">P(X+Y&gt;Z)</th><th class="r">Exp. Exposure</th><th class="r">Waves #</th></tr></thead><tbody>`;
  R.optimized.rows.forEach((r, i) => {
    const s = BYID.get(r.id); const w = posW.get(r.id); const d = w - (i + 1);
    h += `<tr><td><span class="cb"></span></td><td>${i + 1}</td><td>${s.name}</td><td>${s.algorithm}</td><td>${s.use === 'kex' ? 'Key exchange' : 'Signature'}</td><td class="r">${s.certificates.toLocaleString()}</td><td class="r">${s.protectYears < 1 ? fmt(s.protectYears * 12, 0) + ' mo' : s.protectYears + ' yr'}</td><td class="r">${fmt(s.effortWeeks)} wk</td><td>${mdy(r.start)}</td><td>${mdy(r.end)}</td><td class="r sev ${sevCls(r.mosca)}">${pct(r.mosca, 0)}</td><td class="r">${fmt(r.exposure, 2)}</td><td class="r">${w} ${d > 0 ? `<span class="move-up small">▲${d}</span>` : d < 0 ? `<span class="move-down small">▼${-d}</span>` : ''}</td></tr>`;
  });
  $('tbl').innerHTML = h + '</tbody>';
  $('total').textContent = `Total: ${R.optimized.rows.length}`;
}

function renderAssumptions() {
  const m = R.model; const S = DATA.systems;
  $('assump').innerHTML = `<h4>CRQC timeline</h4>${m.source}. Fitted lognormal on years after ${P.SURVEY_DATE}: μ = ${m.mu.toFixed(3)}, σ = ${m.sigma.toFixed(3)}, conditioned on no CRQC before ${DATA.planStart} (${m.offsetYears.toFixed(2)} years later). Median arrival ${dateOf(m.median).getUTCFullYear()}; P(by 2030) ${pct(m.F(NIST_2030))}, P(by 2035) ${pct(m.F(NIST_2030 + 5))}.
  <h4>Exposure</h4>For system i finishing at t<sub>i</sub>: <code>E_i = v_i ∫₀^{t_i} F(s + X_i) ds</code>, the value-weighted expected years of classical traffic or signatures that end up inside the CRQC window (Mosca's X + Y &gt; Z with Z random). X is the data shelf life for key establishment and the remaining trust lifetime for signatures (e.g. ATM firmware stays in the field 12 years). Units are risk-years: value weight × years.
  <h4>Schedule</h4>One migration team works through systems in order at ${state.capacity} engineer-week${state.capacity === 1 ? "" : "s"} per calendar week; total work ${fmt(S.reduce((t, s) => t + s.effortWeeks, 0))} engineer-weeks across ${S.length} systems and ${S.reduce((t, s) => t + s.certificates, 0).toLocaleString()} certificates. A system starts after its dependencies and its vendor's PQC release. Baselines are executed with non-delay dispatch (never idle while something is startable), so every plan finishes on the same date and the gain comes only from ordering.
  <h4>Optimizer</h4>Precedence-aware ratio rule (exposure rate per engineer-week, with prerequisites credited for what they unblock), then insertion local search over all feasible moves, started from three orders. Monte Carlo over 20,000 sampled CRQC dates gives P50/P90 and matches the analytic expectation (${fmt(R.mc.mean)} vs ${fmt(R.optimized.total)}).
  <h4>Score-ranked waves (baseline)</h4>Each system scored 1 to 3 on data sensitivity and external exposure (counted twice), business criticality and regulatory obligation, ranked by total, ties by lower effort, dependencies first.`;
}

function renderAll() {
  renderTiles(); renderChart(); renderWhy(); renderTable(); renderAssumptions();
  const showPlan = state.tab === 'plan', showSys = state.tab !== 'assumptions';
  $('tab-plan').classList.toggle('hidden', !showPlan);
  $('tab-systems-wrap').classList.toggle('hidden', !showSys);
  $('tab-assumptions').classList.toggle('hidden', state.tab !== 'assumptions');
  document.querySelectorAll('#tabs div').forEach((d) => d.classList.toggle('on', d.dataset.t === state.tab));
}

async function boot() {
  DATA = await (await fetch('data/inventory.json')).json();
  BYID = new Map(DATA.systems.map((s) => [s.id, s]));
  const q = new URLSearchParams(location.search);
  if (P.SCENARIOS[q.get('scenario')]) state.scenario = q.get('scenario');
  if (CAPS.includes(Number(q.get('capacity')))) state.capacity = Number(q.get('capacity'));
  if (['plan', 'systems', 'assumptions'].includes(q.get('tab'))) state.tab = q.get('tab');
  $('selScen').innerHTML = Object.entries(P.SCENARIOS).map(([k, v]) => `<option value="${k}" ${k === state.scenario ? 'selected' : ''}>${v.label.replace(' expert survey', '')}</option>`).join('');
  $('selCap').innerHTML = CAPS.map((c) => `<option value="${c}" ${c === state.capacity ? 'selected' : ''}>${c} engineer${c === 1 ? '' : 's'} (${c} eng-wk / wk)</option>`).join('');
  const replan = () => { state.scenario = $('selScen').value; state.capacity = Number($('selCap').value); compute(); renderAll(); };
  $('selScen').addEventListener('change', replan); $('selCap').addEventListener('change', replan); $('btnPlan').addEventListener('click', replan);
  $('btnCmp').addEventListener('click', () => { state.tab = 'plan'; renderAll(); $('chart').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  document.querySelectorAll('#tabs div').forEach((d) => d.addEventListener('click', () => { state.tab = d.dataset.t; renderAll(); }));
  window.addEventListener('resize', renderChart);
  compute(); renderAll();
}
boot();
