---
title: Using the App
description: Navigate between source expressions, model objects, and visual tools.
---

The App places the project files, TypeScript editor, and viewport beside one
another. The active file is the execution root. Open any source file to preview
the models it produces.

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
available in the tabs while the explorer is hidden.

Drag the divider between the editor and viewport to resize the code pane.
The App remembers your preferred width in this browser and fits it to the
available window space. You can also focus **Resize code editor** with `Tab`
and use `←` or `→`; hold `Shift` for larger steps, or use `Home` and `End` for
the minimum and maximum widths. Press `Esc` during a drag to cancel it.

## Move through a model

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
outlines, and modeling panels while keeping model colors and painted
transparency. You can still rotate, pan, and zoom; PNG export follows this
mode. Switch back to **Modeling** to select geometry and use its tools.
This switch applies to the 3D viewport; sketch editing keeps its 2D tools.

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
