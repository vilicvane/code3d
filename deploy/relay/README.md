# Self-hosted relay

This Compose project runs one Node.js relay behind Caddy. Caddy obtains and
renews HTTPS certificates and forwards HTTPS/WSS; Node enforces byte and request
budgets on both CLI uploads and App responses. The relay cannot decrypt model
contents. It retains live routes and bounded memory counters, with no database,
offline queue or stored project data.

## Start

Use a Linux server with Docker Engine and the Docker Compose plugin. The running
containers have a combined memory ceiling of 640 MiB; allow additional memory for
the OS and image builds (a 1 GiB server may need swap while building).

Point a DNS A record at the server; add AAAA only if IPv6 also reaches it. Allow
inbound TCP 80 and 443 in the firewall. The domain must reach this Caddy instance
for certificate validation. Direct DNS and Cloudflare proxied DNS are both
supported; for Cloudflare, first follow the certificate setup below.

From a checkout containing this deployment:

```sh
cd deploy/relay
cp .env.example .env
```

Set `RELAY_DOMAIN` to your hostname, without a scheme or path, and `ACME_EMAIL` to
your certificate contact address. Review `limits.json`, then start:

```sh
docker compose up -d --build --wait
docker compose logs --tail=100 gateway relay
curl --fail https://relay.example.com/health
```

Use `https://relay.example.com` as the App's Relay URL. Opening the App restores
its grants and registers its route. The CLI configuration comes from that App's
agent prompt. The Compose project publishes only Caddy's ports; port 3134 stays
on a private Docker network.

Certificates and Caddy configuration live in named volumes. Keep those volumes
when updating or recreating containers. `.env` is ignored by Git. The gateway
uses automatic HTTP-to-HTTPS redirection, and its 120-second response deadline
allows the relay's 115-second exchange deadline to report an explicit failure.

## Cloudflare proxied DNS

Cloudflare supplies the browser-facing certificate, but its connection to the
origin still needs HTTPS for [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/).
Use that mode and keep this Compose project's Caddy certificate automation.
Flexible mode leaves the origin connection unencrypted and conflicts with
Caddy's HTTP-to-HTTPS redirect.

For a reliable first start, set the relay record to **DNS only**, start Compose,
and confirm `https://relay.example.com/health` succeeds with a valid certificate.
Then select **Full (strict)** in Cloudflare and enable the record's **Proxied**
status. Keep TCP 80 open for ACME HTTP validation and allow
`/.well-known/acme-challenge/*` through without edge caching, redirects or
challenges. TLS-ALPN validation cannot pass through a terminating TLS proxy;
Caddy can use HTTP validation instead. Keep the certificate volumes for renewals.

The Caddy configuration trusts `CF-Connecting-IP` only from Cloudflare's published
IPv4/IPv6 ranges, preserving individual client quotas behind the proxy. Keep the
**Remove visitor IP headers** transform disabled, and do not select **Overwrite
Headers** for Pseudo IPv4: the relay needs the original IPv6 address to apply its
/64 budget. Avoid browser challenges on the relay hostname, since CLI requests
and App WebSocket upgrades cannot solve them.

The [Cloudflare range list](cloudflare.caddy) records its source URLs and check
date. When updating the deployment, compare it with both official lists, replace
changed ranges, then validate and reload:

```sh
docker compose exec gateway caddy validate --config /etc/caddy/Caddyfile
docker compose exec gateway caddy reload --config /etc/caddy/Caddyfile
```

The list is intentionally local; container startup does not fetch network
configuration. Local regression simulates a trusted upstream and tests TLS with
Caddy's internal CA; it does not verify public DNS, Cloudflare's edge or public
ACME issuance for your hostname.

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

## Proxy trust and resources

Caddy resolves the client IP from `CF-Connecting-IP` only when the immediate peer
is in the Cloudflare range list; all other connections use their socket address.
It ignores caller-supplied `X-Forwarded-For` and `X-Real-IP` for this decision,
then overwrites `X-Real-IP` before forwarding to Node. The Node service trusts
that header only because `RELAY_TRUST_PROXY=true` is combined with an unpublished,
private backend network. Do not publish port 3134, attach untrusted containers to
that network, or add another proxy without defining its trust boundary. Direct
Node deployments default to socket IPs and ignore caller-supplied proxy headers.

The relay runs as the image's non-root `node` user, with a read-only filesystem,
no Linux capabilities and a 512 MiB memory ceiling. Caddy has a 128 MiB ceiling;
both containers have PID limits and rotating local logs. The relay also bounds
body/frame size, socket count, in-flight requests and buffered request bytes.
These are bounded-resource protections, not a replacement for the server's
network firewall or provider-level flood protection.

## Update and verify

After checking out the desired revision in the repository, run:

```sh
cd deploy/relay
docker compose build --pull relay
docker compose pull gateway
docker compose up -d --wait
docker compose ps
curl --fail https://relay.example.com/health
```

Updates can interrupt in-flight transport. The App retains request receipts and
re-registers after relay restart; clients should query the original request ID
when a response was lost. Certificate volumes are reused. To stop the deployment
without removing them, use `docker compose down` (without `--volumes`).

For a local regression, with Node.js 24+, repository dependencies installed and
Docker available, run from the repository root:

```sh
npm run test:relay-docker
```

The test creates its own Compose project and loopback ports, builds the production
image, and asks Caddy to issue a localhost certificate through its internal CA.
Only the test child process trusts that CA. It verifies encrypted HTTPS/WSS
round-trips, large legal messages, direct and trusted proxy IP handling over
HTTPS/WSS, IPv6 /64 budgets, upload/response limits,
App receipt recovery after relay restart, backend isolation and certificate
reuse. Its containers, networks and certificate volumes are removed afterward;
ordinary workspace tests do not require Docker.
