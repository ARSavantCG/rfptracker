/**
 * Backups (Admin → File Storage): what's stored, a full backup to download now,
 * and the automatic daily backup to Google Drive.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { DatabaseBackup, Download, CloudUpload, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

type RunRecord = { at: string; ok: boolean; db?: { name: string; bytes: number }; filesCopied?: number; filesRemaining?: number; error?: string; by: string };
type BackupStatus = {
  configured: boolean; redirectUri: string;
  drive: { email: string | null; connectedAt: string; connectedBy: string | null; folder: string } | null;
  status: { lastRunAt?: string; lastSuccessAt?: string; running?: boolean; current?: string; filesBackedUp?: number; history: RunRecord[] };
  storage: { files: number; fileBytes: number; dbBytes: number; filesBackedUp: number };
};
const KEY = ['/api/admin/backup/status'];
const size = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const when = (s?: string) => (s ? new Date(s).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function BackupPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<BackupStatus>({ queryKey: KEY, staleTime: 0, refetchInterval: (d: any) => (d?.state?.data?.status?.running ? 4000 : false) as any });
  const d = q.data;

  // Back from Google's consent screen.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('drive');
    if (!r) return;
    const msg: Record<string, [string, boolean]> = {
      connected: ['Google Drive Connected — first backup started', false], declined: ['Google Drive Not Connected', true],
      expired: ['That sign-in link expired — try Connect again', true], failed: ['Google Drive could not be connected', true],
    };
    const [title, bad] = msg[r] ?? ['Google Drive', false];
    toast({ title, variant: bad ? 'destructive' : undefined });
    window.history.replaceState({}, '', window.location.pathname);
    qc.invalidateQueries({ queryKey: KEY });
  }, []);

  const call = async (url: string, body?: unknown) => apiRequest(url, 'POST', body);
  const download = async () => {
    try { const r: any = await call('/api/admin/backup/download-ticket'); window.location.href = r.url; toast({ title: 'Backup Download Started', description: 'Every table and every file, in one zip. Large backups take a few minutes.' }); }
    catch (e: any) { toast({ title: 'Not Started', description: e?.message, variant: 'destructive' }); }
  };
  const connect = async () => {
    try { const r: any = await call('/api/admin/backup/google/start'); window.location.href = r.url; }
    catch (e: any) { toast({ title: 'Not Connected', description: e?.message, variant: 'destructive' }); }
  };
  const runNow = async () => {
    try { await call('/api/admin/backup/run'); toast({ title: 'Backup Started' }); setTimeout(() => qc.invalidateQueries({ queryKey: KEY }), 800); }
    catch (e: any) { toast({ title: 'Not Started', description: e?.message, variant: 'destructive' }); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Drive? Backups already in the Drive stay there; automatic backups stop.')) return;
    try { await call('/api/admin/backup/google/disconnect'); qc.invalidateQueries({ queryKey: KEY }); toast({ title: 'Google Drive Disconnected' }); }
    catch (e: any) { toast({ title: 'Not Disconnected', description: e?.message, variant: 'destructive' }); }
  };

  const last = d?.status.history?.[0];
  const running = !!d?.status.running;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><DatabaseBackup className="h-5 w-5" /> Backups</CardTitle>
        <CardDescription>The whole app: every table in the database and every stored file.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!d ? <p className="text-sm text-gray-600">{q.isLoading ? 'Loading…' : 'Could not read the backup status.'}</p> : <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Fig label="Database" value={size(d.storage.dbBytes)} />
            <Fig label="Stored Files" value={`${d.storage.files.toLocaleString()} · ${size(d.storage.fileBytes)}`} />
            <Fig label="Files in Drive Backup" value={d.drive ? `${d.storage.filesBackedUp.toLocaleString()} of ${d.storage.files.toLocaleString()}` : '—'} />
            <Fig label="Last Good Backup" value={d.status.lastSuccessAt ? when(d.status.lastSuccessAt) : 'Never'} />
          </div>

          <div className="border rounded-lg p-3 space-y-2">
            <div className="font-semibold text-sm">Download Full Backup</div>
            <p className="text-xs text-gray-600">One zip with the database (as JSON) and every file, at the moment you click. Keep it anywhere: your computer, Drive, an external disk.</p>
            <Button variant="outline" onClick={download}><Download className="h-4 w-4 mr-1" /> Download Full Backup</Button>
          </div>

          <div className="border rounded-lg p-3 space-y-2">
            <div className="font-semibold text-sm">Automatic Backup to Google Drive</div>
            {!d.configured ? (
              <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>Not set up on the server yet. Two secrets are needed in Replit: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, from a Google Cloud OAuth client with this redirect address:
                  <div className="font-mono text-xs mt-1 break-all">{d.redirectUri}</div></div>
              </div>
            ) : !d.drive ? (
              <>
                <p className="text-xs text-gray-600">Connect a Google account. The app only sees the backup folder it creates ("RFPTracker Backups"), nothing else in your Drive.</p>
                <Button onClick={connect}><CloudUpload className="h-4 w-4 mr-1" /> Connect Google Drive</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-700">Backing up to <strong>{d.drive.email || 'Google Drive'}</strong>, folder <strong>{d.drive.folder}</strong>. Once a day while the app is in use: a database snapshot (newest 30 kept, plus the first of each month), and every new file.</p>
                {running ? (
                  <div className="text-sm text-blue-800 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Backing up{d.status.current ? ` — ${d.status.current}` : ''}…</div>
                ) : last ? (
                  <div className={`text-sm flex items-start gap-2 ${last.ok ? 'text-green-800' : 'text-red-800'}`}>
                    {last.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <AlertTriangle className="h-4 w-4 mt-0.5" />}
                    <span>{when(last.at)} · {last.ok ? `Database saved (${size(last.db?.bytes ?? 0)}), ${last.filesCopied ?? 0} new file${last.filesCopied === 1 ? '' : 's'} copied${last.filesRemaining ? `, ${last.filesRemaining} still to copy (continues on the next run)` : ''}` : last.error}</span>
                  </div>
                ) : null}
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" disabled={running} onClick={runNow}>Back Up Now</Button>
                  <Button variant="ghost" className="text-red-700" onClick={disconnect}>Disconnect</Button>
                </div>
                {d.status.history.length > 1 && (
                  <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer">Recent Backups</summary>
                    <ul className="mt-1 space-y-0.5">
                      {d.status.history.map((h, i) => <li key={i}>{when(h.at)} · {h.ok ? `OK · ${h.filesCopied ?? 0} files` : `Failed: ${h.error}`} · {h.by}</li>)}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
function Fig({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div><div className="font-semibold text-gray-900">{value}</div></div>;
}
