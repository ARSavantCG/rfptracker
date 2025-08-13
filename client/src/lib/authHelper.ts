/**
 * Authentication helper utilities
 */

export function clearAuthAndReload() {
  console.log('🚨 CRITICAL: clearAuthAndReload called - this will navigate away from current page!');
  console.trace('Stack trace for clearAuthAndReload call:');
  localStorage.removeItem('auth-token');
  window.location.reload();
}

export function isTokenPresent(): boolean {
  const token = localStorage.getItem('auth-token');
  return !!token && token.length > 0;
}

export async function validateToken(): Promise<boolean> {
  const token = localStorage.getItem('auth-token');
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
      localStorage.removeItem('auth-token');
      return false;
    }
    return false;
  } catch (error) {
    console.error('Token validation error:', error);
    return false;
  }
}

export function handleAuthError(error: Error, showReloadMessage = true) {
  console.log('🔍 handleAuthError called with:', error.message);
  
  if (error.message.includes('401') || error.message.includes('Authentication')) {
    console.log('🚨 AUTH ERROR DETECTED - this will trigger page reload!');
    console.trace('Stack trace for handleAuthError call:');
    
    if (showReloadMessage) {
      alert('Your session has expired. The page will reload to log you in again.');
    }
    clearAuthAndReload();
    return true;
  }
  return false;
}