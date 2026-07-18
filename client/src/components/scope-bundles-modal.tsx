import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Package, Plus, Trash2, X, ChevronLeft } from "lucide-react";
import type { ScopeBundle, RomScopeItem } from "@shared/schema";

interface ScopeBundlesModalProps {
  open: boolean;
  onClose: () => void;
}

interface BundleWithItems extends ScopeBundle {
  items: Array<{ id: number; scopeItemId: number; defaultQuantity: string | null; notes: string | null; sortOrder: number | null }>;
}

export function ScopeBundlesModal({ open, onClose }: ScopeBundlesModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // null = list view; a bundle id = editing that bundle's items
  const [editingBundleId, setEditingBundleId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [selectedItemToAdd, setSelectedItemToAdd] = useState<string>("");

  const { data: bundles = [], isLoading } = useQuery<ScopeBundle[]>({
    queryKey: ["/api/scope-bundles"],
    enabled: open,
  });

  // The catalog items available to add to a bundle
  const { data: catalogItems = [] } = useQuery<RomScopeItem[]>({
    queryKey: ["/api/rom-scope-items"],
    enabled: open,
  });

  // The bundle currently being edited (with its items)
  const { data: editingBundle } = useQuery<BundleWithItems>({
    queryKey: [`/api/scope-bundles/${editingBundleId}`],
    enabled: open && editingBundleId !== null,
  });

  const createBundle = useMutation({
    mutationFn: () =>
      apiRequest("/api/scope-bundles", "POST", {
        name: newName,
        description: newDescription || null,
        category: newCategory || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope-bundles"] });
      setNewName("");
      setNewDescription("");
      setNewCategory("");
      toast({ title: "Bundle created" });
    },
    onError: (e: any) => toast({ title: "Failed to create bundle", description: e?.message, variant: "destructive" }),
  });

  const deleteBundle = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/scope-bundles/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope-bundles"] });
      toast({ title: "Bundle deleted" });
    },
    onError: (e: any) => toast({ title: "Failed to delete bundle", description: e?.message, variant: "destructive" }),
  });

  const addItem = useMutation({
    mutationFn: (scopeItemId: number) =>
      apiRequest(`/api/scope-bundles/${editingBundleId}/items`, "POST", { scopeItemId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/scope-bundles/${editingBundleId}`] });
      setSelectedItemToAdd("");
      toast({ title: "Item added to bundle" });
    },
    onError: (e: any) => toast({ title: "Failed to add item", description: e?.message, variant: "destructive" }),
  });

  const removeItem = useMutation({
    mutationFn: (itemId: number) => apiRequest(`/api/scope-bundles/items/${itemId}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/scope-bundles/${editingBundleId}`] });
      toast({ title: "Item removed" });
    },
    onError: (e: any) => toast({ title: "Failed to remove item", description: e?.message, variant: "destructive" }),
  });

  if (!open) return null;

  const catalogName = (id: number) => catalogItems.find((c) => c.id === id)?.name ?? `Item #${id}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            {editingBundleId !== null && (
              <button onClick={() => setEditingBundleId(null)} className="text-gray-500 hover:text-gray-800">
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <Package className="h-5 w-5 text-blue-700" />
            <h2 className="text-lg font-semibold text-gray-900">
              {editingBundleId === null ? "Scope Bundles" : `Edit Bundle: ${editingBundle?.name ?? ""}`}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Explanatory note */}
          <p className="text-xs text-gray-500">
            A bundle is a named group of catalog items (e.g. "Demising Wall + Cascade"). When used in an
            evaluation, a bundle expands into its component items as <strong>separate line items</strong> —
            each still priced and editable on its own.
          </p>

          {editingBundleId === null ? (
            <>
              {/* Create a new bundle */}
              <div className="border rounded-md p-4 space-y-3 bg-gray-50">
                <div className="font-medium text-sm text-gray-700">Create a bundle</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="b-name" className="text-xs">Name *</Label>
                    <Input id="b-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Demising Wall + Cascade" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="b-cat" className="text-xs">Category</Label>
                    <Input id="b-cat" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="warehouse" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="b-desc" className="text-xs">Description</Label>
                    <Input id="b-desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="optional" />
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={!newName.trim() || createBundle.isPending}
                  onClick={() => createBundle.mutate()}
                  className="flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" /> Create bundle
                </Button>
              </div>

              {/* List existing bundles */}
              <div className="space-y-2">
                <div className="font-medium text-sm text-gray-700">Existing bundles</div>
                {isLoading ? (
                  <div className="text-sm text-gray-400">Loading…</div>
                ) : bundles.length === 0 ? (
                  <div className="text-sm text-gray-400">No bundles yet. Create one above.</div>
                ) : (
                  bundles.map((b) => (
                    <div key={b.id} className="flex items-center justify-between border rounded-md px-4 py-2">
                      <div>
                        <div className="font-medium text-sm">{b.name}</div>
                        {b.description && <div className="text-xs text-gray-500">{b.description}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingBundleId(b.id)}>
                          Manage items
                        </Button>
                        <button
                          onClick={() => { if (confirm(`Delete bundle "${b.name}"?`)) deleteBundle.mutate(b.id); }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              {/* Add a catalog item to this bundle */}
              <div className="border rounded-md p-4 space-y-3 bg-gray-50">
                <div className="font-medium text-sm text-gray-700">Add a catalog item to this bundle</div>
                <div className="flex gap-2">
                  <select
                    value={selectedItemToAdd}
                    onChange={(e) => setSelectedItemToAdd(e.target.value)}
                    className="flex-1 h-10 px-3 text-sm border border-input rounded-md bg-white"
                  >
                    <option value="">Select a catalog item…</option>
                    {catalogItems.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.category ? ` (${c.category})` : ""}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={!selectedItemToAdd || addItem.isPending}
                    onClick={() => addItem.mutate(parseInt(selectedItemToAdd))}
                    className="flex items-center gap-1"
                  >
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>
              </div>

              {/* This bundle's items */}
              <div className="space-y-2">
                <div className="font-medium text-sm text-gray-700">Items in this bundle</div>
                {!editingBundle ? (
                  <div className="text-sm text-gray-400">Loading…</div>
                ) : editingBundle.items.length === 0 ? (
                  <div className="text-sm text-gray-400">No items yet. Add catalog items above.</div>
                ) : (
                  editingBundle.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between border rounded-md px-4 py-2">
                      <div className="text-sm">{catalogName(it.scopeItemId)}</div>
                      <button onClick={() => removeItem.mutate(it.id)} className="text-red-500 hover:text-red-700">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
