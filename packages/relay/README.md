# @code3d/relay

Stateless HTTP/WebSocket forwarding for Code3D App and local agents, following
the caller-generated token and derived routing identity used by
[BackPage](https://github.com/vilicvane/backpage). The App owns agent grants,
decryption, request receipts and project operations. This service retains only
online connections, unfinished HTTP exchanges and bounded in-memory traffic
counters. Routing disappears on disconnect; spent daily traffic quota survives
reconnections until the next UTC day or process restart. It has no database,
session registration, offline queue or business snapshot.

For a public server, use the [Docker Compose deployment](../../deploy/relay/README.md).
It includes Caddy-managed HTTPS/WSS, a private relay backend, traffic budgets,
container resource limits and a repeatable deployment regression test.

From the repository root, with Node.js 24+:

```sh
npm install
npm run build:packages
PORT=3134 HOST=127.0.0.1 npm start --workspace @code3d/relay
```

Use `http://127.0.0.1:3134` as the App relay address for local development.
For a remote relay, terminate HTTPS/WSS at a reverse proxy and forward both
HTTP requests and WebSocket upgrades. Set its response deadline above 115 seconds
and body limit to at least 23 MiB. `GET /health` reports process availability.
No production deployment is performed by build or start.

The App generates a random 32-byte host token and a base64url SHA-256 session ID.
It opens `WS /sessions/<sessionId>/host` and sends `{type: "host", token}` in the
first frame. The relay verifies the hash before installing that route. A party
that only knows the session ID cannot replace its host. The token is never part
of a URL or log, and is separate from every agent's end-to-end content key.

CLI sends `POST /sessions/<sessionId>/agents/<agentId>/requests`. The body is
opaque ciphertext. The relay generates a transport ID and sends the host
`{type: "request", id, agentId, body}`. The host replies with
`{type: "response", id, status, body?}`. Authentication and revocation happen
inside the App. The relay never receives an agent content key.

Both connection roles expose the session ID in the same URL position. Run a
single relay process, or route both roles to the same process by that ID. Random
per-request load balancing cannot pair a request with another process's socket.
After a process restart, App reconnects recreate routes without storage recovery.

Limits bound frame/body sizes, connection count, buffered request bytes and
in-flight requests. Global, IP and session budgets also bound admitted byte
traffic, daily volume and request/message frequency; they inspect sizes, never
encrypted contents. Extra bytes introduced by the forwarding wrapper or escaping
also spend the upload's budget before forwarding. HTTP 429 includes `Retry-After`
when a traffic budget is exhausted. An over-budget WebSocket closes with code 1008, after returning 429
to its pending HTTP callers. Heartbeats remove dead sockets. Offline hosts return 503,
capacity returns 429, and an exchange exceeding 115 seconds returns 504. These
transport errors never mean a mutation was rolled back: its App endpoint may
still be running. CLI must query or retry the original application request ID.

Tests use real HTTP/WebSocket connections and cover multi-agent/project routing,
App-side authentication/revocation, host impersonation, relay restart/reconnect,
retained receipts, lost responses and transport limits.
