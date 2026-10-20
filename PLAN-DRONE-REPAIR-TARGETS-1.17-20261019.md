# Mechanical repair targets — source phase

SPEC 6.2 limits the repair model to friendly structures and other mechanical drones. The current implementation also heals engineers and never repairs another deployed mechanical drone.

Replace player selection with living mechanical target selection, preserve deterministic ordering/line of sight/source coverage, and key the shared 25 HP/s work budget by target kind plus stable ID. Distinguish positive drone and building IDs with optional saved target metadata and a closed command discriminator. Old negative engineer targets must be discarded rather than reinterpreted as drone IDs. Recovery, physical standby storage and ordinary construction-robot repair remain separate. Keep exact actual-HP repair-pack debit and energy costs.

No executable checks before functional implementation closure. Later cover engineer/bioform exclusion, other-drone repair, self/dead/foreign target rejection, equal numeric IDs across target kinds, multiple repairers, fractional HP/budget, LOS/range, save/load and multiplayer authority.
