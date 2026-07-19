---
name: rom-routes.ts recurring fix patterns
description: Two bugs that reappear in every rom-routes.ts commit fetch; plus the line-items save payload shape.
---

## Rule 1 — (propertyDetails as any) casts
`propertyDetails.trailerParking` and `propertyDetails.electricalAllocation` always arrive untyped from the property JSON blob.
Every fetched version of `server/rom-routes.ts` needs:
```ts
trailerParking = (propertyDetails as any).trailerParking || 'N/A';
electricalAllocation = (propertyDetails as any).electricalAllocation || 'N/A';
```
`vehicularParking` on the same block already has the cast in the upstream source — only the other two are missing.

**Why:** The property schema does not declare these fields; they live in a free-form JSON column. The cast is intentional and matches the vehicularParking line directly above.

**How to apply:** After any rom-routes.ts file fetch, grep for `propertyDetails.trailerParking` and `propertyDetails.electricalAllocation` without `as any`; add the cast if missing.

## Rule 2 — Import trapped in JSDoc comment
The `import Templates from "./lib/rfp-templates"` line has appeared as line 2 inside the opening `/** … */` block comment, making it dead code (TS2304). After fetching, verify the import is OUTSIDE the comment block:
```ts
/** … */          // comment closes here
import Templates from "./lib/rfp-templates";   // must be HERE
import { … } from '…';
```

**Why:** Upstream source had the import accidentally inside the JSDoc on commit 1b23b60c. Future fetches may repeat this.

## Rule 3 — line-items save payload shape
`POST /api/rom-pilots/:id/line-items` requires a **wrapped** body:
```json
{ "lineItems": [ …array of items… ] }
```
Sending a raw array returns 200 but saves nothing (the handler destructures `const { lineItems } = req.body`).
