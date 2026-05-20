import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let message: string;
    try {
      const text = await res.text();
      const errorData = JSON.parse(text);
      message = errorData.message || errorData.error || res.statusText;
    } catch {
      message = res.statusText;
    }
    throw new Error(`${res.status}: ${message}`);
  }
}

/**
 * Authenticated fetch helper.
 * Argument order: apiRequest(url, method, data?)
 * Examples:
 *   apiRequest("/api/things", "POST", { name: "foo" })
 *   apiRequest(`/api/things/${id}`, "DELETE")
 *   apiRequest("/api/things", "GET")
 * NOTE: url is ALWAYS first, HTTP method is ALWAYS second.
 * TypeScript cannot catch a swap because both args are strings.
 */
export async function apiRequest(
  url: string,
  method: string,
  data?: unknown | undefined,
): Promise<any> {
  const isFormData = data instanceof FormData;
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  
  // Always send token if available
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
  };
  
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // 20-second timeout prevents fetch hanging indefinitely when the network
  // drops mid-request, which would leave isPending=true with no recovery path.
  const res = await fetch(url, {
    method,
    headers,
    body: isFormData ? data : data ? JSON.stringify(data) : undefined,
    credentials: "include",
    signal: AbortSignal.timeout(20_000),
  });

  await throwIfResNotOk(res);
  
  // Handle empty responses (like 204 No Content)
  if (res.status === 204 || !res.headers.get("content-type")?.includes("application/json")) {
    return null;
  }
  
  return res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    
    // Always send token if available
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
      headers
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
      gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes 
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
