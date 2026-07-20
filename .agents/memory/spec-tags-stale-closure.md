---
name: SpecTagsEditor stale-closure fix
description: Two-layer fix for tag rows resetting when siblings are added/removed; applies to any repeater that receives its rows as a prop.
---

## The rule
Any React repeater component that receives `rows` as a prop and calls `onChange(rows.map/filter/concat)` MUST use the ref pattern for its mutation callbacks, or values will reset under rapid browser events.

## Two bugs, two fixes

### Bug 1 — Parent stale spread
`setFormData({ ...formData, specTags })` captures `formData` at closure time; a
rapid second update overwrites the first.
**Fix:** `setFormData(prev => ({ ...prev, specTags }))` — functional form always
reads the latest state.

### Bug 2 — SpecTagsEditor internal stale closure
`update/remove/add` inside SpecTagsEditor close over the `tags` prop from the last
render. When Playwright (or a fast human) fires kind→spec→value events before React
commits, subsequent callbacks see the old `tags` and undo earlier changes.

**Fix:** refs always hold the latest value, even inside callbacks from old renders:

```tsx
const tagsRef = useRef(tags);
tagsRef.current = tags;           // updated every render
const onChangeRef = useRef(onChange);
onChangeRef.current = onChange;

const update = useCallback((key, patch) =>
  onChangeRef.current(tagsRef.current.map(t => t._key === key ? {...t, ...patch} : t)), []);
const remove = useCallback((key) =>
  onChangeRef.current(tagsRef.current.filter(t => t._key !== key)), []);
const add = useCallback(() =>
  onChangeRef.current([...tagsRef.current, newEmptyRow()]), []);
```

## Testability
Add `data-testid={`${idPrefix}-spec-tag-{kind|spec|value|maxvalue|remove|row}-{idx}`}`
to every control. idx is array position (not `_key`) so Playwright can target by
ordinal. After removing row 0, the survivor reindexes to 0; tests must account for
this shift.

**Why:** Aria tree may only expose one combobox pair even when two rows are rendered —
testids bypass the accessibility tree entirely.

## Verified by Playwright
20-step test confirmed SNAP_D_VERDICT=FIXED: after removing row-0 (quantity/building_depth),
surviving row-1 (reindexed to 0) retained kind=match, spec=clear_height, value=40.
