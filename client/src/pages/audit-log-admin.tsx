import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ChevronDown, ChevronRight, ChevronLeft, Filter, RefreshCw } from "lucide-react";
import Navigation from "@/components/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

interface AuditEntry {
  id: string;
  eventType: string;
  userId: string | null;
  userEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  changedFields: string[] | null;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  totalPages: number;
}

function eventTypeBadge(eventType: string) {
  if (eventType === 'login_success')
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 font-mono text-xs">{eventType}</Badge>;
  if (eventType === 'login_failure')
    return <Badge className="bg-red-100 text-red-800 hover:bg-red-100 font-mono text-xs">{eventType}</Badge>;
  return <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100 font-mono text-xs">{eventType}</Badge>;
}

function metaPreview(meta: Record<string, unknown> | null): string {
  if (!meta) return '—';
  const s = JSON.stringify(meta);
  return s.length > 60 ? s.slice(0, 58) + '…' : s;
}

function ExpandedRow({ entry }: { entry: AuditEntry }) {
  const fields: [string, unknown][] = [
    ['id', entry.id],
    ['event_type', entry.eventType],
    ['user_id', entry.userId],
    ['user_email', entry.userEmail],
    ['entity_type', entry.entityType],
    ['entity_id', entry.entityId],
    ['metadata', entry.metadata],
    ['before_data', entry.beforeData],
    ['after_data', entry.afterData],
    ['changed_fields', entry.changedFields],
    ['created_at', entry.createdAt],
  ];
  return (
    <tr>
      <td colSpan={5} className="px-4 pb-3 pt-0 bg-gray-50 border-b">
        <div className="rounded border bg-white p-3 text-xs font-mono space-y-1 overflow-x-auto">
          {fields.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-gray-400 min-w-[130px]">{k}</span>
              <span className="text-gray-800 break-all">
                {v === null || v === undefined
                  ? <span className="text-gray-300">null</span>
                  : typeof v === 'object'
                    ? <pre className="inline whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre>
                    : String(v)}
              </span>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

export default function AuditLogAdmin() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [userEmailSearch, setUserEmailSearch] = useState('');
  const [appliedEmail, setAppliedEmail] = useState('');
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: eventTypes = [] } = useQuery<string[]>({
    queryKey: ['/api/admin/audit-log/event-types'],
  });

  const params = new URLSearchParams();
  params.set('page', String(page));
  if (appliedEmail) params.set('userEmail', appliedEmail);
  if (selectedEventTypes.length) params.set('eventTypes', selectedEventTypes.join(','));
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  const { data, isLoading, refetch } = useQuery<AuditResponse>({
    queryKey: ['/api/admin/audit-log', params.toString()],
    queryFn: () =>
      fetch(`/api/admin/audit-log?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` },
        credentials: 'include',
      }).then(r => r.json()),
  });

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 text-center text-gray-600">
            Admin access required.{' '}
            <Link href="/admin" className="text-blue-600 underline">Back to Admin</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const entries = data?.entries ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  function applyFilters() {
    setAppliedEmail(userEmailSearch);
    setPage(1);
  }

  function clearFilters() {
    setUserEmailSearch('');
    setAppliedEmail('');
    setSelectedEventTypes([]);
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  function toggleEventType(et: string) {
    setSelectedEventTypes(prev =>
      prev.includes(et) ? prev.filter(x => x !== et) : [...prev, et]
    );
    setPage(1);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-blue-600" />
              Audit Log
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Security and activity events — admin view only
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Link href="/admin">
              <Button variant="outline" size="sm">← Admin Panel</Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-4">
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <Filter className="h-3 w-3" /> Event Type
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(eventTypes.length ? eventTypes : ['login_success', 'login_failure']).map(et => (
                    <button
                      key={et}
                      onClick={() => toggleEventType(et)}
                      className={`px-2 py-1 rounded text-xs font-mono border transition-colors ${
                        selectedEventTypes.includes(et)
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {et}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">User Email</label>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="Partial match…"
                    value={userEmailSearch}
                    onChange={e => setUserEmailSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && applyFilters()}
                    className="w-48 h-8 text-sm"
                  />
                  <Button size="sm" onClick={applyFilters} className="h-8">Search</Button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
                <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="w-36 h-8 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
                <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="w-36 h-8 text-sm" />
              </div>
              {(appliedEmail || selectedEventTypes.length > 0 || dateFrom || dateTo) && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-gray-500">
                  Clear filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {isLoading ? 'Loading…' : `${total.toLocaleString()} event${total !== 1 ? 's' : ''}`}
              </CardTitle>
              <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600 whitespace-nowrap w-8"></th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600 whitespace-nowrap">Timestamp</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600 whitespace-nowrap">Event Type</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">User Email</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-gray-400">Loading…</td>
                    </tr>
                  ) : entries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-gray-400">
                        No events found.
                      </td>
                    </tr>
                  ) : (
                    entries.map(entry => (
                      <>
                        <tr
                          key={entry.id}
                          className="border-b hover:bg-gray-50 cursor-pointer"
                          onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                        >
                          <td className="px-4 py-2.5 text-gray-400">
                            {expandedId === entry.id
                              ? <ChevronDown className="h-3.5 w-3.5" />
                              : <ChevronRight className="h-3.5 w-3.5" />}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 text-xs">
                            {new Date(entry.createdAt).toLocaleString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                              hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
                            })}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {eventTypeBadge(entry.eventType)}
                          </td>
                          <td className="px-4 py-2.5 text-gray-700 max-w-xs truncate">
                            {entry.userEmail ?? <span className="text-gray-300 italic">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs max-w-xs truncate font-mono">
                            {metaPreview(entry.metadata)}
                          </td>
                        </tr>
                        {expandedId === entry.id && <ExpandedRow key={`${entry.id}-expanded`} entry={entry} />}
                      </>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="flex items-center gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </Button>
                <span className="text-xs text-gray-500">
                  Page {page} of {totalPages} · {total.toLocaleString()} total events
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
