# R-034 — Viewport axes and image export menu

Status: complete

## Feedback

Move the coordinate reference to the viewport's top-right corner, remove its
Local/World XYZ caption, and move image export into the viewport context menu
with a dialog for confirming export parameters.
Remove the gesture hint and move compilation progress to the top-left corner.
Keep that corner occupied with a subdued Ready indicator when work finishes.

## Resolution

- The coordinate reference occupies the top-right corner and retains its axis
  letters, camera-relative projection, and accessible coordinate-frame label.
- Right-clicking the canvas opens an `Export image…` menu item. Right-button
  panning does not open the menu. The menu supports keyboard invocation,
  dismissal, and positioning inside the window edges.
- Export opens a modal PNG dialog with width and height in pixels, Cancel, and
  Export PNG. Dimensions retain the existing 64–8192 integer bounds and are
  preserved when reopening the dialog.
- Rendering disables repeat submission and dismissal until it completes.
  Encoding errors remain in the dialog so the user can retry. Closing returns
  focus to the viewport; dialog keystrokes do not invoke editor/tool shortcuts.
- The former persistent Export button and floating export panel are removed.
- The static orbit/zoom/selection hint is removed. Compilation and preview
  progress share the top-left indicator, with space below for contextual tools
  and beside it for the top-right coordinate reference.
- The status stays visible: busy work uses a spinner, while the settled model
  shows `Ready` with a circled check or `Model error` with a circled cross.
  Both icons share a fixed size with optically balanced padding and label spacing.
  Speculative previews and cancellation restore
  the authored model's last outcome; unrelated project/tool errors do not
  overwrite compilation status. Detailed diagnostic placement is unchanged.

## Verification

- Host Chrome checks cover top-right placement, caption removal, right-click
  and right-drag behavior, edge positioning, outside-click dismissal, keyboard
  opening, Escape, and Cancel.
- Invalid dimensions prevent export. A real PNG download was verified as
  800 × 600 pixels with the expected filename. A simulated PNG encoding failure
  retained the dialog and allowed a successful retry.
- A pending export keeps Escape inside the dialog and prevents dismissal.
- Compilation status stays at the top left; the gesture hint is absent.
- Normal compilation settles at `Ready`; syntax and geometry failures settle
  at `Model error`, and fixing the source returns to `Ready`. Syntax error
  details remain in the editor, while related geometry diagnostics retain
  their existing viewport placement.
- App build and formatting checks pass.
