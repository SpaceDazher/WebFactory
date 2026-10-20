# Vehicle v1.16 browser acceptance

Browser acceptance for the merged v1.16 vehicle build. This task changed only the browser test and this report; production code was not modified here.

## Verified behavior

The Chromium journey used the real UI, game Worker, and two separate browser contexts for multiplayer. It verified the 2×3 vehicle UI and interaction, all 40 trunk slots, fuel consumption while driving, safe exit, two mounted turrets and ammunition, the personal fission module, a UI-installed battery and charged vehicle grid, the turret-radius rendering, and save/reload persistence of vehicle fuel, trunk, mounts, and nuclear equipment. A Canvas2D pixel assertion checks the visible radius rather than only reading game state.

The multiplayer journey connected a real Chromium host and client to the same game. The client took and drove its replicated vehicle. Closing the client browser caused a safe exit; a fresh browser late-joined the live game. For the death-exit case, the test prepares the connected late-joining peer as a seated driver, then applies damage through the real Worker and advances the game. Thus death handling is exercised in the browser-hosted game, but the lethal damage itself is an engine fixture rather than a player-weapon action.

WebKit ran the single-player UI, driving, equipment, save/reload, and radius-rendering journey. Neither run produced uncaught page or console errors.

## Commands and results

| Command | Result |
| --- | --- |
| `node tests/e2e-vehicle-v116.mjs chromium` | Exit 0; Playwright Chromium 151.0.7922.34; full journey including two-browser multiplayer |
| `node tests/e2e-vehicle-v116.mjs webkit` | Exit 0; Playwright WebKit 26.5; single-player journey |

The parent reported `npm run typecheck` and `npm run build` passing on the merged release build (build output approximately 2535 KB), as well as its focused vehicle check. Those are parent-run checks, not rerun by this browser-only task.

## Evidence

- Chromium vehicle UI after loading: [vehicle-ui-loaded.png](../shots/vehicle-v116/chromium/vehicle-ui-loaded.png)
- Chromium turret-radius rendering: [vehicle-turret-radius.png](../shots/vehicle-v116/chromium/vehicle-turret-radius.png)
- Chromium multiplayer host: [vehicle-multiplayer-host.png](../shots/vehicle-v116/chromium/vehicle-multiplayer-host.png)
- Chromium multiplayer client: [vehicle-multiplayer-client.png](../shots/vehicle-v116/chromium/vehicle-multiplayer-client.png)
- WebKit vehicle UI: [vehicle-ui-loaded.png](../shots/vehicle-v116/webkit/vehicle-ui-loaded.png)
- WebKit turret-radius rendering: [vehicle-turret-radius.png](../shots/vehicle-v116/webkit/vehicle-turret-radius.png)

## Remaining limits

Firefox was not verified: the installed Playwright browser launch probe failed with `spawn UNKNOWN`, before the test journey started. Chromium and WebKit therefore do not establish three-engine coverage. This browser task did not run the full release gates, GPU hardware benchmark, or manual no-cheat ten-hour scenario; those remain part of the parent release acceptance. No browser-weapon death action was tested, as noted above.
