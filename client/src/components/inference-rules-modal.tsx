import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Brain, Plus, Trash2, X } from "lucide-react";
import type { ScopeInferenceRule } from "@shared/schema";

interface InferenceRulesModalProps {
  open: boolean;
  onClose: () => void;
}

export function InferenceRulesModal({ open, onClose }: InferenceRulesModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [triggerType, setTriggerType] = useState("keyword");
  const [triggerValue, setTriggerValue] = useState("");
  const [impliedScope, setImpliedScope] = useState("");
  const [notes, setNotes] = useState("");

  const { data: rules = [], isLoading } = useQuery<ScopeInferenceRule[]>({
    queryKey: ["/api/inference-rules"],
    enabled: open,
  });

  const createRule = useMutation({
    mutationFn: () =>
      apiRequest("/api/inference-rules", "POST", {
        triggerType,
        triggerValue,
        impliedScope,
        notes: notes || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inference-rules"] });
      setTriggerValue("");
      setImpliedScope("");
      setNotes("");
      toast({ title: "Rule added" });
    },
    onError: (e: any) => toast({ title: "Failed to add rule", description: e?.message, variant: "destructive" }),
  });

  const deleteRule = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/inference-rules/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inference-rules"] });
      toast({ title: "Rule deleted" });
    },
    onError: (e: any) => toast({ title: "Failed to delete rule", description: e?.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: (rule: ScopeInferenceRule) =>
      apiRequest(`/api/inference-rules/${rule.id}`, "PUT", { isActive: !rule.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/inference-rules"] }),
    onError: (e: any) => toast({ title: "Failed to update rule", description: e?.message, variant: "destructive" }),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-700" />
            <h2 className="text-lg font-semibold text-gray-900">AI Scope Inference Rules</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          <p className="text-xs text-gray-500">
            These rules teach the AI intake parser your CRE knowledge. When it reads a Step-1 RFP/work letter,
            it applies these to propose scope. Example: trigger <strong>"partial building"</strong> implies{" "}
            <strong>"Demising Wall, Electrical Reconfiguration, Fire Alarm Reconfiguration, Fire Sprinkler Reconfiguration"</strong>.
            Add to these over time — they're the parser's brain.
          </p>

          {/* Add a rule */}
          <div className="border rounded-md p-4 space-y-3 bg-gray-50">
            <div className="font-medium text-sm text-gray-700">Add a rule</div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Trigger type</Label>
                <select
                  value={triggerType}
                  onChange={(e) => setTriggerType(e.target.value)}
                  className="w-full h-10 px-3 text-sm border border-input rounded-md bg-white"
                >
                  <option value="keyword">keyword (word/phrase in the docs)</option>
                  <option value="condition">condition (a situation)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Trigger</Label>
                <Input value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} placeholder="partial building" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Implies (scope to propose)</Label>
                <Input value={impliedScope} onChange={(e) => setImpliedScope(e.target.value)} placeholder="Demising Wall, Electrical Reconfig, Fire Alarm Reconfig, Sprinkler Reconfig" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="why / context" />
            </div>
            <Button
              size="sm"
              disabled={!triggerValue.trim() || !impliedScope.trim() || createRule.isPending}
              onClick={() => createRule.mutate()}
              className="flex items-center gap-1"
            >
              <Plus className="h-4 w-4" /> Add rule
            </Button>
          </div>

          {/* Existing rules */}
          <div className="space-y-2">
            <div className="font-medium text-sm text-gray-700">Current rules</div>
            {isLoading ? (
              <div className="text-sm text-gray-400">Loading…</div>
            ) : rules.length === 0 ? (
              <div className="text-sm text-gray-400">No rules yet. Add your first above (start with the demising-wall cascade).</div>
            ) : (
              rules.map((r) => (
                <div key={r.id} className={`border rounded-md px-4 py-2 ${r.isActive ? "" : "opacity-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm">
                      <span className="inline-block text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700 mr-2">{r.triggerType}</span>
                      <span className="font-medium">"{r.triggerValue}"</span>
                      <span className="text-gray-500"> → </span>
                      <span>{r.impliedScope}</span>
                      {r.notes && <div className="text-xs text-gray-400 mt-1">{r.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleActive.mutate(r)}
                        className="text-xs text-blue-600 hover:underline"
                        title={r.isActive ? "Disable (parser will ignore it)" : "Enable"}
                      >
                        {r.isActive ? "Active" : "Off"}
                      </button>
                      <button
                        onClick={() => { if (confirm(`Delete rule "${r.triggerValue}"?`)) deleteRule.mutate(r.id); }}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
