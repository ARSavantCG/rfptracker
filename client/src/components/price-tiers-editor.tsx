/**
 * Pricing by quantity on one catalog item (Adolfo 2026-10-22): a price per
 * quantity range. Each range is per unit, a flat package, or per package of N
 * units. A bigger quantity never prices below the top of the range under it —
 * that floor is applied in shared/line-total.ts, the one place line math lives.
 */
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { MoneyInput } from '@/components/cost/inputs';
import { priceByTiers, normalizeTiers, tierLabel } from '@shared/line-total';

export type PriceTierForm = { min: string; max: string; mode: 'unit' | 'flat' | 'step'; price: string; step: string; note: string };

export const tiersToForm = (raw: unknown): PriceTierForm[] =>
  normalizeTiers(raw).map((t) => ({
    min: t.min != null ? String(t.min) : '', max: t.max != null ? String(t.max) : '', mode: t.mode,
    price: t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), step: t.step != null ? String(t.step) : '', note: t.note,
  }));

const num = (s: string) => { const n = parseFloat(String(s ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
export const tiersFromForm = (rows: PriceTierForm[]) => rows
  .filter((r) => num(r.price) != null)
  .map((r) => ({ min: num(r.min), max: num(r.max), mode: r.mode, price: num(r.price)!, step: r.mode === 'step' ? num(r.step) : null, note: r.note.trim() }));

/** "By quantity: 0–3,000 $200.00 · 3,001–5,000 $180.00 · 5,001+ $165.00" — for lists and the printed library. */
export function tiersSummary(raw: unknown): string {
  const t = normalizeTiers(raw);
  if (!t.length) return '';
  const m = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return 'By quantity: ' + t.map((x) => `${tierLabel(x)} ${m(x.price)}${x.mode === 'flat' ? ' flat' : x.mode === 'step' ? ` per ${x.step ?? 1}` : ''}`).join(' · ');
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function PriceTiersEditor({ value, onChange, unit }: { value: PriceTierForm[]; onChange: (v: PriceTierForm[]) => void; unit?: string }) {
  const [tryQty, setTryQty] = useState('');
  const u = unit || 'unit';
  const set = (i: number, patch: Partial<PriceTierForm>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    const last = value[value.length - 1];
    const nextMin = last && num(last.max) != null ? String((num(last.max) as number) + 1) : last ? '' : '0';
    onChange([...value, { min: nextMin, max: '', mode: 'unit', price: '', step: '', note: '' }]);
  };
  const preview = tryQty.trim() ? priceByTiers(tiersFromForm(value), tryQty) : null;

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                <th className="py-1 pr-2 w-28">From ({u})</th><th className="py-1 pr-2 w-28">To ({u})</th>
                <th className="py-1 pr-2 w-48">Priced</th><th className="py-1 pr-2 w-32">Price</th><th className="py-1 pr-2 w-28">Package of</th>
                <th className="py-1 pr-2">What it assumes</th><th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {value.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1 pr-2"><Input className="h-8 text-right" inputMode="decimal" value={r.min} onChange={(e) => set(i, { min: e.target.value })} aria-label="From" /></td>
                  <td className="py-1 pr-2"><Input className="h-8 text-right" inputMode="decimal" value={r.max} onChange={(e) => set(i, { max: e.target.value })} aria-label="To (blank = and up)" title="Leave blank for 'and up'" /></td>
                  <td className="py-1 pr-2">
                    <Select value={r.mode} onValueChange={(v) => set(i, { mode: v as PriceTierForm['mode'] })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unit">Per {u}</SelectItem>
                        <SelectItem value="flat">Package (Flat Price)</SelectItem>
                        <SelectItem value="step">Per Package of N {u}</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1 pr-2"><MoneyInput className="h-8" value={r.price} onValueChange={(v) => set(i, { price: v })} aria-label="Price" /></td>
                  <td className="py-1 pr-2"><Input className="h-8 text-right" inputMode="decimal" value={r.step} disabled={r.mode !== 'step'} onChange={(e) => set(i, { step: e.target.value })} aria-label="Package size" /></td>
                  <td className="py-1 pr-2"><Input className="h-8" value={r.note} onChange={(e) => set(i, { note: e.target.value })} aria-label="What it assumes" /></td>
                  <td className="py-1 text-center">
                    <button type="button" className="p-1 text-gray-400 hover:text-red-700" title="Remove range" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={add}><Plus className="h-3.5 w-3.5 mr-1" /> {value.length ? 'Add a Range' : 'Price by Quantity'}</Button>
        {value.length > 0 && (
          <span className="inline-flex items-center gap-2 text-xs text-gray-600">
            Try a quantity
            <Input className="h-8 w-28 text-right" inputMode="decimal" value={tryQty} onChange={(e) => setTryQty(e.target.value)} aria-label="Try a quantity" />
            {preview && (
              <span className="tabular-nums text-gray-900">
                = <strong>{money(preview.gross)}</strong> · range {preview.label}
                {preview.floorApplied && <span className="text-amber-700"> · minimum: top of {preview.floorLabel}</span>}
                {preview.note && <span className="text-gray-500"> · {preview.note}</span>}
              </span>
            )}
          </span>
        )}
      </div>
      {value.length > 0 && (
        <p className="text-[11px] text-gray-500">
          The range holding the quantity sets the price, and a bigger quantity never prices below the top of a lower range.
          With ranges set, the unit price above is only a fallback.
        </p>
      )}
    </div>
  );
}
