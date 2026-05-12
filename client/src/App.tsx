/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 *
 * This software is proprietary and confidential. Unauthorized copying,
 * distribution, or use of this software is strictly prohibited.
 */

import { Switch, Route } from "wouter";
import { useState, useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Navigation from "@/components/navigation";
import Dashboard from "@/pages/dashboard";
import Contacts from "@/pages/contacts";
import Properties from "@/pages/properties";
import RomPilot from "@/pages/rom-pilot";
import Reports from "@/pages/reports";
import Admin from "@/pages/admin";
import AuditLogAdmin from "@/pages/audit-log-admin";
import Login from "@/pages/login";
import ResetPassword from "@/pages/reset-password";
import NotFound from "@/pages/not-found";
import { PropertySummaryReport } from "@/pages/PropertySummaryReport";
import DataScrubbing from "@/pages/data-scrubbing";
import DataMapping from "@/pages/data-mapping";
import ProjectReportGenerator from "@/pages/project-report-generator";
import PropertyDataAudit from "@/pages/property-data-audit";
import HistoricalImport from "@/pages/historical-import";
import ProposalsLibrary from "@/pages/proposals-library";
import { useAuth } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/error-boundary";
import AuthCheck from "@/components/auth-check";
import Footer from "@/components/footer";
import DemoRadix from "./demo-radix";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setAuthChecked(true);
    }
  }, [isLoading]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Check if we're on the reset password page
    if (
      window.location.pathname === "/reset-password" ||
      window.location.search.includes("token=")
    ) {
      return <ResetPassword />;
    }
    return (
      <Login
        onLoginSuccess={() => {
          // Clear any error states and reload
          queryClient.clear();
          window.location.reload();
        }}
      />
    );
  }

  return (
    <AuthCheck>
      <div className="min-h-screen flex flex-col">
        <div className="flex-1">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/contacts" component={Contacts} />
            <Route path="/properties" component={Properties} />
            <Route path="/rom-pilot" component={RomPilot} />
            <Route path="/reports" component={Reports} />
            <Route path="/data-scrubbing" component={DataScrubbing} />
            <Route path="/data-mapping" component={DataMapping} />
            <Route path="/project-report-generator" component={ProjectReportGenerator} />
            <Route path="/property-data-audit" component={PropertyDataAudit} />
            <Route path="/historical-import" component={HistoricalImport} />
            <Route path="/proposals-library" component={ProposalsLibrary} />
            <Route path="/admin" component={Admin} />
            <Route path="/admin/audit-log" component={AuditLogAdmin} />
            <Route
              path="/admin/property-summary-report"
              component={PropertySummaryReport}
            />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/demo-radix" component={DemoRadix} />
            <Route component={NotFound} />
          </Switch>
        </div>
        <Footer />
      </div>
    </AuthCheck>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="min-h-screen bg-gray-50">
            <Toaster />
            <Router />
          </div>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
