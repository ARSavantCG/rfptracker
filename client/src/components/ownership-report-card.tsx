/**
 * Ownership Report (slice 0b, 2026-07-21) — the number Adolfo asked to see
 * before trusting ownership scoping, plus the reassign escape hatch.
 *
 * Shows, per table, how many records the backfill resolved to a real user id
 * and how many are UNRESOLVED (= admin-only, fail closed). Each unresolved row
 * can be reassigned to a user right here, so a locked-out teammate is a
 * ten-second fix, not a code change.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldAlert } from "lucide-react";

type UnresolvedRecord = { id: number; label: string | null; name: string | null; source_text: string | null };
type TableReport = { total: number; resolved: number; unresolved: number; unresolvedRecords: UnresolvedRecord[] };
type AssignableUser = { id: string; username: string; first_name: string | null; last_name: string | null; role: string };
type OwnershipReport = {
  rfpRequests: TableReport;
  romPilots: TableReport;
  assignableUsers: AssignableUser[];
};

function userLabel(u: AssignableUser) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return name ? `${name} (${u.username})` : u.username;
}

function UnresolvedList({
  tableKey,
  apiTable,
  report,
  users,
}: {
  tableKey: string;
  apiTable: "rfp" | "rom";
  report: TableReport;
  users: AssignableUser[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Per-row selected user id; keyed by record id (stable db id per UI-STANDARDS).
  const [selection, setSelection] = useState<Record<number, string>>({});

  const reassign = useMutation({
    mutationFn: async ({ id, userId }: { id: number; userId: string }) =>
      apiRequest("/api/admin/ownership-reassign", "POST", { table: apiTable, id, userId }),
    onSuccess: () => {
      toast({ title: "Owner reassigned" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ownership-report"] });
    },
    onError: (err: any) => {
      toast({ title: "Reassign failed", description: String(err?.message || err), variant: "destructive" });
    },
  });

  if (report.unresolved === 0) {
    return (
      <p className="text-sm text-green-700 flex items-center gap-1">
        <ShieldCheck className="h-4 w-4" /> Every record has a resolved owner.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {report.unresolvedRecords.map((r) => (
        <div key={`${tableKey}-${r.id}`} className="flex flex-wrap items-center gap-2 border rounded-md p-2 text-sm">
          <span className="font-medium">{r.label || `#${r.id}`}</span>
          <span className="text-gray-600 truncate max-w-[200px]">{r.name}</span>
          <span className="text-gray-400 truncate max-w-[180px]" title="Original creator text on the record">
            {r.source_text ? `"${r.source_text}"` : "(no creator text)"}
          </span>
          <select
            className="border rounded px-2 py-1 text-sm ml-auto"
            value={selection[r.id] || ""}
            onChange={(e) => setSelection((prev) => ({ ...prev, [r.id]: e.target.value }))}
            data-testid={`ownership-select-${tableKey}-${r.id}`}
          >
            <option value="">Assign owner…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{userLabel(u)}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!selection[r.id] || reassign.isPending}
            onClick={() => reassign.mutate({ id: r.id, userId: selection[r.id] })}
            data-testid={`ownership-reassign-${tableKey}-${r.id}`}
          >
            Reassign
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function OwnershipReportCard() {
  const { data, isLoading, error } = useQuery<OwnershipReport>({
    queryKey: ["/api/admin/ownership-report"],
  });
  // Diagnostic: fetched on demand (button) so it doesn't run for every admin view.
  const [showDiag, setShowDiag] = useState(false);
  const diag = useQuery<any>({
    queryKey: ["/api/admin/ownership-diagnostic"],
    enabled: showDiag,
  });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <ShieldAlert className="h-5 w-5" />
          <span>Record Ownership</span>
        </CardTitle>
        <CardDescription>
          Below admin, people can only modify records they created. Records whose owner
          couldn't be determined are admin-only until reassigned here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-gray-500">Loading ownership report…</p>}
        {error != null && (
          <p className="text-sm text-red-600">Failed to load the ownership report.</p>
        )}
        {data && (
          <div className="space-y-6">
            {/* Contact-load diagnostic: makes an empty dropdown self-explaining. */}
            {(() => {
              const d: any = (data as any).contactDiag;
              const n = (data.assignableUsers || []).length;
              if (n > 0) return (
                <p className="text-xs text-green-700" data-testid="ownership-contact-count">
                  {n} assignable {n === 1 ? "contact" : "contacts"} loaded.
                </p>
              );
              return (
                <div className="text-xs text-red-700 border border-red-200 bg-red-50 rounded p-2" data-testid="ownership-contact-error">
                  <div className="font-medium">No assignable contacts loaded — dropdowns will be empty.</div>
                  {d?.error
                    ? <div className="mt-1 font-mono">Query error: {d.error}</div>
                    : <div className="mt-1">Contacts query returned {d?.rawCount ?? 0} rows. If this app instance points at the wrong database, that would explain it.</div>}
                </div>
              );
            })()}
            {([
              { key: "rfpRequests", apiTable: "rfp" as const, title: "RFP Requests", report: data.rfpRequests },
              { key: "romPilots", apiTable: "rom" as const, title: "ROM Pilots", report: data.romPilots },
            ]).map(({ key, apiTable, title, report }) => (
              <div key={key}>
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="font-medium">{title}</h4>
                  <Badge variant="secondary">{report.total} total</Badge>
                  <Badge variant="secondary" className="bg-green-100 text-green-800">{report.resolved} owned</Badge>
                  <Badge
                    variant="secondary"
                    className={report.unresolved > 0 ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}
                    data-testid={`ownership-unresolved-${key}`}
                  >
                    {report.unresolved} unresolved
                  </Badge>
                </div>
                <UnresolvedList tableKey={key} apiTable={apiTable} report={report} users={data.assignableUsers} />
              </div>
            ))}
          </div>
        )}

        {/* Diagnostic: why records aren't resolving. Shows the ACTUAL stored
            values vs contacts, so the matcher can be fixed from real data. */}
        <div className="mt-6 border-t pt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowDiag((v) => !v)}
            data-testid="ownership-diagnostic-toggle"
          >
            {showDiag ? "Hide" : "Show"} why records aren't matching
          </Button>
          {showDiag && (
            <div className="mt-3 text-sm space-y-4">
              {diag.isLoading && <p className="text-gray-500">Loading diagnostic…</p>}
              {diag.error != null && <p className="text-red-600">Failed to load diagnostic.</p>}
              {diag.data && (
                <>
                  <div>
                    <h5 className="font-medium mb-1">Known contacts ({diag.data.contacts?.length ?? 0})</h5>
                    <div className="max-h-40 overflow-auto border rounded p-2 space-y-0.5">
                      {(diag.data.contacts || []).map((c: any) => (
                        <div key={c.ownerId} className="text-xs text-gray-700">
                          <span className="font-mono">{c.ownerId}</span> — {c.name}
                          {c.company ? ` (${c.company})` : ""} · {c.email}
                          {c.type ? ` · ${c.type}` : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                  {(["rfp_requests", "rom_pilots"] as const).map((tbl) => (
                    <div key={tbl}>
                      <h5 className="font-medium mb-1">
                        Unmatched values in {tbl} ({(diag.data.tables?.[tbl] || []).length})
                      </h5>
                      <div className="max-h-56 overflow-auto border rounded p-2 space-y-0.5">
                        {(diag.data.tables?.[tbl] || []).map((r: any, i: number) => (
                          <div key={`${tbl}-${i}`} className="text-xs flex items-center gap-2">
                            <span className={r.matchesContact ? "text-green-700" : "text-amber-700"}>
                              {r.matchesContact ? "✓ would match" : "✗ no match"}
                            </span>
                            <span className="text-gray-500">×{r.count}</span>
                            <span className="font-mono text-gray-800 truncate">
                              {r.value === null ? "(null)" : `"${r.value}"`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-gray-500">
                    "✗ no match" rows are why ownership isn't resolving — the stored text doesn't
                    equal any contact name or email. Share this with whoever's fixing the matcher.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
