import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface DashboardPipelineProps {
  onRfpClick: (rfpId: number) => void;
}

interface ByPropertyEntry {
  propertyId: number | null;
  propertyName: string | null;
  activeRfpCount: number;
  totalTiValue: number;
}

interface LargestActiveDeal {
  id: number;
  rfpNumber: string;
  tenantName: string;
  totalTiValue: number;
}

interface MostActiveProperty {
  propertyId: number | null;
  propertyName: string | null;
  activeRfpCount: number;
}

interface DashboardMetrics {
  pipeline: {
    totalActiveTiValue: number;
    activeRfpCount: number;
    byProperty: ByPropertyEntry[];
    largestActiveDeal: LargestActiveDeal | null;
  };
  portfolioIntelligence: {
    mostActiveProperty: MostActiveProperty | null;
  };
}

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (n >= 1_000_000) {
    const m = (n / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return "$" + m + "M";
  }
  if (n >= 1_000) {
    return "$" + Math.round(n / 1_000) + "K";
  }
  return "$" + Math.round(n).toLocaleString();
}

export default function DashboardPipeline({ onRfpClick }: DashboardPipelineProps) {
  const { data, isLoading, isError, error, refetch } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
          <div className="border-t border-border pt-4 space-y-2">
            <Skeleton className="h-4 w-36 mb-3" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="mb-6 border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive text-sm">Could not load pipeline data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{(error as Error)?.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { totalActiveTiValue, activeRfpCount, byProperty, largestActiveDeal } = data!.pipeline;
  const { mostActiveProperty } = data!.portfolioIntelligence;

  const TOP_N = 8;
  const visibleProperties = byProperty.slice(0, TOP_N);
  const maxTiValue = Math.max(...visibleProperties.map((p) => p.totalTiValue), 1);

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Subsection A — Summary stats */}
        <div className="grid grid-cols-2 gap-4">
          {/* Block 1 — Total Active TI Value */}
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Total Active TI Value</p>
            <p className="text-2xl font-bold tabular-nums leading-tight">
              {formatCurrency(totalActiveTiValue)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{activeRfpCount} active RFPs</p>
          </div>

          {/* Block 2 — Largest Active Deal */}
          {largestActiveDeal ? (
            <div
              className="hover:bg-muted rounded p-2 -m-2 cursor-pointer transition-colors"
              onClick={() => onRfpClick(largestActiveDeal.id)}
            >
              <p className="text-xs text-muted-foreground mb-0.5">Largest Active Deal</p>
              <p className="text-2xl font-bold tabular-nums leading-tight">
                {formatCurrency(largestActiveDeal.totalTiValue)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {largestActiveDeal.rfpNumber} · {largestActiveDeal.tenantName}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Largest Active Deal</p>
              <p className="text-2xl font-bold leading-tight">—</p>
              <p className="text-xs text-muted-foreground mt-0.5">No active deals</p>
            </div>
          )}
        </div>

        {/* Subsection B — By Property */}
        <div className="border-t border-border pt-4 mt-4">
          <p className="text-sm font-medium text-muted-foreground mb-3">Pipeline by Property</p>
          {byProperty.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active RFPs with assigned property</p>
          ) : (
            <div className="space-y-2">
              {visibleProperties.map((prop, idx) => {
                const barPct = maxTiValue > 0 ? (prop.totalTiValue / maxTiValue) * 100 : 0;
                const label = prop.propertyName ?? "Unassigned";
                return (
                  <div key={prop.propertyId ?? `unassigned-${idx}`}>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs truncate shrink-0"
                        style={{ maxWidth: "38%" }}
                        title={label}
                      >
                        {label}
                      </span>
                      <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                        <div
                          className="h-full bg-primary rounded"
                          style={{ width: `${Math.max(barPct, 0.5)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums shrink-0 text-right" style={{ minWidth: "3.5rem" }}>
                        {formatCurrency(prop.totalTiValue)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground ml-1 mt-0.5">
                      {prop.activeRfpCount} RFP{prop.activeRfpCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                );
              })}
              {byProperty.length > TOP_N && (
                <p className="text-xs text-muted-foreground mt-1">
                  +{byProperty.length - TOP_N} more properties
                </p>
              )}
            </div>
          )}
        </div>

        {/* Subsection C — Most Active Property */}
        {mostActiveProperty && (
          <div className="border-t border-border pt-4 mt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium">
                Most active: {mostActiveProperty.propertyName ?? "Unassigned"}
              </span>
              <span className="text-sm text-muted-foreground">
                — {mostActiveProperty.activeRfpCount} active RFP
                {mostActiveProperty.activeRfpCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
