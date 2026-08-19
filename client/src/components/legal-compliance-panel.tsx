import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle, RefreshCw, Scale } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { computeAreaSummary } from "@shared/area-utils";

interface LegalComplianceResult {
  propertyId: number;
  propertyName: string;
  success: boolean;
  message: string;
  adjustmentsMade: boolean;
  originalTotal: number;
  finalTotal: number;
}

interface ComplianceResponse {
  success: boolean;
  summary: string;
  details: LegalComplianceResult[];
}

const LEGAL_REQUIREMENTS = {
  1: { name: 'Bridge Point Gratigny', requiredSF: 409189 },
  2: { name: 'Bridge 595', requiredSF: 290307 },
  3: { name: 'MG Westside', requiredSF: 794334 },
  4: { name: 'Bridge Point Port Everglades', requiredSF: 171983 }
};

export function LegalCompliancePanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current property compliance status
  const { data: properties } = useQuery({
    queryKey: ['/api/properties'],
  });

  // Enforce legal compliance mutation
  const enforceMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/api/properties/enforce-legal-compliance', 'POST');
    },
    onSuccess: (data: ComplianceResponse) => {
      toast({
        title: "Legal Compliance Enforced",
        description: data.summary,
        variant: data.success ? "default" : "destructive",
        duration: data.success ? 4000 : 6000,
      });
      
      // Refresh properties data
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
    },
    onError: (error) => {
      toast({
        title: "Enforcement Failed",
        description: "Failed to enforce legal compliance across properties",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  /**
   * The area this property is legally expected to total.
   *
   * LEGAL_REQUIREMENTS holds surveyed/published figures for the properties that
   * have one. Everything else falls back to the property's own recorded rentable
   * total, which still catches the case this panel exists for: bay configurations
   * drifting away from the figure the property is documented at.
   */
  const getRequirement = (property: any): { name: string; requiredSF: number; published: boolean } | null => {
    const published = LEGAL_REQUIREMENTS[property.id as keyof typeof LEGAL_REQUIREMENTS];
    if (published) return { name: published.name, requiredSF: published.requiredSF, published: true };

    // There is NO recorded rentable total on the properties table - only
    // mechanical_room_square_footage and the bay array. So for a property with no
    // published figure there is genuinely nothing to compare against, and
    // inventing a baseline from the bays themselves would compare a number to
    // itself and always read Compliant. That is worse than saying nothing.
    return null;
  };

  const getComplianceStatus = (property: any) => {
    // Published legal total if we have one; otherwise the property's own recorded
    // rentable figure. Previously a property without a hardcoded entry returned
    // 'unknown' and was then dropped from the list entirely - 15 buildings in the
    // portfolio, 4 in this table, and nothing said the other 11 were unchecked.
    const legalReq = getRequirement(property);
    if (!legalReq) {
      return { status: 'no-baseline' as const, variance: 0, required: 0, actual: 0 };
    }
    
    // property.warehouseTotal DOES NOT EXIST. It was the only reference to that
    // name in the entire codebase, so this read undefined, `|| 0` made it zero,
    // and every property reported its full required area as a shortfall - three
    // scary red "Legal risk" cards describing a problem that was not there.
    //
    // The real total is the sum of the property's bay areas, via the shared
    // helper: raw bay SF, deduped, with a rentable fallback for records where
    // squareFootage is absent.
    const bays = property.bayConfigurations;

    // Rentable = bays + the mechanical room, NOT bays alone.
    //
    // The published legal totals are RENTABLE figures. sumBayArea returns
    // warehouse area only, so every property came up short by exactly its
    // mechanical allocation - Gratigny by 426 SF, which is precisely the
    // mechanical figure shown on its Area Summary. A shortfall that equals a
    // known constant is a missing term, not a discrepancy.
    //
    // Whole property, so the tenant-share proration collapses to 1.0 and this is
    // simply bays + the full mechanical room.
    const summary = computeAreaSummary(bays, bays, property.mechanicalRoomSquareFootage);
    const actualTotal = summary.totalRentableSf;

    // No bays configured is NOT a compliance failure - it is missing data, and
    // reporting it as legal risk trains the reader to ignore this panel.
    if (!Array.isArray(bays) || bays.length === 0) {
      return {
        status: 'unconfigured' as const,
        variance: 0,
        required: legalReq.requiredSF,
        actual: 0,
      };
    }

    const variance = actualTotal - legalReq.requiredSF;

    return {
      status: variance === 0 ? 'compliant' : variance > 0 ? 'overstate' : 'understate',
      variance,
      required: legalReq.requiredSF,
      actual: actualTotal
    };
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            <CardTitle>Legal Compliance Monitor</CardTitle>
          </div>
          <Button
            onClick={() => enforceMutation.mutate()}
            disabled={enforceMutation.isPending}
            variant="outline"
            size="sm"
          >
            {enforceMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Scale className="h-4 w-4 mr-2" />
            )}
            Enforce Compliance
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Compares each property's bay configurations against the total it is documented at.
          A variance means the two disagree and one of them needs correcting before the figure
          reaches a lease or a proposal.
        </div>
        
        <Separator />

        <div className="space-y-3">
          {(() => {
            const total = (properties || []).length;
            const checked = (properties || []).filter((p: any) => getRequirement(p)).length;
            if (total === 0 || checked === total) return null;
            return (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                Checking <strong>{checked}</strong> of <strong>{total}</strong> properties. The rest
                have no published leasable total on file, so there is nothing to compare their bay
                configurations against — they are listed below rather than hidden.
              </div>
            );
          })()}

          {(properties || []).map((property: any) => {
            const compliance = getComplianceStatus(property);
            const legalReq = getRequirement(property);

            // No baseline at all: still LISTED, so an unchecked property is
            // visible rather than silently absent from a compliance panel.
            if (!legalReq) {
              return (
                <div key={property.id} className="border rounded-lg p-4 flex items-center justify-between">
                  <div className="font-medium text-muted-foreground">
                    {property.building ? `${property.propertyName} - Bldg. ${property.building}` : property.propertyName}
                  </div>
                  <Badge variant="outline">No published total on file</Badge>
                </div>
              );
            }
            
            return (
              <div key={property.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    {legalReq.name}
                    {!legalReq.published && (
                      <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                        vs recorded total
                      </span>
                    )}
                  </div>
                  <Badge
                    variant={compliance.status === 'compliant' ? 'default'
                      : compliance.status === 'unconfigured' ? 'outline' : 'destructive'}
                    className={compliance.status === 'compliant' ? 'bg-green-100 text-green-800' : ''}
                  >
                    {compliance.status === 'compliant' ? (
                      <CheckCircle className="h-3 w-3 mr-1" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 mr-1" />
                    )}
                    {compliance.status === 'compliant' ? 'Compliant'
                      : compliance.status === 'unconfigured' ? 'No bays configured' : 'At Risk'}
                  </Badge>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Required</div>
                    <div className="font-mono">{formatNumber(legalReq.requiredSF)} SF</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Actual</div>
                    <div className="font-mono">{formatNumber(compliance.actual)} SF</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Variance</div>
                    <div className={`font-mono ${compliance.status === 'unconfigured' ? 'text-muted-foreground' : compliance.variance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {compliance.variance === 0 ? '0' : `${compliance.variance > 0 ? '+' : ''}${formatNumber(compliance.variance)}`} SF
                    </div>
                  </div>
                </div>

                {compliance.status === 'unconfigured' && (
                  <div className="text-sm text-amber-800 bg-amber-50 p-2 rounded">
                    <AlertTriangle className="h-4 w-4 inline mr-2" />
                    No bay configurations on this property, so the actual total cannot be computed.
                    This is missing data, not a legal exposure.
                  </div>
                )}

                {compliance.status !== 'compliant' && compliance.status !== 'unconfigured' && (
                  <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                    <AlertTriangle className="h-4 w-4 inline mr-2" />
                    Legal risk: Total {compliance.variance > 0 ? 'exceeds' : 'below'} requirement by {formatNumber(Math.abs(compliance.variance))} SF
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {enforceMutation.data && (
          <div className="mt-4 p-4 bg-slate-50 rounded-lg">
            <div className="font-medium mb-2">Last Enforcement Result:</div>
            <div className="text-sm text-muted-foreground mb-2">{enforceMutation.data.summary}</div>
            <div className="space-y-1">
              {enforceMutation.data.details?.map((result: LegalComplianceResult) => (
                <div key={result.propertyId} className="text-xs flex items-center gap-2">
                  {result.success ? (
                    <CheckCircle className="h-3 w-3 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-red-600" />
                  )}
                  <span>{result.propertyName}: {result.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}