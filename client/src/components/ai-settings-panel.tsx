/**
 * The one AI switch. Off hides every "Read with AI" style button and the
 * server refuses AI requests — for handing the app to the team without it.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { useAiStatus } from '@/hooks/use-ai-status';

export function AiSettingsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAiStatus();

  const set = useMutation({
    mutationFn: (enabled: boolean) => apiRequest('/api/admin/ai', 'POST', { enabled }),
    onSuccess: (_r, enabled) => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/status'] });
      toast({ title: enabled ? 'AI features on' : 'AI features off',
        description: enabled ? 'AI reading buttons are back for admins.' : 'Every AI button is hidden and the server will refuse AI requests.' });
    },
    onError: (e: any) => toast({ title: 'Could Not Change Setting', description: e?.message, variant: 'destructive' }),
  });

  const when = data?.updatedAt ? new Date(data.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" />AI Features</CardTitle>
        <CardDescription>
          One switch for everything AI reads: RFP Step 2 intake, bid PDF import, bid analysis, and pay app reading in
          Project Management. AI only ever fills in a screen for you to review; nothing is saved without you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4 border rounded-md p-3">
          <div>
            <div className="font-medium">{data?.enabled === false ? 'Off' : 'On'}</div>
            <div className="text-xs text-gray-600">
              {when ? `Last changed ${when}${data?.updatedBy ? ` by ${data.updatedBy}` : ''}` : 'On by default'}
            </div>
          </div>
          <Switch checked={data?.enabled !== false} disabled={isLoading || set.isPending}
                  onCheckedChange={(v) => set.mutate(v)} aria-label="AI features" />
        </div>
        {data && !data.configured && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>No ANTHROPIC_API_KEY secret is set, so AI will not run even when this is on.</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
