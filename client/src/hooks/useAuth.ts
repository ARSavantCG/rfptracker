import { useQuery } from "@tanstack/react-query";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    queryFn: async () => {
      const token = localStorage.getItem('auth-token');
      console.log('Auth check - token present:', !!token);
      
      if (!token) {
        console.log('No auth token found, user not authenticated');
        return null;
      }
      
      const response = await fetch('/api/auth/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
      
      if (!response.ok) {
        console.log('Auth request failed:', response.status, response.statusText);
        if (response.status === 401) {
          // Token expired or invalid, clear it
          localStorage.removeItem('auth-token');
          return null;
        }
        throw new Error(`Authentication failed: ${response.status}`);
      }
      
      const userData = await response.json();
      console.log('Auth successful for user:', userData.username);
      return userData;
    }
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
  };
}