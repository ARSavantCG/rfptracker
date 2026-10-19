/**
 * Resolving a report's property scope on the server.
 *
 * One helper so nine handlers cannot drift into nine interpretations of "which
 * properties did they ask for" — which is precisely how the executive summary
 * ended up comparing a property ID against a property NAME and silently
 * returning nothing.
 */
import { storage } from './storage';
import {
  parsePropertyScope,
  describePropertyScope,
  propertyInScope,
  type PropertyLike,
} from '@shared/property-scope';

export interface ResolvedScope {
  /** Property ids in scope, or null for every property. */
  ids: string[] | null;
  /** Readable, for a report subtitle: "Kurv Doral II (all 2 buildings)". */
  label: string;
  /** Whether a given property id is in scope. Null scope passes everything. */
  includes: (propertyId: number | string | null | undefined) => boolean;
  /** Every property, already loaded — handlers usually need them anyway. */
  allProperties: PropertyLike[];
}

/**
 * Read the scope off a request.
 *
 * Properties are loaded here because resolving a legacy ?property=<name> needs
 * them, and every caller that scopes by property needs them too.
 */
export async function resolveScope(req: any): Promise<ResolvedScope> {
  const allProperties = (await storage.getAllProperties()) as unknown as PropertyLike[];
  const ids = parsePropertyScope(req?.query || {}, allProperties);
  return {
    ids,
    label: describePropertyScope(ids, allProperties),
    includes: (propertyId) => propertyInScope(propertyId, ids),
    allProperties,
  };
}

/**
 * A subtitle line for a report header, or '' when nothing is scoped.
 * Returned pre-escaped-safe: it contains only property names and digits, but
 * callers still pass it through their own escape, as they would any value.
 */
export function scopeSubtitle(scope: ResolvedScope): string {
  return scope.ids === null ? '' : scope.label;
}
