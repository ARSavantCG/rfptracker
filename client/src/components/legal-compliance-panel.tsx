import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle, RefreshCw, Scale } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

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

  const getComplianceStatus = (property: any) => {
    const legalReq = LEGAL_REQUIREMENTS[property.id as keyof typeof LEGAL_REQUIREMENTS];
    if (!legalReq) return { status: 'unknown', variance: 0 };
    
    const actualTotal = property.warehouseTotal || 0;
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
          Monitors exact leasable area totals to prevent legal issues. Overstating even by 1 SF can result in lawsuits.
        </div>
        
        <Separator />
        
        <div className="space-y-3">
          {(properties || []).map((property: any) => {
            const compliance = getComplianceStatus(property);
            const legalReq = LEGAL_REQUIREMENTS[property.id as keyof typeof LEGAL_REQUIREMENTS];
            
            if (!legalReq) return null;
            
            return (
              <div key={property.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{legalReq.name}</div>
                  <Badge
                    variant={compliance.status === 'compliant' ? 'default' : 'destructive'}
                    className={compliance.status === 'compliant' ? 'bg-green-100 text-green-800' : ''}
                  >
                    {compliance.status === 'compliant' ? (
                      <CheckCircle className="h-3 w-3 mr-1" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 mr-1" />
                    )}
                    {compliance.status === 'compliant' ? 'Compliant' : 'At Risk'}
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
                    <div className={`font-mono ${compliance.variance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {compliance.variance === 0 ? '0' : `${compliance.variance > 0 ? '+' : ''}${formatNumber(compliance.variance)}`} SF
                    </div>
                  </div>
                </div>

                {compliance.status !== 'compliant' && (
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