# @code3d/cli

Command-line access to the project open in Code3D. The App owns files, versions,
saving, model execution, and receipts. Node.js 24+ is required.

```sh
npx --yes @code3d/cli /absolute/path/to/project.c3d.json serve
```

Run `serve` through the current agent session's managed process tool, keeping
stdin or a PTY open. It emits a JSON `listening` event and stays in the foreground.
EOF, closed stdin, SIGINT, SIGTERM, or SIGHUP closes the listener and releases its
port. The host must close the managed pipe/PTY or terminate the process when the
session ends; do not detach it, use `nohup`, or restart the agent conversation.

While it runs, send one complete JSON document through stdin for each invocation:

```sh
echo '{"operation":"context"}' | npx --yes @code3d/cli project.c3d.json
echo '{"operation":"fs.read","path":"/model.ts"}' | npx --yes @code3d/cli project.c3d.json
npx --yes @code3d/cli project.c3d.json --request-id edit-001 < change.json
echo '{"operation":"result","requestId":"edit-001"}' | npx --yes @code3d/cli project.c3d.json
```

For example, `change.json` contains the entire request:

```json
{
  "operation": "apply",
  "input": {
    "files": [
      {
        "path": "/model.ts",
        "version": "<read version>",
        "content": "<full source>"
      }
    ],
    "cursor": {"file": "/model.ts", "regex": "(box\\(10, 6, 8\\))"},
    "render": {"view": "front"},
    "topology": true,
    "type": true
  }
}
```

Multi-line JSON is supported; stdin EOF ends the request. The CLI and local
bridge pass the payload to the App without interpreting or normalizing operation
fields. The App owns schema validation. New App operations and parameters do not
require a CLI update while the connection and response envelope stay unchanged.
The current App accepts one operation, not a batch or JSON Lines stream.

Only execution options remain on the command line: `--request-id`, `--timeout`
and `--output-dir`. `serve` starts the session-managed connection service.
Operation subcommands and observation flags are not part of the CLI interface.

The App supplies a private config with `port`, `origin`, `sessionId`,
`agentId`, `name`, and `key`. Keep the page open and permit local-network access.
One process binds each grant's port on 127.0.0.1; multiple agents use separate
ports. Port conflicts are explicit. Revoke/Revoke all stops App retries and removes
authorizations; the local process remains owned by its agent host.

Operations emit JSON; artifacts are local files with paths in the result.
Transport errors distinguish a missing service from a disconnected App and an
unknown execution outcome, and include executable recovery instructions. Retain
a mutation ID before sending; query it after uncertain outcomes. A `not_sent`
delivery state concerns only the current attempt, not that ID's earlier history.
To execute a recovery lookup without a shell, use `recovery.queryArgv` together
with `recovery.queryStdin`, closing stdin after writing it; `queryCommand` includes
the equivalent POSIX-shell JSON pipe.

See the complete [website agent guide](https://www.code3d.org/docs/guides/agents/)
([Markdown](https://www.code3d.org/docs/guides/agents.md)) for setup, file operations,
cursor regex, arguments, rendering, topology, types, and recovery.

For Browser storage projects, edit the project's `package.json` through `apply`
and request `"render": true` or `"topology": true` with a model cursor in that package scope.
The App installs dependencies during model preparation; an ordinary file-save
response does not confirm installation. Local-folder dependencies are installed
externally with that project's package manager. There is no standalone CLI
install/update command. See [installing project dependencies](https://www.code3d.org/docs/guides/agents/#install-project-dependencies)
for the payload, version checks, lock behavior and failure handling.

When the user is following an agent, `apply` with file changes or an explicit view
or mode uses its retained cursor if none is supplied. It does not choose a position
from the changed files; no valid cursor means no follow jump. Pure observation
without file changes, a new cursor or an explicit view/mode does not trigger following.

`npx --yes @code3d/cli` downloads the published CLI when needed. Development can
use the same command with a built, globally linked checkout: run `npm link` in
`packages/cli`, then verify `npx --yes @code3d/cli --help` resolves that checkout.
Version `0.0.1-alpha.0` is the first functional release.
