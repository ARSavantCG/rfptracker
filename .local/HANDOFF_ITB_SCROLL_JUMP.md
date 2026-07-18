# HANDOFF — ITB Modal Scroll-Jump / Focus-Loss Bug
**Closed:** 2026-07-18  
**Status:** RESOLVED, diagnostics stripped, law embedded in source

---

## Two-Trigger Post-Mortem

The bug required TWO independent fixes because it had TWO independent triggers.

### Trigger 1 — Re-seed on every background refetch
**What happened:** The seed `useEffect` that calls `form.reset()` + `replaceScope()` had
no guard. Every time TanStack Query refetched `freshRfp` or `existingInvitation` (window
focus, cache invalidation, background poll), the effect re-ran and called `replaceScope()`.
Each `replaceScope()` regenerated `useFieldArray`'s internal `field.id` values — which
were the React keys — remounting every row input and killing focus.

**Fix:** `seededForOpenRef` — a `useRef(false)` that flips to `true` on first seed and
resets to `false` on modal close. Background refetches hit the guard and return early.

### Trigger 2 — 100 ms setTimeout inside the seed
**What happened:** Even after Trigger 1 was fixed, a `setTimeout(() => replaceScope(...), 100)`
existed inside the seed block "to force update scope fields after form.reset()". This fired
~100 ms after modal open — AFTER the user had already clicked into a quantity field. The
delayed `replaceScope()` still regenerated field IDs and killed focus.

**Fix:** Removed the `setTimeout`. `form.reset(formValues)` with `formValues.scopeOfWork`
already containing the rows (via `withRowKeys()`) is sufficient. `replaceScope()` on the
same tick is redundant. Stable `_key` values in row data mean even a replaceScope call
wouldn't cause DOM remounts.

**The law** (line 657 of invitation-to-bid-modal.tsx):
> `// NOTE: a legacy setTimeout(() => replaceScope(...), 100) lived here...`
> `// Do not reintroduce it.`

---

## What Was Also Added (and stays)
- **`stableRowKey()` + `withRowKeys()`** — stable `_key` stored in row data.
  `Draggable` keyed on `_key`, not `field.id`. Even if `replaceScope` fires, React
  sees the same DOM key and skips the remount. Defence-in-depth.
- **`seededForOpenRef` gate** — single-seed guarantee per modal lifecycle.

---

## Diagnostic Layers (now stripped)
Three temporary layers were added during debugging and are now removed:
1. Module-level `itbModalMountCounter` + per-mount `mountId` state
2. `focusDiag` state + focus/scroll event listeners + `SCROLL JUMP` detector
3. `scopeIdsRef` + `ROWS REMOUNTED` effect

Verified clean: overlay `[data-testid="focus-diag"]` absent from DOM on a live session.
Quantity field `777` survived 4-second wait with no focus loss.

---

## Files Changed
- `client/src/components/invitation-to-bid-modal.tsx` — all fixes + diagnostics stripped
