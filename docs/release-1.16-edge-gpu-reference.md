# Edge GPU reference and limits

Edge155 native E14 ran on hardware ANGLE Intel UHD, with three p95 misses at the original16.7ms threshold; E15 passed on the same adapter. Neither result proves RTX performance or that every native Edge configuration meets the frame budget. The existing Chrome137 reference run used the user's configured RTX4060 Laptop GPU.

The current primary [Chromium switch definition](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/config/gpu_switches.cc) defines `force-high-performance-gpu`. The [GPU process launcher](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/gpu/gpu_process_host.cc) forwards this choice to its high-performance GPU workaround. This supports a temporary, isolated browser launch for a reference-hardware test; it does not prove which adapter the installed Edge will select. The next probe must read the actual WebGL debug renderer. Windows graphics preferences and the user's browser profile remain untouched.

ECC documentation-lookup was used; Context7 is not configured in this session, so these official Chromium sources are the fallback. Intel failures remain part of the release evidence.

Observed result: the isolated process-local probe selected NVIDIA RTX4060 Laptop with GL error0. The unchanged E14 fixture and frame/UPS assertions then passed on Edge155, headed with `--force-high-performance-gpu`: p95 11.10/8.20/9.80/7.30ms, UPS59.8–59.9,1788entities, no page/console errors. The parent read `e2e-edge-155-14-rtx.log` and its exit0 file. Startup telemetry already had textures ready, frames5/snaps5 before fixture load, so no readiness/warmup change was made. This closes the reference-hardware gate; it does not promise60FPS on the Intel configuration.
