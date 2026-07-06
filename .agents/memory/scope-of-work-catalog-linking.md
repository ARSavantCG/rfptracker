---
name: Scope of Work to catalog linking pattern
description: How ITB Step 3 Scope of Work rows optionally link to the rom_scope_items master catalog, and how that carries through to Evaluation Budget imports.
---

Invitation to Bid (Step 3) Scope of Work rows are free-typed by default (description/quantity/unit only). They can optionally carry a `masterItemId` (FK to `rom_scope_items.id`) plus a `masterItemSnapshot` (description/unit/unitPrice at selection time) when picked from a catalog autocomplete, instead of typed manually.

**Why:** Old rows across the system predate these fields entirely, so both the Drizzle JSON type and the Zod insert schema must keep them fully optional/nullable — never assume presence. A read path (e.g. an import/carry-through endpoint) must treat `masterItemId == null` as "free-typed, pass through unpriced" rather than erroring, and must never write back to the source table (Evaluation import endpoints here are read-only against `invitation_to_bid`).

**How to apply:** When adding a new consumer of `scopeOfWork` (or any similarly-shaped historical JSON array), always re-resolve `masterItemId` links against the live catalog table for current pricing rather than trusting the stored snapshot, but keep the snapshot as a fallback/display value. Reuse the same client-side post-processing pipeline (tiered pricing / quantity auto-population / recalculation) that existing template-import features already use, rather than duplicating divergent logic, so imported line items behave identically regardless of source.
