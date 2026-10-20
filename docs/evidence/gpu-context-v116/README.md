# v1.16 WebGL context recovery evidence

This isolated candidate exercises real `WEBGL_lose_context` loss and restoration through the app’s New Game UI. It does not claim an FPS or RTX 4060 acceptance result.

- **RED:** [pre-lifecycle failure excerpt](logs/red-pre-lifecycle.log) records the initial timeout after real context loss, before renderer lifecycle handlers existed.
- **RED (test-fixture correction):** [cycle 3 failed attempt](logs/red-cycle3-optional-ru-failure.log) records the Russian restore-failure assertion timing out while the test had deliberately hidden the menu shell.
- **GREEN:** [final browser run](logs/green-browser.log) covers RU/EN loss and fallback reasons, awaited Worker tick samples, paused-state preservation, full serialized Worker save equality, atlas/frame rebuild, old-context release and handler removal, and injected restoration failure in both languages.
- **Checks:** [typecheck](logs/typecheck.log), [build](logs/build.log), [full i18n scan](logs/i18n.log), and focused [GPU](logs/gpu-v116.log), [diagnostic](logs/diagnostic-v116.log), and [render-fx](logs/render-fx-v116.log) regressions.
- **Rendered scene:** [Canvas2D during loss](screenshots/ru-canvas-before-restore.png) and [WebGL after recovery](screenshots/ru-webgl-after-restore.png). Both captures show the same paused world.

The final recovery run preserved the complete Worker save string (tick 124, 1,833 bytes, SHA-256 `f0f4ac95df309801d25af0cacaf15e46fda0663543af6f2fe45ccca959480238`) as well as the paused snapshot. The functional browser reported ANGLE / Intel UHD Graphics as its active hardware adapter. The parent’s native Chrome / RTX 4060 performance gate remains separate.
