import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { evaluateFormula } from "@shared/formula-utils";
import { Printer, FileText, Loader2, Sparkles, AlertTriangle, CheckCircle } from "lucide-react";
import type { BidCollection, BidLineItem } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface BidViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  bid: BidCollection | null;
}

interface AiAnomaly {
  lineItemDescription: string;
  issue: string;
  severity: "low" | "medium" | "high";
}

interface AiMissingItem {
  description: string;
  reason: string;
}

interface AiAnalysis {
  anomalies: AiAnomaly[];
  missing: AiMissingItem[];
  summary: string;
}

export function BidViewModal({ isOpen, onClose, bid }: BidViewModalProps) {
  const { toast } = useToast();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);

  // Fetch line items for this bid
  const { data: lineItems } = useQuery({
    queryKey: [`/api/bid-collections/${bid?.id}/line-items`],
    enabled: isOpen && !!bid?.id,
  });

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "TBD";
    
    let num: number;
    
    // Handle formula values (starting with =)
    if (amount.startsWith('=')) {
      const result = evaluateFormula(amount);
      
      if (result.error || result.value === null || isNaN(result.value)) {
        return "TBD"; // Return a safe fallback for invalid formulas
      }
      
      num = result.value;
    } else {
      num = parseFloat(amount);
    }
    
    // Ensure we have a valid number
    if (isNaN(num) || !isFinite(num)) {
      return "TBD";
    }
    
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

  const handleAnalyze = async () => {
    if (!bid?.id) return;
    const token = localStorage.getItem('auth-token');
    if (!token) {
      toast({ title: "Not authenticated", description: "Please log in again.", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    setAiAnalysis(null);
    try {
      const response = await fetch(`/api/ai/analyze-bid/${bid.id}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${response.status}`);
      }
      const data: AiAnalysis = await response.json();
      setAiAnalysis(data);
    } catch (error: any) {
      toast({
        title: "Analysis failed",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setAiLoading(false);
    }
  };

  const getSeverityBadge = (severity: AiAnomaly["severity"]) => {
    if (severity === "high") return <Badge className="bg-red-100 text-red-800 border-red-200">High</Badge>;
    if (severity === "medium") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Medium</Badge>;
    return <Badge className="bg-gray-100 text-gray-700 border-gray-200">Low</Badge>;
  };

  if (!bid) return null;

  const hasIssues = aiAnalysis && (aiAnalysis.anomalies.length > 0 || aiAnalysis.missing.length > 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bid Details - {bid.contractorCompany}</DialogTitle>
        </DialogHeader>
        
        <div className="flex justify-end gap-2 mb-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAnalyze}
            disabled={aiLoading}
            className="flex items-center gap-2"
          >
            {aiLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Analyze with AI
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const token = localStorage.getItem('auth-token');
              
              if (!token) {
                alert('No authentication token found. Please log in again.');
                return;
              }
              
              const printUrl = `/api/bid-collections/${bid.id}/pdf`;
              
              // Open PDF with authentication
              fetch(printUrl, {
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              }).then(response => {
                if (response.ok) {
                  return response.text();
                } else {
                  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
              }).then(html => {
                const blob = new Blob([html], { type: 'text/html' });
                const url = window.URL.createObjectURL(blob);
                window.open(url, '_blank');
                setTimeout(() => window.URL.revokeObjectURL(url), 100);
              }).catch(error => {
                console.error('Print error:', error);
                alert(`Unable to generate PDF: ${error.message}. Please try logging in again.`);
              });
            }}
            className="flex items-center gap-2"
          >
            <Printer className="h-4 w-4" />
            Print/PDF
          </Button>
        </div>

        {/* AI Analysis Results Panel */}
        {aiAnalysis && (
          <div className="mb-4 border rounded-lg overflow-hidden">
            <div className="bg-slate-50 border-b px-4 py-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-slate-600" />
              <span className="font-semibold text-sm text-slate-700">AI Bid Analysis</span>
            </div>

            {!hasIssues ? (
              <div className="flex items-center gap-2 px-4 py-3 bg-green-50 text-green-800">
                <CheckCircle className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium">Bid looks clean — no issues detected.</span>
              </div>
            ) : (
              <div className="divide-y">
                {/* Summary */}
                <div className="px-4 py-3 bg-blue-50">
                  <p className="text-sm text-blue-800">{aiAnalysis.summary}</p>
                </div>

                {/* Anomalies */}
                {aiAnalysis.anomalies.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-semibold text-slate-700">
                        Anomalies ({aiAnalysis.anomalies.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {aiAnalysis.anomalies.map((a, i) => (
                        <div key={i} className="flex items-start gap-3 text-sm bg-white border rounded p-2">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-slate-800">{a.lineItemDescription}</span>
                            <p className="text-slate-600 mt-0.5">{a.issue}</p>
                          </div>
                          <div className="flex-shrink-0">{getSeverityBadge(a.severity)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Missing Items */}
                {aiAnalysis.missing.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-slate-500" />
                      <span className="text-sm font-semibold text-slate-700">
                        Missing Items ({aiAnalysis.missing.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {aiAnalysis.missing.map((m, i) => (
                        <div key={i} className="text-sm bg-white border rounded p-2">
                          <span className="font-medium text-slate-800">{m.description}</span>
                          <p className="text-slate-600 mt-0.5">{m.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-6">
          {/* Company Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
            <div>
              <label className="text-sm font-medium text-gray-600">Company</label>
              <p className="text-lg font-semibold">{bid.contractorCompany}</p>
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
              <div className="mt-1">{getStatusBadge(bid.status as string)}</div>
            </div>
          </div>

          {/* Notes */}
          {bid.notes ? (
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-2">Notes</label>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="whitespace-pre-wrap">{String(bid.notes)}</p>
              </div>
            </div>
          ) : null}

          {/* Line Items */}
          {lineItems && (lineItems as BidLineItem[]).length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Line Items</h3>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(lineItems as BidLineItem[]).map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{item.description}</TableCell>
                        <TableCell>{item.quantity ? parseFloat(item.quantity).toLocaleString('en-US') : ''}</TableCell>
                        <TableCell>{item.unit || ''}</TableCell>
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
            let attachments: any[] = [];
            
            if (bid.attachments) {
              if (typeof bid.attachments === 'string') {
                try {
                  attachments = JSON.parse(bid.attachments);
                } catch (e) {
                  console.error('Failed to parse attachments:', e);
                  attachments = [];
                }
              } else if (Array.isArray(bid.attachments)) {
                attachments = bid.attachments;
              }
            }
            
            return attachments && attachments.length > 0 ? (
              <div>
                <h3 className="text-lg font-semibold mb-3">Attachments</h3>
                <div className="space-y-2">
                  {attachments.map((file: any, index: number) => (
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
            ) : null;
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
