/** A section rolled up to its header, remembered in this browser (per key). */
import { useState } from 'react';

export function useRolled(key: string, initial = false): [boolean, () => void] {
  const [rolled, setRolled] = useState<boolean>(() => {
    try { const v = localStorage.getItem(key); return v == null ? initial : v === '1'; } catch { return initial; }
  });
  const toggle = () => setRolled((r) => { try { localStorage.setItem(key, r ? '0' : '1'); } catch { /* private window */ } return !r; });
  return [rolled, toggle];
}
