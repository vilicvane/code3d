# @code3d/agent

Shared browser/Node protocol for Code3D App sessions and the `c3d` CLI. The App
executes requests; a relay transports authenticated ciphertext. This package
provides configuration, encryption, the HTTP client and an App-side endpoint.
It does not itself implement project storage, model evaluation or a relay server.

## Agent grants

The App calls `createAgentConfig({relay, sessionId, name})` for each agent and
hands the complete JSON configuration to that agent through a copied prompt:

```json
{
  "version": 1,
  "relay": "https://relay.example",
  "sessionId": "app-session-id",
  "agentId": "stable-agent-id",
  "name": "Modeling agent",
  "accessToken": "<32 random bytes as unpadded base64url>",
  "key": "<independent 32 random bytes as unpadded base64url>"
}
```

The agent saves this file wherever convenient. Each agent needs its own grant;
separate CLI invocations reuse it. `accessToken` authorizes relay routing, while
`key` encrypts content and **must never be registered with the relay**. Project
contents, cursor expressions, arguments and response artifacts are all encrypted.
Session IDs, agent IDs, request IDs, message sizes/timing and relay credentials
are visible to the relay. HTTPS is required except for loopback development.

The App must revoke routing and close the endpoint when ending a grant. Receipts
currently live in that endpoint's memory. After a reload or lost receipt journal,
issue fresh grants and keys; never reopen the old grant with an empty journal.
Closing an endpoint prevents further replies and requests; it does not roll back
work already accepted by the App handler.

## Wire contract

The client posts an encrypted JSON envelope to:

```text
POST <relay>/sessions/<sessionId>/agents/<agentId>/requests
Authorization: Bearer <accessToken>
Content-Type: application/json
```

The response body is another envelope. Both have
`{version: 1, requestId, nonce, ciphertext}`. Binary fields use unpadded base64url.
HKDF-SHA-256 derives separate AES-256-GCM keys for each agent and direction, with
the session ID as salt. A fresh random 96-bit nonce is generated per message;
the 128-bit tag authenticates protocol version, session, agent, direction and
request ID. Plaintext JSON is limited to 16 MiB, including encoded artifacts.

`AgentEndpoint.handle(envelope)` decrypts and validates a request, invokes its
handler and encrypts the result. Relay adapters must authenticate before routing
to this endpoint. Multiple endpoints share the App's project service; that service
owns version checks, batch preflight, serialization and persistence. The endpoint
alone does not supply transactional file writes or model observation semantics.

Supported requests:

| Operation | Fields      | Purpose                                           |
| --------- | ----------- | ------------------------------------------------- |
| `fs.list` | `path`      | List a project directory                          |
| `fs.read` | `path`      | Read file content and its version                 |
| `fs.stat` | `path`      | Inspect a project path                            |
| `apply`   | `input`     | Submit a file batch, cursor and requested outputs |
| `result`  | `requestId` | Query the original result without executing again |

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
  "render": true,
  "topology": true
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

The resolver runs in a disposable Web Worker with a one-second deadline and
cancellation. A slow regex fails preflight without blocking the editor. The
caller supplies the proposed source and must reject the file batch if this
check fails, then recheck versions after asynchronous preflight. This stage
provides the resolver; it does not yet connect App file commits or decorations.

Responses are `{ok: true, data, artifacts?}` or
`{ok: false, error: {code, message, details?}}`. Artifact fields are `name`,
`mimeType`, and `base64` (unpadded base64url). App responses must distinguish a
saved change from a later evaluation failure; transport success cannot do this.

## Retries and uncertain outcomes

Request IDs are scoped to an agent grant. Identical normalized requests with the
same ID join an in-progress execution or return the saved result. Different
content with the same ID returns `request_conflict`. Errors from the handler are
also retained, since work may have started before failure. Transport failures
never imply rollback, and the client does not automatically resubmit changes.

`result` returns the saved response, `result_pending`, or `result_unknown` in the
current grant. A missing result is not proof of non-execution after a grant was
replaced. Keep the original request ID to query or retry the identical request.

Receipts are never evicted while a grant accepts work. The default limit is 4096
requests and 64 MiB of serialized responses. Running requests reserve room for
a maximum-size response; new work returns `agent_busy` when reservations exhaust
capacity, or `session_capacity` when retained receipts exhaust it. Old results
and matching retries remain readable. Request fingerprints use SHA-256 so the
journal does not retain additional copies of full source submissions.

Run `npm test --workspace @code3d/agent` from the repository root. Tests include
real loopback HTTP exchanges, tampering, cross-agent isolation, concurrent retries
and recovering the result after a lost response.
