import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Check, Edit2, Plus, Trophy } from "lucide-react";

const COST_BUCKETS = ["Office", "Warehouse Office", "Warehouse", "Other"] as const;

interface BucketData {
  bucket: string;
  originalTotal: number;
  adjustmentAmount: number;
  adjustmentReason: string | null;
  adjustedTotal: number;
}

interface BidLevelingData {
  bidCollectionId: number;
  contractorName: string;
  contractorCompany: string;
  buckets: BucketData[];
}

interface BidLevelingViewProps {
  rfpId: number;
  onSelectPrimaryBidder?: (bidCollectionId: number) => void;
}

export function BidLevelingView({ rfpId, onSelectPrimaryBidder }: BidLevelingViewProps) {
  const { toast } = useToast();
  const [adjustmentDialog, setAdjustmentDialog] = useState<{
    open: boolean;
    bidCollectionId: number;
    contractorName: string;
    bucket: string;
    currentAmount: number;
    currentReason: string;
  } | null>(null);
  const [selectBidderDialog, setSelectBidderDialog] = useState<{
    open: boolean;
    bidCollectionId: number;
    contractorName: string;
  } | null>(null);

  const { data: bidLevelingData, isLoading } = useQuery<BidLevelingData[]>({
    queryKey: ["/api/rfp-requests", rfpId, "bid-leveling"],
    queryFn: async () => {
      const response = await fetch(`/api/rfp-requests/${rfpId}/bid-leveling`);
      if (!response.ok) throw new Error("Failed to fetch bid leveling data");
      return response.json();
    },
    enabled: !!rfpId,
  });

  const adjustmentMutation = useMutation({
    mutationFn: async (data: {
      rfpId: number;
      bidCollectionId: number;
      costBucket: string;
      adjustmentAmount: number;
      adjustmentReason: string;
    }) => {
      return apiRequest("/api/bid-leveling/adjustments", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests", rfpId, "bid-leveling"] });
      toast({ title: "Adjustment saved successfully" });
      setAdjustmentDialog(null);
    },
    onError: () => {
      toast({ title: "Failed to save adjustment", variant: "destructive" });
    },
  });

  const selectPrimaryBidderMutation = useMutation({
    mutationFn: async (bidCollectionId: number) => {
      return apiRequest(`/api/rfp-requests/${rfpId}/select-primary-bidder`, "POST", { bidCollectionId });
    },
    onSuccess: (_, bidCollectionId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests", rfpId] });
      toast({ title: "Primary bidder selected and data carried to Step 5" });
      setSelectBidderDialog(null);
      onSelectPrimaryBidder?.(bidCollectionId);
    },
    onError: () => {
      toast({ title: "Failed to select primary bidder", variant: "destructive" });
    },
  });

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(cents / 100);
  };

  const handleSaveAdjustment = () => {
    if (!adjustmentDialog) return;
    adjustmentMutation.mutate({
      rfpId,
      bidCollectionId: adjustmentDialog.bidCollectionId,
      costBucket: adjustmentDialog.bucket,
      adjustmentAmount: Math.round(adjustmentDialog.currentAmount * 100),
      adjustmentReason: adjustmentDialog.currentReason,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bid Leveling / Comparison View</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!bidLevelingData || bidLevelingData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bid Leveling / Comparison View</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No bids have been collected yet. Add bids in the Bid Collection step to compare them here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const getLowestBidForBucket = (bucket: string): number => {
    let lowest = Infinity;
    bidLevelingData.forEach((bid) => {
      const bucketData = bid.buckets.find((b) => b.bucket === bucket);
      if (bucketData && bucketData.adjustedTotal > 0 && bucketData.adjustedTotal < lowest) {
        lowest = bucketData.adjustedTotal;
      }
    });
    return lowest === Infinity ? 0 : lowest;
  };

  const calculateGrandTotal = (bid: BidLevelingData): number => {
    return bid.buckets.reduce((sum, b) => sum + b.adjustedTotal, 0);
  };

  const getLowestGrandTotal = (): number => {
    let lowest = Infinity;
    bidLevelingData.forEach((bid) => {
      const total = calculateGrandTotal(bid);
      if (total > 0 && total < lowest) {
        lowest = total;
      }
    });
    return lowest === Infinity ? 0 : lowest;
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Bid Leveling / Comparison View
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48 sticky left-0 bg-background">Cost Bucket</TableHead>
                  {bidLevelingData.map((bid) => (
                    <TableHead key={bid.bidCollectionId} className="min-w-48 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-semibold">{bid.contractorCompany}</span>
                        <span className="text-xs text-muted-foreground">{bid.contractorName}</span>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {COST_BUCKETS.map((bucket) => {
                  const lowestForBucket = getLowestBidForBucket(bucket);
                  return (
                    <TableRow key={bucket}>
                      <TableCell className="font-medium sticky left-0 bg-background">
                        {bucket}
                      </TableCell>
                      {bidLevelingData.map((bid) => {
                        const bucketData = bid.buckets.find((b) => b.bucket === bucket);
                        const isLowest =
                          bucketData?.adjustedTotal === lowestForBucket && lowestForBucket > 0;

                        return (
                          <TableCell
                            key={`${bid.bidCollectionId}-${bucket}`}
                            className="text-center"
                          >
                            <div className="flex flex-col gap-1">
                              <div className="text-xs text-muted-foreground">
                                Original: {formatCurrency(bucketData?.originalTotal || 0)}
                              </div>
                              {(bucketData?.adjustmentAmount || 0) !== 0 && (
                                <div className="text-xs text-orange-600">
                                  Plug: {formatCurrency(bucketData?.adjustmentAmount || 0)}
                                  {bucketData?.adjustmentReason && (
                                    <span className="block text-muted-foreground">
                                      ({bucketData.adjustmentReason})
                                    </span>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center justify-center gap-2">
                                <span className={`font-medium ${isLowest ? "text-green-600 font-bold" : ""}`}>
                                  {formatCurrency(bucketData?.adjustedTotal || 0)}
                                </span>
                                {isLowest && (
                                  <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">
                                    Lowest
                                  </Badge>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() =>
                                  setAdjustmentDialog({
                                    open: true,
                                    bidCollectionId: bid.bidCollectionId,
                                    contractorName: bid.contractorCompany,
                                    bucket,
                                    currentAmount: (bucketData?.adjustmentAmount || 0) / 100,
                                    currentReason: bucketData?.adjustmentReason || "",
                                  })
                                }
                              >
                                {(bucketData?.adjustmentAmount || 0) !== 0 ? (
                                  <>
                                    <Edit2 className="h-3 w-3 mr-1" /> Edit
                                  </>
                                ) : (
                                  <>
                                    <Plus className="h-3 w-3 mr-1" /> Add Plug
                                  </>
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell className="sticky left-0 bg-muted/50">Grand Total</TableCell>
                  {bidLevelingData.map((bid) => {
                    const grandTotal = calculateGrandTotal(bid);
                    const lowestTotal = getLowestGrandTotal();
                    const isLowest = grandTotal === lowestTotal && lowestTotal > 0;

                    return (
                      <TableCell
                        key={`${bid.bidCollectionId}-total`}
                        className="text-center"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <span className={isLowest ? "text-green-600" : ""}>
                            {formatCurrency(grandTotal)}
                          </span>
                          {isLowest && (
                            <Badge className="bg-green-600">Best Price</Badge>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() =>
                            setSelectBidderDialog({
                              open: true,
                              bidCollectionId: bid.bidCollectionId,
                              contractorName: bid.contractorCompany,
                            })
                          }
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Select as Primary
                        </Button>
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={adjustmentDialog?.open || false}
        onOpenChange={(open) => !open && setAdjustmentDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Adjustment / Plug</DialogTitle>
            <DialogDescription>
              Add a manual adjustment for {adjustmentDialog?.contractorName} - {adjustmentDialog?.bucket}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="adjustmentAmount">Adjustment Amount ($)</Label>
              <Input
                id="adjustmentAmount"
                type="number"
                step="0.01"
                value={adjustmentDialog?.currentAmount || 0}
                onChange={(e) =>
                  setAdjustmentDialog((prev) =>
                    prev ? { ...prev, currentAmount: parseFloat(e.target.value) || 0 } : null
                  )
                }
                placeholder="Enter adjustment amount (positive or negative)"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use positive numbers to add costs (missed scope), negative to reduce
              </p>
            </div>
            <div>
              <Label htmlFor="adjustmentReason">Reason</Label>
              <Textarea
                id="adjustmentReason"
                value={adjustmentDialog?.currentReason || ""}
                onChange={(e) =>
                  setAdjustmentDialog((prev) =>
                    prev ? { ...prev, currentReason: e.target.value } : null
                  )
                }
                placeholder="e.g., Missed electrical scope, Added dock equipment"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveAdjustment}
              disabled={adjustmentMutation.isPending}
            >
              {adjustmentMutation.isPending ? "Saving..." : "Save Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectBidderDialog?.open || false}
        onOpenChange={(open) => !open && setSelectBidderDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Primary Bidder</DialogTitle>
            <DialogDescription>
              Are you sure you want to select {selectBidderDialog?.contractorName} as the primary bidder? 
              This will carry their adjusted bucket totals to Step 5 (Evaluation Budget).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectBidderDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                selectBidderDialog &&
                selectPrimaryBidderMutation.mutate(selectBidderDialog.bidCollectionId)
              }
              disabled={selectPrimaryBidderMutation.isPending}
            >
              {selectPrimaryBidderMutation.isPending ? "Selecting..." : "Confirm Selection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
