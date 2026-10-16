/**
 * Pinned reports, plus a browse-everything catalog.
 *
 * Deliberately self-contained. It mounts ABOVE the existing Reports page and
 * changes nothing below it, so if this breaks the page people use every day
 * still works. The hand-written cards get folded into the catalog in a later
 * pass, once this has proven itself in production.
 *
 * The catalog is the point as much as the pinning is: four of the reports in it
 * were not reachable from this page at all, and nobody can pin a report they
 * cannot find.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Star, Link2, Search, ChevronDown, ChevronRight, AlertTriangle, X,
  Building2, ListChecks, Clock, FileText, TrendingUp, Users, DollarSign,
  TableIcon, ClipboardList, FileBarChart, Tags, BarChart3,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { AUTH_TOKEN_KEY } from '@/lib/auth-constants';
import {
  REPORT_CATEGORIES,
  type ReportDefinition,
  type ReportParam,
  buildReportUrl,
} from '@shared/report-catalog';

// The catalog stores an icon NAME, not a component — it is shared code and
// cannot import from lucide. Anything unmapped falls back rather than crashing
// the panel, which is what an undefined component in JSX would do.
const ICONS: Record<string, any> = {
  Building2, ListChecks, Clock, FileText, TrendingUp, Users, DollarSign,
  TableIcon, ClipboardList, FileBarChart, Tags,
};
const iconFor = (name?: string) => ICONS[name || ''] || BarChart3;

/**
 * Label a shared link's report with its scope, resolving a property id to its
 * name. Falls back to the raw value rather than hiding it: a link to a property
 * that has since been deleted should still say what it was aimed at.
 */
function describeIncoming(
  def: ReportDefinition,
  params: Record<string, string>,
  properties: any[],
): string {
  const parts: string[] = [];
  for (const param of def.params) {
    const raw = params[param.name];
    if (!raw) continue;
    if (param.type === 'boolean') { parts.push(param.label); continue; }
    if (param.type === 'property') {
      const p = properties.find((x: any) => String(x.id) === String(raw));
      parts.push(p ? (p.building ? `${p.propertyName} — Bldg. ${p.building}` : p.propertyName) : raw);
      continue;
    }
    parts.push(raw);
  }
  return parts.length ? `${def.label} — ${parts.join(' · ')}` : def.label;
}

interface PinnedReport {
  id: number;
  reportKey: string;
  label: string;
  url: string | null;
  kind: 'api' | 'page' | null;
  icon?: string;
  answers?: string;
  params?: Record<string, string>;
  available: boolean;
  reason?: string;
  droppedParams?: string[];
}

export function PinnedReports() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [browseOpen, setBrowseOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Parameter values chosen in the catalog, keyed "<reportKey>.<paramName>".
  const [draftParams, setDraftParams] = useState<Record<string, string>>({});

  const { data: catalogData } = useQuery<{ reports: ReportDefinition[] }>({
    queryKey: ['/api/reports/catalog'],
  });
  const { data: pinData } = useQuery<{ pins: PinnedReport[] }>({
    queryKey: ['/api/me/report-pins'],
  });
  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ['/api/properties'],
  });

  const reports = catalogData?.reports || [];
  const pins = pinData?.pins || [];

  // Property NAMES are distinct from property rows: a name covers every
  // building under it, which is what the portfolio report scopes by.
  const propertyNames = useMemo(
    () => Array.from(new Set(properties.map((p: any) => p.propertyName).filter(Boolean))).sort(),
    [properties],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['/api/me/report-pins'] });

  const pinMutation = useMutation({
    mutationFn: (vars: { reportKey: string; params: Record<string, string> }) =>
      apiRequest('/api/me/report-pins', 'POST', vars),
    onSuccess: (_data, vars) => {
      refresh();
      const def = reports.find((r) => r.key === vars.reportKey);
      toast({ title: 'Pinned', description: `${def?.label || 'Report'} added to the top of this page.` });
    },
    onError: (error: any) =>
      toast({ title: 'Could not pin', description: error?.message || 'Unknown error', variant: 'destructive' }),
  });

  const unpinMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/me/report-pins/${id}`, 'DELETE'),
    onSuccess: () => refresh(),
    onError: (error: any) =>
      toast({ title: 'Could not remove the pin', description: error?.message || 'Unknown error', variant: 'destructive' }),
  });

  /**
   * Open a report. An 'api' report is HTML behind an auth token, so it has to
   * be fetched and opened as a blob; a 'page' is an in-app route.
   */
  const open = async (kind: 'api' | 'page' | null, url: string | null, label: string) => {
    if (!url) return;
    if (kind === 'page') {
      navigate(url);
      return;
    }
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        let detail = `Report failed (${response.status})`;
        try {
          const body = await response.json();
          if (body?.message) detail = body.message;
        } catch { /* HTML or empty body — keep the status */ }
        throw new Error(detail);
      }
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      if (!window.open(objectUrl, '_blank')) {
        toast({ title: 'Pop-up blocked', description: 'Allow pop-ups for this site to open the report.', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Report error:', error);
      toast({
        title: `Could not open ${label}`,
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  /**
   * Copy a shareable link.
   *
   * It points at THIS PAGE with ?open=<key>, not at the report's API URL.
   *
   * A raw API link cannot work when pasted: five of the report endpoints accept
   * the token in an Authorization header only, and a browser following a pasted
   * link sends no header and no cookie — the recipient gets a 401. The only way
   * to make the raw URL work would be to append the sender's own token to it,
   * which hands over their credentials to anyone the link reaches.
   *
   * Pointing at the app instead means the recipient's browser loads the SPA,
   * authenticates as THEMSELVES, and fetches the report with their own token and
   * their own permissions. Nothing is shared except which report to open.
   */
  const copyLink = async (
    reportKey: string,
    params: Record<string, string> | undefined,
    label: string,
  ) => {
    const search = new URLSearchParams({ open: reportKey });
    for (const [k, v] of Object.entries(params || {})) {
      if (v) search.set(k, v);
    }
    const absolute = `${window.location.origin}/reports?${search.toString()}`;
    try {
      await navigator.clipboard.writeText(absolute);
      toast({
        title: 'Link copied',
        description: `${label} — opens for anyone signed in to the app.`,
      });
    } catch {
      // Clipboard access is refused in some mobile and embedded browsers.
      window.prompt('Copy this link:', absolute);
    }
  };

  const isPinned = (def: ReportDefinition, params: Record<string, string>) => {
    const norm = (p: Record<string, string> | undefined) =>
      Object.keys(p || {}).sort().map((k) => `${k}=${(p || {})[k]}`).join('&');
    return pins.some((pin) => pin.reportKey === def.key && norm(pin.params) === norm(params));
  };

  const paramsFor = (def: ReportDefinition): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const param of def.params) {
      const value = draftParams[`${def.key}.${param.name}`];
      if (value) out[param.name] = value;
    }
    return out;
  };

  const setParam = (def: ReportDefinition, param: ReportParam, value: string) =>
    setDraftParams((prev) => ({ ...prev, [`${def.key}.${param.name}`]: value }));

  /**
   * A shared link landing here: ?open=<reportKey> plus that report's parameters.
   *
   * Shown as a banner rather than opened automatically. Auto-opening would fire
   * a window.open outside any user gesture, which every pop-up blocker stops —
   * the person would see nothing and assume the link was broken. One button also
   * means they know what they are about to open before a tab appears.
   */
  const incoming = useMemo(() => {
    const search = new URLSearchParams(window.location.search);
    const key = search.get('open');
    if (!key) return null;
    const def = reports.find((r) => r.key === key);
    if (!def) return null;
    const params: Record<string, string> = {};
    for (const param of def.params) {
      const value = search.get(param.name);
      if (value) params[param.name] = value;
    }
    return { def, params };
  }, [reports]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter(
      (r) => r.label.toLowerCase().includes(q) || r.answers.toLowerCase().includes(q),
    );
  }, [reports, search]);

  return (
    <div className="space-y-4">
      {/* ---- Someone shared a link --------------------------------------- */}
      {incoming && (
        <Card className="border-blue-300 bg-blue-50">
          <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                Shared with you: {describeIncoming(incoming.def, incoming.params, properties)}
              </div>
              <div className="text-xs text-gray-600">{incoming.def.answers}</div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                size="sm"
                onClick={() =>
                  open(incoming.def.kind, buildReportUrl(incoming.def, incoming.params), incoming.def.label)
                }
              >
                Open report
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => pinMutation.mutate({ reportKey: incoming.def.key, params: incoming.params })}
              >
                <Star className="h-4 w-4 mr-1" />
                Pin it
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Pinned strip -------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 text-amber-500" />
              <span>Your Reports</span>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setBrowseOpen((v) => !v)}>
              {browseOpen ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
              Browse all reports
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {pins.length === 0 ? (
            <p className="text-sm text-gray-600">
              Nothing pinned yet. Open <strong>Browse all reports</strong> and star the ones you
              use — they'll sit here every time you come back.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {pins.map((pin) => {
                const Icon = iconFor(pin.icon);
                return (
                  <div
                    key={pin.id}
                    className={`flex items-center gap-2 rounded-md border p-2 ${
                      pin.available ? 'bg-white hover:border-blue-400' : 'bg-amber-50 border-amber-200'
                    }`}
                  >
                    {pin.available ? (
                      <Icon className="h-4 w-4 text-blue-600 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                    )}
                    <button
                      className="flex-1 min-w-0 text-left"
                      disabled={!pin.available}
                      onClick={() => open(pin.kind, pin.url, pin.label)}
                    >
                      <div className="text-sm font-medium truncate">{pin.label}</div>
                      {!pin.available && (
                        <div className="text-xs text-amber-800">{pin.reason}</div>
                      )}
                      {pin.available && pin.droppedParams && (
                        <div className="text-xs text-amber-700">
                          Opens unscoped — this report no longer takes {pin.droppedParams.join(', ')}.
                        </div>
                      )}
                    </button>
                    {pin.available && (
                      <button
                        title="Copy a link to this report"
                        className="p-1 text-gray-400 hover:text-blue-600"
                        onClick={() => copyLink(pin.reportKey, pin.params, pin.label)}
                      >
                        <Link2 className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      title="Remove this pin"
                      className="p-1 text-gray-400 hover:text-red-600"
                      onClick={() => unpinMutation.mutate(pin.id)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Browse everything -------------------------------------------- */}
      {browseOpen && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">All Reports</CardTitle>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                className="pl-10"
                placeholder="Search by name, or by what you're trying to find out..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {REPORT_CATEGORIES.map((category) => {
              const inCategory = filtered.filter((r) => r.category === category);
              if (inCategory.length === 0) return null;
              return (
                <div key={category}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {inCategory.map((def) => {
                      const Icon = iconFor(def.icon);
                      const params = paramsFor(def);
                      const pinned = isPinned(def, params);
                      const url = buildReportUrl(def, params);
                      return (
                        <div key={def.key} className="rounded-md border p-3 hover:border-blue-300">
                          <div className="flex items-start gap-3">
                            <Icon className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm">{def.label}</div>
                              <div className="text-xs text-gray-600">{def.answers}</div>

                              {def.params.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {def.params.map((param) => {
                                    const value = draftParams[`${def.key}.${param.name}`] || '';
                                    if (param.type === 'boolean') {
                                      return (
                                        <label key={param.name} className="flex items-center gap-1.5 text-xs text-gray-700">
                                          <input
                                            type="checkbox"
                                            checked={value === 'true'}
                                            onChange={(e) => setParam(def, param, e.target.checked ? 'true' : '')}
                                          />
                                          {param.label}
                                        </label>
                                      );
                                    }
                                    const options = param.type === 'propertyName'
                                      ? propertyNames.map((n: string) => ({ value: n, label: n }))
                                      : properties.map((p: any) => ({
                                          value: String(p.id),
                                          label: p.building ? `${p.propertyName} — Bldg. ${p.building}` : p.propertyName,
                                        }));
                                    return (
                                      <select
                                        key={param.name}
                                        value={value}
                                        onChange={(e) => setParam(def, param, e.target.value)}
                                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                      >
                                        <option value="">{param.blankMeans || `All ${param.label.toLowerCase()}`}</option>
                                        {options.map((o) => (
                                          <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                      </select>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                title={pinned ? 'Already pinned' : 'Pin to the top of this page'}
                                disabled={pinned || pinMutation.isPending}
                                onClick={() => pinMutation.mutate({ reportKey: def.key, params })}
                                className={`p-1.5 rounded-md ${
                                  pinned ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'
                                }`}
                              >
                                <Star className="h-4 w-4" fill={pinned ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                title="Copy a link to this report"
                                onClick={() => copyLink(def.key, params, def.label)}
                                className="p-1.5 rounded-md text-gray-400 hover:text-blue-600"
                              >
                                <Link2 className="h-4 w-4" />
                              </button>
                              <Button size="sm" variant="outline" onClick={() => open(def.kind, url, def.label)}>
                                Open
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-sm text-gray-600">No report matches "{search}".</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
