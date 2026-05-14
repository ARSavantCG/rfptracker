import { useQuery } from "@tanstack/react-query";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";
// Session-based authentication - no token presence check needed

export function useAuth() {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    queryFn: async () => {
      // Try session-based auth first (cookies will be sent automatically)
      let response = await fetch('/api/auth/user', {
        credentials: 'include',
      });

      // If session auth fails, try token auth
      if (!response.ok && response.status === 401) {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        
        if (!token) {
          console.debug('Auth check - no session or token present');
          return null;
        }

        console.debug('Auth check - trying token authentication');
        response = await fetch('/api/auth/user', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });
      }

      if (!response.ok) {
        console.debug('Auth request failed:', response.status, response.statusText);
        if (response.status === 401) {
          // Authentication failed, clean up
          localStorage.removeItem(AUTH_TOKEN_KEY);
          return null;
        }
        throw new Error(`Authentication failed: ${response.status}`);
      }

      const userData = await response.json();
      console.debug('Auth successful for user:', userData.username);
      return userData;
    }
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
  };
}
