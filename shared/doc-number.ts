/**
 * Document numbers are three digits everywhere: Pay App 007, Invoice 012,
 * TEN-001, CAP-001, CO-001 (Adolfo, 2026-10-22). Stored numbers are plain
 * integers; this is display only.
 */
export const no3 = (n: number | string | null | undefined): string => (n == null || n === '' ? '' : String(n).padStart(3, '0'));
