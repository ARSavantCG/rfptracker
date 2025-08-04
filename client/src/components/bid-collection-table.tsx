import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Edit, Eye, FileText, Download, ArrowRight, Printer, Trash2 } from "lucide-react";
import { BidCollectionModal } from "./bid-collection-modal";
import { BidViewModal } from "./bid-view-modal";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { RfpRequest, BidCollection } from "@shared/schema";

interface BidCollectionTableProps {
  rfp: RfpRequest | null;
}

export function BidCollectionTable({ rfp }: BidCollectionTableProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedBid, setSelectedBid] = useState<BidCollection | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch bid collections for this RFP
  const { data: bidCollections, isLoading } = useQuery({
    queryKey: [`/api/rfp-requests/${rfp?.id}/bid-collections`],
    enabled: !!rfp?.id,
  });

  const getStatusBadge = (status: string) => {
    const statusColors = {
      "received": "bg-blue-100 text-blue-800",
      "under-review": "bg-yellow-100 text-yellow-800", 
      "shortlisted": "bg-green-100 text-green-800",
      "rejected": "bg-red-100 text-red-800",
      "awarded": "bg-purple-100 text-purple-800",
    };

    return (
      <Badge className={statusColors[status as keyof typeof statusColors] || "bg-gray-100 text-gray-800"}>
        {status.replace('-', ' ').toUpperCase()}
      </Badge>
    );
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "TBD";
    const num = parseFloat(amount);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(num);
  };



  // Workflow advancement mutation
  const advanceToEvaluationMutation = useMutation({
    mutationFn: async () => {
      if (!rfp) throw new Error("No RFP selected");
      
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/rfp-requests/${rfp.id}/workflow-phase`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ phase: 'evaluation' }),
      });
      if (!response.ok) throw new Error('Failed to advance workflow');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      toast({
        title: "Success",
        description: "Advanced to Evaluation phase successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to advance to evaluation phase",
        variant: "destructive",
      });
    },
  });

  // Delete bid collection mutation
  const deleteBidMutation = useMutation({
    mutationFn: async (bidId: number) => {
      if (!rfp) throw new Error("No RFP selected");
      return apiRequest(`/api/rfp-requests/${rfp.id}/bid-collections/${bidId}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/rfp-requests/${rfp?.id}/bid-collections`] });
      toast({
        title: "Success",
        description: "Bid deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete bid",
        variant: "destructive",
      });
    },
  });

  const handleNewBid = () => {
    setSelectedBid(null);
    setIsModalOpen(true);
  };

  const handleEditBid = (bid: BidCollection) => {
    setSelectedBid(bid);
    setIsModalOpen(true);
  };

  const handleViewBid = (bid: BidCollection) => {
    setSelectedBid(bid);
    setIsViewModalOpen(true);
  };

  const handleDeleteBid = (bid: BidCollection) => {
    if (window.confirm(`Are you sure you want to delete the bid from ${bid.contractorName} (${bid.contractorCompany})? This action cannot be undone.`)) {
      deleteBidMutation.mutate(bid.id);
    }
  };

  const handleAdvanceToEvaluation = () => {
    advanceToEvaluationMutation.mutate();
  };

  if (!rfp) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bid Collection</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">Select an RFP to view bid collections.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Bid Collection - {rfp.projectName}</CardTitle>
          <div className="flex gap-2">
            <Button onClick={handleNewBid}>
              <Plus className="h-4 w-4 mr-2" />
              Add New Bid
            </Button>
            {bidCollections && (bidCollections as BidCollection[]).length > 0 && (
              <Button 
                variant="outline"
                onClick={() => {
                  const token = localStorage.getItem('auth-token');
                  const printUrl = `/api/rfp-requests/${rfp.id}/bid-collections/pdf`;
                  // Open PDF with authentication
                  fetch(printUrl, {
                    headers: {
                      'Authorization': `Bearer ${token}`
                    }
                  }).then(response => {
                    if (response.ok) {
                      return response.text();
                    } else {
                      throw new Error('Authentication failed');
                    }
                  }).then(html => {
                    const blob = new Blob([html], { type: 'text/html' });
                    const url = window.URL.createObjectURL(blob);
                    window.open(url, '_blank');
                    setTimeout(() => window.URL.revokeObjectURL(url), 100);
                  }).catch(error => {
                    console.error('Print error:', error);
                    toast({
                      title: "Print Error",
                      description: "Unable to generate PDF. Please try logging in again.",
                      variant: "destructive",
                    });
                  });
                }}
                className="flex items-center gap-2"
              >
                <Printer className="h-4 w-4" />
                Print All Bids
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-gray-500">Loading bid collections...</div>
            </div>
          ) : !bidCollections || (bidCollections as BidCollection[]).length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Bids Submitted</h3>
              <p className="text-gray-500">
                Start collecting bids from contractors and architects for this project using the "Add New Bid" button above.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bidder</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Submission Date</TableHead>
                    <TableHead>Total Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attachments</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(bidCollections as BidCollection[]).map((bid) => (
                    <TableRow key={bid.id}>
                      <TableCell className="font-medium">
                        {bid.contractorName}
                      </TableCell>
                      <TableCell>{bid.contractorCompany}</TableCell>
                      <TableCell>{formatDate(bid.submissionDate)}</TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(bid.totalAmount)}
                      </TableCell>
                      <TableCell>{getStatusBadge(bid.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-600">
                            {(() => {
                              let attachments = bid.attachments;
                              if (typeof attachments === 'string') {
                                try {
                                  attachments = JSON.parse(attachments);
                                } catch (e) {
                                  attachments = [];
                                }
                              }
                              return Array.isArray(attachments) ? attachments.length : 0;
                            })()} files
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewBid(bid)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditBid(bid)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const token = localStorage.getItem('auth-token');
                              const pdfUrl = `/api/bid-collections/${bid.id}/pdf`;
                              // Download PDF with authentication
                              fetch(pdfUrl, {
                                headers: {
                                  'Authorization': `Bearer ${token}`
                                }
                              }).then(response => {
                                if (response.ok) {
                                  return response.blob();
                                } else {
                                  throw new Error('Failed to generate PDF');
                                }
                              }).then(blob => {
                                // Create download link
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `${bid.contractorCompany || bid.contractorName || 'bid'}-${rfp.projectName || 'project'}-bid.pdf`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                window.URL.revokeObjectURL(url);
                              }).catch(error => {
                                console.error('Download error:', error);
                                toast({
                                  title: "Download Error",
                                  description: `Failed to download ${bid.contractorCompany || bid.contractorName} bid PDF`,
                                  variant: "destructive",
                                });
                              });
                            }}
                            title="Download PDF"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          {(() => {
                            let attachments = bid.attachments;
                            if (typeof attachments === 'string') {
                              try {
                                attachments = JSON.parse(attachments);
                              } catch (e) {
                                attachments = [];
                              }
                            }
                            return Array.isArray(attachments) && attachments.length > 0;
                          })() && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                let attachments = bid.attachments;
                                if (typeof attachments === 'string') {
                                  try {
                                    attachments = JSON.parse(attachments);
                                  } catch (e) {
                                    attachments = [];
                                  }
                                }
                                
                                if (Array.isArray(attachments) && attachments.length > 0) {
                                  // Download each attachment
                                  attachments.forEach((file: any) => {
                                    if (file.id) {
                                      const token = localStorage.getItem('auth-token');
                                      const downloadUrl = `/api/bid-collections/${bid.id}/attachments/${file.id}`;
                                      
                                      // Create a temporary link to download with authentication
                                      fetch(downloadUrl, {
                                        headers: {
                                          'Authorization': `Bearer ${token}`
                                        }
                                      }).then(response => {
                                        if (response.ok) {
                                          return response.blob();
                                        } else {
                                          throw new Error('Download failed');
                                        }
                                      }).then(blob => {
                                        const url = window.URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = file.name;
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                        window.URL.revokeObjectURL(url);
                                      }).catch(error => {
                                        console.error('Download error:', error);
                                        toast({
                                          title: "Download Error",
                                          description: `Failed to download ${file.name}`,
                                          variant: "destructive",
                                        });
                                      });
                                    }
                                  });
                                } else {
                                  toast({
                                    title: "No Attachments",
                                    description: "This bid has no attachments to download.",
                                    variant: "destructive",
                                  });
                                }
                              }}
                              title="Download All Attachments"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteBid(bid)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="Delete Bid"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          
          {/* Bottom Action Area */}
          {rfp.workflowPhase === 'bid-collection' && (
            <div className="flex justify-end mt-6 pt-4 border-t">
              <Button 
                onClick={() => advanceToEvaluationMutation.mutate()}
                disabled={advanceToEvaluationMutation.isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                {advanceToEvaluationMutation.isPending ? 'Advancing...' : 'Advance to Evaluation'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <BidCollectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        rfp={rfp}
        bidCollection={selectedBid}
      />

      <BidViewModal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        bid={selectedBid}
      />
    </>
  );
}