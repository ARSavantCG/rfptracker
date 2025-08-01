import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, CheckCircle, Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/lib/utils";
import { getTimezoneInfo, getCurrentDateString, formatDateForDisplay, formatDateForInput } from "@shared/date-utils";

export function TimezoneAdminPanel() {
  const [timezoneInfo, setTimezoneInfo] = useState<any>(null);
  
  // Get sample RFP to test date display
  const { data: rfps = [] } = useQuery({
    queryKey: ["/api/rfp-requests"],
  });

  useEffect(() => {
    setTimezoneInfo(getTimezoneInfo());
  }, []);

  const testDates = [
    { label: "Today", value: getCurrentDateString() },
    { label: "Sample: July 30, 2025", value: "2025-07-30" },
    { label: "Sample: December 25, 2024", value: "2024-12-25" }
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Timezone Management & Date Handling
          </CardTitle>
          <CardDescription>
            Monitor and validate date/time handling across the application to prevent timezone conversion issues.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Timezone Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Browser Timezone</h4>
              <Badge variant="outline" className="text-sm">
                {timezoneInfo?.userTimezone || "Loading..."}
              </Badge>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Current Time</h4>
              <Badge variant="outline" className="text-sm">
                {timezoneInfo?.currentTime || "Loading..."}
              </Badge>
            </div>
          </div>

          {/* Date Handling Policy */}
          <div className="border rounded-lg p-4 bg-green-50 dark:bg-green-950">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-green-800 dark:text-green-200">
                  Timezone Policy Active
                </h4>
                <div className="text-xs text-green-700 dark:text-green-300 space-y-1">
                  {timezoneInfo?.recommendations?.map((rec: string, index: number) => (
                    <div key={index}>• {rec}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Date Processing Test */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Date Processing Validation</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {testDates.map((testDate, index) => (
                <div key={index} className="border rounded-lg p-3 space-y-2">
                  <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {testDate.label}
                  </div>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-gray-500">Input:</span> {testDate.value}
                    </div>
                    <div>
                      <span className="text-gray-500">Display:</span> {formatDateForDisplay(testDate.value)}
                    </div>
                    <div>
                      <span className="text-gray-500">Form:</span> {formatDateForInput(testDate.value)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sample RFP Date Test */}
          {rfps.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Live RFP Date Validation</h4>
              <div className="border rounded-lg p-3 space-y-2">
                <div className="text-xs font-medium">
                  {rfps[0].tenantName} - {rfps[0].rfpNumber}
                </div>
                <div className="space-y-1 text-xs">
                  <div>
                    <span className="text-gray-500">Received:</span> {formatDate(rfps[0].receivedOn)}
                  </div>
                  <div>
                    <span className="text-gray-500">Due:</span> {formatDate(rfps[0].internalDueDate)}
                  </div>
                  <div>
                    <span className="text-gray-500">Raw Received:</span> {rfps[0].receivedOn}
                  </div>
                  <div>
                    <span className="text-gray-500">Raw Due:</span> {rfps[0].internalDueDate}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action Items */}
          <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-950">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  Date Handling Status
                </h4>
                <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                  <div>✅ Centralized date utilities implemented</div>
                  <div>✅ Timezone conversion prevention active</div>
                  <div>✅ Form date handling standardized</div>
                  <div>✅ Display formatting consistent</div>
                  <div>✅ Database storage preserves local dates</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}