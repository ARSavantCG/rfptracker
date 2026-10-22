/**
 * Send the invitation to bid, from step 3, to the people who will price it.
 *
 * Before this, step 3 produced the invitation and stopped: getting it to a
 * contractor meant downloading the document, opening Outlook, hunting for
 * addresses, attaching, and writing the note — every time, for every bidder,
 * with nothing left in the app afterwards saying who had been invited.
 *
 * Replies come back to the sender's own inbox. There is no bidder login and
 * no upload link; what this records is the sending.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { AUTH_TOKEN_KEY } from '@/lib/auth-constants';
import { Send, Check, AlertTriangle, Plus, Users } from 'lucide-react';

interface Candidate {
  contactId: number;
  name: string;
  email: string;
  company: string | null;
  type: 'contractor' | 'architect';
}

interface SendRow {
  id: number;
  recipientEmail: string;
  recipientName: string | null;
  recipientCompany: string | null;
  recipientType: string;
  status: string;
  error: string | null;
  sentAt: string;
}

const authFetch = async (url: string, init?: RequestInit) => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`);
  return body;
};

export function ItbSendPanel({ rfpId, projectName, rfpNumber }: {
  rfpId: number;
  projectName?: string;
  rfpNumber?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [extraEmail, setExtraEmail] = useState('');
  const [extras, setExtras] = useState<{ email: string; type: 'contractor' | 'architect' }[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);

  const { data: candidateData } = useQuery<{ candidates: Candidate[] }>({
    queryKey: [`/api/rfp-requests/${rfpId}/invitation-to-bid/candidates`],
    enabled: open && !!rfpId,
  });
  const { data: sendData } = useQuery<{ sends: SendRow[] }>({
    queryKey: [`/api/rfp-requests/${rfpId}/invitation-to-bid/sends`],
    enabled: !!rfpId,
  });

  const candidates = candidateData?.candidates || [];
  const sends = sendData?.sends || [];

  // Who has already had it, so a second send is a deliberate act rather than
  // an accident of scrolling.
  const alreadySent = useMemo(
    () => new Set(sends.filter((s) => s.status === 'sent').map((s) => s.recipientEmail.toLowerCase())),
    [sends],
  );

  const recipients = useMemo(() => [
    ...candidates.filter((c) => selected.has(c.contactId)).map((c) => ({
      contactId: c.contactId, email: c.email, name: c.name, company: c.company, type: c.type,
    })),
    ...extras.map((e) => ({ email: e.email, type: e.type })),
  ], [candidates, selected, extras]);

  const sendMutation = useMutation({
    mutationFn: (payload: any) =>
      authFetch(`/api/rfp-requests/${rfpId}/invitation-to-bid/send`, {
        method: 'POST', body: JSON.stringify(payload),
      }),
    onSuccess: (result: any) => {
      toast({
        title: result.failed ? 'Sent with failures' : 'Invitation sent',
        description: result.message,
        variant: result.failed ? 'destructive' : undefined,
        duration: result.failed ? 12000 : 6000,
      });
      setSelected(new Set());
      setExtras([]);
      queryClient.invalidateQueries({
        queryKey: [`/api/rfp-requests/${rfpId}/invitation-to-bid/sends`],
      });
    },
    onError: (e: any) => toast({
      title: 'Nothing was sent',
      description: e?.message || 'Unknown error',
      variant: 'destructive',
      duration: 12000,
    }),
  });

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const addExtra = () => {
    const email = extraEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'That does not look like an email address', variant: 'destructive' });
      return;
    }
    if (extras.some((e) => e.email === email) || candidates.some((c) => c.email.toLowerCase() === email)) {
      toast({ title: 'Already on the list' });
      setExtraEmail('');
      return;
    }
    setExtras((prev) => [...prev, { email, type: 'contractor' }]);
    setExtraEmail('');
  };

  const group = (type: 'contractor' | 'architect') => candidates.filter((c) => c.type === type);

  return (
    <div className="border rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-medium text-sm">
          <Send className="h-4 w-4 text-blue-600" />
          Send the invitation to bid
          {sends.length > 0 && (
            <span className="text-xs font-normal text-gray-500">
              — {sends.filter((s) => s.status === 'sent').length} sent
              {sends.some((s) => s.status === 'failed') && (
                <span className="text-red-600">
                  , {sends.filter((s) => s.status === 'failed').length} failed
                </span>
              )}
            </span>
          )}
        </span>
        <span className="text-xs text-gray-500">{open ? 'Hide' : 'Open'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t pt-4">
          <p className="text-xs text-gray-600">
            Each recipient gets their own copy of the invitation, addressed to their company —
            contractors get the contractor package, architects the architect one. Replies come
            straight back to your inbox.
          </p>

          {candidates.length === 0 ? (
            <p className="text-sm text-gray-600 flex items-center gap-2">
              <Users className="h-4 w-4" />
              No contractors or architects with an email address in your contacts yet.
              Add them under Contacts, or type an address below.
            </p>
          ) : (
            (['contractor', 'architect'] as const).map((type) => group(type).length > 0 && (
              <div key={type}>
                <Label className="text-xs uppercase text-gray-500">
                  {type === 'contractor' ? 'Contractors' : 'Architects'}
                </Label>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {group(type).map((c) => (
                    <label
                      key={c.contactId}
                      className="flex items-start gap-2 text-sm p-2 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(c.contactId)}
                        onChange={() => toggle(c.contactId)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate">
                          {c.name}
                          {c.company ? <span className="text-gray-500"> · {c.company}</span> : null}
                        </span>
                        <span className="block text-xs text-gray-500 truncate">{c.email}</span>
                        {alreadySent.has(c.email.toLowerCase()) && (
                          <span className="text-[11px] text-green-700 flex items-center gap-1">
                            <Check className="h-3 w-3" /> already sent
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}

          <div>
            <Label className="text-xs uppercase text-gray-500">Someone not in contacts</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={extraEmail}
                onChange={(e) => setExtraEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } }}
                placeholder="name@company.com"
                className="h-9 text-sm"
              />
              <Button type="button" variant="outline" className="h-9" onClick={addExtra}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {extras.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {extras.map((e) => (
                  <span key={e.email} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-2 py-1">
                    {e.email}
                    <button
                      type="button"
                      className="text-gray-500 hover:text-red-600"
                      onClick={() => setExtras((prev) => prev.filter((x) => x.email !== e.email))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label className="text-xs uppercase text-gray-500">Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={`Invitation to Bid — ${projectName || 'Project'} (${rfpNumber || ''})`}
                className="h-9 text-sm mt-1"
              />
            </div>
            <div>
              <Label className="text-xs uppercase text-gray-500">Message</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Leave blank to use the standard note, which states the project and the bid due date."
                className="text-sm mt-1"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-600">
              {recipients.length === 0
                ? 'Nobody selected yet.'
                : `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.`}
            </span>
            <Button
              type="button"
              disabled={recipients.length === 0 || sendMutation.isPending}
              onClick={() => sendMutation.mutate({ recipients, subject, message })}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Send className="h-4 w-4 mr-2" />
              {sendMutation.isPending ? 'Sending…' : 'Send Invitation'}
            </Button>
          </div>

          {sends.length > 0 && (
            <div className="border-t pt-3">
              <Label className="text-xs uppercase text-gray-500">Who has been sent it</Label>
              <div className="mt-1 space-y-1">
                {sends.map((s) => (
                  <div key={s.id} className="flex items-start gap-2 text-xs">
                    {s.status === 'sent'
                      ? <Check className="h-3.5 w-3.5 text-green-600 mt-0.5 flex-shrink-0" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-red-600 mt-0.5 flex-shrink-0" />}
                    <span className="min-w-0">
                      <span className="text-gray-900">
                        {s.recipientName || s.recipientEmail}
                        {s.recipientCompany ? <span className="text-gray-500"> · {s.recipientCompany}</span> : null}
                      </span>
                      <span className="text-gray-500">
                        {' '}— {s.recipientType} package,{' '}
                        {new Date(s.sentAt).toLocaleDateString('en-US',
                          { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      {/* A failure says why, here, rather than only in a toast
                          that has long since disappeared. */}
                      {s.status === 'failed' && (
                        <span className="block text-red-700">Failed: {s.error || 'unknown error'}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
