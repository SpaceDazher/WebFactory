# Native server access settings — source checkpoint 19 Oct

One active world per process; defaults: 8 players (max16), invitation-only,
pauseWhenEmpty=true, no password, owner administrator. Owner-only loopback
control exposes revision-checked settings with closed schemas and redacted
password state. Passwords use salt + PBKDF2-SHA256 verifier310000 iterations;
a guest sends a one-use challenge HMAC, never the password.

A guest has a cryptographically random32-byte signing seed per origin/world,
stored separately from the rotating world reconnect credential. The seed never
crosses authentication. Auth includes Ed25519 public key + challenge signature;
the owner allowlists SHA256(publicKey). Node22 verifies with crypto.verify and
JWK OKP Ed25519. Possession and admission are checked before slot allocation;
raw legacy clientId/display name cannot reclaim a player or confer a role.
The existing world reconnect token or a pinned signing-key proof restores an
identity; whitelist admission still requires an approved public fingerprint.
Only owner control changes stable-player-ID game-admin grants.

LAN HTTP/WS remains supported. It is not encrypted LAN transport. Public relay
requires HTTPS/WSS; admin control remains loopback-only. The interim raw-key
HMAC approach and the resulting LAN-blocking client guard have been removed.
TweetNaCl.js1.0.3 and @noble/hashes2.0.1 are pinned unmodified upstream source
packages under src/vendor with original types, licences, source archive and
verified registry SRI/provenance. Shared node_modules was not changed. SHA/HMAC/
PBKDF2 are library primitives; browser signing is isolated from the Node bundle.
A disposable, bounded authworker keeps password derivation off the render
thread; the build embeds it in the same offline HTML. No scripts from downloaded
packages, builds, typechecks, cryptographic tests, server or browser were run.

The same Luna/max produced the settings source but exhausted its usage limit
before the requested public-key/LAN correction. No new agent/model was created;
the parent applied that correction and continues source review. This is not
accepted runtime behavior. Direct native WebRTC/P2P and a public operated service
remain functional/external gaps; see PLAN-NATIVE-RTC-1.17-20261019.md.
