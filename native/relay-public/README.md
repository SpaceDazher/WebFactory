# Public invitation gateway

Current operator-deployed free endpoint: **https://zavod7-relay.onrender.com**.
HTTPS invitation landing, browser joins by full link/short code and a short 16-client HTTPS/WSS run passed after deployed gateway fix ac05429.
Earlier public load attempts failed intermittently; sustained 16-player
capacity is not accepted. See `../../docs/PUBLIC-RELAY-PROPOSAL-20261020.md`
and `../../docs/RELEASE-ACCEPTANCE-20261020.md` for current evidence.

The old `play.zavod7-game.net` name was a proposal only and is not used.
Render deployment uses the root `render.yaml`, Node, and the Free plan.

## Alternative operator-managed VPS

The source supports a public gateway with separate installation identities,
or a private single-host gateway. Use a VPS with a reachable public address,
Docker Compose and a domain owned by the operator. Simulation and saves stay
on each owner's PC; the VPS serves invitation pages and the fallback stream.
The VPS deployment below remains an alternative, not a requirement for Render.

After registering a suitable domain, point its A record (and AAAA only if
IPv6 is actually served) to the VPS. Copy `.env.example` to `.env`, enter the
owned hostname and operator email. Public mode is the supplied default and
needs no shared host token. Each native installation creates its own Ed25519
identity in its private application data, outside transferable world saves.
The gateway verifies a fresh signed challenge and binds all room operations
to that server identity. Guest admission and physical resume proofs include
the expected server ID to prevent cross-host challenge forwarding.
When the implementation phase and validation are finished, deployment uses:

```sh
docker compose --env-file .env up -d --build
```

The internal gateway port is not published. Caddy receives TCP80/443 and
manages HTTPS; certificates live in persistent volumes. The default log
formatter removes request URLs/headers and client addresses, because room
paths contain invitation codes. WebSocket proxying and five-minute
stream-close grace are configured. The trusted-proxy flag is safe only while
the internal gateway remains unexposed behind this controlled Caddy hop.

For a public game/installer build, set `ZAVOD_INVITE_ORIGIN` to the exact owned
HTTPS origin. This supplies short-code resolution and the native server's
default outbound WSS endpoint without embedding any operator secret. Advanced
per-server overrides are:

```text
ZAVOD_RELAY_URL=wss://YOUR_OWNED_DOMAIN/v1/host
ZAVOD_RELAY_PUBLIC_ORIGIN=https://YOUR_OWNED_DOMAIN
```

For an intentionally private single-host deployment, set registration mode to
`private`, generate a private 32–128 character URL-safe host token, and provide
`ZAVOD_RELAY_HOST_TOKEN` to both the gateway and that server through private
environment configuration. Never compile it into a public game or installer.

Do not replace these with the proposed name until ownership and DNS are
established. The proposal is not compiled as an active endpoint into the game.
The root page accepts a short room code; full invitations lead straight to
the relevant room. A code is usable only while its registered room is live.
After the owned endpoint is operational, set `ZAVOD_INVITE_ORIGIN` to its
exact HTTPS origin when building the game to enable short-code entry outside
the gateway page. The default stays empty; the proposed name is never fetched
automatically. This public build setting contains no host token or private key.

After the deferred Windows build and validation, copy the actual
`dist/native/Zavod7-Server-Setup.exe` into this directory's `downloads/` folder
and restart the relay. The landing page and room UI advertise the download
only when the configured file exists and passes basic size/PE-header gates.
A Linux image build does not produce that Windows executable. The installer
packages only an explicit list of build products, excluding private data.

Source quotas are 64 authenticated hosts, 32 pending host handshakes,
128 retained room leases, 64 physical guest sockets in total and 32 per room.
These bounds are not a measured capacity guarantee. Host data/control and
address/global request limits are separate. Each room/code has an expiry;
after expiry, stable routing accepts only signed resumes of already admitted
logical sessions. WebSocket heartbeat and the logical transport's bounded
recovery timers handle path loss. Registry/lease state is in memory; a gateway
restart creates new room codes while native player identities remain saved.

Native play can use ordered reliable WebRTC through the bundled werift
runtime and the browser implementation. WSS carries the same logical stream
when direct RTC is unavailable. Only explicitly configured STUN URLs are used;
the source does not invent an active third-party ICE service. Actual NAT,
CGNAT, blocked-UDP, restart, isolation and load behavior still need validation.

Source references (consulted while preparing this configuration):
[Caddy HTTPS](https://caddyserver.com/docs/automatic-https),
[WebSocket proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[log filters](https://caddyserver.com/docs/caddyfile/directives/log#filter),
[official Docker image tags](https://github.com/docker-library/official-images/blob/master/library/caddy).
Pinned Caddy image:2.11.7-alpine. This configuration has not been built,
validated by Caddy/Docker, deployed or checked over a public network yet.
