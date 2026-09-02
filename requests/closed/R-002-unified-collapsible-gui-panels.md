# R-002 Unified collapsible GUI panels

## Request

- Object catalog, object properties, and similar GUI panels should be collapsed
  by default so the model viewport remains visually dominant.
- A compact title or handle should show the panel name and its shortcut.
- Hovering the handle temporarily expands the panel.
- Clicking the handle or pressing its shortcut toggles a persistent expanded
  state.
- This should become a shared mechanism for small dialogs and tool panels, not
  separate behavior implemented by each panel.

## Preliminary state model

Use one reusable panel controller with three visible states:

```text
collapsed ── hover ──> peek
    │                   │
 click / shortcut       │ pointer leave
    ▼                   ▼
 pinned <────────── collapsed
```

- `collapsed`: only the compact title/shortcut handle is visible.
- `peek`: temporary expansion caused by hover; leaving the handle and panel
  returns it to `collapsed`.
- `pinned`: persistent expansion toggled by click or shortcut; hover state no
  longer controls visibility.

## Interaction rules

- Moving from the handle into the panel must not close it; use the combined
  handle-and-panel hover region or a short close grace period.
- Keyboard focus, pointer capture, text input, sliders, and gizmo/tool drags
  must keep a peeked panel open until the interaction finishes.
- Clicking or using the shortcut while pinned collapses the panel.
- On touch devices, where hover is unavailable, tapping the handle toggles the
  pinned state directly.
- Only one transient peek may need to be visible at a time, while multiple
  pinned panels may remain open if space permits.
- Panel visibility is UI state, not model state, and must never write into the
  model source file.
- The shared mechanism needs accessible focus behavior, `aria-expanded`, and a
  non-hover keyboard path.

## Architecture direction

- Introduce a reusable `PeekPanel` or `DockPanelController` rather than adding
  catalog-specific CSS and listeners.
- Separate panel state from panel content so the catalog, inspector, relation
  views, and future tool dialogs can reuse it.
- Let the layout layer coordinate placement, overlap, z-order, and which
  transient panel is currently peeking.
- Shortcut registration should be centralized so titles can display the actual
  assigned key and conflicts can be detected.

## Prototype decisions

- Shortcuts are `Alt+1` for Model Outline and `Alt+2` for Properties.
- Panel state resets each session; multiple panels may be pinned.
- `Escape` dismisses only a transient peek and does not unpin panels.

## Deferred decisions

- Whether opening one pinned panel should collapse another on narrow viewports.
- Whether shortcuts should become user-configurable.

## Resolution

Implemented as reusable dock panel infrastructure.
