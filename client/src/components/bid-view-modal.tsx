import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText } from "lucide-react";
import type { BidCollection, BidLineItem } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

interface BidViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  bid: BidCollection | null;
}

export function BidViewModal({ isOpen, onClose, bid }: BidViewModalProps) {
  // Fetch line items for this bid
  const { data: lineItems } = useQuery({
    queryKey: [`/api/bid-collections/${bid?.id}/line-items`],
    enabled: isOpen && !!bid?.id,
  });

  const formatDate = (date: Date | string) => {
    // Parse the date string directly to avoid timezone conversion issues
    const dateStr = date.toString();
    if (dateStr.includes('T')) {
      const datePart = dateStr.split('T')[0];
      const [year, month, day] = datePart.split('-');
      const localDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      return localDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    // Fallback for other date formats
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "TBD";
    const num = parseFloat(amount);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(num);
  };

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

  if (!bid) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bid Details - {bid.contractorName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Bidder Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
            <div>
              <label className="text-sm font-medium text-gray-600">Bidder Name</label>
              <p className="text-lg font-semibold">{bid.contractorName}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Company</label>
              <p className="text-lg">{bid.contractorCompany}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Email</label>
              <p className="text-lg">{bid.contractorEmail}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Submission Date</label>
              <p className="text-lg">{formatDate(bid.submissionDate)}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Total Amount</label>
              <p className="text-xl font-bold text-green-600">{formatCurrency(bid.totalAmount)}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Status</label>
              <div className="mt-1">{getStatusBadge(bid.status)}</div>
            </div>
          </div>

          {/* Notes */}
          {bid.notes && (
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-2">Notes</label>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="whitespace-pre-wrap">{bid.notes}</p>
              </div>
            </div>
          )}

          {/* Line Items */}
          {lineItems && (lineItems as BidLineItem[]).length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Line Items</h3>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(lineItems as BidLineItem[]).map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{item.category}</TableCell>
                        <TableCell>{item.description}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(item.totalPrice)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Attachments */}
          {(() => {
            // Parse attachments if they're stored as string
            let attachments = bid.attachments;
            if (typeof attachments === 'string') {
              try {
                attachments = JSON.parse(attachments);
              } catch (e) {
                console.error('Failed to parse attachments:', e);
                attachments = [];
              }
            }
            
            return attachments && Array.isArray(attachments) && attachments.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-3">Attachments</h3>
                <div className="space-y-2">
                  {attachments.map((file, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 border rounded-lg">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <span className="flex-1">{file.name}</span>
                      <span className="text-sm text-gray-500">
                        {Math.round(file.size / 1024)} KB
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}