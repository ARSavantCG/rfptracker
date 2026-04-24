import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface Velocity {
  avgDaysReceivedToCompleted: number | null;
  sampleSize: number;
  note: string;
}

interface DashboardMetrics {
  portfolioIntelligence: {
    avgCostPerSfCurrentYear: number | null;
    avgCostPerSfPriorYear: number | null;
    yoyDeltaPct: number | null;
    velocity: Velocity;
  };
}

function formatCostPerSf(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "$" + n.toFixed(2) + "/SF";
}

export default function DashboardPortfolioIntelligence() {
  const { data, isLoading, isError, error, refetch } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-3 w-32 mt-2" />
              </div>
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
          <CardTitle className="text-destructive text-sm">
            Could not load portfolio intelligence
          </CardTitle>
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

  const { avgCostPerSfCurrentYear, avgCostPerSfPriorYear, yoyDeltaPct, velocity } =
    data!.portfolioIntelligence;

  const { avgDaysReceivedToCompleted, sampleSize, note } = velocity;

  const renderYoyPill = () => {
    if (yoyDeltaPct === null) {
      return (
        <p className="text-sm text-muted-foreground">No prior year data for comparison</p>
      );
    }
    if (yoyDeltaPct === 0) {
      return (
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
          Flat vs prior year
        </span>
      );
    }
    if (yoyDeltaPct > 0) {
      return (
        <span className="inline-flex items-center gap-1 text-sm text-red-600 font-medium px-2 py-0.5 rounded-full bg-red-50">
          <TrendingUp className="h-3.5 w-3.5" />
          +{yoyDeltaPct}% vs prior year
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-sm text-green-600 font-medium px-2 py-0.5 rounded-full bg-green-50">
        <TrendingDown className="h-3.5 w-3.5" />
        {yoyDeltaPct}% vs prior year
      </span>
    );
  };

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Portfolio Intelligence</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Block 1 — Cost Benchmark */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Avg TI Cost per SF</p>
            <p className="text-2xl font-bold tabular-nums leading-tight mb-2">
              {formatCostPerSf(avgCostPerSfCurrentYear)}
            </p>
            <div className="mb-1">{renderYoyPill()}</div>
            <p className="text-xs text-muted-foreground mb-3">
              {avgCostPerSfPriorYear !== null
                ? `Prior year: $${avgCostPerSfPriorYear.toFixed(2)}/SF`
                : "Prior year: no data"}
            </p>
            <p className="text-xs text-muted-foreground">
              Based on recorded project actuals ·{" "}
              <Link
                href="/historical-import"
                className="text-primary underline-offset-2 hover:underline"
              >
                Add historical data →
              </Link>
            </p>
          </div>

          {/* Block 2 — Velocity */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Avg RFP Cycle Time</p>
            <p className="text-2xl font-bold tabular-nums leading-tight mb-2">
              {avgDaysReceivedToCompleted !== null ? `${avgDaysReceivedToCompleted} days` : "—"}
            </p>
            {sampleSize === 0 ? (
              <p className="text-sm text-muted-foreground italic">Not enough recent data</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {sampleSize} completed RFP{sampleSize !== 1 ? "s" : ""} in last 90 days
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-3">{note}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
