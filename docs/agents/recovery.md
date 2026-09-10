# Results and recovery

[Start here](../agents.md) · Read this whenever a request fails, a connection is lost, or acceptance, saving or execution is uncertain.

Each request emits one JSON result on stdout. The request ID is also written to
stderr before sending. Images and binary artifacts are written to new local files;
JSON returns their `path`, `name`, and `mimeType`. Open the image using the agent's
image-viewing tool. `--output-dir <directory>` chooses the parent artifact folder.
Exit codes are 0 for success, 1 for an App error, 2 for local input/startup errors,
and 3 for transport errors or output failure after an invocation.

| Failure                                          | What to do                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service_unavailable`                            | Run the supplied `recovery.command` with the current session's managed process tool, then retry with the original ID. No conversation restart is needed. |
| `app_disconnected`                               | The service is running. Keep the project open and allow local-network access; avoid repeatedly restarting a working service.                             |
| Timeout, connection lost, or incomplete response | Execution may have happened. Restore the connection and run `recovery.queryCommand` before another mutation.                                             |
| `port_in_use`                                    | Reuse the correct service or change the App port, copy updated configuration, and restart only the service.                                              |
| `version_conflict`                               | Read current files and prepare a new full-content change against their versions.                                                                         |

`error.details.delivery` describes **this attempt**: `not_sent` means it was not
connected/forwarded, while `unknown` means execution cannot be ruled out. Neither
value declares the historical state of an ID reused from an earlier attempt.
Transport errors include a structured recovery action and instructions. Prefer
`recovery.argv` when starting the service with a process tool. For receipt lookup,
pass `queryArgv` as the arguments and `queryStdin` as stdin, then close stdin.
Displayed `command` / `queryCommand` strings use POSIX-shell quoting; the latter
includes the JSON pipe. Recovery for a failed result lookup retains the ID being
looked up, rather than asking for a receipt of the lookup itself.

```sh
echo '{"operation":"result","requestId":"model-edit-001"}' | npx --yes @code3d/cli project.c3d.json
```

`result` queries the original request without rerunning it. Repeating identical
input with the same ID reuses its execution/receipt; different input with the
same ID returns `request_conflict`. Never generate a fresh mutation ID merely
because a response was lost. `result_pending`, `result_unknown`, or `result_interrupted` are not
proof a change failed. If the App closed before recording the final outcome,
inspect current files before preparing any new mutation.

Receipts survive reload and service restart. Each grant retains up to 4096 receipts
and 64 MiB of responses; capacity exhaustion rejects new requests instead of
forgetting IDs and reexecuting them. Revocation deletes that grant and its receipts;
it does not undo accepted changes. The CLI's default timeout is 120 seconds
(`--timeout <ms>` changes it); the local bridge exchange deadline is 115 seconds.
Query or retry the original ID when longer-running work completes.

## Related reading

See [connection](connection.md) to manage the service and [files](files.md) to prepare a corrected change against current versions.
