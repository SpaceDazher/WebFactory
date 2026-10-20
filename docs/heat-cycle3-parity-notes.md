# Cycle 3 blast differential notes

`node --import tsx docs/.heat-explosion-parity.once.ts` compares the immutable pre-heat-change source with this candidate after one real overlapping reactor blast. It preserves the full before/after save comparison and exits 1 on any difference; the captured result is `heat-explosion-parity-cycle3.log`.

The observed differences are intentional and covered by `tests/heat-explosion-batch.test.ts`:

- Stored reactor heat losses are 17.2 billion J in this candidate versus 22.05 billion J before. The old path counted the secondary reactor's 4.85 billion J once in `removeEntity` and again when its queued blast ran. The candidate records the heat in `removeEntity`, clears the removed entity's `hE`, then processes the queued blast without recording that heat again.
- The surviving steam branch with capacity 1,700 has amount 83.606557 instead of 83.606553. Component allocation rounds each branch to 1e-6; the candidate's capacity-proportional split retains 0.000004 more volume. Its 17 surviving node `famt` shares each increase by 0.000000235294117. The test checks each branch against the rounded capacity share and reconciles remaining steam energy plus rounding loss.

All other compared fields match in this fixture, including the 62 removals, 56 destroyed fluid entities, 4 destroyed power entities, remaining network capacities/temperatures, power references, heat state, zones, events, and counters other than `lost`. The differential is intentionally not normalized or changed to pass.
