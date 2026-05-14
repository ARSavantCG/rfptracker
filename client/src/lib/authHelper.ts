import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";
/**
 * Authentication helper utilities
 */

export function clearAuthAndReload() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  window.location.reload();
}

export function isTokenPresent(): boolean {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return !!token && token.length > 0;
}

export async function validateToken(): Promise<boolean> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    return false;
  }

  try {
    const response = await fetch('/api/auth/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (response.ok) {
      return true;
    } else if (response.status === 401) {
      // Token is invalid, clear it
      localStorage.removeItem(AUTH_TOKEN_KEY);
      return false;
    }
    return false;
  } catch (error) {
    console.error('Token validation error:', error);
    return false;
  }
}

export function handleAuthError(error: Error, showReloadMessage = true) {
  if (error.message.includes('401') || error.message.includes('Authentication')) {
    // Auth error handler disabled to prevent navigation issues during file operations
    return true;
  }
  return false;
}