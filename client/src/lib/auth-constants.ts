/**
 * Shared localStorage key for the auth Bearer token.
 *
 * Using a typed constant instead of an inline string means TypeScript
 * will catch any misspelling at the import site rather than silently
 * producing a 401 at runtime.
 */
export const AUTH_TOKEN_KEY = 'auth-token' as const;

/**
 * Appends the auth token as a query param to a same-origin resource URL that will
 * be loaded by browser navigation (window.open, <a href>, <img src>) where an
 * Authorization header can't be attached. Used for /uploads/* files, which are
 * guarded server-side by requireAuthFlexible.
 *
 * If we later move to signed short-lived URLs, this is the single place to change:
 * swap the query-param append for a fetch of a signed URL.
 */
export function withAuth(url: string): string {
  if (!url || url === '#') return url;
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
