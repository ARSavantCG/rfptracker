import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock, Calendar, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface AttentionRequiredProps {
  onRfpClick: (rfpId: number) => void;
  onShowAll?: (section: "overdue" | "awaiting" | "upcoming") => void;
}

interface OverdueRfp {
  id: number;
  rfpNumber: string;
  tenantName: string;
  propertyId: number | null;
  internalDueDate: string;
  daysOverdue: number;
}

interface BidAwaiting {
  bidCollectionId: number;
  rfpId: number;
  rfpNumber: string;
  contractorName: string;
  submissionDate: string | null;
  daysWaiting: number;
}

interface UpcomingDeadline {
  id: number;
  rfpNumber: string;
  tenantName: string;
  propertyId: number | null;
  internalDueDate: string;
  daysUntilDue: number;
}

interface DashboardMetrics {
  attentionRequired: {
    overdueRfps: OverdueRfp[];
    bidsAwaitingEvaluation: BidAwaiting[];
    upcomingDeadlines: UpcomingDeadline[];
  };
}

const VISIBLE = 5;

function CardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-44" />
      </CardHeader>
      <CardContent className="space-y-2">
        {[0, 1, 2, 3, 4].map((j) => (
          <Skeleton key={j} className="h-10 w-full rounded" />
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-5 gap-1.5 text-muted-foreground">
      <CheckCircle2 className="h-5 w-5 text-green-500" />
      <span className="text-xs">{message}</span>
    </div>
  );
}

export default function AttentionRequired({ onRfpClick, onShowAll }: AttentionRequiredProps) {
  const { data, isLoading, isError, error, refetch } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="mb-6 border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive text-sm">Could not load dashboard metrics</CardTitle>
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

  const { overdueRfps, bidsAwaitingEvaluation, upcomingDeadlines } = data!.attentionRequired;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Card 1 — Overdue RFPs */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              Overdue RFPs
            </CardTitle>
            <Badge className="bg-red-500 hover:bg-red-500 text-white">{overdueRfps.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {overdueRfps.length === 0 ? (
            <EmptyState message="No overdue RFPs" />
          ) : (
            <>
              {overdueRfps.slice(0, VISIBLE).map((rfp) => (
                <div
                  key={rfp.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                  onClick={() => onRfpClick(rfp.id)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{rfp.rfpNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">{rfp.tenantName}</p>
                  </div>
                  <span className="text-xs text-red-600 whitespace-nowrap ml-2">
                    {rfp.daysOverdue}d overdue
                  </span>
                </div>
              ))}
              {overdueRfps.length > VISIBLE && (
                <div
                  className="text-xs text-muted-foreground text-center py-1.5 cursor-pointer hover:text-foreground"
                  onClick={() => onShowAll?.("overdue")}
                >
                  +{overdueRfps.length - VISIBLE} more
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Card 2 — Bids Awaiting Evaluation */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Bids Awaiting Evaluation
            </CardTitle>
            <Badge className="bg-amber-500 hover:bg-amber-500 text-white">
              {bidsAwaitingEvaluation.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {bidsAwaitingEvaluation.length === 0 ? (
            <EmptyState message="No bids awaiting evaluation" />
          ) : (
            <>
              {bidsAwaitingEvaluation.slice(0, VISIBLE).map((bid) => (
                <div
                  key={bid.bidCollectionId}
                  className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                  onClick={() => onRfpClick(bid.rfpId)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{bid.rfpNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">{bid.contractorName}</p>
                  </div>
                  <span className="text-xs text-amber-600 whitespace-nowrap ml-2">
                    {bid.daysWaiting}d waiting
                  </span>
                </div>
              ))}
              {bidsAwaitingEvaluation.length > VISIBLE && (
                <div
                  className="text-xs text-muted-foreground text-center py-1.5 cursor-pointer hover:text-foreground"
                  onClick={() => onShowAll?.("awaiting")}
                >
                  +{bidsAwaitingEvaluation.length - VISIBLE} more
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Card 3 — Upcoming Deadlines */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-500" />
              Upcoming Deadlines (7 days)
            </CardTitle>
            <Badge className="bg-blue-500 hover:bg-blue-500 text-white">
              {upcomingDeadlines.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {upcomingDeadlines.length === 0 ? (
            <EmptyState message="No deadlines in next 7 days" />
          ) : (
            <>
              {upcomingDeadlines.slice(0, VISIBLE).map((rfp) => {
                const dayColor =
                  rfp.daysUntilDue <= 2
                    ? "text-red-600"
                    : rfp.daysUntilDue <= 5
                    ? "text-amber-600"
                    : "text-muted-foreground";
                return (
                  <div
                    key={rfp.id}
                    className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                    onClick={() => onRfpClick(rfp.id)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{rfp.rfpNumber}</p>
                      <p className="text-xs text-muted-foreground truncate">{rfp.tenantName}</p>
                    </div>
                    <span className={`text-xs whitespace-nowrap ml-2 ${dayColor}`}>
                      in {rfp.daysUntilDue}d
                    </span>
                  </div>
                );
              })}
              {upcomingDeadlines.length > VISIBLE && (
                <div
                  className="text-xs text-muted-foreground text-center py-1.5 cursor-pointer hover:text-foreground"
                  onClick={() => onShowAll?.("upcoming")}
                >
                  +{upcomingDeadlines.length - VISIBLE} more
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
