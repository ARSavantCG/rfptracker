/**
 * Shared localStorage key for the auth Bearer token.
 *
 * Using a typed constant instead of an inline string means TypeScript
 * will catch any misspelling at the import site rather than silently
 * producing a 401 at runtime.
 */
export const AUTH_TOKEN_KEY = 'auth-token' as const;
