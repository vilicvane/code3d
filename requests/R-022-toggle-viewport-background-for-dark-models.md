# R-022 Toggle viewport background for dark models

## Request

- Add a compact toggle to the model viewport for switching between dark and
  light background colors.
- The interaction may use a “turn the light on/off” visual metaphor.
- The purpose is to make dark-painted model objects easy to inspect without
  changing their source-defined colors or materials.
- This is a viewport presentation preference and must not modify model source
  or become persistent model state.

## Open decisions

- The toggle's exact icon, label, and placement in the viewport.
- The two background colors and whether the grid, fog, edge colors, or other
  viewport chrome should adapt with the selected background.
- Whether the preference persists per browser/workspace or resets each session.
