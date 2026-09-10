# Connection and request transport

[Start here](../agents.md) · Read this when starting or restarting the local service, changing its configuration, or choosing CLI execution options.

## Send JSON requests

Invoke `c3d <config-file>` with one complete JSON document on stdin. The CLI reads
until EOF, sends that value unchanged to the App, writes one JSON result and exits.
Multi-line JSON is supported. The App defines and validates operations and their
fields; additions to that schema do not require a CLI update while the transport
and response envelope remain unchanged. The current App accepts one operation per
request; arrays, batches and JSON Lines are not currently supported.

Use a pipe for a small request, or redirect a local request file for source changes:

```sh
npx --yes @code3d/cli project.c3d.json --request-id edit-001 < /tmp/request.json
```

The JSON contains the operation and all its parameters. The CLI's execution
options are `--request-id`, `--timeout` and `--output-dir`; `serve` manages the local
connection. Operation names and observation settings are JSON fields, not CLI
subcommands or flags. Running without redirected stdin in a terminal reports how
to supply a request instead of entering an interactive session.

## Service lifecycle

Run `serve` in the foreground through the agent host's managed process tool,
retaining its process handle and keeping stdin or a PTY open. It prints a JSON
`listening` event, then waits. Invoke other CLI commands separately while it runs.
Do not use `nohup`, a detached process, a system daemon, or plain shell `&`.

Closing the owning stdin/PTY or sending SIGINT, SIGTERM, or SIGHUP closes the
listener and releases the port. `serve` does not interpret terminal input.
A host that closes stdin immediately will also stop the service immediately.
The host must close its managed pipe/PTY or terminate the process when the agent
session ends: a CLI cannot detect the end of an abstract chat conversation when
its host leaves the process and handles alive. Use the host's documented session
cleanup mechanism; do not claim a detached process has this lifecycle.

Reuse an existing service with the same configuration. After changing the port
or configuration, stop only that service process and start it again with the
updated file. The current agent conversation continues.

## Configuration and access

The JSON contains `port`, `origin`, `sessionId`, `agentId`, `name`, and
`key`. Keep it private and outside committed source; use a file readable only by
your account. Keep source code and secrets in private files or stdin rather than external process arguments. The service binds only to `127.0.0.1`, checks the App's exact Origin,
and authenticates and encrypts traffic using the per-agent key.

The App suggests a port from 49152–65535; it is not reserved until `serve` starts.
Both the creation form and an existing agent row accept ports 1024–65535. If the
port is occupied or reserved by the OS, the service reports `port_in_use` without
silently changing it. Reuse the correct existing service, or choose another port
in the App and copy its updated prompt. Browsers and agents must share reachable
loopback networking; WSL, containers, or SSH sessions may need port forwarding.

App reloads and service restarts preserve agent identities, keys, and request
receipts. **Revoke** removes one agent's authorization; **Revoke all** removes all
agents for that project. These actions stop webpage retries, but do not own or
kill the local processes. Opening the project again restores remaining grants.

## Related reading

[Recovery](recovery.md) explains transport failures and result lookup. [Project files](files.md) defines App operations.
