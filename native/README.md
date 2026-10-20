# Native server packaging

Current checkpoint (20 Oct 2026): the operator deployed the public gateway at
`https://zavod7-relay.onrender.com`. Local native/RTC/browser and a short public
16-socket run have passed after gateway fix ac05429 was deployed. Earlier intermittent attempts are retained in the evidence report.
Sustained public load and clean Windows installation are still unaccepted.
Older implementation-only statements below describe prior checkpoints; use
`../docs/RELEASE-ACCEPTANCE-20261020.md` for current evidence.

To bake this endpoint into the game and Windows component, use:

```powershell
$env:ZAVOD_INVITE_ORIGIN = 'https://zavod7-relay.onrender.com'
npm run native:build
```

No private credential is embedded; owner installation keys remain local.

The Windows package is built on Windows with Node `22.23.2` and the installed .NET Framework C# compiler:

```powershell
npm run native:build
```

This produces `dist/native/Zavod7-Server-Setup.exe`. The installer payload keeps the full `dist/...` tree, which it stages and swaps into `%LOCALAPPDATA%\Programs\Zavod7\dist`; the server's relative public-root, the tray paths, and the game/PWA asset paths all resolve from that layout. Upgrades first request a saved shutdown, wait for the old tray to release its single-instance lock, extract to a staging directory, then atomically swap the application tree. The installer registers `zavod7://server` and starts the tray process. The tray stores its credentials under the current user's LocalAppData and asks the authenticated controller for a fresh one-use browser link whenever it opens the panel. The server continues running if the tray or game tab exits.

The build bundles the Node executable already installed on the build machine; `ZAVOD_NODE_EXE` may select another installed executable, but the selected runtime must report exactly `v22.23.2`. `ZAVOD_NODE_LICENSE` can point to that runtime's `LICENSE.txt`, and `ZAVOD_CSC` can select an installed Framework compiler. The package builder bundles both the game server and the optional relay gateway, writes fixed ZIP timestamps, records runtime hashes, and rejects ZIP32 overflow. Its payload is an explicit list of build products, never a recursive copy of local data or credentials. The npm native scripts first prepare the isolated, locked `native/rtc-runtime` dependencies with lifecycle scripts disabled; they do not modify the shared development dependency junction or download Node.

## Docker

`Dockerfile.native` builds the game and server bundle in an isolated image layer. `compose.native.yaml` keeps the control plane bound to host loopback while publishing the gameplay port. Start it with:

```sh
docker compose -f compose.native.yaml up --build
```

Set `ZAVOD_ADVERTISE_HOST` in an operator-owned `.env` file to a hostname or IP players can reach. The server probes that address before showing its invite. With no configured address, the container does not advertise its internal Docker interface.

An optional `ZAVOD_PUBLIC_ORIGIN` (with `ZAVOD_RELAY_ORIGIN` retained as a legacy fallback) is an operator-managed HTTPS reverse proxy which forwards the game page, `/api/v1/world-info`, and the `/api/v1/play` WebSocket upgrade to gameplay port 17838. The server publishes that invite only after checking the active world/data manifest and completing a WebSocket upgrade probe. The setting is an origin only; it accepts no path, query, or embedded credentials.

## Room access settings

Each native server process runs one active world. New worlds default to eight players (up to sixteen), invitation access, and pausing when the last player disconnects. The authenticated owner control page can change the player limit, pause-when-empty policy, optional room password, admission-key allowlist, and in-game administrators. Password changes are stored as a random salt plus a PBKDF2-SHA-256 verifier (310,000 rounds); guests answer a fresh, single-use WebSocket challenge with an HMAC proof. The password itself is never included in an invite URL, status response, or server log.

Every guest browser profile gets a random 256-bit Ed25519 signing seed scoped to the current origin and world, stored separately from its rotating reconnect token. The join panel shows the SHA-256 fingerprint of its public key. Owners allowlist that fingerprint; the server stores the fingerprint. Guest authentication sends only the public key and a signature of the single-use world/generation challenge. The private seed never appears in the authentication message, URL, status or logs. A valid world-bound reconnect token can recover and rebind the saved identity, while whitelist mode still requires the public fingerprint to have been approved. Local LAN HTTP/WS remains supported; this is not encrypted LAN transport. Internet relay URLs require HTTPS/WSS, with TLS terminated by an operator-managed proxy. The controller remains restricted to loopback. Browser signing uses the pinned, unmodified TweetNaCl.js 1.0.3 source; SHA-256/HMAC/PBKDF2 fallback uses pinned @noble/hashes 2.0.1. Upstream licences/provenance are included, and no shared node_modules installation is required.

Administrator grants are tied to saved player IDs, never display names, and only the authenticated local owner can change them. Guests cannot set roles through gameplay messages. Existing world files migrate to invitation-only access, no password, the owner as administrator, and `pauseWhenEmpty=true`. Legacy client IDs are not accepted as proof of identity; in whitelist mode, existing guests must reconnect with their saved world token and an approved admission-key fingerprint.

## Self-hosted room-code relay

The optional relay gateway is a separate, self-hostable service. It does not run simulation code or store saves. Public mode verifies each installation's own Ed25519 key with a fresh challenge and keeps separate in-memory leases and bounded guest connections; private mode supports one operator-token host. The game server opens an outbound, certificate-verified WSS tunnel to the exact `ZAVOD_RELAY_URL` endpoint ending in `/v1/host`; guests connect through `/r/<10-character-code>/api/v1/play`. Resolving `/v1/rooms/<CODE>` returns a guest-only world invite capability, verified server ID, current data/mod fingerprint, room URL and expiry. The short code is therefore a bearer-equivalent guest credential: share it only with people allowed to join. Rotating the game invitation invalidates the prior room code. Admission, password and transport-resume proofs bind to the expected server ID as well as the world/generation.

To run the gateway with Docker Compose, configure `ZAVOD_RELAY_PUBLIC_ORIGIN` as the exact HTTPS origin that guests will visit, `ZAVOD_RELAY_HOST_TOKEN` as a random secret of at least 32 URL-safe characters, and `ZAVOD_RELAY_URL` as the exact WSS URL the game server will use. Start the optional service with `docker compose -f compose.native.yaml --profile relay up --build`. The gateway listens on container port 17900, published to host loopback by default; place an operator-managed TLS reverse proxy in front of it and forward HTTP room routes plus WebSocket upgrades for `/v1/host` and `/r/.../api/v1/play`. The game server connects to that WSS route; it never exposes the controller port through the relay. Do not place the host token in public browser configuration or logs.

On Windows, the packaged Node runtime can run `dist/native/relay-gateway.mjs` as a separate service with the same environment variables. The tray manages the dedicated game server only; gateway service supervision, TLS certificates, DNS, firewall rules and public deployment remain operator responsibilities. The gateway caps each raw play message at 5 MiB, leases at one hour or the invitation's earlier expiry, resolution to 40 requests per address per minute, and guests at 32 per room/64 total. Public mode allows up to 64 authenticated hosts; these are source bounds, not measured capacity. Signed installation identity persists in `relay-identity.json` under private application data and is not transferred with a world. Never publish or bundle it. Native play now has a bundled pure-JS werift RTC adapter and a bounded ordered logical stream shared with WSS fallback; direct RTC does not require the owner's browser. Path recovery retains the logical session, neutralizes held input while unavailable and requires a fresh signed physical resume. Actual transport, load, isolation and reconnect acceptance remains deferred. No live public gateway, TLS certificate or deployed service is supplied by this repository. See `relay-public/README.md` for the proposed public endpoint and separate public/private configuration.

The relay's host token authenticates the outbound server tunnel only; it is not a guest password or a substitute for the world access controls above.

The control port is not exposed beyond host loopback by the supplied Compose file. Keep it that way when configuring a public guest ingress; forward only gameplay HTTP/WebSocket traffic. World saves and credentials live in the persistent `zavod7-data` volume.
# Native RTC transport — implementation checkpoint, not acceptance

The standalone Node process now includes pinned pure-JS werift0.25.1 from
`native/rtc-runtime/package-lock.json`. Prepare this isolated dependency tree with
`npm ci --prefix native/rtc-runtime --ignore-scripts --no-audit --no-fund` before
packaging; do not install it into the shared development dependency junction.
The browser uses its own WebRTC implementation. No native add-on, media stream
or owner browser relay is involved.

Play uses a bounded ordered/acknowledged logical stream over WS and a reliable
RTC DataChannel. DataChannel fragments carry at most12KiB of UTF-8 bytes;
logical play messages are capped at2MiB. Large snapshots retain the existing
384KiB application chunks and128MiB aggregate cap. Physical WS reconnection
uses a fresh Ed25519 signature pinned by the original admission; owner resume
requires the existing join credential over loopback. It does not authenticate a
second player or reset the logical sequence. The in-memory reconnect grace is
25seconds, with an independent30second acknowledgement deadline.

`ZAVOD_RTC_ICE_URLS` accepts at most8 whitespace/comma-separated `stun:`/`stuns:`
URLs supplied by the operator. The default is empty (local candidates only).
No public STUN, official invitation service, TLS hostname or credentials are
invented. UDP/NAT restrictions leave the configured WS/WSS route available.
`/s/<leaseId>/api/v1/play` is a stable same-origin routing handle for admitted
sessions across invitation rotation; it is not a membership credential.

This source has not been built or run in the current implementation phase.
Seamless transitions, NAT/CGNAT/blocked-UDP, packaging, LAN authentication,
browser compatibility and load remain executable acceptance work after the
remaining functional SPEC work is finished.

