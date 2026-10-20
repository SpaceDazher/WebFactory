# Official-provider source boundary (implementation before tests)

The current operator-token gateway is useful for a private single-host setup.
It cannot fulfil SPEC1.5 for a public game distribution: never embed an operator
host secret in game HTML or an installer. The user asked to propose the domain;
play.zavod7-game.net is proposed, not owned/registered/deployed. Keep defaults
empty until a real owned service is provided.

## Concrete source phase

1. One persistent per-installation Ed25519 Node host identity, stored outside
   world saves in the protected application-data directory. `serverId` is the
   hash of its public key; one stable random lease ID is stored alongside it.
   Validate bounded stored key data before use, exclusive creation, restrictive
   permissions and no private material in status/game/URLs/logs.
2. Explicit private-token and public-signed registration modes. Public gateway
   supplies a fresh one-use challenge; host signs a domain-separated payload
   binding the service HTTPS origin, challenge, serverId and leaseId. The public
   key must hash to serverId. No shared operator credential is required on a
   normal user's PC. Private mode remains an operator-controlled option.
3. Multi-host gateway maps bounded by active/pending host, room, guest, rate and
   byte capacities; one world/lease per host. Every register/release/data/close
   acts only on that verified host's lease. Lease-ID collisions or attempts to
   replace another identity are rejected. Physical tunnel replacement cleans
   only the old matching session. Public codes, stable backup routing, expiry,
   heartbeat and cleanup must not share one global host/lease variable anymore.
4. Bind guest admission/password proofs AND physical resume proofs to the
   expected serverId. Room resolution must report the verified host identity,
   not an untrusted register field. Browser validates the challenge against its
   expected world AND server identity before signing. This is necessary on a
   shared HTTPS origin: a malicious host can otherwise clone a public worldId
   and relay a victim server's challenge through its own room. The engineer's
   private key can remain world-scoped, so legitimate world transfer preserves
   identity; its signatures must have an explicit authority audience.
5. Native build uses an operator-supplied owned `ZAVOD_INVITE_ORIGIN` for both
   browser code entry and default host WSS registration. Default stays empty.
   Configurable private endpoints/token remain advanced overrides. Never use
   the proposed/unregistered name as an active default.
6. Public Compose/Caddy configuration enables signed enrolment and keeps the
   internal port private. Trusted-proxy address handling is explicit and only
   trusts a single controlled internal proxy hop; forged client forwarded
   headers do not control limits by default. Do not log room paths/credentials.

## Required evidence after all functional work

No tests/tsc/build/server/browser/Docker/Caddy execution in this phase.
After functional closure: private and public registration, restart/key reload,
wrong/replayed host proof, cross-host register/data/close/release, limits and
cleanup; cloned-worldId challenge forwarding; same-player reconnect through
RTC/WSS switches and host replacement; deployment/TLS/DNS and actual NAT,
CGNAT, blocked-UDP and load evidence. Source presence is not passing evidence.

Stop before purchasing domains/hosting, modifying real DNS or deploying without
the required account access and concrete authorization. Complete repository
source/configuration independently; do not invent a live official service.
