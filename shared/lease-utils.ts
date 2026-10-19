/**
 * Lease-derived values that more than one surface needs.
 *
 * Suite numbers live in TWO places and must not disagree:
 *
 *   BayConfiguration.suiteNumber  — the property record. Entered once in Bay
 *                                   Configuration, shown as "STE 101" in the
 *                                   bay grid and on the bay configuration print.
 *   ExecutedLease.suiteNumber     — an override, for a demise that carries its
 *                                   own number the bays do not say (bays 3-5
 *                                   leased as one "Suite 300").
 *
 * Deriving from the bays by default means the common case needs no typing and
 * cannot drift from the property record. The override exists because the
 * uncommon case is real, and the same precedence already governs
 * rentableAreaOverride.
 *
 * NOT ALWAYS A "SUITE". Several parks — Kurv Doral among them — identify each
 * unit by its own street address rather than Suite 100 / 200. The stored value
 * is therefore a free-text unit identifier, and formatLeaseSuite prefixes
 * "Suite" only when the value actually looks like a suite designation.
 */

export interface SuiteBayLike {
  id?: string;
  suiteNumber?: string | null;
}

export interface SuiteLeaseLike {
  assignedBays?: readonly string[] | null;
  suiteNumber?: string | null;
}

/**
 * The suite label for a lease: the override, or the distinct suites on the
 * bays it holds.
 *
 * Returns '' when nothing is known — not "N/A" or "—". Callers decide how to
 * render an absence, and plenty of leases legitimately have no suite at all.
 *
 * Several bays with different suites produce all of them ("101, 102"), because
 * a demise really can span two numbered suites and collapsing that to the
 * first would be a quiet lie.
 */
export function resolveLeaseSuite(
  lease: SuiteLeaseLike | null | undefined,
  bays: readonly SuiteBayLike[] | null | undefined,
): string {
  const override = String(lease?.suiteNumber ?? '').trim();
  if (override) return override;

  const assigned = lease?.assignedBays;
  if (!Array.isArray(assigned) || assigned.length === 0) return '';
  if (!Array.isArray(bays) || bays.length === 0) return '';

  const wanted = new Set(assigned.map(String));
  const suites: string[] = [];
  for (const bay of bays) {
    if (bay?.id == null || !wanted.has(String(bay.id))) continue;
    const suite = String(bay.suiteNumber ?? '').trim();
    // Distinct, in bay order — two bays sharing a suite is one suite.
    if (suite && !suites.includes(suite)) suites.push(suite);
  }
  return suites.join(', ');
}

/** True when the lease carries its own suite rather than inheriting the bays'. */
export function leaseSuiteIsOverridden(lease: SuiteLeaseLike | null | undefined): boolean {
  return String(lease?.suiteNumber ?? '').trim() !== '';
}

/**
 * Does this unit identifier look like a suite DESIGNATION rather than an
 * address?
 *
 * Not every park numbers its units "Suite 100". Several — Kurv Doral among
 * them — identify each unit by its own street address, so blindly prefixing
 * would print "Suite 8520 NW 33rd St".
 *
 * A designation is a short code: digits, optionally with one leading or
 * trailing letter — 100, 101A, B200. Anything longer, or containing a space
 * between words, is taken as an address and shown exactly as entered.
 */
export function looksLikeSuiteDesignation(value: string): boolean {
  return /^[A-Za-z]?-?\d{1,5}[A-Za-z]?$/.test(value.trim());
}

/**
 * The unit label for display: "Suite 300", "Suites 101, 102", or an address
 * verbatim. Empty when there is no unit identifier at all.
 */
export function formatLeaseSuite(
  lease: SuiteLeaseLike | null | undefined,
  bays: readonly SuiteBayLike[] | null | undefined,
): string {
  const suite = resolveLeaseSuite(lease, bays);
  if (!suite) return '';

  const parts = suite.split(',').map((p) => p.trim()).filter(Boolean);
  // Prefix only when EVERY part is a designation. A mixed list gets no prefix
  // rather than a wrong one on half of it.
  if (!parts.every(looksLikeSuiteDesignation)) return suite;
  return parts.length > 1 ? `Suites ${parts.join(', ')}` : `Suite ${parts[0]}`;
}
