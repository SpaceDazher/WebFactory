# Native server implementation boundary

Planning notes, 2026-10-17, updated with source interfaces on 2026-10-18. This document records required implementation seams;
it does not establish that a native server or relay is implemented or accepted.
The controlling product requirements remain SPEC §1 and the full status ledger.

## Reuse and dependencies

- Run the authoritative `Game` and stable saved player identity mapping in an
  independent Node process. The selected dedicated-server client wire sends
  authoritative snapshots/commands, separately from the existing browser
  `Session`/`NetSim` lockstep transport. Never represent the server as a phantom
  engineer at peer 0. Do not create a second simulation model or depend on an open renderer.
- Preserve mod data registration, scenario state and the existing
  `src/mods/script-node.ts` ScriptHost adapter; worker settling must still bracket
  simulation steps. Background operation must not silently disable scripts.
- The available Node binary reports product version 22.23.2. No Node WebRTC
  implementation is currently installed in the shared dependencies.
- A candidate transport is [werift](https://github.com/shinyoshiaki/werift-webrtc),
  which documents Node DataChannels. Consult its pinned version's
  [API compatibility](https://github.com/shinyoshiaki/werift-webrtc/blob/develop/docs/browser-api-compatibility.md)
  and [example](https://github.com/shinyoshiaki/werift-webrtc/blob/develop/examples/datachannel/offer.ts)
  rather than assuming complete browser API equivalence. In particular, closing
  a peer is asynchronous. This is an implementation option, not dependency approval
  or interoperability evidence. Isolate any native-server dependencies and lockfile
  inside the candidate; never install into the shared node_modules junction.

## Ownership and controller

- Keep the native controller's local session credential, server owner credential,
  guest invite and player reconnect credential distinct. Remote game commands must
  never call process/file management operations.
- Bind control only to loopback; validate Host and an exact served application
  Origin, credentials, body size and operation fields. Do not accept arbitrary
  URLs, command lines, filesystem paths or an Origin wildcard. Do not place owner
  secrets in invitations, renderer query strings or logs.
- Address worlds by validated IDs from a controller-owned registry, not paths
  supplied by a webpage. Verify resolved storage paths remain in that registry's
  directory. Protect persisted secrets for the current OS user.
- Store controller schema separately from save21. Execute mutations against a
  revision and cache the result by requestId; a retry cannot create another process,
  rotate twice or overwrite a newer world. Reject requestId reuse with a different
  body. Bound replay-cache size and lifetime.
- Model handoff explicitly: paused browser authority → serialized snapshot/hash
  → durable imported world → acquired exclusive ownership → acknowledged server
  readiness → owner joins as a client. A timeout alone cannot release a live
  server's ownership or resume a competing browser simulation.
- Separate transport authority from engineer index0. Existing browser hosting
  combines both roles; a headless collector must not create a phantom engineer,
  duplicate owner inventory, or claim the owner's input slot. Preserve the owner's
  stable character when they reconnect as a client, including index0 if applicable.
  Review every `me === 0`/host assumption in Session and NetSim: frame collection,
  system-command provenance and remote administration need explicit trusted roles,
  not a different public display name or an extra owner avatar.
- Stop only after a durable final save. Preserve the live world on save failure;
  signal the failure and allow retry. Crash recovery must inspect the ownership
  marker and confirmed process state, not simply assume a stale UI means death.

## Invitations, transport and delivery

- Persist the same 24-hour invitation through stop/start. Rotation revokes future
  admission using the old code/token without kicking already admitted players.
  Enforce the SPEC code alphabet, collision handling, token entropy, expiry,
  resolve throttling and heartbeat freshness on the service, not just in the UI.
- Enforce framing, assembled-message limits, deadlines and backpressure on both
  direct RTC and WebSocket relay. Drop malformed/oversized input before world
  decompression or command dispatch; validate claimed player/role on authority.
- Bundle the runtime, assets and tray/controller with an explicit Windows launch
  path. Closing the game window must leave the independent simulation running;
  tray Stop must still complete the save/ownership protocol. Missing runtime or
  transport dependencies must produce a recoverable explanation.
- A Docker/VPS service and endpoint configuration can be delivered locally, but
  public internet availability remains local-only until a real operator, reachable
  TLS endpoint and relay are configured. Never ship an invented working address.

## Deferred acceptance

After all functional SPEC workstreams are connected: execute clean Windows
launch/close/rejoin, hash-preserving handoff with scripts, repeated control requests,
save failure/crash recovery, late join/reconnect, direct/NAT/relay paths, guest
isolation, 16-player/24-hour load and invitation usability checks. Until observed,
these remain pending; static architecture and library examples are not acceptance.
