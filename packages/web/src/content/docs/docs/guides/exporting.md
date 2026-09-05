---
title: Exporting models and images
description: Export the geometry you are inspecting as STEP, STL, or 3MF, or capture a PNG.
---

## Choose what to export

Move the editor cursor to the part or composition you want to export, and
check the viewport. Right-click the viewport and choose **Export model…**.
You can also focus the viewport and press `Shift+F10` to open its menu.

Export follows the **foreground model context**, not every object created by
the file. To export an assembly, inspect its `group(...)` expression. Dimmed
surrounding parts, selection highlights, axes, and tool guides are not included.
Relations are preserved as the parts' evaluated positions.

The dialog captures the current model context. If you edit or recompile the
model, close and reopen the dialog before exporting again.

## Choose a format

| Format | Output                                               | What it preserves                                          |
| ------ | ---------------------------------------------------- | ---------------------------------------------------------- |
| STEP   | CAD geometry, including solids, curves, and surfaces | Geometry, part names, colors, and placement                |
| STL    | Triangle mesh; solids only                           | Shape and placement, without names or colors               |
| 3MF    | Triangle meshes; solids only                         | Part names, colors, and relative placement in one assembly |

Choose STEP to carry the geometry into another CAD application. STL and 3MF
provide meshes for applications such as slicers. They do not carry the
TypeScript source, parameter tools, or the modeling history; keep your source
files as the editable project.

## Scale and orientation

**Millimeters per model unit** sets the output scale. Leave it at `1` if a
dimension of `40` in your code should become 40 mm. Use `10` if each model
unit represents a centimeter. This does not rewrite the source.

STEP and 3MF declare millimeter units. STL has no unit metadata; Code3D writes
its coordinates in millimeters, so choose millimeters in the receiving
application.

**Up axis** can keep **Y — as modeled** or rotate the output to
**Z — for printing**. Selecting STEP defaults to Y; selecting STL or 3MF
defaults to Z. This changes the output coordinates, not the viewport camera.

Always check dimensions and orientation after importing the file. Export
does not validate printability, clearances, or manufacturing suitability.

## Mesh settings

STL and 3MF expose linear and angular tolerances. Smaller tolerances make finer
meshes, with larger files and more work to export. Linear tolerance is in
millimeters **after output scaling**; angular tolerance is in degrees.
The initial settings are 0.1 mm and 10°.

For STL, choose binary or ASCII encoding. These settings do not affect STEP,
which exports CAD geometry rather than the viewport's display mesh.

## Export an image

Choose **Export image…** from the same menu to save a PNG of the current
viewport. Set its width and height in pixels; image export is separate from
model export and does not produce CAD geometry.
