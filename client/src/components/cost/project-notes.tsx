/** A small running notes box for the project — anything the team should know. */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { projectKey } from './types';

export function ProjectNotes({ projectId, notes }: { projectId: number; notes: string | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState(notes ?? '');
  useEffect(() => { setText(notes ?? ''); }, [notes]);
  const dirty = text !== (notes ?? '');
  const save = useMutation({
    mutationFn: () => apiRequest(`/api/cost-projects/${projectId}`, 'PATCH', { notes: text }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [projectKey(projectId)] }); toast({ title: 'Notes Saved' }); },
    onError: (e: any) => toast({ title: 'Not Saved', description: e?.message, variant: 'destructive' }),
  });
  return (
    <div className="bg-white border rounded-lg px-4 py-3 space-y-2">
      <label htmlFor="project-notes" className="text-xs font-semibold uppercase tracking-wide text-gray-600">Project Notes</label>
      <Textarea id="project-notes" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setText(notes ?? '')}>Discard</Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save Notes'}</Button>
        </div>
      )}
    </div>
  );
}
