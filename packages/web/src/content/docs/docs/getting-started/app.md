---
title: Using the App
description: Navigate between source expressions, model objects, and visual tools.
---

The App places the project files, text editor, and viewport beside one
another. An active TypeScript or JavaScript file is the execution root. Open a
source file to preview the models it produces; other text files open without
running a model.

Model files support TypeScript namespaces, enums, and constructor parameter
properties. You can attach helpers to a function with a namespace of the same
name. A project's `tsconfig.json` can opt into stricter syntax checking.

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

Select a group to see its bounding box. In **Elements → References**, hover
**up**, **down**, **left**, **right**, **front** or **back** to show a matching
reference face. The box and faces follow the selected instance's local frame.

## Adjust model inputs

Open `/examples/inputs.ts`. Place the editor caret inside a Width or Height
`input(...)` call: **Inputs** expands and highlights the corresponding value.
Press Tab to focus and select that value. Tab / Shift+Tab then moves through the
form. You can also expand **Inputs** using its handle at the bottom of the viewport.

Drag a slider to see the box resize before releasing the mouse. Typing a valid
value updates it while the field stays focused. Sliders and numeric fields stay
in sync. Models declare the allowed range and control step with
`input('Width', 40, {min: 4, max: 100, step: 1})`;
a slider appears when both bounds are provided.
**Reset** restores both source defaults immediately. Empty or invalid text stays
in the field while the model keeps the last valid value; continue typing or reset.

Inputs are numeric parameters declared by the model. They do not rewrite code,
and their values last only for the current file session. Switching files or
reloading the App clears them. Focusing a field pauses animation; playback keeps
unfinished text and focus intact. See [numeric inputs](/docs/packages/core/runtime/#numeric-inputs)
for the authoring API.

For an articulated model, open `/examples/assemblies/robot-arm.ts`. Five sliders
control the base, shoulder, elbow, wrist and gripper opening. Drag a joint slider
to move the attached links and gripper together. The links use bored joints,
separate depth layers and limited travel to keep moving parts clear.

## Play an assembly animation

A model that reads `timeOffset()` displays playback controls below the
viewport. Select the complete assembly in the source, then choose **Play**.
**Pause** keeps the current pose; **Reset** returns to zero seconds and stays
paused. The time display shows the most recently completed frame.

Editing code pauses playback and re-evaluates at the last accepted time.
Changing files resets time to zero. Selecting another source expression or
hiding the page also pauses playback. Source files remain unchanged by playback.
Frame rate depends on model cost; slow frames skip elapsed time instead of
queuing older frames.

Try `/examples/constraints/animation.ts` in the file explorer. See
[time offset](/docs/packages/core/runtime/#time-offset) for the authoring
API and current scope.

## Performance settings

Open **Settings** in the top bar to adjust performance preferences for all
projects in this browser. Choose **Preview**, **Rendering**, or
**Cache** in the sidebar; on narrow screens, the categories appear across the top.
Switching categories keeps your unsaved edits. Enter values directly and choose
**Save** to apply all categories; **Cancel** discards edits. **Reset defaults**
asks for confirmation before filling every category with its initial values.
The defaults take effect after saving.
Use arrow keys, Home, or End while focusing the category navigation to switch
panels. If a field is invalid, saving opens its category and focuses that field.

| Setting                       | Default                           | Effect                                                                         |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| Edit delay (ms)               | 400                               | Wait after typing before updating the model.                                   |
| Completion preview delay (ms) | 200                               | Wait before previewing a focused completion candidate.                         |
| Resolution limit (DPR)        | Unlimited                         | Cap the viewport pixel ratio; leave empty for full display resolution.         |
| Geometry workers              | Hardware-based, up to 4 initially | Maximum parallel geometry queries; enter any positive whole number.            |
| Memory cache (GiB)            | 2                                 | Soft computation-cache budget; active models can exceed it.                    |
| Disk cache (GiB)              | 2                                 | Shared build, geometry and resource cache budget, including maintenance space. |
| Disk cache threshold (ms)     | 1                                 | Minimum computation time for new results to qualify for disk storage.          |

Cache budgets accept positive decimal values and have no App-imposed maximum.
The disk cache threshold accepts non-negative decimal values; 0 removes the time
threshold. It applies to new computations from the next model execution. Existing
cache entries and their eligibility are preserved, and faster results still use
the memory cache. It does not filter package downloads or compiled build artifacts.
More geometry workers can speed up independent queries while using more memory.
The resolution setting applies immediately to the viewport; image exports keep
their chosen dimensions. Delays apply to subsequent previews, computation
settings to the next model execution, and disk budgets to subsequent cache
transactions. Saving preferences also updates other open tabs on the same site.
The App does not estimate free disk space to choose or clamp your budget.

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

TypeScript and JavaScript highlight keywords, strings and numbers when a file
opens, including in pinned scope headers while scrolling. Unicode identifiers,
including Chinese variable names, use the normal identifier color. Unused
variables appear dimmed, and matching bracket pairs use distinct colors.

Changes save to the project's current storage. Renaming or moving a folder
updates its open tabs and agent locations, but does not rewrite import paths.
If an operation fails, the explorer shows the error and reloads the actual
directory state. A batch may have completed some entries before a storage
failure. Unsaved text must be saved successfully before moving or deleting
entries. Local folders automatically check opened files and source dependencies
for external changes while the page is visible and when you return to it.
**Refresh files** also rereads file contents and directory names. Unsaved text
is preserved. **Reload folder** reloads the workspace after saving pending edits.

Deleting every file leaves an empty project. You can create a new file there;
refreshing does not restore files you deleted. Closing every tab also leaves
the editor empty, while preserving the project's files.

## Move through a model

When you load a file without a preview, the viewport shows **Select to preview**.
Place the cursor in a model or sketch expression to open it. The hint stays
dismissed after your first preview until you load another file. Moving outside
an expression keeps the last 3D preview. A sketch expression opens its 2D
drawing tools, including for an empty sketch. Sketches that only appear in a
mixed inspection render as points and curves in 3D at their actual placement,
alongside any models. Selecting an editable call that fails also opens the
viewport and its parameter panel, so you can correct the arguments without
first producing a valid model. Dimension-based primitives such as `box()` provide
[runtime defaults](../../../../../../core/docs/api.md#runtime-defaults-while-editing) for a
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

In **Render**, use the **Render scene** menu in the viewport's upper-right corner to
choose **Studio** (the default neutral lighting), **Side light** (stronger
directional contrast), or **Soft light** (broad, soft lighting).
The choice updates lighting and environment reflections while keeping the same
dark background; image exports from the viewport use the same scene. Modeling
keeps its original lighting and background. Returning to Render restores your selection.

Render uses directional lighting, soft shadows, and ambient occlusion to make
side faces, recesses, and contact areas easier to distinguish while preserving
the authored materials. These effects also appear in exported PNGs. Transparent
parts keep their transparency and do not cast solid shadows. Ambient occlusion
uses the surfaces visible from the current view; it is an approximation, not a
path-traced render. Modeling keeps its existing lighting and edge guides.

The scene choice is saved in this browser and restored when you reload or reopen
the App. It applies across the models and projects you preview. Open the menu with
Enter, Space, or an arrow key; use Up/Down and Home/End to move through scenes,
Enter to select, and Escape to close. The current scene has a checkmark.
This selector provides built-in
presets; custom environment uploads and individual light controls are not available.
Materials with their own `envMap` retain that reflection map. Agent-requested
renders use Studio independently of this viewport selection.

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

In `blank.fillet(1)`, select `blank` to preview the input before rounding,
then select `fillet` to preview its result. Unannotated parameters first use a
function-level inspector when one exists, then preview the call's ordinary
return value. For example, selecting `rounded` inside `centered(rounded)` shows
the recentered result.

Public JSDoc inspectors can provide additional context for a parameter or call.
They return the complete scene as `target` and `ambient` values. Targets matching
the selected values receive focus; newly generated geometry does not inherit it.
The App keeps the previous scene until inspection finishes, and retains it if
inspection itself fails. See [source inspection](../../../../../../core/docs/runtime.md#source-inspection)
for authoring inspectors, including local helpers and published packages.

Inside `relate(part => ...)`, related values show only the actual participants.
`on` and `align` inspect their references and support geometry at the constraint
stage. Independent transformations inspect their own stage before later steps;
continuous constraints still solve together. Unrelated values keep ordinary
preview, and mixed collections retain all their members. Inner call inspectors
and results take precedence over the enclosing closure.
See [inspecting relation scope](../../../../../../core/docs/relations.mdx#inspect-the-right-scope).

Inspection does not automatically add a parameter panel or a drag handle.
Panels use [parameter annotations](../guides/model-tools.mdx), while spatial
handles require an operation with supported positioning or rotation semantics.

## Use a contextual tool

Place the cursor inside a `box(x, y, z)` argument to show a dimension with its
value and end ticks along one actual edge. An extrusion distance uses the same
annotation, with a finite distance guide when no matching edge exists. Edge arguments to
`fillet` identify the original edges being rounded, and `originVertex`
identifies the chosen vertex in the model's adjusted coordinates.

The highlight follows the argument position: in `box(size, size, size)`, each
use of `size` refers to a different dimension. Moving between dimensions
preserves the view, and orbiting keeps the chosen edge stable. These guides
appear in **Modeling** mode and disappear in **Render** mode.

Sketch and 3D views share the **Arguments** selector in the lower-right corner.
Hover over its handle to preview it, or click to pin it open and switch the
evaluated argument set of a function
with `@code3d.arguments`. The selector is hidden when the current context
has no candidate argument sets.

The viewport status names the work currently running: **Reading files**,
**Resolving imports**, **Loading dependencies**, **Compiling code**, and
**Building model**. Initial startup can also show **Loading compiler** or
**Starting modeling engine**. Hover a stage for an explanation. Cached work can
skip stages. While waiting for you to pause typing, no stage is shown.
**Preparing preview** covers display meshes and topology after model execution;
it appears only when that stage lasts longer than 200ms.

Unavailable tools are hidden or disabled without a separate status banner.
If a drag still fails when you release it, the preview is restored and a
dismissible error appears above the scale legend. Cancelling with **Escape**
does not report the drag error. Constraint editing, deletion, and source
write failures use the same error bar; a successful retry clears it.

Tools depend on the call or value under the editor cursor. A primitive can
offer dimension inputs; a fillet or chamfer can offer edge selection;
an offset can offer a position tool. Empty topology calls such as `vertex()`,
`edge()`, `surface()`, `originVertex()`, and `pivotVertex()` still show their
selection controls when the input model is available. Pick a candidate to fill
the missing argument; simply opening the tool leaves the source unchanged.
The missing-argument diagnostic remains until the call is corrected. An unfinished independent
`pivotVertex()` inside `relate` also keeps self and its completed placement prefix
available for vertex selection; finish the selector with `rotate(...)` to complete
the transformation.
Origin operations offer an origin marker
and arrows, while `rotate` offers angle inputs and rotation rings. Try the
[origin and rotation guide](../../../../../../core/docs/origins-and-rotation.mdx).
On an ordinary model expression, the toolbar offers **Origin Offset** and
**Rotate model**. Choosing a tool only moves the source focus. It reuses the
nearest matching call after the caret in the same method chain, then the
nearest one before it; the first drag adds the call if none exists. Origin
Offset normally drags the origin while leaving the shape in place. Hold Alt
to move its gizmo to the shape’s bounding-box center, then drag to move the
shape while the origin marker stays in place. Release Alt before dragging to
return the gizmo to the origin;
both gestures edit `originOffset(...)`. Shift uses the larger grid step in
either mode.

In a composition preview, selecting a member or subgroup positioned with
`relate()` shows translation arrows by default. The toolbar above the parameter
panel provides **Translate**, **Rotate about point**, and **Rotate about axis**;
the rotation button remembers its selected variant. Relation translation does
not change when Alt is held. Translate shows the part’s origin at the current placement;
pivot and axis markers belong to the corresponding rotation tool. Axis rotation
rings use orange for any selected axis; reference translation arrows keep XYZ colors.
Within `relate`, tools act on the current self. Selecting an `align` or `on`
relation highlights that relation's axes or faces. Selecting self, offset, or a
rotation keeps its own controls without markers from other jointly solved relations.

Switching tools alone leaves the source unchanged. Choosing a reference for a
different rotation tool appends a new rotation after the current operation; it
retains the existing rotation and its parameters. The editor follows the newly added operation and shows its panel. Blank space in a returned `relate` array, including an empty array, also opens tools for self.

The toolbar highlights the tool for the current source call. A manual tool choice stays active within that rotation chain, including its selector and angle fields; moving to another call selects its corresponding tool.

After a viewport tool edit, the status stays visible until the updated model is ready or reports an error. The Modeling / Render controls keep the same height when the status appears or disappears.

XYZ distance fields use the current minor grid spacing as their step, matching translation drags. Arrow keys add or subtract one step from the current value. Zooming updates the step while keeping the input you are editing. Source highlighting applies only within a parameter list; placing the cursor on a method name still opens its tool without highlighting an input.

A pivot or axis selector shows the full rotation panel immediately, including its reference, authored displacement, and angles. Before `rotate(...)` is written, the angle fields show zero defaults. Merely opening the panel leaves the source unchanged; editing an angle or picking a reference completes the rotation in a source edit that can be undone.

A pivot or axis selector and its final `rotate(...)` form one tool: moving the
cursor between them retains the same rotation controls and a panel containing
both reference and angle parameters. An unfinished `pivotVertex()`, `axisEdge()`, `pivotPoint()`, or `axisLine()`
still offers references on self. Picking a self vertex/straight edge writes `pivotVertex(id)`/`axisEdge(id)`, completes a missing `rotate` with zero
angles and activates its gizmo. Existing angles and `pivotOffset`/`axisOffset` are
preserved; selection and completion undo together. Coordinate `pivot` selectors
use the same point picker, including before their final rotation is written.
Point/axis candidates appear while the
corresponding rotation tool is active; selecting them does not require Alt. Click a vertex,
or straight edge of self to choose the reference, or drag an arrow
to move it while holding `Alt`. Alt switches between object rotation and
reference translation; releasing it retains candidates. A drag
keeps the operation it started with even if Alt is released before the pointer.
Gizmo handles take priority over nearby candidates; snapping stays enabled.

Moving a coordinate `pivot([x, y, z])` changes those coordinates directly.
Moving a referenced center (`pivotVertex`/`pivotPoint`) or axis (`axisEdge`/`axisLine`) adds `pivotOffset` or
`axisOffset`, retaining the reference; an existing offset is edited in place.
Dragging a ring
edits the nearest following `.rotate(...)` when self is selected, preserving its
pivot or axis. On a selected offset/rotate, the matching tool edits that call
and the other tool inserts its operation immediately after it.
A point marker shows that rotation’s pivot when the member is selected and
remains visible while dragging.
If none exists, it adds a rotation about that member's origin and local axes.
Translation likewise reuses the nearest following `offset(...)`, so alternating between
the tools does not keep appending calls. These tools remain available when
`.material(...)` follows `relate(...)`. Press `Escape` to cancel or use Undo after committing.
While dragging a translation arrow, rotation ring, sketch point, or circular
radius, a compact readout below the tool panel shows the current value and its
signed change since the drag began as `field: old + delta = new` (with a minus sign
when decreasing). Field names match the parameter panel labels, including JSDoc
`@code3d.param` labels. The readout has the same width as the tool panel. It also appears when there is no parameter
panel or the drag will add a new offset or rotation call. Values follow snapping
and the tool's coordinates; sketch values reflect the solved geometry. Releasing
or cancelling the drag hides the readout. After a tool edit is committed, the
existing spatial values with an accurate preview and valid source remain
editable from the committed pose while the model updates. New calls or arguments
wait for the replacement model before their handles become available.
Cancelling a drag or releasing it without a change leaves the handles available.

Constraints expose only `on` and `align`. All relative transformations are independent
array entries, including transforms after a group of jointly solved constraints.

When a parameter has a unique editable source, the panel follows TypeScript
definitions to update it. Otherwise, an evaluated expression appears as
placeholder text in an empty numeric input. Typing a number replaces that
call's whole argument expression, even if you enter the displayed value.
This does not attempt to invert the expression or change its inputs.

Inputs select their contents on focus and apply valid changes after a short
typing pause. `Enter`, `Tab`, or leaving the input also commits the value.
With the editor cursor inside a parameter, its tool control is highlighted.
This includes topology selection summaries such as edges, vertices, surfaces,
and the selection parameters of fillet, chamfer, and shell.
A writable text input also shows a small highlighted `Tab` hint inside its
right border. Press `Tab` to focus it and
select its contents. The highlight does not move focus or change your code;
it clears when the editor loses focus or you select text or use multiple cursors. This also works at the next
available argument in an incomplete call. Completion lists and snippet tab
stops keep their usual `Tab` behavior; selections and multiple cursors keep
editor indentation. If there is no writable input, `Tab` behaves normally.
You can fill an incomplete call such as `box()` in order with `Tab`; the next
argument becomes available as each earlier one is added.

Your own functions can offer the same dimension inputs. See
[adding tools to model functions](../guides/model-tools.mdx).

For multiple constraints, select self to move their joint result. The App edits
or inserts an independent `offset`/`rotate` in the returned array and adds its
Core import when needed. On an independent offset or rotation, switching tools
inserts a new array item immediately after it; it does not chain methods onto the
completed transformation. The tool stays within the current placement segment.
Editing a shared callback changes every runtime instance, including a `map` of
screws; their previews use each instance's own frame. [Try independent
transformations](../../../../../../core/docs/relations.mdx#transform-a-joint-result).

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

Model geometry does not fade with viewing distance. Zooming into large models
keeps their distant geometry within the camera range; only the perspective grid
fades into the background. This also applies to PNG exports.

The 3D grid and coordinate indicator use the displayed model or group's local
coordinates, or the common composition coordinates when previewing a collection
or relation. Highlighting or moving a member keeps this frame fixed; the member's
modeling handles still use their own reference frame. Perspective shows the XZ
grid; axis-aligned orthographic views show the corresponding XY, XZ, or YZ plane.

Each sketch remembers its 2D editing pan and zoom while the project is open. Switching
between sketches in the editing tool restores their views; scrolling, panning or
interacting with geometry takes over immediately. Entering a sketch from a 3D or
empty view shows it immediately, as does returning to 3D. Reduced-motion settings
disable the transitions.

When you switch model files, the current preview stays visible while the next
file compiles. Its controls pause until the new result replaces it. An empty
result or a compilation failure clears the previous file’s preview.

Modeling failures appear in the top status and, where source information
is available, as an editor diagnostic at the responsible call. Errors from an
entry remain visible when you navigate into a helper file, even if that helper
runs successfully on its own. Editing the project clears outdated diagnostics;
rerunning an entry replaces its previous results. Hover **Model error**
to read the details; click it to open and highlight the responsible source when
its location is available. Keyboard focus followed by Enter or Space works too.
The viewport
diagnostic card is reserved for sketch source data that differs from its
constraint solution, with a **Fix** action when safe synchronization is available. If the object or sketch
you are editing evaluated successfully, its preview and tools stay current even
when a later operation fails. For example, you can keep moving a loft section
after the loft fails, then drag it back to a position that produces a valid result.
Selecting a section inside a `loft` call shows all sections in their composition
positions, with the current section emphasized. A successful loft also shows its
completed shape as translucent context. If the loft fails, the sections remain
visible and editable so you can adjust its inputs.
Selecting an input inside `intersect()` shows ambient inputs and the shared
volume as the target. If the inputs do not overlap or only touch, a diagnostic
explains that there is no common solid volume; inspecting the input still shows
the operands for adjustment. An inner call such as `sphere(8)` in
`intersect([sphere(8), box(12, 12, 12)])` previews its own result or inspector.

For `extrude([a, b], distance)`, inspecting the input shows target faces and
ambient results. Selecting one face focuses it; selecting the array focuses all
faces. The shared distance field updates every extrusion, and inspecting that
argument shows target results with a dimension on each and ambient input faces.
After an extrusion fails, select its input argument to inspect the faces.
The failed call's distance field remains editable so you can correct it or Undo.
If the current target itself fails or the file cannot be evaluated, its previous
preview remains visible and its stale tools pause until a new result is available.

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
frame, with snapping always enabled. XYZ distance inputs use the current minor
grid step and accept exact values; rotation inputs and handles keep their angle steps.

Both panels open on hover and pin open on click. Press Escape to close a
temporary hover panel. The Elements panel fits its current contents. Longer lists scroll within the
panel while the heading and category tabs stay visible.

See [selecting topology](../../../../../../core/docs/topology.md) for a complete tool workflow.

## Export a model or image

Right-click the viewport and choose **Export model…** for STEP, STL, or 3MF,
or **Export image…** for PNG. Model export follows the foreground source
context you are inspecting. See [exporting models](../guides/exporting.md)
for format, scale, and orientation settings.

## Work with a local agent

Use **Connect Agent** to name an agent and copy its private connection prompt.
The agent starts a session-managed local CLI service and operates on the open
project without restarting its conversation. See the [agent guide](../guides/agents.mdx)
for connection, following an agent, image history, and access management.
