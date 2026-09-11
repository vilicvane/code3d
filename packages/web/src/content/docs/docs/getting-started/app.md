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

The explorer shows files of every type and empty directories. Its default
excludes match VS Code in the browser: `.git`, `.svn`, `.hg`, `.DS_Store`,
`Thumbs.db`, and names ending in `.crswap` at every depth. `node_modules`,
`.code3d`, `.vscode`, and other dotfiles remain visible. It does not apply
`.gitignore` or workspace `files.exclude` settings. Installed package files and
Code3D workspace metadata open read-only.

Folder contents load when you expand them; opening a workspace does not walk
its entire directory tree. Search discovers names in unopened folders without
reading their contents. Single-child directory chains share a compact row once
loaded, and large directories use a scrolling window of rows. Folder paths and
file names remain complete; scroll horizontally to read names wider than the
sidebar. The search box and explorer toolbar stay in place.

Use **New file** or **New folder** in the explorer header or right-click menu.
New entries go in the focused folder, or beside the focused file. Header actions
use the nearest writable parent when focus is inside `node_modules` or another
read-only directory; the dialog shows the destination. Enter a relative path
such as `src/utils/model.ts` or `assets/icons` to create missing parent folders
automatically. Existing files and folders are never overwritten. Right-click
an entry for **Rename**, **Cut**, **Copy**, **Paste**, and **Delete**. Drag selected
entries onto a folder to move them. `Ctrl/Cmd` selects additional entries;
`Shift` selects a range. With the explorer focused, use `F2` to rename,
`Delete` to delete, and `Ctrl/Cmd+C`, `X`, or `V` for the project file clipboard.
Use the explorer's search box or `Ctrl/Cmd+F` to find paths; `Esc` leaves search or cancels
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
tools. Selecting an editable call that fails also opens the viewport and its
parameter panel, so you can correct the arguments without first producing a
valid model. Dimension-based primitives such as `box()` provide
[runtime defaults](../../reference/core/#runtime-defaults-while-editing) for a
preview while the editor continues to report missing required arguments.

- Place the editor cursor in an expression to inspect its runtime object.
- Drag with the left mouse button to rotate freely using Arcball, including
  over the top and bottom of the model, with a short glide after release.
  Drag with the right button to pan; scroll or drag with the middle button
  to zoom. Scrolling over the viewport zooms around the mouse position.
  Zoom has no fixed distance limits.
- Click an axis endpoint in the upper-right coordinate indicator to view from
  +X, −X, +Y, −Y, +Z, or −Z. It uses the displayed scene's coordinate frame and
  enters orthographic projection while
  keeping the scale at the center of the view. Rotating the camera restores
  perspective; panning, zooming and using modeling tools keep the orthographic
  view. Click
  the facing endpoint again to flip to the other side. Positive directions
  have white X/Y/Z labels; negative directions are plain dots. Double-click
  anywhere on the indicator to restore the default angled perspective view and fit the
  model. Rotation, zoom and the change between perspective and orthographic
  projection animate smoothly; dragging or scrolling immediately takes over.
  When rotation restores perspective, the lens transition continues while you drag. The system's reduced-motion preference skips these animations.
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
Modeling/Render mode. Returning to it restores your rotation, pan, zoom and
perspective or orthographic projection;
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

Place the cursor inside a `box(x, y, z)` argument to highlight one edge along
that dimension. An extrusion distance highlights an edge along the extrusion,
or a finite distance guide when there is no matching edge. Edge arguments to
`fillet` identify the original edges being rounded, and `originVertex`
identifies the chosen vertex in the model's adjusted coordinates.

The highlight follows the argument position: in `box(size, size, size)`, each
use of `size` refers to a different dimension. Moving between dimensions
preserves the view, and orbiting keeps the chosen edge stable. These guides
appear in **Modeling** mode and disappear in **Render** mode.

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
With the editor cursor inside a parameter, press `Tab` to focus its visible,
writable tool input and select its contents. This also works at the next
available argument in an incomplete call. Completion lists and snippet tab
stops keep their usual `Tab` behavior; selections and multiple cursors keep
editor indentation. If there is no writable input, `Tab` behaves normally.
You can fill an incomplete call such as `box()` in order with `Tab`; the next
argument becomes available as each earlier one is added.

Your own functions can offer the same dimension inputs. See
[adding tools to model functions](../../guides/model-tools/).

## Understand feedback

Compilation progress appears near the viewport. Project preparation, dependency
and resource downloads, model snapshots, exports, sketch solving, and build-cache
clearing have no fixed operation deadline. Slow work can finish; changing the
source or cancelling still supersedes the old model operation. Network and
worker failures are reported normally.

Source changes from tools appear in a temporary code excerpt, making the
resulting edit visible.

The grid legend at the bottom left shows the length of one small grid cell in
the current 3D or sketch view. It updates as you zoom; source updates and
diagnostics stack above it. Sketch wheel zoom has no fixed minimum or maximum.

The 3D grid and coordinate indicator use the displayed model or group's local
coordinates, or the common composition coordinates when previewing a collection
or relation. Highlighting or moving a member keeps this frame fixed; the member's
modeling handles still use their own reference frame. Perspective shows the XZ
grid; axis-aligned orthographic views show the corresponding XY, XZ, or YZ plane.

Each sketch remembers its own pan and zoom while the project is open. Switching
between visible sketches smoothly restores their views; scrolling, panning or
interacting with geometry takes over immediately. Entering a sketch from a 3D or
empty view shows it immediately, as does returning to 3D. Reduced-motion settings
disable the transitions.

When you switch model files, the current preview stays visible while the next
file compiles. Its controls pause until the new result replaces it. An empty
result or a compilation failure clears the previous file’s preview.

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

Position handles, including origin and relationship offsets, move in increments
of the current minor grid spacing. Each drag keeps its starting grid and reference
frame. Hold `Alt` to move freely and release it to resume snapping, even without
moving the pointer. This affects viewport position drags only: numeric inputs keep
their own adjustment steps, and rotation handles keep their angle steps.

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
for connection, following an agent, image history, and access management.
