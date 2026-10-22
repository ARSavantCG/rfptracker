/**
 * One-time merge (Adolfo 2026-10-22): separate SF-tier catalog items that share an
 * Item Group ("Office ≤3,000", "Office 3,001–5,000", "Office 5,001+") become ONE
 * item with pricing by quantity (rom_scope_items.price_tiers; math in
 * shared/line-total.ts).
 *
 *  - The lowest tier's row becomes the merged item (renamed to the group name),
 *    carrying every tier as a range at its current price.
 *  - The other tier rows are retired (is_active = false), never deleted: saved
 *    ROMs and evaluations that used them keep their prices and stay editable.
 *  - Templates pointing at a retired tier are repointed to the merged item.
 *  - Families that pick variants by property specs (match tags) are left alone.
 *
 * Idempotent: once merged, no group qualifies again. Runs at startup once,
 * recorded in app_settings.
 */
import { sql, eq } from 'drizzle-orm';
import { db } from '../db';
import { romScopeItems } from '@shared/schema';
import Templates from './rfp-templates';

const FLAG = 'price_tiers_merged_v1';

export async function mergeTierGroups(opts: { dryRun?: boolean } = {}) {
  const all = await db.select().from(romScopeItems);
  const active = all.filter((i: any) => i.isActive !== false);
  const groups = new Map<string, any[]>();
  for (const i of active as any[]) {
    const g = String(i.itemGroup || '').trim();
    if (!g) continue;
    if (i.minSquareFootage == null && i.maxSquareFootage == null) continue;
    const k = g.toLowerCase();
    groups.set(k, [...(groups.get(k) || []), i]);
  }
  const merged: Array<{ group: string; keptId: number; retired: number[]; tiers: any[] }> = [];
  for (const [, members] of Array.from(groups)) {
    if (members.length < 2) continue;
    if (members.some((m) => Array.isArray(m.specTags) && m.specTags.some((t: any) => t?.kind === 'match'))) continue;
    if (members.some((m) => Array.isArray(m.priceTiers) && m.priceTiers.length)) continue;
    const sorted = [...members].sort((a, b) => (a.minSquareFootage ?? 0) - (b.minSquareFootage ?? 0));
    const keep = sorted[0];
    const price = (m: any) => parseFloat(String((m.activePrice ?? m.unitPrice) || '0').replace(/[$,\s]/g, '')) || 0;
    const tiers = sorted.map((m, idx) => ({
      min: idx === 0 ? (m.minSquareFootage ?? 0) : m.minSquareFootage,
      max: m.maxSquareFootage ?? null,
      mode: 'unit',
      price: price(m),
      note: '',
    }));
    const group = String(keep.itemGroup).trim();
    merged.push({ group, keptId: keep.id, retired: sorted.slice(1).map((m) => m.id), tiers });
    if (opts.dryRun) continue;
    await db.update(romScopeItems).set({
      name: group, priceTiers: tiers as any, itemGroup: null, minSquareFootage: null, maxSquareFootage: null,
      description: [keep.description, `Pricing by quantity — merged from ${sorted.map((m) => m.name).join(', ')}.`].filter(Boolean).join(' '),
      updatedAt: new Date(),
    } as any).where(eq(romScopeItems.id, keep.id));
    for (const m of sorted.slice(1)) {
      await db.update(romScopeItems).set({ isActive: false, description: [m.description, `Merged into "${group}" (#${keep.id}).`].filter(Boolean).join(' '), updatedAt: new Date() } as any)
        .where(eq(romScopeItems.id, m.id));
    }
  }
  // Templates: repoint lines from a retired tier to its merged item.
  if (!opts.dryRun && merged.length) {
    const to = new Map<number, { id: number; name: string }>();
    for (const m of merged) for (const r of [m.keptId, ...m.retired]) to.set(r, { id: m.keptId, name: m.group });
    try {
      const list: any = await Templates.listTemplates({ search: '', includeArchived: true } as any);
      for (const t of list?.items || []) {
        const full: any = await Templates.getTemplate(t.id);
        let changed = false;
        const items = (full?.items || []).map((it: any) => {
          const hit = it.romScopeItemId != null ? to.get(Number(it.romScopeItemId)) : undefined;
          if (!hit) return it;
          changed = true;
          return { ...it, romScopeItemId: hit.id, label: hit.name };
        });
        // Two tiers of the same group on one template collapse to one line.
        const seen = new Set<number>();
        const deduped = items.filter((it: any) => {
          const id = it.romScopeItemId != null ? Number(it.romScopeItemId) : null;
          if (id == null || !merged.some((m) => m.keptId === id)) return true;
          if (seen.has(id)) return false;
          seen.add(id); return true;
        });
        if (changed) await (Templates as any).updateTemplate(t.id, { items: deduped });
      }
    } catch (e) {
      console.warn('⚠️  Price tier merge: templates not repointed:', (e as Error).message);
    }
  }
  return merged;
}

/** Once per database, at startup. */
export async function mergeTierGroupsOnce() {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS app_settings ("key" text PRIMARY KEY, "value" text NOT NULL, updated_at timestamp NOT NULL DEFAULT now(), updated_by text)`);
    const r: any = await db.execute(sql`SELECT value FROM app_settings WHERE key = ${FLAG}`);
    if ((r?.rows ?? r ?? []).length) return;
    const merged = await mergeTierGroups();
    await db.execute(sql`INSERT INTO app_settings (key, value, updated_by) VALUES (${FLAG}, ${JSON.stringify(merged.map((m) => ({ group: m.group, keptId: m.keptId, retired: m.retired })))}, 'startup') ON CONFLICT (key) DO NOTHING`);
    if (merged.length) console.log(`✅ Merged ${merged.length} tier group(s) into pricing by quantity:`, merged.map((m) => m.group).join(', '));
  } catch (e) {
    console.warn('⚠️  Price tier merge skipped:', (e as Error).message);
  }
}
