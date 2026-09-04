# R-030 Preserve development server for acceptance

## Request

- Open each Herdr development server in a compact pane below the active pane
  without moving user focus.
- Keep the development server and its pane available while the user inspects
  the result.

## Confirmed behavior

- The server pane opens below the active pane with `--ratio 0.85`, leaving
  about 85% of the height for the original pane and 15% for the server.
- Completing implementation, tests, commits, or queueing does not stop the
  development server or close its pane.
- Unless the user explicitly asks to stop it, the development server and its
  pane remain available until the requested change has been successfully
  merged into the main worktree.
- A server that fails or exits on its own is still removed from coordination
  state with `server-stopped`.

## Verification

- A Herdr layout trial retained focus in the original pane and produced a
  59-row original pane above a 10-row server pane.
