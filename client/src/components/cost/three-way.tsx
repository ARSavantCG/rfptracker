/**
 * The three-way check badge next to a pay app's number: our line 8 (from the
 * G703 lines entered), the contractor's G702 line 8, and the GC's conditional.
 */
import { threeWayCheck, type Waiver } from '@shared/cost-waivers';
import { money } from './types';

export function ThreeWayBadge({ app, waivers, contractName }: { app: any; waivers: readonly Waiver[]; contractName: string }) {
  const c = threeWayCheck(app, waivers, contractName);
  if (c.status === 'none') return null;
  if (c.status === 'match') return <span className="ml-1 font-semibold text-green-700" title={`All three match. ${c.summary}`}>✓</span>;
  if (c.status === 'partial') return <span className="ml-1 font-semibold text-green-700" title={`The two entered match; one isn't entered yet. ${c.summary}`}>✓</span>;
  const off = c.oursOff != null ? Math.abs(c.oursOff) : null;
  return <span className="ml-1 font-semibold text-red-700" title={`Don't match. ${c.summary}${c.oursOff != null && c.oursOff < 0 ? '. Ours is lower: G703 lines are missing, most often change order work billed this period.' : ''}`}>⚠{off != null ? ` ${money(off)}` : ''}</span>;
}
