---
title: Using the App
description: Navigate between source expressions, model objects, and visual tools.
---

The App places the project files, text editor, and viewport beside one
another. An active TypeScript or JavaScript file is the execution root. Open a
source file to preview the models it produces; other text files open without
running a model.

You can keep editing while a model is building. The App cancels the older
revision and builds the latest one, reusing completed geometry calculations.
The operation currently running may need to finish first. If the old build
cannot stop within five seconds, the App restarts its model runtime; the next
build then starts with an empty geometry cache. Cancelled results never replace
the current preview.

The App keeps previous calculation results for later edits and undo, using a
default 2 GiB memory budget. It removes the least recently used historical
results when over budget and keeps the current model's complete working set.
This budget does not cap the total memory used by the browser tab.

## Arrange your workspace

Use **Hide file explorer** beside the open-file tabs to give the editor more
space; **Show file explorer** brings the project tree back. Click a folder to
expand or collapse it, then select a file to open it. Open files remain
available in the tabs while the explorer is hidden. You can close every tab,
including the last one, to clear the editor and preview. Closing a tab keeps
the file and its edits in the project; reopen it from the explorer.

The file explorer starts at 256px unless you have already saved a custom width.
Drag the file explorer's right edge to resize the tree, or the divider between
the editor and viewport to resize the code pane. The App remembers both widths
in this browser and fits them to the available window space. Resizing the tree
keeps the code width where space allows; hiding and showing the tree restores
its preferred width. The tree remains resizable in the stacked layout on
narrow screens.

You can also focus **Resize file explorer** or **Resize code editor** with
`Tab` and use `←` or `→`; hold `Shift` for larger steps, or use `Home` and `End`
for the minimum and maximum widths. Press `Esc` during a drag to cancel it.

## Manage project files

The explorer shows files of every type and empty directories. It skips
`.code3d`, `.git`, and `node_modules` directories at every depth; other dotfiles
remain visible. It does not apply `.gitignore`. Single-child directory chains
share a compact row, and large directories use a scrolling window of rows.

Use **New file** or **New folder** in the explorer header or right-click menu.
New entries go in the focused folder, or beside the focused file. Right-click
an entry for **Rename**, **Cut**, **Copy**, **Paste**, and **Delete**. Drag selected
entries onto a folder to move them. `Ctrl/Cmd` selects additional entries;
`Shift` selects a range. With the explorer focused, use `F2` to rename,
`Delete` to delete, and `Ctrl/Cmd+C`, `X`, or `V` for the project file clipboard.
Use **Search files** or `Ctrl/Cmd+F` to find paths; `Esc` leaves search or cancels
an inline rename. Arrow keys navigate the tree, and `Enter` or a double-click
puts the selected text file's editor in focus.

UTF-8 text files up to 8 MiB open in the editor. Markdown, JSON, CSS, HTML and
YAML have language highlighting; unknown text formats use plain text. Binary
files can be moved, copied and deleted, but do not open as text. Copies preserve
file bytes and empty folders. Pasting a copy beside an existing name generates
a name such as `part copy.ts`; moves reject occupied destinations.

Changes save to the project's current storage. Renaming or moving a folder
updates its open tabs and agent locations, but does not rewrite import paths.
If an operation fails, the explorer shows the error and reloads the actual
directory state. A batch may have completed some entries before a storage
failure. Unsaved text must be saved successfully before moving or deleting
entries. Use **Refresh files** to reread directory names after external changes;
open documents keep their current text. Unsaved new files remain visible in the
tree. **Reload folder** also reloads file contents after saving pending edits.

Deleting every file leaves an empty project. You can create a new file there;
refreshing does not restore files you deleted. Closing every tab also leaves
the editor empty, while preserving the project's files.

## Move through a model

When you load a file without a preview, the viewport shows **Select to preview**.
Place the cursor in a model or sketch expression to open it. The hint stays
dismissed after your first preview until you load another file. Moving outside
an expression keeps the last 3D preview. An empty sketch still opens its drawing
tools.

- Place the editor cursor in an expression to inspect its runtime object.
- Drag with the left mouse button to rotate freely using Arcball, including
  over the top and bottom of the model, with a short glide after release.
  Drag with the right button to pan; scroll or drag with the middle button
  to zoom. Scrolling over the viewport zooms around the mouse position.
  Zoom has no fixed distance limits.
- Click an axis endpoint in the upper-right coordinate indicator to view from
  +X, −X, +Y, −Y, +Z, or −Z. It uses the selected object's local frame, or the
  world frame when nothing is selected, and keeps your zoom distance. Click
  the facing endpoint again to flip to the other side. Positive directions
  have white X/Y/Z labels; negative directions are plain dots. Double-click
  anywhere on the indicator to restore the default angled view and fit the
  model. View changes animate smoothly; dragging or scrolling immediately
  takes over. The system's reduced-motion preference skips these animations.
  You can also focus an axis with Tab and press Enter or Space to select it;
  pressing Enter or Space on the indicator itself resets the view.
- Click geometry to select an occurrence or an available source context.
- Double-click the active object to navigate to its source.

The viewport may show surrounding parts dimmed when they help explain a
relation or operation. The active geometry remains the main context.

Use **Modeling / Render** beside the upper-left status to switch between
editing guides and a clean model view. **Render** hides helper elements,
outlines, and modeling panels while keeping model colors and authored
transparency. You can still rotate, pan, and zoom; PNG export follows this
mode. Switch back to **Modeling** to select geometry and use its tools.
This switch applies to the 3D viewport; sketch editing keeps its 2D tools.

During the session, each displayed model or collection remembers its view and
Modeling/Render mode. Returning to it restores your rotation, pan and zoom;
changing which member is emphasized keeps the collection's view. New models
are fitted to the viewport, and changes in zoom animate smoothly.

A `group()` result and its input collection keep separate views. On the first
visit to either one, an existing view of the other supplies its starting view,
with the focus adjusted for the group's origin. Once both have been viewed,
each remembers your subsequent changes independently. Ordinary dimension and
whitespace edits retain the view; reloading the page starts a new session.

### Inspect inputs and results

```ts
import {box} from '@code3d/core';

const blank = box(24, 6, 14);
const rounded = blank.fillet(1);

function centered(model: typeof blank) {
  return model.originCenter();
}
const result = centered(rounded);
```

In `blank.fillet(1)`, place the cursor on `blank` to inspect the input before
rounding, then on `fillet(1)` to inspect the operation's result. In
`centered(rounded)`, the `rounded` argument is also an inspectable input,
even though `centered` is an ordinary function without tool annotations.

The App follows evaluated model values, not a list of function names. Imported
aliases, namespace calls, and models in arrays or options objects can retain
their input contexts too. A failed call can still expose inputs that were
evaluated before it failed.

Inside `relate(part => ...)`, the parameter declaration and uses of `part`
show the related model alongside the other participants. Named elements and
topology references share that context. Each call in the relation chain shows
its own stage, before later offsets or rotations. The current pair's markers
distinguish the selected side from its counterpart and the dimmed surrounding
objects. See
[inspecting relation scope](../../guides/relations/#inspect-the-right-scope).

Inspection does not automatically add a parameter panel or a drag handle.
Panels use [parameter annotations](../../guides/model-tools/), while spatial
handles require an operation with supported positioning or rotation semantics.

## Use a contextual tool

Tools depend on the call or value under the editor cursor. A primitive can
offer dimension inputs; a fillet or chamfer can offer edge selection;
an offset can offer a position tool. Origin operations offer a pivot marker
and arrows, while `rotate` offers angle inputs and rotation rings. Try the
[origin and rotation guide](../../guides/origins-and-rotation/).

When a parameter has a unique editable source, the panel follows TypeScript
definitions to update it. Otherwise, an evaluated expression appears as
placeholder text in an empty numeric input. Typing a number replaces that
call's whole argument expression, even if you enter the displayed value.
This does not attempt to invert the expression or change its inputs.

Inputs select their contents on focus and apply valid changes after a short
typing pause. `Enter`, `Tab`, or leaving the input also commits the value.
You can fill an incomplete call such as `box()` in order with `Tab`; the next
argument becomes available as each earlier one is added.

Your own functions can offer the same dimension inputs. See
[adding tools to model functions](../../guides/model-tools/).

## Understand feedback

Compilation progress appears near the viewport. Source changes from tools
appear in a temporary code excerpt, making the resulting edit visible.

Modeling failures appear with an error message and, where source information
is available, an underline at the responsible call. Previously evaluated
contexts may remain usable, so you can inspect and correct the input that led
to a failed operation.

## Undo and formatting

Code and tool changes share the editor's source history. Use the usual Undo
and Redo shortcuts. `Shift+Alt+F` formats the current source.

With the editor focused, `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS) or `F1`
opens the command palette for editor actions.

During a viewport drag, `Esc` cancels the temporary preview without changing
source. It does not close the contextual tool panel or end topology selection.
The panel follows the editor cursor and closes when you leave its call.
Changes already committed to source stay in place; use Undo to revert them.

See [selecting topology](../../guides/topology/) for a complete tool workflow.

## Export a model or image

Right-click the viewport and choose **Export model…** for STEP, STL, or 3MF,
or **Export image…** for PNG. Model export follows the foreground source
context you are inspecting. See [exporting models](../../guides/exporting/)
for format, scale, and orientation settings.

## Work with a local agent

Use **Connect Agent** to name an agent and copy its private connection prompt.
The agent starts a session-managed local CLI service and operates on the open
project without restarting its conversation. See the [agent guide](../../guides/agents/)
for setup, source changes, observations, and connection recovery.
