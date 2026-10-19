/**
 * THE SINGLE SOURCE for "which properties is this report about".
 *
 * Before this, three reports each spelled it differently:
 *
 *   portfolio        ?property=<NAME>  and  ?building=<id>
 *   costs-in-place   ?propertyId=<id>
 *   executive        ?filters={"property":"<NAME>"}
 *
 * and six other reports could not be scoped at all. Worse, the executive
 * summary's filter compared rfp_requests.property — which holds the property
 * ID as text — against a NAME, so `"9" === "Kurv Doral II"` was never true and
 * that filter silently returned an empty report for its entire life.
 *
 * Everything now speaks one language: a list of property IDs, as
 * ?propertyIds=1,9,10. IDs because names change — the portfolio was renamed to
 * Kurv and every name-keyed lookup in this codebase stopped matching, which is
 * the same lesson PROPERTY_LEGAL_TOTALS_BY_ID records.
 *
 * A "PARK" is not a separate concept here. Buildings are grouped by
 * propertyName, so a park is simply every id sharing one name. The picker
 * offers that as one click and sends the ids it expands to, which means no new
 * column, no migration, and arbitrary mixes of buildings work for free.
 */

export interface PropertyLike {
  id: number | string;
  propertyName?: string | null;
  building?: string | null;
}

/** The query parameter every report reads. */
export const PROPERTY_SCOPE_PARAM = 'propertyIds';

/**
 * Parse a scope out of raw query values.
 *
 * Accepts the new spelling and every legacy one, because links already pasted
 * into emails and pins already saved must keep working:
 *
 *   propertyIds=1,9,10   the current form (also repeated: propertyIds=1&propertyIds=9)
 *   propertyId=4         costs-in-place
 *   building=9           portfolio
 *   property=<name>      portfolio and executive — resolved against the
 *                        supplied property list, since a name is all they sent
 *
 * Returns null for "no scope", which every caller must treat as EVERYTHING
 * rather than as nothing. An empty array would quietly produce empty reports.
 */
export function parsePropertyScope(
  query: Record<string, any> | null | undefined,
  allProperties: readonly PropertyLike[] | null | undefined,
): string[] | null {
  if (!query) return null;

  const ids = new Set<string>();
  const add = (value: any) => {
    if (value === undefined || value === null) return;
    for (const part of String(value).split(',')) {
      const trimmed = part.trim();
      if (trimmed) ids.add(trimmed);
    }
  };

  // Repeated parameters arrive as an array.
  const raw = query[PROPERTY_SCOPE_PARAM];
  if (Array.isArray(raw)) raw.forEach(add);
  else add(raw);

  add(query.propertyId);
  add(query.building);

  // A NAME covers every building under it — which is exactly what a park is.
  const nameRaw = query.property;
  if (nameRaw !== undefined && nameRaw !== null && String(nameRaw).trim() !== '') {
    const wanted = String(nameRaw).trim().toLowerCase();
    for (const p of allProperties || []) {
      if (String(p.propertyName ?? '').trim().toLowerCase() === wanted) {
        ids.add(String(p.id));
      }
    }
    // A name that matches no property must NOT fall through to "everything" —
    // that would silently widen a deliberately narrow request. Scope to nothing
    // instead, which the report shows as an empty result the reader can see.
    if (ids.size === 0) return [];
  }

  return ids.size > 0 ? Array.from(ids) : null;
}

/** True when this property is in scope. A null scope means everything. */
export function propertyInScope(
  propertyId: number | string | null | undefined,
  scope: readonly string[] | null,
): boolean {
  if (scope === null) return true;
  if (propertyId === null || propertyId === undefined) return false;
  return scope.includes(String(propertyId));
}

/**
 * Filter a list of properties to the scope.
 * A null scope returns the list untouched.
 */
export function filterPropertiesByScope<T extends PropertyLike>(
  properties: readonly T[],
  scope: readonly string[] | null,
): T[] {
  if (scope === null) return [...properties];
  return properties.filter((p) => propertyInScope(p.id, scope));
}

/**
 * A readable description of the scope, for a report header or a pin label.
 *
 * Collapses a complete park back to its name: selecting both buildings of Kurv
 * Doral II reads "Kurv Doral II (all 2 buildings)", not two building names.
 */
export function describePropertyScope(
  scope: readonly string[] | null,
  allProperties: readonly PropertyLike[] | null | undefined,
): string {
  if (scope === null) return 'All properties';
  if (scope.length === 0) return 'No matching property';

  const all = allProperties || [];
  const byId = new Map(all.map((p) => [String(p.id), p]));
  const selected = scope.map((id) => byId.get(String(id))).filter(Boolean) as PropertyLike[];
  if (selected.length === 0) return `${scope.length} propert${scope.length === 1 ? 'y' : 'ies'}`;

  // How many buildings does each name have in total, and how many are selected?
  const totalByName = new Map<string, number>();
  for (const p of all) {
    const n = String(p.propertyName ?? '').trim();
    totalByName.set(n, (totalByName.get(n) || 0) + 1);
  }
  const selectedByName = new Map<string, PropertyLike[]>();
  for (const p of selected) {
    const n = String(p.propertyName ?? '').trim();
    selectedByName.set(n, [...(selectedByName.get(n) || []), p]);
  }

  const parts: string[] = [];
  for (const [name, members] of Array.from(selectedByName.entries())) {
    const total = totalByName.get(name) || members.length;
    if (members.length === total && total > 1) {
      parts.push(`${name} (all ${total} buildings)`);
    } else if (members.length === total) {
      parts.push(name);
    } else {
      const buildings = members
        .map((m: PropertyLike) => (m.building ? `Bldg. ${m.building}` : name))
        .join(', ');
      parts.push(`${name} — ${buildings}`);
    }
  }

  // Long selections become a count rather than an unreadable run-on.
  if (parts.length > 2) return `${selected.length} buildings across ${parts.length} properties`;
  return parts.join(' · ');
}

/** Buildings grouped by property name, for a picker that offers whole parks. */
export function groupPropertiesByName<T extends PropertyLike>(
  properties: readonly T[],
): Array<{ name: string; buildings: T[] }> {
  const byName = new Map<string, T[]>();
  for (const p of properties) {
    const n = String(p.propertyName ?? '').trim() || 'Unnamed';
    byName.set(n, [...(byName.get(n) || []), p]);
  }
  return Array.from(byName.entries())
    .map(([name, buildings]) => ({
      name,
      buildings: [...buildings].sort((a, b) =>
        String(a.building ?? '').localeCompare(String(b.building ?? ''), undefined, { numeric: true })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
