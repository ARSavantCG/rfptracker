import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Users, Star } from "lucide-react";
import { PROJECT_TEAM_ROLES, PROJECT_TEAM_ROLE_LABELS, PROJECT_TEAM_CORE_ROLES } from "@shared/schema";

interface TeamMember {
  id: number;
  rfpId: number;
  contactId: number;
  role: string;
  isPrimary: boolean | null;
  roleTitle: string | null;
  customRole: string | null;
  notes: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  company: string | null;
}

interface Contact {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  type: string;
  isActive: boolean | null;
}

export function ProjectTeamSection({ rfpId }: { rfpId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<string>("architect");
  const [search, setSearch] = useState("");
  const [contactId, setContactId] = useState<number | null>(null);
  const [roleTitle, setRoleTitle] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  const teamKey = [`/api/rfp-requests/${rfpId}/team`];

  const { data: team = [], isLoading } = useQuery<TeamMember[]>({ queryKey: teamKey });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });

  // Search across name AND company, because the firm is usually what comes to
  // mind first ("who did we use from RLC?") even though the record is a person.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = contacts.filter((c) => c.isActive !== false);
    if (!q) return active.slice(0, 8);
    return active
      .filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [contacts, search]);

  const reset = () => {
    setAdding(false); setSearch(""); setContactId(null);
    setRoleTitle(""); setCustomRole(""); setIsPrimary(false); setRole("architect");
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!contactId) throw new Error("Select a person first");
      return apiRequest(`/api/rfp-requests/${rfpId}/team`, "POST", {
        contactId, role, isPrimary,
        roleTitle: roleTitle.trim() || null,
        customRole: role === "other" ? customRole.trim() || null : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKey });
      reset();
      toast({ title: "Added to project team" });
    },
    onError: (e: Error) => toast({ title: "Could not add", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (memberId: number) =>
      apiRequest(`/api/rfp-requests/${rfpId}/team/${memberId}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKey });
      toast({ title: "Removed from project team" });
    },
    onError: (e: Error) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  // Group by role so the panel reads like the printed directory.
  const grouped = useMemo(() => {
    const m = new Map<string, TeamMember[]>();
    for (const t of team) {
      if (!m.has(t.role)) m.set(t.role, []);
      m.get(t.role)!.push(t);
    }
    return Array.from(m.entries()).sort(
      (a, b) => PROJECT_TEAM_ROLES.indexOf(a[0] as any) - PROJECT_TEAM_ROLES.indexOf(b[0] as any)
    );
  }, [team]);

  const selected = contacts.find((c) => c.id === contactId);

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-gray-900 flex items-center gap-2">
          <Users className="h-4 w-4" />
          Project Team {team.length > 0 && <span className="text-gray-500 font-normal">({team.length})</span>}
        </h4>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="button-add-team-member">
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        )}
      </div>

      {adding && (
        <div className="border rounded-lg p-3 mb-3 space-y-3 bg-gray-50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Role</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <optgroup label="Core design team">
                  {PROJECT_TEAM_CORE_ROLES.map((r) => (
                    <option key={r} value={r}>{PROJECT_TEAM_ROLE_LABELS[r]}</option>
                  ))}
                </optgroup>
                <optgroup label="Add as needed">
                  {PROJECT_TEAM_ROLES.filter((r) => !PROJECT_TEAM_CORE_ROLES.includes(r as any) && r !== "other").map((r) => (
                    <option key={r} value={r}>{PROJECT_TEAM_ROLE_LABELS[r]}</option>
                  ))}
                  <option value="other">Other — type the discipline…</option>
                </optgroup>
              </select>
            </div>
            <div>
              {role === "other" ? (
                <>
                  <Label className="text-xs">Discipline</Label>
                  <Input
                    className="h-9 text-sm"
                    placeholder="e.g. Acoustical Consultant"
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <Label className="text-xs">Title on this project</Label>
                  <Input
                    className="h-9 text-sm"
                    placeholder="Optional, e.g. Project Architect"
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                  />
                </>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs">Person</Label>
            <Input
              className="h-9 text-sm"
              placeholder="Search by person, firm, or email…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setContactId(null); }}
            />
            <div className="mt-1 max-h-40 overflow-y-auto border rounded bg-white">
              {matches.length === 0 && (
                <div className="p-2 text-xs text-gray-500">No matching contacts.</div>
              )}
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setContactId(c.id); setSearch(c.name); }}
                  className={`w-full text-left px-2 py-1.5 text-sm hover:bg-blue-50 border-b last:border-b-0 ${contactId === c.id ? "bg-blue-50" : ""}`}
                >
                  <div className="font-medium">{c.name}</div>
                  {/* The firm is not a separate record - it rides along on the
                      contact, so show it here to confirm the right one. */}
                  <div className="text-xs text-gray-500">
                    {c.company || "No firm on record"}{c.email ? ` · ${c.email}` : ""}
                  </div>
                </button>
              ))}
            </div>
            {selected && (
              <p className="text-xs text-gray-600 mt-1">
                Firm will be recorded as <strong>{selected.company || "— none on this contact —"}</strong>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="team-primary" checked={isPrimary} onCheckedChange={(v) => setIsPrimary(!!v)} />
            <Label htmlFor="team-primary" className="text-xs cursor-pointer">
              Primary contact for this role — adding a new primary demotes the current one
            </Label>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={() => addMutation.mutate()} disabled={!contactId || addMutation.isPending || (role === "other" && !customRole.trim())}>
              {addMutation.isPending ? "Adding…" : "Add to team"}
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading team…</p>
      ) : team.length === 0 ? (
        <p className="text-sm text-gray-500">
          No one assigned yet. Add the architect, engineers, and other roles here and they will
          appear on the Project Team Directory report.
        </p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([r, members]) => (
            <div key={r}>
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                {r === "other"
                  ? (members.find((m) => m.customRole)?.customRole || "Other")
                  : (PROJECT_TEAM_ROLE_LABELS[r] || r)}
              </div>
              <div className="border rounded divide-y">
                {members.map((m) => (
                  <div key={m.id} className="flex items-start justify-between p-2">
                    <div className="text-sm">
                      <div className="font-medium flex items-center gap-1.5">
                        {m.contactName || `Contact #${m.contactId}`}
                        {m.isPrimary && (
                          <Badge variant="outline" className="text-[10px] py-0">
                            <Star className="h-2.5 w-2.5 mr-0.5" /> Primary
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-600">
                        {m.company || "No firm on record"}
                        {m.roleTitle ? ` · ${m.roleTitle}` : ""}
                      </div>
                      <div className="text-xs text-gray-500">
                        {[m.contactEmail, m.contactPhone].filter(Boolean).join(" · ") || "No contact details"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeMutation.mutate(m.id)}
                      disabled={removeMutation.isPending}
                      title="Remove from project team"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
