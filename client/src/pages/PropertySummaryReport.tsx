import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, Eye, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function PropertySummaryReport() {
  const [isLoading, setIsLoading] = useState(false);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const { toast } = useToast();

  const handleViewReport = () => {
    setIsLoading(true);
    // Open the report directly in a new tab like other reports
    const newWindow = window.open('/api/reports/property-summary', '_blank');
    if (!newWindow) {
      toast({
        title: "Popup blocked",
        description: "Please allow popups for this site to view the report.",
        variant: "destructive"
      });
    }
    setIsLoading(false);
  };





  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Link href="/admin">
          <Button variant="ghost" className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Admin
          </Button>
        </Link>
        
        <div className="flex items-center gap-3 mb-2">
          <FileText className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Property Summary Report
          </h1>
        </div>
        
        <p className="text-gray-600 dark:text-gray-400 max-w-3xl">
          Comprehensive summary of all properties including bay configurations, building specifications, 
          electrical capacity, executed leases, and cost estimates.
        </p>
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-blue-600" />
            Comprehensive Property Summary
          </CardTitle>
          <CardDescription>
            This report consolidates all property data across your portfolio into a single comprehensive document.
            It includes property details, bay configurations, building specifications, electrical systems, 
            executed leases, and cost estimates.
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <div className="space-y-6">
            {/* Report Features */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900 dark:text-white">Includes:</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <li>• Property details and locations</li>
                  <li>• Bay configurations and square footage</li>
                  <li>• Building specifications (structural, operational, safety)</li>
                  <li>• Electrical capacity and transformers</li>
                  <li>• Executed leases and tenant information</li>
                  <li>• Cost estimates and financial data</li>
                </ul>
              </div>
              
              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900 dark:text-white">Report Details:</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <li>• Professional Kurv Industrial branding</li>
                  <li>• Organized by property with clear sections</li>
                  <li>• Formatted tables for easy reading</li>
                  <li>• Print-friendly layout</li>
                  <li>• Real-time data from your system</li>
                  <li>• Export-ready HTML format</li>
                </ul>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-4 pt-4 border-t">
              <Button 
                onClick={handleViewReport}
                disabled={isLoading}
                className="flex items-center gap-2"
              >
                <Eye className="w-4 h-4" />
                {isLoading ? "Generating..." : "View Report"}
              </Button>
              

            </div>

            {/* Usage Notes */}
            <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Usage Notes:</h4>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                <li>• The report pulls real-time data from your database</li>
                <li>• Building specifications will show "Not specified" if not yet configured</li>
                <li>• Cost estimates are placeholder values until actual cost tracking is implemented</li>
                <li>• The report is optimized for both screen viewing and printing</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}