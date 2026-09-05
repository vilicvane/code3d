---
title: Using the App
description: Navigate between source expressions, model objects, and visual tools.
---

The App places the project files, TypeScript editor, and viewport beside one
another. The active file is the execution root. Open any source file to preview
the models it produces.

## Move through a model

- Place the editor cursor in an expression to inspect its runtime object.
- Drag the viewport to orbit; scroll to zoom.
- Click geometry to select an occurrence or an available source context.
- Double-click the active object to navigate to its source.

The viewport may show surrounding parts dimmed when they help explain a
relation or operation. The active geometry remains the main context.

## Use a contextual tool

Tools depend on the call or value under the editor cursor. A primitive can
offer dimension inputs; a fillet or chamfer can offer edge selection;
an offset can offer a position tool.

Editable parameters are traced through TypeScript definitions to their source.
When that chain does not identify an editable value, the panel can display the
expression but cannot promise to rewrite it. Edit the source directly in that
case.

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

Escape closes temporary tool context. Changes already committed to source stay
in place; use Undo to revert them.

See [selecting topology](../../guides/topology/) for a complete tool workflow.

## Export a model or image

Right-click the viewport and choose **Export model…** for STEP, STL, or 3MF,
or **Export image…** for PNG. Model export follows the foreground source
context you are inspecting. See [exporting models](../../guides/exporting/)
for format, scale, and orientation settings.
