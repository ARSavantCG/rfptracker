import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isTokenPresent, clearAuthAndReload } from '@/lib/authHelper';

interface AuthCheckProps {
  children: React.ReactNode;
}

export default function AuthCheck({ children }: AuthCheckProps) {
  const [showAuthWarning, setShowAuthWarning] = useState(false);

  useEffect(() => {
    // Check if we should show the auth warning
    const checkAuthStatus = () => {
      const hasToken = isTokenPresent();
      const isOnDashboard = window.location.pathname === '/' || window.location.pathname === '/dashboard';
      
      // Show warning if user appears to be on dashboard but has no token
      if (isOnDashboard && !hasToken) {
        setShowAuthWarning(true);
      }
    };

    checkAuthStatus();
    
    // Check auth status when localStorage changes
    window.addEventListener('storage', checkAuthStatus);
    return () => window.removeEventListener('storage', checkAuthStatus);
  }, []);

  if (showAuthWarning) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-yellow-600" />
            </div>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>
              Your session has expired or authentication is missing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              onClick={clearAuthAndReload} 
              className="w-full"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Log In Again
            </Button>
            <Button 
              onClick={() => setShowAuthWarning(false)} 
              variant="outline" 
              className="w-full"
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}