/**
 * Where tenant change orders put their money (Adolfo, 2026-11-02): a change order doesn't make a new
 * budget line — it raises the budget lines it's priced on. So every budget-line picker shows, beside
 * each line, the change orders that added to it ("New Office Area (4,000 sf) · CO-01 +$105,350.03"):
 * map the contractor's change order there and it is paid from that money.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { SelectItem } from '@/components/ui/select';
import { coTotals, type BudgetCO } from '@shared/cost-budget-approval';
import { money } from './types';

type Funds = Map<string, Array<{ number: string; amount: number; status: string }>>;
const Ctx = createContext<Funds>(new Map());

export function CoFundsProvider({ cos, children }: { cos: readonly BudgetCO[]; children: ReactNode }) {
  const funds = useMemo(() => {
    const m: Funds = new Map();
    const add = (key: string, number: string, amount: number, status: string) => {
      const list = m.get(key) ?? [];
      const hit = list.find((x) => x.number === number);
      if (hit) hit.amount = Math.round((hit.amount + amount) * 100) / 100; else list.push({ number, amount: Math.round(amount * 100) / 100, status });
      m.set(key, list);
    };
    for (const c of cos) {
      if (c.status === 'void') continue;
      for (const l of c.lines) add(l.key, c.number, l.amount, c.status);
      for (const mk of coTotals(c).markupLines) add(mk.key, c.number, mk.amount, c.status);
    }
    for (const [k, list] of Array.from(m)) m.set(k, list.filter((x) => Math.abs(x.amount) >= 0.005));
    return m;
  }, [cos]);
  return <Ctx.Provider value={funds}>{children}</Ctx.Provider>;
}

export function useCoFunds() { return useContext(Ctx); }

/** A budget line in a picker, with the tenant change orders that added to it. */
export function BudgetLineItem({ k, description }: { k: string; description: string }) {
  const funds = useCoFunds().get(k) ?? [];
  return (
    <SelectItem value={k}>
      {description}
      {funds.length > 0 && <span className="ml-1 text-[11px] text-green-800">· {funds.map((f) => `${f.number}${f.status === 'pending' ? ' (pending)' : ''} +${money(f.amount)}`).join(' · ')}</span>}
    </SelectItem>
  );
}
