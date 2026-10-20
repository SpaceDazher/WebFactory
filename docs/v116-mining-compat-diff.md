# Mining telemetry and legacy save hash

## Pre-fix serialized comparison

The `v1.8-mid.z7save` fixture was loaded with the 1.15 baseline deserializer and the merged 1.16 deserializer. Both games advanced 1,800 ticks, then their serialized states were compared recursively after applying the compatibility canonicalizer from `tests/mega.test.ts`.

Observed: 205 differences across 1,141 entities. The only differing paths were `ents[].dc` (71), `ents[].dh` (71), `ents[].lastIt` (62), and `settings.genv` (1, current value `1`). Removing the mining-diagnostic paths from the comparison left only the explicit legacy default `settings.genv = 1`; no physical-state difference remained.

The code now stores the most recently mined item in `lastOre` and retains the old `lastIt` meaning: the item for a pending productivity bonus. `tests/mega.test.ts` canonicalizes `dc`, `dh`, `pendIt`, and `lastOre`, plus `settings.genv` only when it equals the legacy default `1`. It intentionally preserves `lastIt` in the oracle.

## Verification

`MEGA_QUICK=1 npm.cmd exec -- tsx tests/mega.test.ts` completed with exit 0 after this change, including the `v1.8-mid` reference hash. The full three-fixture `mega.test.ts` run is pending the integration gate order (`run bot`, then `saves`, then `mega`).

The same 1.15/current `v1.8-mid` comparison was repeated after the semantics and canonicalizer changes. After 1,800 ticks both saves contain 1,141 entities and the normalized serialized JSON is byte-for-byte equal (267,195 bytes on each side); the inline comparison exited 0.

The pre-fix recursive-diff probe completed with exit 0 and is recorded at `C:\Users\Daniil\AppData\Local\Temp\world-v116-legacy-recursive-diff-full.log`.

## Performance probes (preliminary only)

The exact paired REF profile (`REF_BASE`, 1,906 objects, 3,600 warm-up ticks, 4,800 measured ticks in 120-tick blocks) after the drill scratch-buffer candidate is recorded in `C:\Users\Daniil\AppData\Local\Temp\world-v116-perf-drill-scratch-preliminary.log`. Its three p95 current/1.15 ratios were 1.144, 1.217, and 1.244 (1.15/current p95 ms: 0.9115/1.0377, 0.7688/0.9368, and 0.7511/0.9329). These were captured during integration load, so they are preliminary; they do not meet the ≤10% regression target, and the strict quiet profile remains outstanding.

An isolated 2,400-tick `stepDrill` differential compared the scratch-buffer implementation with the former `tiles.filter` implementation on the same mixed iron/uranium fixture, checking serialized `stateHash` every 60 ticks. All 40 checkpoints matched; the fixture exercised uranium-acid fallback, productivity bonus, blocked output, cursor movement, and ordinary-ore depletion. A separate warmed microbenchmark on 92 drills measured median 0.000965 ms/call with the scratch buffer and 0.000976 ms/call with the filter reference (ratio 0.989; observed ranges overlapped), which is too small to treat as conclusive end-to-end improvement.

The `genLimits` candidate was compared in memory with the exact grouped-array implementation from `D:\Project\webfactory\parallel-base-v1.16\src\sim\networks.ts` using 384 synthetic engines over 8 fluid nets. Per-engine `_max` values matched; five interleaved rounds measured 0.0204–0.0213 ms/call for the candidate and 0.0212–0.0225 ms/call for baseline. This small synthetic microbenchmark suggests a modest improvement only; it is not a runtime acceptance profile.

The next candidate reuses per-Game/per-power-version work buffers for `stepPower`, groups load samples by network with scratch-buffer indices (preserving per-network insertion order), and avoids per-tick `_pkw`/`_pbw` entity writes. The paired REF preliminary run is recorded at `D:\Project\webfactory\release-v1.16\integration-logs\world-v116-perf-scratchpower-preliminary.log`; its p95 ratios were 1.006, 1.192, and 1.170. The work was still under integration load, and the spread is too wide to establish the ≤10% target. After this patch, the observed focused commands `npm.cmd run typecheck`, `npm.cmd exec -- tsx tests/v116b.test.ts`, `npm.cmd exec -- tsx tests/v116.test.ts`, and `MEGA_QUICK=1 npm.cmd exec -- tsx tests/mega.test.ts` all exited 0; this does not replace the required all-fixture compatibility gate or strict quiet profile.
