import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Pencil } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RomLine {
  masterItemId: number;
  label: string;
  totalPrice: number;
}

interface ActualLine {
  id: number;
  category: string;
  vendorName: string | null;
  totalCost: number;
  notes: string | null;
  linkedMasterItemIds: number[];
}

interface ProjectActual {
  id: number;
  lineItems: ActualLine[];
}

interface EvalBudget {
  tenantImprovements: any[];
  designSoftCosts: any[];
}

interface FormState {
  category: string;
  vendorName: string;
  totalCost: string;
  linkedIds: number[];
}

export interface RfpActualsSectionProps {
  rfpId: number;
  rfpIsLeased: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function parseRomPrice(totalPrice: string | null | undefined): number {
  if (!totalPrice) return 0;
  return parseFloat(String(totalPrice).replace(/[^0-9.-]/g, "")) || 0;
}

const EMPTY_FORM: FormState = { category: "", vendorName: "", totalCost: "", linkedIds: [] };

// ─── Main Component ───────────────────────────────────────────────────────────

export function RfpActualsSection({ rfpId, rfpIsLeased }: RfpActualsSectionProps) {
  const queryClient = useQueryClient();
  const [addForm, setAddForm] = useState<FormState | null>(null);
  const [editState, setEditState] = useState<{ lineId: number; form: FormState } | null>(null);

  // ── Data fetches ────────────────────────────────────────────────────────────

  const { data: evalBudget } = useQuery<EvalBudget>({
    queryKey: [`/api/rfp-requests/${rfpId}/evaluation-budget`],
    enabled: rfpIsLeased && !!rfpId,
  });

  const { data: actual, isLoading: actualsLoading } = useQuery<ProjectActual>({
    queryKey: [`/api/rfp-requests/${rfpId}/actuals`],
    enabled: rfpIsLeased && !!rfpId,
  });

  // ── Derived: ROM lines (linkable = masterItemId non-null) ───────────────────

  const romLines = useMemo<RomLine[]>(() => {
    if (!evalBudget) return [];
    const all = [
      ...((evalBudget.tenantImprovements as any[]) || []),
      ...((evalBudget.designSoftCosts as any[]) || []),
    ];
    return all
      .filter((li: any) => li.masterItemId != null)
      .map((li: any) => ({
        masterItemId: li.masterItemId as number,
        label:
          li.romSnapshot?.label ||
          li.customDescription ||
          `Item ${li.masterItemId}`,
        totalPrice: parseRomPrice(li.totalPrice),
      }));
  }, [evalBudget]);

  // Total ROM (all budget lines, including non-linkable, for full-scope rollup)
  const totalRom = useMemo(() => {
    if (!evalBudget) return 0;
    const all = [
      ...((evalBudget.tenantImprovements as any[]) || []),
      ...((evalBudget.designSoftCosts as any[]) || []),
    ];
    return all.reduce((sum: number, li: any) => sum + parseRomPrice(li.totalPrice), 0);
  }, [evalBudget]);

  const allLineItems: ActualLine[] = actual?.lineItems ?? [];

  const totalActuals = useMemo(
    () => allLineItems.reduce((sum, li) => sum + (li.totalCost || 0) / 100, 0),
    [allLineItems]
  );

  // Map masterItemId → owning category label (for exclusive linking display)
  const linkedByLine = useMemo(() => {
    const map = new Map<number, string>();
    for (const li of allLineItems) {
      for (const mid of li.linkedMasterItemIds || []) {
        map.set(mid, li.category);
      }
    }
    return map;
  }, [allLineItems]);

  // ── Mutations ───────────────────────────────────────────────────────────────

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfpId}/actuals`] });

  const addMutation = useMutation({
    mutationFn: (form: FormState) =>
      apiRequest(`/api/project-actuals/${actual!.id}/line-items`, "POST", {
        category: form.category.trim(),
        vendorName: form.vendorName.trim() || null,
        totalCost: parseFloat(form.totalCost.replace(/,/g, "")) || 0,
        linkedMasterItemIds: form.linkedIds,
      }),
    onSuccess: () => { invalidate(); setAddForm(null); },
  });

  const editMutation = useMutation({
    mutationFn: ({ lineId, form }: { lineId: number; form: FormState }) =>
      apiRequest(`/api/project-actuals/${actual!.id}/line-items/${lineId}`, "PATCH", {
        category: form.category.trim(),
        vendorName: form.vendorName.trim() || null,
        totalCost: parseFloat(form.totalCost.replace(/,/g, "")) || 0,
        linkedMasterItemIds: form.linkedIds,
      }),
    onSuccess: () => { invalidate(); setEditState(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (lineId: number) =>
      apiRequest(`/api/project-actuals/${actual!.id}/line-items/${lineId}`, "DELETE"),
    onSuccess: invalidate,
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function toggleLink(ids: number[], mid: number): number[] {
    return ids.includes(mid) ? ids.filter((x) => x !== mid) : [...ids, mid];
  }

  // Is this masterItemId taken by a line OTHER than exceptLineId?
  function takenByOther(mid: number, exceptLineId?: number): string | null {
    const owner = linkedByLine.get(mid);
    if (!owner) return null;
    if (exceptLineId !== undefined) {
      const ownLine = allLineItems.find((l) => l.id === exceptLineId);
      if (ownLine?.linkedMasterItemIds.includes(mid)) return null;
    }
    return owner;
  }

  function deltaReadout(line: ActualLine) {
    const linkedRom = romLines
      .filter((r) => (line.linkedMasterItemIds || []).includes(r.masterItemId))
      .reduce((sum, r) => sum + r.totalPrice, 0);
    const actAmt = line.totalCost / 100;
    const delta = actAmt - linkedRom;
    const pct = linkedRom > 0 ? (delta / linkedRom) * 100 : null;
    const color = delta > 0 ? "text-red-600" : "text-green-700";
    return { linkedRom, actAmt, delta, pct, color };
  }

  // ── Form renderer ────────────────────────────────────────────────────────────

  function renderForm(
    form: FormState,
    setForm: (f: FormState) => void,
    onSave: () => void,
    onCancel: () => void,
    saving: boolean,
    exceptLineId?: number
  ) {
    return (
      <div className="bg-white border border-green-200 rounded p-3 space-y-2.5 text-xs mt-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-gray-500 block mb-0.5">Label *</label>
            <Input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="e.g. General Contractor"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <label className="text-gray-500 block mb-0.5">Vendor (optional)</label>
            <Input
              value={form.vendorName}
              onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
              placeholder="e.g. Acme Build Co."
              className="h-7 text-xs"
            />
          </div>
        </div>
        <div>
          <label className="text-gray-500 block mb-0.5">Amount ($)</label>
          <Input
            value={form.totalCost}
            onChange={(e) => setForm({ ...form, totalCost: e.target.value })}
            placeholder="e.g. 2800000"
            className="h-7 text-xs w-44"
          />
        </div>
        {romLines.length > 0 && (
          <div>
            <label className="text-gray-500 block mb-1">Link ROM lines covered</label>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {romLines.map((r) => {
                const taken = takenByOther(r.masterItemId, exceptLineId);
                const isSelected = form.linkedIds.includes(r.masterItemId);
                const disabled = !!taken;
                return (
                  <button
                    key={r.masterItemId}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      !disabled &&
                      setForm({ ...form, linkedIds: toggleLink(form.linkedIds, r.masterItemId) })
                    }
                    title={taken ? `Linked to: ${taken}` : r.label}
                    className={`px-2 py-0.5 rounded text-[10px] border transition-all leading-snug ${
                      disabled
                        ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                        : isSelected
                        ? "bg-green-600 text-white border-green-600"
                        : "bg-white text-gray-700 border-gray-300 hover:border-green-400"
                    }`}
                  >
                    {r.label.length > 30 ? r.label.slice(0, 30) + "…" : r.label}
                    {taken ? ` → ${taken.length > 16 ? taken.slice(0, 16) + "…" : taken}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          <Button
            size="sm"
            className="h-6 text-[10px] px-3 bg-green-700 hover:bg-green-800"
            disabled={!form.category.trim() || !form.totalCost.trim() || saving}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <button
            onClick={onCancel}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className={`rounded-lg p-4 border ${
        rfpIsLeased ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"
      }`}
    >
      <h4 className="font-medium text-gray-900 mb-1">
        Contract Actuals
        {!rfpIsLeased && (
          <span className="text-xs text-gray-400 font-normal ml-2">
            — mark as leased to add actuals
          </span>
        )}
      </h4>

      {!rfpIsLeased ? null : actualsLoading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-3">
          {/* Left / Right split */}
          <div className="grid grid-cols-2 gap-3">

            {/* ── ROM reference ────────────────────────────────────────────── */}
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                ROM Budget Lines
              </p>
              {!evalBudget ? (
                <p className="text-xs text-gray-400 italic">No evaluation budget.</p>
              ) : romLines.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No linkable lines in budget.</p>
              ) : (
                <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                  {romLines.map((r) => {
                    const owner = linkedByLine.get(r.masterItemId);
                    return (
                      <div
                        key={r.masterItemId}
                        className={`flex items-center justify-between text-xs rounded px-2 py-1 border ${
                          owner
                            ? "bg-green-100 border-green-200"
                            : "bg-white border-gray-100"
                        }`}
                      >
                        <span
                          className="text-gray-700 truncate flex-1 mr-1"
                          title={r.label}
                        >
                          {r.label.length > 30 ? r.label.slice(0, 30) + "…" : r.label}
                        </span>
                        <span className="tabular-nums text-gray-500 shrink-0 text-[10px] mr-1">
                          {fmtD(r.totalPrice)}
                        </span>
                        {owner && (
                          <span className="text-[9px] text-green-700 bg-green-200 px-1 rounded shrink-0">
                            ✓
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Actual lines ─────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  Actual Lines
                </p>
                {!addForm && (
                  <button
                    onClick={() => {
                      setAddForm({ ...EMPTY_FORM });
                      setEditState(null);
                    }}
                    className="flex items-center gap-1 text-[10px] text-green-700 hover:text-green-900"
                  >
                    <Plus className="h-3 w-3" />
                    Add Line
                  </button>
                )}
              </div>

              {allLineItems.length === 0 && !addForm ? (
                <p className="text-xs text-gray-400 italic">No actuals entered yet.</p>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {allLineItems.map((li) => {
                    const { linkedRom, actAmt, delta, pct, color } = deltaReadout(li);
                    const isEditing = editState?.lineId === li.id;

                    return (
                      <div
                        key={li.id}
                        className="bg-white border border-gray-100 rounded p-2 text-xs"
                      >
                        {isEditing && editState ? (
                          renderForm(
                            editState.form,
                            (f) => setEditState({ lineId: li.id, form: f }),
                            () => editMutation.mutate({ lineId: li.id, form: editState.form }),
                            () => setEditState(null),
                            editMutation.isPending,
                            li.id
                          )
                        ) : (
                          <>
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-gray-800">{li.category}</span>
                                {li.vendorName && (
                                  <span className="text-gray-400 ml-1 text-[10px]">
                                    · {li.vendorName}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0 ml-2">
                                <button
                                  onClick={() =>
                                    setEditState({
                                      lineId: li.id,
                                      form: {
                                        category: li.category,
                                        vendorName: li.vendorName || "",
                                        totalCost: String(li.totalCost / 100),
                                        linkedIds: [...(li.linkedMasterItemIds || [])],
                                      },
                                    })
                                  }
                                  className="text-gray-400 hover:text-blue-600"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => deleteMutation.mutate(li.id)}
                                  disabled={deleteMutation.isPending}
                                  className="text-gray-400 hover:text-red-600 disabled:opacity-40"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>

                            {/* Δ readout */}
                            <div className="mt-1 text-[10px] text-gray-500 leading-relaxed">
                              {(li.linkedMasterItemIds || []).length > 0 ? (
                                <>
                                  Linked ROM:{" "}
                                  <span className="font-medium text-gray-700">
                                    {fmtD(linkedRom)}
                                  </span>
                                  {" · "}Actual:{" "}
                                  <span className="font-medium text-gray-700">
                                    {fmtD(actAmt)}
                                  </span>
                                  {" · "}Δ{" "}
                                  <span className={`font-semibold ${color}`}>
                                    {delta >= 0 ? "+" : ""}
                                    {fmtD(delta)}
                                    {pct != null &&
                                      ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`}
                                  </span>
                                </>
                              ) : (
                                <>
                                  Actual:{" "}
                                  <span className="font-medium text-gray-700">
                                    {fmtD(actAmt)}
                                  </span>
                                  <span className="text-gray-400"> · no ROM links</span>
                                </>
                              )}
                            </div>

                            {/* Linked ROM chips */}
                            {(li.linkedMasterItemIds || []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {romLines
                                  .filter((r) =>
                                    (li.linkedMasterItemIds || []).includes(r.masterItemId)
                                  )
                                  .map((r) => (
                                    <span
                                      key={r.masterItemId}
                                      className="px-1.5 py-0.5 bg-green-100 text-green-800 rounded text-[9px]"
                                    >
                                      {r.label.length > 22 ? r.label.slice(0, 22) + "…" : r.label}
                                    </span>
                                  ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add form */}
              {addForm &&
                renderForm(
                  addForm,
                  setAddForm,
                  () => addMutation.mutate(addForm),
                  () => setAddForm(null),
                  addMutation.isPending
                )}
            </div>
          </div>

          {/* Project rollup */}
          {(totalRom > 0 || totalActuals > 0) && (
            <div className="border-t border-green-200 pt-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-gray-500">
                  Total ROM:{" "}
                  <span className="font-semibold text-gray-800">{fmtD(totalRom)}</span>
                </span>
                <span className="text-gray-300">vs</span>
                <span className="text-gray-500">
                  Total Actuals:{" "}
                  <span className="font-semibold text-gray-800">{fmtD(totalActuals)}</span>
                </span>
                {totalRom > 0 && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span
                      className={`font-semibold ${
                        totalActuals - totalRom > 0 ? "text-red-600" : "text-green-700"
                      }`}
                    >
                      Δ {fmtD(totalActuals - totalRom)}{" "}
                      ({((((totalActuals - totalRom) / totalRom) * 100) >= 0 ? "+" : "")}
                      {(((totalActuals - totalRom) / totalRom) * 100).toFixed(1)}%)
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
