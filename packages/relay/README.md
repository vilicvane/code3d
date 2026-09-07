# @code3d/relay

Stateless HTTP/WebSocket forwarding for Code3D App and local agents, following
the caller-generated token and derived routing identity used by
[BackPage](https://github.com/vilicvane/backpage). The App owns agent grants,
decryption, request receipts and project operations. This service retains only
online connections and unfinished HTTP exchanges, all removed on disconnect.
It has no database, session registration, offline queue or business snapshot.

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
in-flight requests. Heartbeats remove dead sockets. Offline hosts return 503,
capacity returns 429, and an exchange exceeding 115 seconds returns 504. These
transport errors never mean a mutation was rolled back: its App endpoint may
still be running. CLI must query or retry the original application request ID.

Tests use real HTTP/WebSocket connections and cover multi-agent/project routing,
App-side authentication/revocation, host impersonation, relay restart/reconnect,
retained receipts, lost responses and transport limits.
