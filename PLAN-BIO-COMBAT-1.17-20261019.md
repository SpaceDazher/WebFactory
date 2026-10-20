# Bioform acid and controlled detonation — source phase

SPEC 3.3 requires allied spitters/worms to use acid projectiles and persistent allied puddles, and an individual destroyer detonation order with two seconds of preparation and cancellation. Existing direct-hit attacks do not cover these requirements.

1. Keep the stable player owner on allied acid projectiles/puddles. Route their area damage exclusively to living Swarm units, nests and worms; never engineers, structures, drones or allied bioforms. Preserve legacy hostile behavior when the optional owner is absent. Save, snapshot and hash the same state; validate the optional ownership at save ingress.
2. Add a closed individual `genetics:detonate` command with an enabled flag, owner/control-link checks, destroyer-only admission and bounded saved countdown. Arming prevents movement and ordinary attacks; cancel remains explicit. Death cancels naturally. Detonation consumes the body once and leaves only ordinary sterile organic residue, with no donor/trophy corpse.
3. Expose the command, cancellation, preparation countdown and allied effect color in the ordinary UI/render paths, with RU/EN text.
4. Review all touched authority/save/sync paths now. Defer executable regression checks until the remaining functional SPEC coverage is closed, as requested. Later checks must cover faction isolation, damage/expiry, timing/cancellation, pause/save/load, command rejection, hash equality and sterile death.
