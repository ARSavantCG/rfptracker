import { useQuery } from "@tanstack/react-query";
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
        const token = localStorage.getItem('auth-token');
        
        if (!token) {
          console.log('Auth check - no session or token present');
          return null;
        }

        console.log('Auth check - trying token authentication');
        response = await fetch('/api/auth/user', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });
      }

      if (!response.ok) {
        console.log('Auth request failed:', response.status, response.statusText);
        if (response.status === 401) {
          // Authentication failed, clean up
          localStorage.removeItem('auth-token');
          return null;
        }
        throw new Error(`Authentication failed: ${response.status}`);
      }

      const userData = await response.json();
      console.log('Auth successful for user:', userData.username);
      console.log('User permissions:', userData.permissions);
      return userData;
    }
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
  };
}