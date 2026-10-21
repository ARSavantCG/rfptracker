/**
 * Whether AI buttons should show. One admin switch (Admin → AI) covers every
 * AI feature; when it is off, the buttons go away and the server refuses too.
 */
import { useQuery } from '@tanstack/react-query';

export type AiStatus = { enabled: boolean; configured: boolean; updatedBy: string | null; updatedAt: string | null };

export function useAiStatus() {
  const q = useQuery<AiStatus>({ queryKey: ['/api/ai/status'], staleTime: 30_000 });
  return { ...q, on: !!q.data?.enabled && !!q.data?.configured };
}
