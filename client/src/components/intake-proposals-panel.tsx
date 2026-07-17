import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Check, X, Loader2 } from "lucide-react";
import type { IntakeProposal } from "@shared/schema";

interface IntakeProposalsPanelProps {
  rfpId: number;
}

const confidenceRank = (c: string | null) => (c === "high" ? 0 : c === "medium" ? 1 : 2);

export function IntakeProposalsPanel({ rfpId }: IntakeProposalsPanelProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [typedText, setTypedText] = useState("");
  const [lastMeta, setLastMeta] = useState<any>(null);

  const { data: proposals = [], isLoading } = useQuery<IntakeProposal[]>({
    queryKey: ["/api/intake-proposals", rfpId],
    enabled: !!rfpId,
  });

  const runParse = useMutation({
    mutationFn: () => apiRequest(`/api/ai/intake-parse/${rfpId}`, "POST", { typedText }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/intake-proposals", rfpId] });
      setLastMeta(data?.meta ?? null);
      const n = data?.proposals?.length ?? 0;
      toast({
        title: `AI proposed ${n} scope item${n === 1 ? "" : "s"}`,
        description: data?.meta ? `${data.meta.filesIncluded} file(s) read, ${data.meta.rulesApplied} rule(s) applied.` : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Parse failed", description: e?.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest(`/api/intake-proposals/${id}/status`, "PATCH", { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/intake-proposals", rfpId] }),
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const acceptAll = () => {
    proposals.filter((p) => p.status === "proposed").forEach((p) => setStatus.mutate({ id: p.id, status: "accepted" }));
  };
  const rejectAll = () => {
    proposals.filter((p) => p.status === "proposed").forEach((p) => setStatus.mutate({ id: p.id, status: "rejected" }));
  };

  const sorted = [...proposals].sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence));
  const pendingCount = proposals.filter((p) => p.status === "proposed").length;

  return (
    <div className="border rounded-md p-4 space-y-4 bg-purple-50/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-700" />
          <h3 className="font-semibold text-gray-900">AI Proposed Scope</h3>
        </div>
        <Button size="sm" onClick={() => runParse.mutate()} disabled={runParse.isPending} className="flex items-center gap-1">
          {runParse.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {proposals.length ? "Re-run parse" : "Run AI parse"}
        </Button>
      </div>

      <p className="text-xs text-gray-500">
        The AI reads the Step-1 files and any notes below, applies your inference rules, and proposes scope.
        Review and accept/reject — nothing is added automatically. You can always add scope manually as usual.
      </p>

      {/* Optional typed context to feed the parse */}
      <textarea
        value={typedText}
        onChange={(e) => setTypedText(e.target.value)}
        placeholder="Optional: paste a broker email or type notes to include in the parse (e.g. 'tenant only taking the north half, needs 2000A power')"
        className="w-full text-sm border border-input rounded-md p-2 min-h-[60px]"
      />

      {/* Diagnostics — shows what the parse actually saw */}
      {lastMeta && (
        <div className="text-xs bg-white border rounded-md p-2 text-gray-600 space-y-0.5">
          <div><strong>Files found for this RFP:</strong> {lastMeta.totalFilesFound ?? 0}</div>
          {lastMeta.fileNames?.length > 0 && (
            <div><strong>Files:</strong> {lastMeta.fileNames.join(", ")}</div>
          )}
          <div><strong>Files read by AI:</strong> {lastMeta.filesIncluded ?? 0}</div>
          {lastMeta.skipped?.length > 0 && (
            <div className="text-amber-600"><strong>Skipped:</strong> {lastMeta.skipped.join(", ")}</div>
          )}
          {lastMeta.skipReasons?.length > 0 && (
            <div className="text-amber-700 text-[11px]">{lastMeta.skipReasons.map((r: string, i: number) => <div key={i}>• {r}</div>)}</div>
          )}
          <div><strong>Rules applied:</strong> {lastMeta.rulesApplied ?? 0}</div>
        </div>
      )}

      {/* Bulk actions */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={acceptAll} className="flex items-center gap-1">
            <Check className="h-4 w-4" /> Accept all ({pendingCount})
          </Button>
          <Button size="sm" variant="outline" onClick={rejectAll} className="flex items-center gap-1">
            <X className="h-4 w-4" /> Reject all
          </Button>
        </div>
      )}

      {/* Proposals list */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : proposals.length === 0 ? (
        <div className="text-sm text-gray-400">No proposals yet. Click "Run AI parse" to analyze the intake.</div>
      ) : (
        <div className="space-y-2">
          {sorted.map((p) => (
            <div
              key={p.id}
              className={`border rounded-md px-3 py-2 bg-white ${
                p.status === "accepted" ? "border-green-400" : p.status === "rejected" ? "border-red-300 opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium flex items-center gap-2">
                    {p.description}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      p.matchType === "catalog-match" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {p.matchType === "catalog-match" ? "catalog match" : "needs mapping"}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{p.confidence}</span>
                  </div>
                  {p.reason && <div className="text-xs text-gray-500 mt-0.5">{p.reason}</div>}
                  {p.sourceRef && <div className="text-[10px] text-gray-400 mt-0.5">source: {p.sourceRef}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {p.status === "proposed" ? (
                    <>
                      <button
                        onClick={() => setStatus.mutate({ id: p.id, status: "accepted" })}
                        className="p-1 rounded hover:bg-green-100 text-green-600"
                        title="Accept"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setStatus.mutate({ id: p.id, status: "rejected" })}
                        className="p-1 rounded hover:bg-red-100 text-red-600"
                        title="Reject"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setStatus.mutate({ id: p.id, status: "proposed" })}
                      className="text-xs text-gray-500 hover:underline"
                      title="Reset to proposed"
                    >
                      {p.status}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
