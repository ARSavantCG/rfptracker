/**
 * Invoice numbers that say what they are (Adolfo, 2026-11-05):
 *   ACC-KPE-TCO-002 = Accordia · Kurv Port Everglades · Tenant Change Order · 2nd one.
 * Project and property codes default from the names and can be set in the Report Header.
 * Each type counts on its own per project, carrying on from invoices already issued.
 */
export const INVOICE_TYPE_CODES = { tenant: 'TCO', capital: 'CMF' } as const;

const letters = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').trim();

/** First three letters of the project: "Accordia (Expansion)" → ACC. */
export function projectCodeFrom(name: unknown): string {
  return letters(name).replace(/\s+/g, '').slice(0, 3);
}

/** Initials of the property: "Kurv Port Everglades" → KPE (building suffixes dropped). */
export function propertyCodeFrom(name: unknown): string {
  const words = letters(String(name ?? '').replace(/\s*[-–]\s*Bldg\.?.*$/i, '')).split(/\s+/).filter(Boolean);
  return words.map((w) => w[0]).join('').slice(0, 3);
}

export function invoicePrefix(projectCode: string, propertyCode: string, stream: 'tenant' | 'capital'): string {
  return [projectCode, propertyCode, INVOICE_TYPE_CODES[stream]].map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean).join('-');
}

/** The next number: one past how many of this type were issued, skipping any already used. */
export function nextInvoiceNumber(prefix: string, issued: string[]): string {
  const used = new Set(issued.map((n) => String(n).trim().toUpperCase()));
  let n = issued.length + 1;
  let out = `${prefix}-${String(n).padStart(3, '0')}`;
  while (used.has(out.toUpperCase())) { n += 1; out = `${prefix}-${String(n).padStart(3, '0')}`; }
  return out;
}
