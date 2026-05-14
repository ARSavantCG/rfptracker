import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle, XCircle, Copy, Download, RefreshCw } from "lucide-react";
import MasterScopeItemPicker, { type MasterScopeSelection } from "@/components/master-scope-item-picker";

interface QueueGroup {
  descriptionNormalized: string;
  displayDescription: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sources: Record<string, number>;
  entries: { id: string; sourceType: string; sourceLineItemId?: string; createdAt: string }[];
}

interface ReviewedEntry {
  id: string;
  customDescription: string;
  status: string;
  sourceType: string;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  notes?: string;
  promotedMasterItemId?: number;
  duplicateOfMasterItemId?: number;
}

interface PromoteDialogState {
  open: boolean;
  group: QueueGroup | null;
  finalDescription: string;
  csiDivision: string;
  unit: string;
  defaultUnitPrice: string;
}

interface DuplicateDialogState {
  open: boolean;
  group: QueueGroup | null;
  selectedMasterItemId: number | null;
  selectedMasterName: string;
}

interface RejectDialogState {
  open: boolean;
  group: QueueGroup | null;
  notes: string;
}

export default function ScopeItemReview() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [promoteDialog, setPromoteDialog] = useState<PromoteDialogState>({
    open: false,
    group: null,
    finalDescription: "",
    csiDivision: "",
    unit: "",
    defaultUnitPrice: "",
  });

  const [duplicateDialog, setDuplicateDialog] = useState<DuplicateDialogState>({
    open: false,
    group: null,
    selectedMasterItemId: null,
    selectedMasterName: "",
  });

  const [rejectDialog, setRejectDialog] = useState<RejectDialogState>({
    open: false,
    group: null,
    notes: "",
  });

  const { data: pendingGroups = [], isLoading: pendingLoading } = useQuery<QueueGroup[]>({
    queryKey: ["/api/admin/scope-item-review/pending"],
  });

  const { data: promotedEntries = [], isLoading: promotedLoading } = useQuery<ReviewedEntry[]>({
    queryKey: ["/api/admin/scope-item-review/promoted"],
  });

  const { data: rejectedEntries = [], isLoading: rejectedLoading } = useQuery<ReviewedEntry[]>({
    queryKey: ["/api/admin/scope-item-review/rejected"],
  });

  const { data: duplicateEntries = [], isLoading: duplicateLoading } = useQuery<ReviewedEntry[]>({
    queryKey: ["/api/admin/scope-item-review/duplicates"],
  });

  const importLegacyMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/scope-item-review/import-legacy", {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/pending"] });
      toast({
        title: "Legacy import complete",
        description: `${data.imported ?? 0} new entries queued, ${data.skipped ?? 0} already present.`,
      });
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const promoteMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/admin/scope-item-review/promote", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/promoted"] });
      setPromoteDialog((d) => ({ ...d, open: false }));
      toast({ title: "Promoted to master list" });
    },
    onError: () => toast({ title: "Promote failed", variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/admin/scope-item-review/duplicate", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/duplicates"] });
      setDuplicateDialog((d) => ({ ...d, open: false }));
      toast({ title: "Marked as duplicate" });
    },
    onError: () => toast({ title: "Action failed", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/admin/scope-item-review/reject", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scope-item-review/rejected"] });
      setRejectDialog((d) => ({ ...d, open: false }));
      toast({ title: "Marked as rejected" });
    },
    onError: () => toast({ title: "Action failed", variant: "destructive" }),
  });

  const openPromote = (group: QueueGroup) => {
    setPromoteDialog({
      open: true,
      group,
      finalDescription: group.displayDescription,
      csiDivision: "",
      unit: "",
      defaultUnitPrice: "",
    });
  };

  const openDuplicate = (group: QueueGroup) => {
    setDuplicateDialog({ open: true, group, selectedMasterItemId: null, selectedMasterName: "" });
  };

  const openReject = (group: QueueGroup) => {
    setRejectDialog({ open: true, group, notes: "" });
  };

  const handlePromoteSubmit = () => {
    if (!promoteDialog.group || !promoteDialog.csiDivision.trim() || !promoteDialog.unit.trim()) return;
    promoteMutation.mutate({
      descriptionNormalized: promoteDialog.group.descriptionNormalized,
      finalDescription: promoteDialog.finalDescription.trim(),
      csiDivision: promoteDialog.csiDivision.trim(),
      unit: promoteDialog.unit.trim(),
      defaultUnitPrice: promoteDialog.defaultUnitPrice.trim() || null,
    });
  };

  const handleDuplicateSubmit = () => {
    if (!duplicateDialog.group || !duplicateDialog.selectedMasterItemId) return;
    duplicateMutation.mutate({
      descriptionNormalized: duplicateDialog.group.descriptionNormalized,
      masterItemId: duplicateDialog.selectedMasterItemId,
    });
  };

  const handleRejectSubmit = () => {
    if (!rejectDialog.group) return;
    rejectMutation.mutate({
      descriptionNormalized: rejectDialog.group.descriptionNormalized,
      notes: rejectDialog.notes.trim() || null,
    });
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const sourceLabel = (sources: Record<string, number>) =>
    Object.entries(sources)
      .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
      .join(", ");

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scope Item Review Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review custom &ldquo;Other&rdquo; entries from Evaluation Budget and promote worthy items to the master list.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => importLegacyMutation.mutate()}
          disabled={importLegacyMutation.isPending}
          className="flex items-center gap-2"
        >
          <Download className="h-4 w-4" />
          {importLegacyMutation.isPending ? "Importing…" : "Import Legacy Free-Types"}
        </Button>
      </div>

      <Tabs defaultValue="pending">
        <TabsList className="mb-4">
          <TabsTrigger value="pending" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Pending
            {pendingGroups.length > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs">{pendingGroups.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="promoted" className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Promoted
          </TabsTrigger>
          <TabsTrigger value="rejected" className="flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            Rejected
          </TabsTrigger>
          <TabsTrigger value="duplicates" className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            Duplicates
          </TabsTrigger>
        </TabsList>

        {/* PENDING TAB */}
        <TabsContent value="pending">
          {pendingLoading ? (
            <div className="text-center py-8 text-gray-400">Loading…</div>
          ) : pendingGroups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-3 text-green-500" />
                No pending items — queue is clear.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingGroups.map((group) => (
                <Card key={group.descriptionNormalized} className="border-amber-200">
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900">{group.displayDescription}</span>
                          <Badge variant="outline" className="text-xs">
                            {group.count} {group.count === 1 ? "use" : "uses"}
                          </Badge>
                        </div>
                        <div className="text-xs text-gray-500 mt-1 space-x-3">
                          <span>First: {formatDate(group.firstSeen)}</span>
                          <span>Latest: {formatDate(group.lastSeen)}</span>
                          <span>Sources: {sourceLabel(group.sources)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button size="sm" onClick={() => openPromote(group)} className="h-8 bg-green-600 hover:bg-green-700">
                          Promote
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openDuplicate(group)} className="h-8">
                          Duplicate
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openReject(group)} className="h-8 text-red-600 border-red-200 hover:bg-red-50">
                          Reject
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* PROMOTED TAB */}
        <TabsContent value="promoted">
          {promotedLoading ? (
            <div className="text-center py-8 text-gray-400">Loading…</div>
          ) : promotedEntries.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-gray-500">No promoted entries yet.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {promotedEntries.map((e) => (
                <Card key={e.id} className="border-green-200">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm">{e.customDescription}</span>
                        <span className="text-xs text-gray-500 ml-3">from {e.sourceType.replace(/_/g, " ")}</span>
                      </div>
                      <div className="text-xs text-gray-400">
                        {e.reviewedAt ? `Promoted ${formatDate(e.reviewedAt)}` : ""}
                        {e.reviewedBy ? ` by ${e.reviewedBy}` : ""}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* REJECTED TAB */}
        <TabsContent value="rejected">
          {rejectedLoading ? (
            <div className="text-center py-8 text-gray-400">Loading…</div>
          ) : rejectedEntries.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-gray-500">No rejected entries.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {rejectedEntries.map((e) => (
                <Card key={e.id} className="border-red-100">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm">{e.customDescription}</span>
                        {e.notes && <span className="text-xs text-gray-500 ml-3 italic">{e.notes}</span>}
                      </div>
                      <div className="text-xs text-gray-400">
                        {e.reviewedAt ? `Rejected ${formatDate(e.reviewedAt)}` : ""}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* DUPLICATES TAB */}
        <TabsContent value="duplicates">
          {duplicateLoading ? (
            <div className="text-center py-8 text-gray-400">Loading…</div>
          ) : duplicateEntries.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-gray-500">No duplicates marked.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {duplicateEntries.map((e) => (
                <Card key={e.id} className="border-gray-200">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm">{e.customDescription}</span>
                        {e.duplicateOfMasterItemId && (
                          <span className="text-xs text-gray-500 ml-3">→ master item #{e.duplicateOfMasterItemId}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400">
                        {e.reviewedAt ? `Marked ${formatDate(e.reviewedAt)}` : ""}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* PROMOTE DIALOG */}
      <Dialog open={promoteDialog.open} onOpenChange={(o) => setPromoteDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Promote to Master List</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Final Description</Label>
              <Input
                value={promoteDialog.finalDescription}
                onChange={(e) => setPromoteDialog((d) => ({ ...d, finalDescription: e.target.value }))}
                placeholder="Description as it will appear in the master list"
              />
            </div>
            <div>
              <Label>
                CSI Division <span className="text-red-500">*</span>
              </Label>
              <Input
                value={promoteDialog.csiDivision}
                onChange={(e) => setPromoteDialog((d) => ({ ...d, csiDivision: e.target.value }))}
                placeholder="e.g. 09 - Finishes"
              />
            </div>
            <div>
              <Label>
                Unit <span className="text-red-500">*</span>
              </Label>
              <Input
                value={promoteDialog.unit}
                onChange={(e) => setPromoteDialog((d) => ({ ...d, unit: e.target.value }))}
                placeholder="sf, lf, ea, ls, $"
              />
            </div>
            <div>
              <Label>Default Unit Price (optional)</Label>
              <Input
                value={promoteDialog.defaultUnitPrice}
                onChange={(e) => setPromoteDialog((d) => ({ ...d, defaultUnitPrice: e.target.value }))}
                placeholder="0.00"
                type="number"
                step="0.01"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteDialog((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button
              onClick={handlePromoteSubmit}
              disabled={
                promoteMutation.isPending ||
                !promoteDialog.finalDescription.trim() ||
                !promoteDialog.csiDivision.trim() ||
                !promoteDialog.unit.trim()
              }
              className="bg-green-600 hover:bg-green-700"
            >
              {promoteMutation.isPending ? "Promoting…" : "Promote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DUPLICATE DIALOG */}
      <Dialog open={duplicateDialog.open} onOpenChange={(o) => setDuplicateDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Duplicate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              Select the existing master item that &ldquo;{duplicateDialog.group?.displayDescription}&rdquo; duplicates.
            </p>
            <div>
              <Label>Existing Master Item</Label>
              <MasterScopeItemPicker
                searchEndpoint="/api/master-scope-items/search"
                value={duplicateDialog.selectedMasterName}
                onSelect={(sel: MasterScopeSelection) => {
                  if (sel.type === "master" && sel.masterItemId) {
                    setDuplicateDialog((d) => ({
                      ...d,
                      selectedMasterItemId: sel.masterItemId!,
                      selectedMasterName: sel.description,
                    }));
                  }
                }}
                placeholder="Search master items…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateDialog((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button
              onClick={handleDuplicateSubmit}
              disabled={duplicateMutation.isPending || !duplicateDialog.selectedMasterItemId}
            >
              {duplicateMutation.isPending ? "Saving…" : "Mark as Duplicate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REJECT DIALOG */}
      <Dialog open={rejectDialog.open} onOpenChange={(o) => setRejectDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              Reject &ldquo;{rejectDialog.group?.displayDescription}&rdquo; — it will not be promoted to the master list.
            </p>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={rejectDialog.notes}
                onChange={(e) => setRejectDialog((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Reason for rejection…"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button
              onClick={handleRejectSubmit}
              disabled={rejectMutation.isPending}
              variant="destructive"
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
