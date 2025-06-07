import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Edit, Eye, FileText, Download } from "lucide-react";
import { BidCollectionModal } from "./bid-collection-modal";
import type { RfpRequest, BidCollection } from "@shared/schema";

interface BidCollectionTableProps {
  rfp: RfpRequest | null;
}

export function BidCollectionTable({ rfp }: BidCollectionTableProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedBid, setSelectedBid] = useState<BidCollection | null>(null);

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

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleNewBid = () => {
    setSelectedBid(null);
    setIsModalOpen(true);
  };

  const handleEditBid = (bid: BidCollection) => {
    setSelectedBid(bid);
    setIsModalOpen(true);
  };

  const handleViewBid = (bid: BidCollection) => {
    // TODO: Implement bid detail view modal
    console.log("View bid:", bid);
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
          <Button onClick={handleNewBid}>
            <Plus className="h-4 w-4 mr-2" />
            Add New Bid
          </Button>
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
              <p className="text-gray-500 mb-4">
                Start collecting bids from contractors for this project.
              </p>
              <Button onClick={handleNewBid}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Bid
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contractor</TableHead>
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
                            {bid.attachments?.length || 0} files
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
                          {bid.attachments && bid.attachments.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                // TODO: Implement attachment download
                                console.log("Download attachments for bid:", bid.id);
                              }}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Summary Statistics */}
          {bidCollections && (bidCollections as BidCollection[]).length > 0 && (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {(bidCollections as BidCollection[]).length}
                </div>
                <div className="text-sm text-gray-600">Total Bids</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {(bidCollections as BidCollection[]).filter(b => b.status === 'shortlisted').length}
                </div>
                <div className="text-sm text-gray-600">Shortlisted</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {(bidCollections as BidCollection[]).filter(b => b.status === 'under-review').length}
                </div>
                <div className="text-sm text-gray-600">Under Review</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {formatCurrency(
                    Math.min(...(bidCollections as BidCollection[])
                      .filter(b => b.totalAmount)
                      .map(b => parseFloat(b.totalAmount!))).toString()
                  )}
                </div>
                <div className="text-sm text-gray-600">Lowest Bid</div>
              </div>
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
    </>
  );
}