---
name: ITB modal scroll-jump / focus-loss fix
description: How the Invitation to Bid scope-row focus bug was diagnosed and fixed — stable _key strategy.
---

## Rule
Every scope row in the ITB modal must carry a `_key` string in its data.
Never use `field.id` (useFieldArray's internal ID) as a React key for scope rows.

## Why
`useFieldArray.replace()` / `reset()` regenerates internal field IDs. If those
IDs are the React keys, every row input unmounts and remounts on each replace call —
killing focus and jumping scroll to the top. Using a `_key` stored IN the row data
means React sees the same key across replace calls and skips the DOM remount.

## How to apply
- `withRowKeys()` normalizer (top of invitation-to-bid-modal.tsx): adds `_key` to
  rows that lack one before they enter useFieldArray.
- `stableRowKey()`: generates short random IDs for new rows.
- `appendScope()` calls and the CSV import path must inject `_key`.
- Draggable: `key={(field as any)._key ?? field.id}` (not `key={field.id}`).
- The seed effect is gated by `seededForOpenRef` — flips once per modal-open,
  preventing re-seed on background query refetches.

## Diagnostic overlay (leave in until confirmed clean in production)
Three layers: mount counter, ROWS REMOUNTED detector, SCROLL JUMP detector.
Remove after a clean production session (no SCROLL JUMP, mount# stable mid-edit).
