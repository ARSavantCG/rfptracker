/**
 * Single source of truth for brand identity used across all report/PDF generators.
 *
 * Before this, the logo loader was copy-pasted into 9 files (and had drifted — some
 * used process.cwd(), some './', some checked the data: prefix, some didn't), and the
 * company name/color were hardcoded in ~17/11 files respectively. Change branding in
 * ONE place now.
 *
 * If we later add an admin App Settings system, these become the fallbacks and each
 * getter reads the setting first (see SETTINGS-AUDIT.md).
 */

import { readFileSync } from 'fs';
import path from 'path';

/** Company display name shown on reports. */
export const COMPANY_NAME = 'Kurv Industrial';

/** Primary brand color (headers, rules, titles). */
export const BRAND_COLOR_PRIMARY = 'rgb(0,50,130)';

/**
 * Returns the brand logo as a base64 data URI for embedding in report HTML.
 * Robust version: tolerant of an already-prefixed data URI, strips whitespace,
 * and returns '' on any failure so a missing logo never breaks report rendering.
 */
export function getBrandLogo(): string {
  try {
    const logoPath = path.join(process.cwd(), 'bridge_logo_new_base64.txt');
    const base64 = readFileSync(logoPath, 'utf-8').replace(/\s+/g, '');
    if (!base64) return '';
    return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
  } catch {
    return '';
  }
}
