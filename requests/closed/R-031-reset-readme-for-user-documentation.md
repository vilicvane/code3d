# R-031 Rebuild the user README

## Request

- Move the existing internal prototype documentation out of the project
  README without losing it.
- Rebuild the README from the beginning as a concise user-facing introduction.
- Use the existing `www` copy as source material, while keeping the README much
  simpler and suitable as an upstream reference for future website revisions.

## Confirmed behavior

- The former README content is preserved unchanged in `PROTOTYPE.md`.
- Keeping the prototype document at the repository root preserves its links
  to `PLAN.md` and `TOOLING.md`.
- The README introduces the product, its distinguishing principles, one
  representative model, local startup, prototype status, and licensing in a
  few dozen lines.
- Its central proposition is the continuity between code and direct
  manipulation: the viewport understands the objects and topology produced by
  source, and interactive changes return to that source rather than creating a
  second editing mode or hidden model state.
- Detailed capability, implementation, and roadmap material stays outside the
  README.

## Status

Implemented.

## Verification

- `PROTOTYPE.md` matches the pre-migration `README.md` byte for byte.
- The README example is adapted from the checked-in primitive example.
- The license statement does not link to a nonexistent repository file.
- `npx prettier --check README.md PROTOTYPE.md requests/closed/R-031-reset-readme-for-user-documentation.md`
