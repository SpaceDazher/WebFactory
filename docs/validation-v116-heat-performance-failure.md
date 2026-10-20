# v1.16 heat stress run — failed cooling stage

- Command: `npm.cmd exec -- tsx docs/.v116-heat-preflight.once.ts`
- Started: 2026-10-09 18:12:47 UTC on Node v22.23.2, Intel Core i7-12650H.
- Exit: 1. The process ended; no performance JSON was emitted because the runner writes it only after every stage passes.
- Structural preflight passed: 100 reactors, 13,096 heat pipes, 1,000 heat exchangers, 2,000 turbines, 14,196 thermal nodes, and 24,087 heat edges. The 2×2 production station had 48 HX, 84 turbines, eight real offshore pumps, and 100 powered radars drawing 30,003.2 kW.
- The 300-tick preflight and the hot-working stage's no-accident assertion passed. The cooling stage then failed its assertion after 300 warmup plus 1,800 measured `Game.step` ticks: `cooling measurement caused an accident` at temporary runner line 177.
- No p50/p95/p99 values from this run are reported. They were held in memory and never reached the final report writer.
- Fixture boundary: only the production station's 48 HX/84 turbines had real pump-fed water/steam. The remaining 952 HX were thermal-grid stress nodes without water supply, and the remaining 1,916 turbines had no steam input. This run therefore does not prove the fully working 1,000-HX/2,000-turbine criterion.

The failure is retained as evidence; the assertion was not skipped or weakened. A valid rerun needs a real water/steam network for the full counted HX/turbine population, with initial terrain allowed as a fixture and all post-start supply produced by pumps and `Game.step`.
