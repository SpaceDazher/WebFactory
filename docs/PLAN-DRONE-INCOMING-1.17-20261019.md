# Mechanical drone combat/lifecycle source closure

SPEC6 requires real losses, reachable enemy targets and consistent flight
budgets. Source review found no incoming mechanical-drone damage, stale
flying/returning-only source-loss checks, and a dead-state cleanup that does
not match the saved mode schema. Close these paths before deferred testing.

Share an alive/in-flight predicate; combat and repair count as deployed.
Land/disabled and actual low repair work are reachable by ground melee;
airborne machines require a flying/ranged attacker. Repair transit remains
flying. Ranged worm/unit impacts can hit drones; ground acid/blasts affect
only low machines. Death clears internal resources once, emits no biomass,
and removes the row after the tick without reusing its ID or creating an
inventory stack. Keep the existing save21 modes and original enemy damage.

No tests, types, build or runtime now. Later acceptance must establish HP,
one-time loss, attack eligibility, recall/source loss in all four flight
modes, loaded worlds, multiplayer hashes and bounded mixed-army performance.
