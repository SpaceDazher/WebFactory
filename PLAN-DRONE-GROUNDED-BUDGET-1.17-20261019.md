# Grounded mechanical drone admission — source phase

SPEC 6.1 counts forced landings against deployment budgets until recovery; physical machines parked in inventories do not count. Current budget reductions use the flight-only helper and incorrectly free units when a drone lands or disables in the world.

Add a separate live-world budget predicate, keeping movement/recall checks flight-only. Apply it to manual/automatic launch, owner/personal/port/world budgets, alternative return source reservation and recipient ownership admission. Show grounded personal machines in deployed UI. No new saved field is needed: the existing world instance and HP already distinguish deployment from physical standby storage.

Executable acceptance is deferred until functional SPEC closure, as requested. Later test forced landing, exhausted charge, recovery, standby storage, transfer, source removal, reconnect, death and all admission ceilings without deleting existing machines when over limit.
