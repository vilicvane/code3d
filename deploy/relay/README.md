# Relay deployment

This Compose project runs one Node.js relay behind a remotely managed
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).
`cloudflared` opens outbound connections to Cloudflare; Cloudflare serves the
public HTTPS/WSS hostname and forwards requests to `http://relay:3134` on the
private Docker network. Neither container publishes a host port. There are no
origin certificates, certificate volumes or inbound 80/443 firewall rules to
maintain. App/CLI content remains end-to-end encrypted independently of Tunnel.

## Create and start

Use a server with Docker Engine and a current Docker Compose plugin, plus a
domain managed in your Cloudflare account. Compose must support
[environment-backed secrets](https://docs.docker.com/reference/compose-file/secrets/).
The deployment has been tested with Compose v5.5.1; Docker Swarm is not supported.

1. In Cloudflare, create a **remotely managed tunnel** using the cloudflared
   connector. Follow the
   [dashboard setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/).
   Copy only its tunnel token from the offered Docker command.
2. Add a published application route for your hostname, for example
   `relay.example.com`, with service **HTTP** and URL **relay:3134**. The hostname
   routes through the tunnel; it does not need an A/AAAA record pointing to the
   server. Remove a conflicting record for that hostname when prompted.
3. From this repository, prepare the private environment file:

   ```sh
   cd deploy/relay
   cp .env.example .env
   chmod 600 .env
   ```

   Set `TUNNEL_TOKEN` in `.env` with an editor. This deployment token is separate
   from the App's host token and each agent's content key. `.env` is ignored by
   Git. Compose creates `/run/secrets/tunnel_token` only in cloudflared; the token
   is absent from the image, command line and container environment. Docker
   administrators can still read the container's secret file.

4. Build and start:

   ```sh
   docker compose up -d --build --wait --wait-timeout 120
   docker compose ps
   curl --fail https://relay.example.com/health
   ```

   `cloudflared` is healthy only after at least one Tunnel connection is ready.
   Confirm the tunnel is healthy in Cloudflare too. Configure an App project to
   use `https://relay.example.com`, then verify a request with its copied agent
   prompt. A successful `/health` request does not by itself test an encrypted
   App/CLI exchange.

No new inbound firewall rule is needed for the relay. If the server restricts
outbound traffic, allow the
[Cloudflare Tunnel destinations on port 7844, UDP and TCP](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/),
and working DNS resolution. The default transport uses QUIC and can fall back to
HTTP/2. Cloudflared's edge network can reach the Internet; the relay is attached
only to an internal Docker network.

Keep **Remove visitor IP headers** disabled, and do not select **Overwrite
Headers** for Pseudo IPv4: the relay uses `CF-Connecting-IP` and needs the original
IPv6 address for its /64 budget. Enable **WebSockets** for the hostname's zone.
Do not put an interactive Access login or browser challenge in front of this
hostname: the CLI and App's WebSocket connection do not implement those flows.

## Traffic budgets

`limits.json` applies all three scopes together:

| Scope         | Sustained admitted traffic | Burst   | UTC daily traffic | Requests/messages per second | Request burst |
| ------------- | -------------------------- | ------- | ----------------- | ---------------------------- | ------------- |
| Whole process | 2 MiB/s                    | 128 MiB | 10 GiB            | 100                          | 200           |
| Client IP     | 512 KiB/s                  | 64 MiB  | 1 GiB             | 20                           | 60            |
| App session   | 512 KiB/s                  | 64 MiB  | 512 MiB           | 10                           | 30            |

The byte budgets count incoming application bytes: encrypted CLI request bodies
and App WebSocket messages, including invalid messages. Extra bytes added by the
relay's request wrapper, JSON escaping or UTF-8 replacement are also charged
before forwarding, so opaque malformed uploads cannot amplify unmetered output.
Request bodies and their responses both spend the same session/global quota;
each also spends its sender's
IP quota. HTTP requests, WebSocket upgrades, messages and control frames have
frequency budgets. `/health` is exempt for container health checks.

The admitted payload is normally forwarded once, so forwarded outgoing payload
is roughly the same volume, plus framing and protocol overhead. These budgets
are **not a strict hosting-provider bandwidth cap**: TLS/HTTP overhead, rejected
uploads and connection floods still cost network traffic. Use the provider's
network limits if the bill requires a hard ceiling.

Bursts permit complete source files and render results; this is admission
control, not a slow-download queue. The global budget limits abuse across many
IPs or newly generated sessions. Exhausting it temporarily affects every user.
IPv4-mapped addresses share IPv4 quota, and IPv6 addresses share their /64 quota.
Each of the IP/session maps is bounded by `maxSubjects` (4096 by default); spent
daily quota is never evicted to make room for another identity. If it is full,
existing subjects can continue within their budgets; new ones receive 429 until
unused entries can expire, or the UTC day changes.

Counters exist only in the relay process. Reconnecting or changing agent IDs
does not reset them; the next UTC day or a process restart does. Run one relay
replica: independently scaled processes would have independent quotas and would
not share live socket routes. Operators can edit the limits and restart the
relay to apply them:

```sh
docker compose restart relay
```

Over-budget HTTP requests receive 429 and `Retry-After`. An over-budget App
WebSocket closes with code 1008; pending HTTP exchanges receive 429 first. The
App reconnects automatically. A rejected response does not undo work already
accepted by the App. The CLI reports the original request ID and retry guidance;
it does not automatically resubmit mutations. Query or retry that same ID after
the indicated delay, instead of creating a new mutation.

## Tunnel trust and resources

With `RELAY_TRUST_CLOUDFLARED=true`, Node requires one valid `CF-Connecting-IP`
address for both HTTP and WebSocket requests. `X-Real-IP` and `X-Forwarded-For`
never select the quota. This is safe because cloudflared is the only production
service sharing the relay's unpublished, internal backend. Do not publish port
3134 or attach untrusted containers to that network. Direct Node development
runs default to socket IPs and ignore every caller-supplied proxy header.

The relay runs as the non-root `node` user with a read-only filesystem and a
512 MiB memory ceiling. The official cloudflared image runs as UID 65532 with a
128 MiB ceiling. Its filesystem must remain writable because Compose copies
its environment-backed secret into the container at creation; no host UID or
secret-file ownership setup is required. Both containers drop Linux
capabilities, disallow privilege escalation, bound process counts and rotate
local logs. No token is supplied as a command argument or logged. The relay also
bounds body/frame size, socket count, in-flight requests and buffered bytes.

Tunnel hides the origin's relay port; it does not replace the Node byte budgets
or promise unlimited bandwidth. Limits still apply to opaque encrypted requests
and responses, and do not depend on Cloudflare inspecting their contents.

## Update and verify

After checking out the desired revision in the repository, run:

```sh
cd deploy/relay
docker compose build --pull relay
docker compose pull cloudflared
docker compose up -d --wait --wait-timeout 120
docker compose ps
curl --fail https://relay.example.com/health
```

The cloudflared version is pinned in `compose.yaml`; update that tag explicitly
when adopting a newer release. Docker restarts the containers after a crash or
host reboot. Tunnel connections reconnect automatically; the health check shows
loss of connectivity but Docker does not restart solely because a container is
unhealthy. Use `docker compose logs --tail=100 cloudflared relay` to diagnose it.
The metrics/readiness endpoint is loopback-only inside cloudflared.

To rotate the Tunnel token, update it in Cloudflare and `.env`, then recreate the
connector so Compose copies the new secret:

```sh
docker compose up -d --force-recreate --wait --wait-timeout 120 cloudflared
```

Updates can interrupt in-flight transport. The App retains request receipts and
re-registers after relay restart; query the original request ID when a response
was lost. `docker compose down` stops the deployment; there is no relay database
or certificate volume to preserve. Keep `.env` protected for the next start.

For a local regression, with Node.js 24+, repository dependencies installed and
Docker available, run from the repository root:

```sh
npm run test:relay-docker
```

The test creates a disposable Compose project with no published ports, builds the
production relay image, and runs an internal client on its private backend. It
verifies encrypted HTTP/WS exchanges, 8 MiB source and result messages within the
512 MiB relay limit, upload/response budgets, visitor-IP handling, IPv6 /64 quotas
and App receipt recovery after relay restart. The real cloudflared image reads a
deliberately invalid token through the production secret path as its non-root
user, rejects it without logging it, and cannot report ready offline. Secret
isolation, container configuration and the absence of a token in the image are
also checked. Containers and networks are removed afterward; ordinary workspace
tests do not require Docker.

The internal client supplies the headers cloudflared would send. These tests do
not authenticate a Tunnel or verify Cloudflare's edge, public DNS, TLS or account
settings. The public health and App/CLI checks above complete deployment
validation once a real hostname and Tunnel token are configured.
