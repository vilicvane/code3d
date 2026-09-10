# @code3d/agent

Shared browser/Node protocol for the Code3D App and local `c3d` CLI process.
The App executes requests and owns all project data and receipts. This package
provides configuration, encryption, the local HTTP client, reconnecting App
WebSocket transport and per-agent request endpoint. The Node bridge and CLI
adapter live in [@code3d/cli](../cli/README.md).

## Agent grants

The App calls `createAgentConfig({port, origin, sessionId, name})` for each agent
and hands the complete private configuration to it through a copied prompt:

```json
{
  "port": 54321,
  "origin": "https://www.code3d.org",
  "sessionId": "stable-project-session-id",
  "agentId": "stable-agent-id",
  "name": "Euler",
  "key": "<32 random bytes as unpadded base64url>"
}
```

Each agent has its own secret and local server port. Ports must be integers in
1024–65535; suggestions use 49152–65535. The server binds only `127.0.0.1` on that
exact port and never probes alternative ports. The App persists grants per
project, including port, color, connection history and receipts. Opening the
project restores connections without opening the panel. Changing a port keeps
the identity and journal, closes the old socket/retry, and generates an updated
prompt. Revoke deletes that grant/journal and stops retries; Revoke all does
so for every agent in the current project. Accepted changes continue saving.

Configuration and storage have one current format, with no configuration version
or migration path. The App stores grants and receipts in `code3d-agents`.
Never reopen an existing grant with an empty journal.

## Local authentication and lifecycle

`LocalHost` opens `ws://127.0.0.1:<port>/sessions/<sessionId>/agents/<agentId>/app`.
The Node service checks the exact Host, App Origin and path before upgrading.
Each side contributes a fresh random challenge. The bridge encrypts both with
its `bridge-proof` key, and the App responds with the same challenge pair using
its separate `app-proof` key. Both verify freshness before becoming ready.
Separate HKDF domains prevent reflection into either proof or request/response.
Neither the secret nor source content appears in URLs or plaintext frames.

The authenticated App connection accepts encrypted requests and sends encrypted
responses. Ephemeral transport IDs only correlate current HTTP responses; the
stable operation IDs and receipts belong to the App. A service restart loses
connections and pending waits, and the App reconnects using its original journal.
Handshake authentication does not mark an agent as having interacted; its first
valid operation does. The App retries with bounded exponential backoff until
revoked, ended or the project is closed/switched away.

Local HTTP operations reject any Origin header and require the exact loopback
Host and configured grant path. Ciphertext is authenticated before forwarding.
The local service has no project registration database, offline queue or receipt
cache. Resource bounds cover messages, sockets, uploading requests, buffered
bytes and pending responses; there are no public proxy or billing quotas.

## Wire contract

The client posts an encrypted JSON envelope to:

```text
POST http://127.0.0.1:<port>/sessions/<sessionId>/agents/<agentId>/requests
Content-Type: application/json
```

The response body is another envelope. Both have
`{version: 1, requestId, nonce, ciphertext}`. Binary fields use unpadded base64url.
HKDF-SHA-256 derives separate AES-256-GCM keys for each agent and direction, with
the session ID as salt. A fresh random 96-bit nonce is generated per message;
the 128-bit tag authenticates protocol version, session, agent, direction and
request ID. Plaintext JSON is limited to 16 MiB, including encoded artifacts.

`AgentEndpoint.handle(envelope)` decrypts and validates a request, invokes its
handler and encrypts the result. The App chooses the grant by agent ID and the
endpoint authenticates its ciphertext. The local service has exactly its configured grant.
Multiple endpoints share the App's project service; that service
owns version checks, batch preflight, serialization and persistence. The endpoint
alone does not supply transactional file writes or model observation semantics.

The CLI accepts one JSON request from stdin. `AgentClient.request(value)` encrypts
and sends that JSON value without interpreting operation names or fields. The
bridge likewise forwards authenticated content without an operation schema.
Validation and normalization run in the App's `AgentEndpoint`, so application
operations can evolve without requiring a new CLI build. Configuration,
encryption, receipt recovery and the generic response/artifact envelope are the
stable transport contract. Current App operations still accept one request at a
time; this does not introduce batch execution or JSON Lines.

## Use the client

Install `@code3d/agent` to use the same authenticated client as the CLI. Configuration comes from the App's copied prompt:

```ts
import {readFile} from 'node:fs/promises';
import {AgentClient, parseAgentConfig} from '@code3d/agent';

const config = parseAgentConfig(
  JSON.parse(await readFile('project.c3d.json', 'utf8')),
);
const client = await AgentClient.create(config);
const response = await client.request({operation: 'context'});
console.log(response);
```

The [local CLI service](../cli/README.md) must be running and connected to the
open App. For project work, follow the [agent Markdown entry](../../docs/agents.md):
[file operations](../../docs/agents/files.md), [cursor selection](../../docs/agents/cursor.md),
[observations](../../docs/agents/observation.md), and [recovery](../../docs/agents/recovery.md)
define the App's behavior. They are maintained separately from this transport SDK.

## Retries and uncertain outcomes

Request IDs are scoped to an agent grant. Identical normalized requests with the
same ID join an in-progress execution or return the saved result. Different
content with the same ID returns `request_conflict`. Errors from the handler are
also retained, since work may have started before failure. Transport failures
never imply rollback, and the client does not automatically resubmit changes.

`result` returns the saved response, `result_pending`, `result_interrupted`, or `result_unknown` in the
current grant. A missing result is not proof of non-execution after a grant was
replaced. Keep the original request ID to query or retry the identical request.

Receipts are never evicted while a grant accepts work. The default limit is 4096
requests and 64 MiB of serialized responses. Running requests reserve room for
a maximum-size response; new work returns `agent_busy` when reservations exhaust
capacity, or `session_capacity` when retained receipts exhaust it. Old results
and matching retries remain readable. Request fingerprints use SHA-256 so the
journal does not retain additional copies of full source submissions.

A `ReceiptJournal` records a request fingerprint before the handler can start,
then saves the completed response before replying. Failure to write the initial
record prevents execution. A record without a response after reopening returns
`result_interrupted` with an unknown outcome; matching retries cannot execute it
again. Failure to save the outcome returns `receipt_storage_failed` with the
observed response. Inspect current files before deciding on a new change.

Run `npm test --workspace @code3d/agent` from the repository root. Tests include
real loopback HTTP exchanges, tampering, cross-agent isolation, concurrent retries
and recovering the result after a lost response. The CLI tests additionally
exercise real session-managed CLI, WebSockets, restart/reconnect and App-side revocation. App browser
tests run the real CLI against both storage backends, render PNGs, page topology,
verify temporary/JSDoc arguments and check independent cursors.

## Source and integration

| Area                                              | Implementation                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Public API and configuration                      | [Exports](src/index.ts), [grant configuration](src/config.ts)                |
| Encryption and authenticated envelopes            | [Cipher](src/crypto.ts), [validation](src/validation.ts)                     |
| Node/browser HTTP client                          | [AgentClient](src/client.ts)                                                 |
| Reconnecting browser transport                    | [LocalHost](src/local-host.ts)                                               |
| App request validation and response types         | [Protocol](src/protocol.ts), [render options](src/render-options.ts)         |
| Request deduplication and receipt persistence     | [AgentEndpoint](src/endpoint.ts)                                             |
| Local service adapter                             | [CLI bridge](../cli/src/bridge.ts), [service lifecycle](../cli/src/serve.ts) |
| Project files, observations and persistent grants | [App agent integration](../app/src/agent/), [App README](../app/README.md)   |

Use the [tests](test/) for complete endpoint/journal integration examples,
including lost replies and reconnects. Keep the browser transport free of project
storage responsibilities: the App project service owns write preflight, saving,
compilation, and follow behavior.
