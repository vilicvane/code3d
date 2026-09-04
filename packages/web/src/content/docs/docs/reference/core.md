---
title: Modeling API
description: A curated map of the public core modeling operations.
---

Import these functions from `@code3d/core`. The editor's TypeScript signatures
provide exact overloads and inferred model interfaces.

## Solid primitives

| Function                                    | Meaning                              |
| ------------------------------------------- | ------------------------------------ |
| `box(x, y, z)`                              | Box dimensions along X, Y, and Z     |
| `cylinder(radius, y)`                       | Cylinder with its axis along Y       |
| `sphere(radius)`                            | Sphere of the given radius           |
| `frustum(bottomRadius, topRadius, y)`       | Truncated cone                       |
| `regularPrism(radius, y, sides, rotation?)` | Regular polygonal prism              |
| `helicalThread(options)`                    | Helical solid from thread dimensions |

## Profiles and curves

Planar profiles lie in the local XZ plane with a +Y normal.

| Function                                   | Meaning                                      |
| ------------------------------------------ | -------------------------------------------- |
| `circle(radius)`                           | Circular face                                |
| `ellipse(xRadius, zRadius)`                | Elliptical face                              |
| `rectangle(x, z)`                          | Rectangular face                             |
| `regularPolygon(radius, sides, rotation?)` | Regular polygonal face                       |
| `point(x, y, z)` or `point([x, y, z])`     | Vertex model                                 |
| `line(x, y, z)` or `line(start, end)`      | Straight edge                                |
| `arc(start, middle, end)`                  | Arc through three points                     |
| `bezier(points)`                           | Bézier curve                                 |
| `spline(points)`                           | Interpolating spline                         |
| `loft(sections, options?)`                 | Solid through sections; optional curve spine |

Profiles and curves are model values that can be inspected and related to
other models.

## Composition and boolean operations

| Function               | Result                                        |
| ---------------------- | --------------------------------------------- |
| `group(models, name?)` | Composition that preserves its separate parts |
| `union(solids)`        | Fused solid                                   |
| `cut(stock, tools)`    | Stock with the tool volumes removed           |
| `intersect(solids)`    | Shared solid volume                           |

Relations are resolved at composition and geometry evaluation boundaries.

## Model operations

Available operations depend on the kind of geometry. TypeScript completion
shows which operations are supported by the value you hold.

- `.fillet(radius, edgeIds?)`: round selected edges, or all edges.
- `.chamfer(distance, edgeIds?)`: bevel selected edges, or all edges.
- `.paint(color)`: assign a model color.
- `.relate(self => constraint)`: return a value with relative placement.
- `.expose({name: element})`: publish a typed named-element interface.

## Anchors and relations

Solid primitives expose `center`, `top`, `bottom`, and `axis`. Profiles,
curves, and other geometry provide elements suited to their own shape.

Use `selfAnchor.on(targetAnchor)` to relate complete frames.
`.flip()` changes orientation, and `.offset(x, y, z)` adjusts the relation
in the target frame.

## Topology

- `.vertex(id)`, `.edge(id)`, `.surface(id)`: one point, line, or face anchor.
- `.vertices(ids?)`, `.edges(ids?)`, `.surfaces(ids?)`: arrays of anchors.

IDs are model-local. See [topology selection](../../guides/topology/) for
selection behavior and derived-model identity.

Numeric values use a consistent coordinate scale. UI unit labels are metadata;
they do not perform runtime unit conversion.
