# Mechanical ownership source closure

SPEC6 requires checked ownership changes. Add an explicit owner/admin transfer
to a different live player. A physical standby instance moves to the nearby
recipient's real inventory with capacity preflight, original-source rollback
and the same UID/HP/charge/ammo/repair. Search only the sender's inventory/hand,
mounted hangars, accessible local containers and nearby ground; no remote
inventory extraction or arbitrary client-supplied instance state.

For deployed machines retain the body in place. Only its current controller
can transfer it, with normal source reach (or close pickup range when landed).
An airborne recipient must fit the weighted owner/personal limits and provide
a reachable compatible own port or powered personal module before rebinding;
the machine returns to that source. A landed body remains landed for pickup.
Global flight count and ID never increase. UI exposes recipient choice on real
parked/deployed rows; closed commands accept player index and UID only.

No tests/types/build/runtime until all functional source is implemented.
