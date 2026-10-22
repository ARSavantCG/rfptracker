/**
 * A project's name for headers and lists: without the trailing notes in
 * brackets that come from the RFP — "(Balance of Bldg.) (RFP-2025-011.B)".
 * The full name is kept and shown small at the foot of the project page.
 * Brackets inside the name ("Accordia (Expansion) @ …") stay.
 */
export function shortProjectName(name: string | null | undefined): string {
  const full = String(name ?? '').trim();
  let s = full;
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/\s*\([^()]*\)\s*$/, '').trim();
    if (next === s || !next) break;
    s = next;
  }
  return s || full;
}
