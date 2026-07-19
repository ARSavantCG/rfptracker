import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator, Lock } from "lucide-react";
import { RomPilotScopeModal } from "@/components/rom-pilot-scope-modal-new";

// Dual-entry principle (DESIGN-rom-pilot-convergence.md): a pricingPath='rom_pilot'
// RFP uses the SAME workflow shell as every RFP; at the Evaluation step THIS panel
// renders in place of the bid-based evaluation. It opens the SAME scope modal the
// standalone /rom-pilot page uses — two doors, one machine. No navigation away.
interface RomWorkflowPanelProps {
  rfp: any;
}

export function RomWorkflowPanel({ rfp }: RomWorkflowPanelProps) {
  const [scopeOpen, setScopeOpen] = useState(false);

  const { data: pilot, isLoading, error } = useQuery<any>({
    queryKey: [`/api/rfp-requests/${rfp.id}/rom-pilot`],
    enabled: !!rfp?.id,
    retry: false,
  });

  const fmt = (v: any) => {
    const n = parseFloat(v) || 0;
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  };

  return (
    <div className="space-y-4">
      {/* Loud badge so this can never be confused with a bid-based evaluation */}
      <div className="flex items-center gap-3 rounded-lg border-2 border-purple-300 bg-purple-50 px-4 py-3">
        <Calculator className="h-6 w-6 text-purple-700" />
        <div>
          <div className="text-sm font-bold uppercase tracking-wide text-purple-800">
            ROM Pilot — Allowance / Self-Serve Pricing
          </div>
          <div className="flex items-center gap-1 text-xs text-purple-700">
            <Lock className="h-3 w-3" />
            Quantities are yours — unit rates come from the catalog and are locked.
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-500">Loading linked ROM Pilot…</div>
      ) : error || !pilot ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No ROM Pilot is linked to this RFP. If this RFP was meant to use the ROM path,
          contact an admin — the fork may not have completed.
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span>{pilot.romNumber} — {pilot.projectName}</span>
              <span className="text-lg font-semibold text-gray-900">{fmt(pilot.totalEstimate)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-2 text-sm text-gray-600 sm:grid-cols-3">
              <div><span className="font-medium text-gray-800">Property:</span> {pilot.property}</div>
              <div>
                <span className="font-medium text-gray-800">Bays:</span>{" "}
                {Array.isArray(pilot.selectedBayConfigurations) ? pilot.selectedBayConfigurations.length : 0} selected
              </div>
              <div><span className="font-medium text-gray-800">Created by:</span> {pilot.createdBy || "—"}</div>
            </div>
            {pilot.notes && <div className="text-xs text-gray-500">{pilot.notes}</div>}
            <Button
              className="bg-purple-600 text-white hover:bg-purple-700"
              onClick={() => setScopeOpen(true)}
              data-testid="rom-price-scope"
            >
              Price Scope from Catalog
            </Button>
          </CardContent>
        </Card>
      )}

      {pilot && (
        <RomPilotScopeModal
          isOpen={scopeOpen}
          onClose={() => setScopeOpen(false)}
          romPilotId={pilot.id}
          romPilotName={pilot.projectName}
        />
      )}
    </div>
  );
}
