# R-010 Metric fastener and hole-tool library

## Request

- Add a reusable metric screw library as ordinary TypeScript source inside the
  persistent project filesystem from R-009.
- Let authors construct a screw from a common preset such as `'M6'` or `'M8'`
  plus its length, or provide a complete custom specification.
- Model the screw as completely and accurately as practical for the prototype,
  including real thread geometry rather than a cosmetic cylinder.
- Provide matching hole/tool models intended for Boolean `cut`, including
  standard clearance choices and head accommodation.
- Fill missing general-purpose modeling capabilities exposed by this work, and
  refactor them into sound reusable abstractions rather than fastener-specific
  runtime branches.

## Product and API direction

- Fasteners are author-space modules built from public code3d modeling APIs.
  They are not hard-coded compiler syntax, hidden assets, or OpenCascade
  objects leaking through the public model API.
- Presets initially cover a useful common ISO 4762 socket-head cap screw range;
  the preset table is exported and editable. A custom spec uses the same shape
  as a resolved preset, so custom and standard screws follow one code path.
- Screw length is the nominal under-head length. Geometry should include the
  socket-head envelope, hex socket recess, under-head transition, shank,
  lead-in/chamfer, and ISO metric 60-degree external thread profile. Partial
  thread length follows the applicable standard rule where the selected length
  permits it.
- Hole tools are semantic model objects usable directly as Boolean cutters.
  They support ISO 273 close/normal/loose clearance diameters plus a custom
  diameter, depth/through extent, and socket-head counterbore where requested.
  Any allowance not fixed by a cited standard must be explicit rather than
  presented as standardized.
- Numeric units remain UI metadata only. The library documents that preset
  dimensions are millimetres but does not introduce a runtime unit type.
- Public construction remains semantically immutable at every step.

## Standards and technical research

- ISO 261:2024 defines the general-plan metric thread series and points to the
  ISO 68-1 basic profile, ISO 724 basic dimensions, and ISO 965-1 tolerances:
  <https://www.iso.org/standard/4165.html>.
- ISO 273:1979 remains the ISO reference for fine, medium, and coarse clearance
  hole series: <https://www.iso.org/standard/4183.html>.
- The ISO 273 table used for presets gives, for example, M6 clearances of
  6.4/6.6/7.0 mm and M8 clearances of 8.4/9.0/10.0 mm for close/normal/loose:
  <https://www.albanycountyfasteners.com/media/6b/b8/g0/1764944339/clearance-hole-chart.pdf?ts=1764944339>.
- ISO 4762 dimensional tables establish nominal pitch, maximum head diameter,
  head height, hex key size, socket depth, and standard thread-length rules.
  M6 is 1.0 mm pitch with a 10 x 6 mm head and 5 mm socket; M8 is 1.25 mm pitch
  with a 13 x 8 mm head and 6 mm socket:
  <https://buynutbolts.com/media/resources/BuyNutBolts_ISO4762_DIN912_SHCS_Datasheet_v2.pdf>.
- Replicad exposes OpenCascade helix and profile-sweep capabilities suitable
  for a reusable helical-sweep primitive. Its official helper library provides
  a useful implementation reference, but code3d should own the resulting API
  and geometry lifecycle:
  <https://replicad.xyz/docs/api/functions/makeHelix>,
  <https://github.com/sgenoud/replicad-threads>.

## Modeling foundation to establish

- A public, source-traced helical sweep (or a smaller coherent set of wire,
  profile, and sweep primitives) whose parameters and errors remain code3d
  concepts rather than raw kernel handles.
- General regular-polygon/prism and conical/chamfer construction as needed for
  the hex socket, lead-in, and head transitions.
- Robust Boolean composition and meshing for threaded solids, with no separate
  simplified render-only representation unless it is an explicit caller
  choice.
- Reusable axial placement conventions and anchors sufficient to assemble
  library geometry without reintroducing global author-facing placement APIs.

## Acceptance criteria

- At minimum M3, M4, M5, M6, M8, M10, and M12 presets are available with
  documented ISO 4762 dimensions and correct coarse pitch.
- Preset and custom screws compile from an imported VFS module and visibly
  produce socket-head, recessed, threaded solids at representative short and
  long lengths.
- Thread pitch and major diameter are dimensionally testable; invalid/impossible
  custom specifications produce a local modeling diagnostic rather than a
  corrupt shape or worker crash.
- Clearance cutters use the selected ISO 273 series. Counterbore/head recess
  geometry can cut a representative plate and leaves the expected result.
- Screw and hole models participate normally in naming, painting, relations,
  booleans, source selection, outline navigation, parameters, and GUI edits.
- The default project demonstrates at least one imported preset screw, one
  matching hole tool, and a Boolean-cut use without making the demo so heavy
  that ordinary editing becomes unusable.
- Build, focused geometry tests, and browser visual/interaction checks pass.

## Implementation checkpoints

- [ ] Confirm and test kernel helix/sweep behavior and choose the smallest
      general public modeling API.
- [ ] Implement/refactor the required modeling foundation and diagnostics.
- [ ] Add the editable preset/spec library and socket-head screw geometry.
- [ ] Add clearance/counterbore hole tools and representative composition.
- [ ] Verify dimensions, tracing, editability, performance, and browser output.
