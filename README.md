# PQC Migration Plan for Keyfactor Command (concept demo)

**Live demo:** https://mohith26.github.io/keyfactor-pqc-migration-planner/

Unofficial concept demo by Mohith Gajjela. Not affiliated with Keyfactor. Synthetic inventory from a seeded generator in this repo; the quantum-computer timeline is fitted to the Global Risk Institute *Quantum Threat Timeline Report 2024*. Every number on the page is computed in the browser. Defensive feature: it only plans migrations.

## What it is

Command Risk Intelligence already scores each certificate's quantum risk, and public PQC guidance (including Keyfactor's own PQC Readiness series) recommends ranking systems on a 1-3 scale and grouping them into waves. Scores tell you *what is risky*; they do not tell you *what order to migrate in* when you have one team, dependencies (HSM firmware before the CA hierarchy before the services that need PQC certificates), and vendors that ship PQC support on their own dates.

This page adds a **PQC Migration Plan** to Command (next to Risk Intelligence) that turns the inventory into a schedule minimizing **expected exposure**:

- **Mosca's X + Y > Z with Z uncertain.** X is how long a system's protection must hold (data shelf life for key establishment, remaining trust lifetime for signatures, e.g. ATM firmware in the field for 12 years). Z, the arrival of a cryptographically relevant quantum computer (CRQC), is a probability distribution fitted to the GRI expert survey, conditioned on no CRQC before the plan starts.
- **Exposure of a system finishing at t:** `v * integral_0^t F(s + X) ds`, the value-weighted expected years of classical traffic or signatures that end up inside the CRQC window.
- **Schedule:** one team at a chosen capacity, dependencies and vendor dates respected; the order is optimized with a precedence-aware ratio rule plus insertion local search.
- **Baselines:** score-ranked waves and weakest-keys-first, both executed with non-delay dispatch (never idle while something is startable), so every plan finishes on the same date and the difference comes only from ordering.

## Results (from `node scripts/report.mjs`)

Synthetic inventory: 36 systems, 16,856 certificates, 282.6 engineer-weeks of migration work, plan start Q1 2027.

| CRQC timeline | team | optimized | score-ranked waves | reduction | waves would need |
|---|---|---|---|---|---|
| GRI 2024, pessimistic reading | 2 engineers | 172.3 risk-years (P90 458) | 234.6 (P90 564) | **-26.6%** | +0.84 engineers to match |
| GRI 2024, pessimistic reading | 1 engineer | 315.9 | 484.0 | -34.7% | +0.47 |
| GRI 2024, average reading | 2 engineers | 224.9 | 282.3 | -20.3% | +0.59 |
| GRI 2024, pessimistic reading | 4 engineers | 134.9 | 143.0 | -5.7% | +1.93 |

Same finish date in every row (Q4 2029 at 2 engineers). The average completion date of the 13 systems whose data must stay protected 10+ years moves from Q3 2028 to Q2 2028 at 2 engineers, and from 2030.4 to 2029.4 at 1 engineer. The gain shrinks as capacity grows, because vendor PQC release dates become the bottleneck rather than the team.

## How it works

`src/planner.js` (pure functions shared by the page and the tests):

1. `fitLognormal`: least-squares fit on the probit scale to the survey anchors (pessimistic reading: ~19% within 10 years, ~39% by 15, ~60% by 20; average reading: ~14% within 5, ~34% within 10).
2. `crqcModel`: conditional CDF in plan time plus a precomputed cumulative integral, so every exposure is two table lookups.
3. `simulate`: one team, capacity c engineer-weeks per week; start = max(previous finish, vendor date, dependency finish).
4. `greedy`: pick the available system with the highest exposure rate per engineer-week, crediting prerequisites with the rate of everything they unblock (Sidney-style closure ratio).
5. `localSearch`: try moving every system to every feasible position; keep improvements until none remain. `optimize` starts from greedy, waves and weakest-first and keeps the best.
6. `monteCarlo`: samples 20,000 CRQC dates; realized exposure is `v * max(0, t - max(0, z - X))`, whose mean matches the analytic expectation.

## Tests

```
node --test test/planner.test.mjs   # 9 tests
node scripts/generate.mjs           # regenerates data/inventory.json (seed 20261110)
node scripts/report.mjs             # prints every number above
```

Covers: generator determinism; normal CDF / inverse; the lognormal reproducing its survey anchors; monotone conditional CDF and the integral table vs Simpson quadrature; Monte Carlo mean vs analytic (within 3%); dependency and vendor-date enforcement; **exact optimality on 7-system subsets by brute force over all feasible orders**; optimized beats both baselines for both timelines and three capacities with the same finish date; and that dispatch never idles while a system is startable.

To run locally: `python3 -m http.server` in the repo root and open http://localhost:8000.

## Honest limitations

- **Synthetic inventory.** Systems, effort, value weights, shelf lives and vendor dates are invented to look like a mid-size bank. In Command they would come from certificate metadata, collections, SSL discovery and AgileSec findings, plus a few owner-entered fields (shelf life, effort).
- **The timeline is expert opinion.** The GRI survey is the best public aggregate, not a forecast. Both readings are offered; a lognormal through 2-3 anchors is a modelling choice, and the tail matters for 25-30 year secrets.
- **One team, one system at a time.** Real programs run several workstreams in parallel; the model treats capacity as a single pooled rate. Parallel machines with precedence is a harder scheduling problem.
- **Local search is a heuristic.** It matches brute force on small subsets; on 36 systems there is no optimality certificate.
- **Value weights matter.** The ordering is only as good as the shelf-life and value inputs; the page shows them per system so they can be challenged.
- **Not a replacement for risk scoring.** It consumes Risk Intelligence-style findings (algorithm, key size, exposure) and adds time and dependencies; it does not detect weak keys itself.
- UI is a hand-built recreation of the Command 25.4+ portal from public demo videos and docs screenshots; icons are Font Awesome stand-ins; the logo mark is redrawn.

## Novelty note

Checked Nov 10, 2026: Keyfactor blog (Command Risk Intelligence launch, Feb 2025; "Commanding the Future" quantum scoring, Sep 2025; How to Build a PQC Migration Roadmap, Jun 2026; PQC Readiness stages 1-4 and PQC Lab assessment, Oct 2026), Command 25.4 and 26.2.1 release notes, and the PQC Lab page (AgileSec "Quantum Risk & Prioritization" demo). Keyfactor ships per-certificate quantum risk scores (expiry date and bits-of-security bands) and recommends score-based waves; AgileSec ranks findings by severity. None describes a schedule that optimizes migration order under dependencies, vendor dates and team capacity against a probabilistic CRQC timeline, or reports expected exposure with Monte Carlo intervals. Competitors: SandboxAQ's PQC guidance and AQtive Guard describe prioritization factors and fixed wave templates. The closest is IBM's Quantum Safe Migration Orchestrator (announced Dec 2025, used by IBM Consulting), which advertises constraint-aware, multi-horizon migration roadmaps with dependency capture; its public material does not describe a probabilistic CRQC timeline, an expected-exposure objective, or Monte Carlo intervals. So constraint-aware roadmapping exists at a competitor; this specific formulation inside a CLM product does not appear to.
