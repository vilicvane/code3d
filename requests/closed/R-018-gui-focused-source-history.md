# R-018 GUI-focused source history

## Request

- Undo and redo source changes with standard keyboard shortcuts while focus is
  in the graphical interface.

## Behavior

- `Ctrl/Cmd+Z` invokes undo; `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` invoke redo.
- The command uses the active file's existing Monaco history. Tool edits,
  editor edits, and GUI-triggered history therefore remain one source history.
- Running a history command does not focus Monaco or otherwise move the current
  GUI focus.
- When Monaco or one of its internal inputs owns focus, its native keyboard
  handling remains unchanged.
- A source change dismisses any stale source-update popover.
