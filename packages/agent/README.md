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
  "version": 2,
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

IndexedDB version 3 migrates existing remote grants once: it retains session ID,
agent ID, key, names, colors, lastSeen and receipt keys, assigns local ports and
records the current App origin. Obsolete host tokens/relay addresses are removed.
Agents need to copy the updated configuration and start a local CLI service; no
remote fallback remains. Never reopen an existing grant with an empty journal.

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

Supported requests:

| Operation | Fields      | Purpose                                           |
| --------- | ----------- | ------------------------------------------------- |
| `context` | none        | Read the current App file and user selection      |
| `fs.list` | `path`      | List a project directory                          |
| `fs.read` | `path`      | Read file content and its version                 |
| `fs.stat` | `path`      | Inspect a project path                            |
| `apply`   | `input`     | Submit a file batch, cursor and requested outputs |
| `result`  | `requestId` | Query the original result without executing again |

`context` returns `{file, revision, cursor}` for the current user editor state.
The cursor is a one-capture regex and line range suitable for `apply`, or null
when the editor has no selection. Reading context neither moves the user/agent
cursor nor evaluates the model. Use `fs.read` on the returned file to obtain its
source and modification version; supply the returned cursor explicitly to
`apply` when adopting the user's target. Each new context invocation reads live
state; retrying an old request ID still returns its original receipt.

Copied initial and update prompts demonstrate this flow instead of embedding a
source selection. Both link to the [website agent guide](https://www.code3d.org/docs/guides/agents/)
for the command contract and public modeling APIs.

Project paths are absolute within the App project, such as `/model.ts`, and never
refer to the CLI machine's project files. `apply.input` accepts:

```json
{
  "files": [
    {
      "path": "/model.ts",
      "version": "opaque-current-version",
      "content": "complete replacement source"
    }
  ],
  "cursor": {
    "file": "/model.ts",
    "regex": "return ([^;]+);",
    "lines": [20, 40],
    "arguments": "[10, 5, 6]"
  },
  "render": {"view": "front"},
  "topology": true,
  "type": true
}
```

All top-level input fields are optional. A file's `version: null` requires absence
and creates it; `content: null` deletes an existing version. Rename is represented
as a delete/create batch with joint preflight; persistence failures must still
report any partial disk changes. No partial text patches or silent overwrites
are implied. The protocol checks the cursor payload shape; the App resolves it
against the post-change source. Arguments are a TypeScript array expression, not
JSON values; omission falls back to JSDoc arguments and then ordinary execution
context.

`render` accepts a boolean or `{view}`. Views are `isometric` (default), `front`,
`back`, `left`, `right`, `top`, `bottom`, or `{direction: [x, y, z], up?: [x, y, z]}`.
Direction points from the observed scene center toward the camera; front is +Z,
right is +X and top is +Y. Custom vectors must be finite and nonzero; an explicit
up vector cannot be parallel to the direction. Default up is +Y, or -Z/+Z for
top/bottom directions. Perspective capture automatically fits the scene bounds
for the output aspect ratio and does not change the user's camera. The response
reports normalized direction/up and `coordinates: "observation-scene"`.
Each requested view gets its own image, including renders of retained topology
snapshots; images from a different view are never reused.

`type: true` returns `observation.type` without requiring model execution.
It describes the smallest syntax node covering the captured selection, or the
node at an empty capture: sourceRef, static type, syntax kind, documentation,
call/construct signatures and up to 100 members (name, type, optional). The
`membersTotal` field makes truncation explicit. A cursor without type-bearing
syntax returns null. Selecting a call returns its result type; selecting the
function name returns its callable type. Temporary arguments do not alter
static source types. Combined geometry/type output, including snapshot pages,
uses the same source selection; runtime failures can still include static types.

Model execution and topology inspection have no 15-second deadline. Every
accepted project revision invalidates the old observation and terminates its
Worker, releasing the observation queue. User edits immediately cancel the
App's old compilation and schedule the latest source. Terminating the Worker
also interrupts synchronous loops during preparation or execution; completed
compilations retain the kernel cache for later edits. Superseded observations
preserve their accepted/saved file outcomes. Project preparation (120 seconds),
CAD export (30 seconds) and transport deadlines remain separate.

### App cursor preflight

The App's `inspectAgentCursor(source, cursor, signal?)` resolves exactly one
capturing group in exactly one full regex match. Empty captures are carets;
captures that did not participate in the match are errors. Noncapturing groups,
named captures and lookarounds use JavaScript regex semantics. Overlapping full
matches count toward ambiguity as well.

`lines: [first, last]` uses 1-based inclusive line numbers, excluding the final
line's terminator. The full match and captured selection must lie in that range.
The range filters positions in the original source, so anchors and lookarounds
retain full-file context. Flags default to `u`; optional `i`, `m`, `s`, `u` or `v`
are accepted, while search and capture-index flags are managed by the App.
Returned offsets use UTF-16 with exclusive ends, alongside 1-based Monaco
positions and the selected text.

The resolver runs in a disposable Web Worker with a one-second execution deadline
after it is ready, a separate ten-second loading deadline, and cancellation in
both phases. A slow regex fails preflight without blocking the editor. The
caller supplies the proposed source and must reject the file batch if this
check fails, then recheck versions after asynchronous preflight. The App project
service provides this validation and a shared queue for user saves and agent
batches, retaining accepted content when persistence fails.

Responses are `{ok: true, data, artifacts?}` or
`{ok: false, error: {code, message, details?}}`. Artifact fields are `name`,
`mimeType`, and `base64` (unpadded base64url). App responses must distinguish a
saved change from a later evaluation failure; transport success cannot do this.

A local transport failure after authenticating the request uses an encrypted
`{transportError: {code, message, delivery}}` response instead of an App result.
`delivery: "not_sent"` proves only that this attempt was not forwarded; it does
not describe earlier attempts with the same ID. Disconnection after forwarding
and exchange timeout use `"unknown"`. Unauthenticated HTTP failures or incomplete
responses cannot establish non-execution. The client exposes `AgentTransportError`
and the CLI adds recovery commands for its configuration file.

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

## App integration

The App's Agents panel issues, copies and revokes persistent grants. Closing or
switching away from a project disconnects its transport; reopening restores its
identity and journals without opening the panel. A Web Lock allows one tab per
project to serve agents; another tab reports that ownership instead of taking
over the connection. A directory without restored permission cannot expose the
browser fallback project under that directory's credentials. Cursor positions
and model snapshots are transient; select a new cursor after reopening. A failed save retains accepted drafts
and exposes Retry saving. Protected `.git` and `.code3d` paths cannot be modified.
Text apply/read is bounded at 8 MiB per file; binary files can be read as artifacts.

`AgentObserver` serializes offscreen requests through the existing model compiler,
viewport source selection and screenshot exporter. It does not change the user's
viewport or cursor. Collaborator selections are Monaco decorations with matching name labels anchored by content widgets. Screenshot
corner views and history remain deferred while viewport work proceeds separately.
See the [agent guide](../web/src/content/docs/docs/guides/agents.md#render-types-and-topology) for topology
paging, identity scope, geometry coordinates and snapshot expiration.
