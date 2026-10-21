/**
 * Number boxes that read the way the app's numbers read: money with commas
 * and cents, percentages to two decimals. Shown formatted whenever the box
 * isn't being typed in; plain digits while it is, so editing is easy.
 * No placeholder text — an empty box is empty (Adolfo, 2026-10-20).
 */
import { forwardRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { fmtMoneyText, fmtPctText } from '@shared/format';

type Props = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'placeholder'> & {
  value: string;
  onValueChange: (raw: string) => void;
};

function makeNumberInput(format: (s: string) => string, suffix?: string, keepTyped = false) {
  return forwardRef<HTMLInputElement, Props>(function NumberInput({ value, onValueChange, className, onFocus, onBlur, ...rest }, ref) {
    const [editing, setEditing] = useState(false);
    const shown = editing ? String(value ?? '').replace(/,/g, '') : format(String(value ?? ''));
    return (
      <div className="relative">
        <Input ref={ref} {...rest} inputMode="decimal" value={shown}
               className={`text-right tabular-nums ${suffix ? 'pr-6' : ''} ${className || ''}`}
               onFocus={(e) => { setEditing(true); onFocus?.(e); }}
               onBlur={(e) => { setEditing(false); onValueChange(keepTyped ? e.target.value.replace(/[,%\s]/g, '') : format(e.target.value)); onBlur?.(e); }}
               onChange={(e) => onValueChange(e.target.value)} />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">{suffix}</span>}
      </div>
    );
  });
}

export const MoneyInput = makeNumberInput(fmtMoneyText);
export const PercentInput = makeNumberInput(fmtPctText, '%');
/** A percentage that keeps every digit typed (56.929894) — shown to two decimals, stored as typed. For tenant shares. */
export const SharePercentInput = makeNumberInput(fmtPctText, '%', true);
