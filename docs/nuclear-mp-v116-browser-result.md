# Nuclear multiplayer browser verification (1.16)

## Result

The nuclear multiplayer journey passed in Chromium with three real browser clients (host plus two joining clients). One joining client disconnected and reconnected under the same browser identity; a fresh client then joined after the reactor cascade. The browser test uses a seeded hot-but-held reactor base only as setup; the rod commands, moderation actions, save, disconnect, reconnect, and late join use the real UI, Worker simulation, multiplayer transport, and snapshot state.

| Checkpoint | Observed result |
| --- | --- |
| Initial synchronized base | Two fueled reactors at 999 °C, rods held, tick 0 on host and both clients |
| Player roles | Ordinary player denied `/creative`; host switches creative/survival; a client promoted through the Players UI can run both commands |
| Accident | Real `Game.step()` starts both rods at tick 135; cascade removes both reactors and creates two radiation zones at tick 735 |
| Multiplayer save | Requested at tick 756; saved state is tick 759 with two zones |
| FX snapshot | Host and connected client both receive active blast `{life:70}` and reactor boom `{life:60}` with positive remaining ticks |
| Reconnect | Same browser identity and world character reconnect; post-cascade zones are present |
| Late join | A fresh browser receives the post-accident snapshot at tick 871 |
| Lockstep | Host, reconnecting client, and late joiner report the same Worker hash at tick 900: `59833d969d682fe2`; desyncs `0/0/0`, resyncs `0/0/0` |
| Browser errors | No uncaught page errors or unexpected console errors |

The run used Playwright 1.62.0 and Chromium 151.0.7922.34 on Windows. Screenshots from the run are in [`shots/nuclear-mp-v116/chromium`](../shots/nuclear-mp-v116/chromium/): [reactor setup and roles](../shots/nuclear-mp-v116/chromium/roles-and-reactors.png), [reactor cascade](../shots/nuclear-mp-v116/chromium/reactor-cascade.png), [host after hot join](../shots/nuclear-mp-v116/chromium/post-accident-hot-join-host.png), and [late-join client](../shots/nuclear-mp-v116/chromium/post-accident-hot-join-client.png).

## Renderer regression found and fixed

The first real browser run reached the cascade, save, reconnect, and late join, but failed on `CanvasRenderingContext2D.arc`: the reactor and nuclear blast FX have a 70-tick lifetime while the renderer divided remaining time by 30. The computed radius was `-250.56` in the browser. Clamping progress alone exposed the same defect in the accompanying 60-tick `boom` radial gradient, whose renderer assumed a 40-tick lifetime.

`Fx.life` now carries the initial animation duration through the existing structured-clone snapshot. Every blast creator sets its actual duration (12, 30, 36, 50, or 70 ticks); every boom creator sets 40 or 60 ticks. The renderer interpolates over that duration, clamps progress and radius, and keeps the old 30-tick blast / 40-tick boom defaults for snapshots without `life`. No physics or zone state is modified by this change.

The focused renderer test first failed on the 70-tick blast with a negative radius (`-230.4`), then failed after the radius clamp because the long blast stayed at its minimum radius for the first 40 ticks. The real browser run also exposed the corresponding 60-tick boom gradient failure. The final test checks finite nonnegative radii and expansion from start through middle to the last active tick for blast lives 12/30/36/50/70 and boom lives 40/60; it also checks the legacy defaults. The E2E now verifies that the active 70/60-tick duration fields reached both connected browser Workers.

## Fresh Firefox and WebKit nuclear multiplayer runs

Both engines passed the complete nuclear multiplayer journey using actual browser contexts and the local signaling server. The host and clients entered through the multiplayer UI; reactor controls, role changes, console commands, save, disconnect/reconnect, and late join ran through the real browser Workers and lockstep simulation. The hot reactor setup was fixture-only.

| Engine | Reactor cascade | Save | Reconnect and late join | Lockstep checkpoint | Errors |
| --- | --- | --- | --- | --- | --- |
| WebKit 26.5 | rods enabled at tick 256; two reactors removed and two radiation zones created at tick 826 | requested 830, acknowledged save tick 837 | same player reconnected; fresh browser joined at tick 1144 | all live browsers matched at tick 1200: `ea03f4d4cf59edc1`; desync/resync `0/0` | none |
| Firefox 153.0 | rods enabled at tick 141; two reactors removed and two radiation zones created at tick 738 | requested 747, acknowledged save tick 751 | same player reconnected; fresh browser joined at tick 1016 | all live browsers matched at tick 1020: `e71ad7fdfca37339`; desync/resync `0/0` | none |

Both runs also verified ordinary-player console denial, host/admin creative and survival changes, the active 70/60-tick FX metadata in snapshots, and no unexpected browser errors. Screenshots are saved under [`shots/nuclear-mp-v116/webkit`](../shots/nuclear-mp-v116/webkit/) and [`shots/nuclear-mp-v116/firefox`](../shots/nuclear-mp-v116/firefox/), including [WebKit reactor cascade](../shots/nuclear-mp-v116/webkit/reactor-cascade.png) and [Firefox reactor cascade](../shots/nuclear-mp-v116/firefox/reactor-cascade.png).

The earlier shared Playwright Firefox 153 build failed with `spawn UNKNOWN`; SideBySide event 33 cited the `mozglue` assembly although its DLL was present. I installed official Playwright 1.62 Firefox and WebKit builds into a new, isolated workspace cache at `D:\Project\webfactory\browser-cache-v116`; the shared cache and OS configuration were not changed. Both full journeys launched and passed from that clean cache.

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\Project\webfactory\browser-cache-v116'
$env:PLAYWRIGHT_SKIP_BROWSER_GC = '1'
.\node_modules\.bin\playwright.cmd install firefox webkit
node tests/e2e-nuclear-mp-v116.mjs webkit
node tests/e2e-nuclear-mp-v116.mjs firefox
```

## Eight-player deterministic nuclear lockstep

[`tests/nuclear-mp-8.test.ts`](../tests/nuclear-mp-8.test.ts) runs the seeded eight-peer NetSim scenario twice in one invocation. It sends power-priority and console commands from real simulated peers, grants an admin role through the host session, starts two hot reactors, waits for the actual `Game.step()` cascade, requests the synchronized multiplayer save, disconnects and reconnects the same character, and compares full `stateHash` values from the `NetSim.onHash` callback. No hash fields are assigned or replaced by the test.

The two independent simulations matched at full-state control ticks `60`, `300`, `900`, `960`, and `1080`. The latest observed values were `23850dbd755fc131`, `c086aae4c6a4e756`, `d4168e50506d04c8`, `3ccc4e68ccd56e20`, and `31d2f56df8d9c2db`. The accident had two radiation zones at tick 915; the saved state was tick 922 with hash `b90e2e09a6df328`. The reconnecting character was player 4, and the post-reconnect common quick hash matched at tick 1080 with zero desyncs. This is a deterministic same-seed repeat within the test process; it is not a hardware performance measurement.

## Security review

The reviewed car command path is host-authoritative: lockstep assigns `pl` from the authenticated session/frame index and filters client-sent system commands. Car equipment, turret, and ammunition commands validate the vehicle, owner/admin access, distance, slot, permitted equipment/ammunition kind, inventory, grid bounds, and overlap before changing state. Resource returns are preflighted; equipment overflow is dropped into the world instead of silently discarded.

Save validation checks vehicle structure and finite/ranged movement state before JSON cloning, including equipment footprint/overlap, charge bounds, turret/ammo categories, nuclear counters, and matching unique driver references. The valid occupied-car roundtrip plus 23 malformed-save cases are covered by `tests/vehicle-save-validation.test.ts`. `Fx.life` is optional visual metadata generated by simulation FX creators; it is carried in snapshots, is not a command or saved resource, and the renderer clamps animation progress/radius. The browser journeys observed the 70/60-tick values in connected Workers. I found no additional security defect in these paths; this review covers structural/state integrity, not authenticity of locally editable save files.

## Exact checks

The vehicle/FX implementation checks below were recorded as exit `0` before the parent’s current shared `src/sim/mgmt.ts` work-in-progress:

```powershell
node_modules/.bin/tsx.cmd tests/render-fx-v116.test.ts
node_modules/.bin/tsx.cmd tests/v116.test.ts
node_modules/.bin/tsx.cmd tests/sim.test.ts
node_modules/.bin/tsx.cmd tests/vehicle-save-validation.test.ts
node_modules/.bin/tsx.cmd tests/v116vehicle.test.ts
node_modules/.bin/tsx.cmd tests/nuclear-mp-8.test.ts
npm.cmd run typecheck
npm.cmd run build
node --check tests/e2e-nuclear-mp-v116.mjs
node tests/e2e-nuclear-mp-v116.mjs chromium
node tests/e2e-nuclear-mp-v116.mjs webkit
node tests/e2e-nuclear-mp-v116.mjs firefox
```

In this phase, `vehicle-save-validation.test.ts`, `v116vehicle.test.ts`, `render-fx-v116.test.ts`, `nuclear-mp-8.test.ts`, and both fresh-cache WebKit/Firefox nuclear browser runs exited `0`. The latest `npm.cmd run typecheck` exited `1` with eight errors in the parent-owned WIP `src/sim/mgmt.ts` (TS18046 at line 43; RuleTarget narrowing at lines 118, 120, 198 and 207; plus a `number`/`Player.mining` union at line 540); it reported no diagnostics in the new test. This phase made no production changes. Re-run typecheck after that shared file is stabilized. No manual 10-hour gameplay or hardware performance criterion is measured here.
