/**
 * TopOutstandingRfpsPanel - Dashboard component for displaying top RFPs by cost
 * 
 * Usage:
 * ```tsx
 * // Basic usage with default limit of 5
 * <TopOutstandingRfpsPanel onRowClick={(id) => navigate(`/rfps/${id}`)} />
 * 
 * // Custom limit
 * <TopOutstandingRfpsPanel limit={10} onRowClick={handleRfpClick} />
 * ```
 * 
 * Features:
 * - Shows top open RFPs (received/in-progress) by improvement cost
 * - Handles edge cases: null costs, zero/negative area
 * - Status badges and sorting toggle
 * - Fully accessible with keyboard navigation
 * - Responsive design for mobile/tablet
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, ToggleLeft, ToggleRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface RfpRow {
  id: string;
  tenant_name: string;
  property_name: string;
  status: 'received' | 'in_progress' | 'completed' | 'archived';
  area_sf: number | null;
  improvement_cost_total: number | null;
  cost_per_sf?: number | null;
}

interface TopOutstandingRfpsPanelProps {
  /** Number of RFPs to display (default: 5) */
  limit?: number;
  /** Callback when a row is clicked with RFP ID */
  onRowClick?: (rfpId: string) => void;
}

export function TopOutstandingRfpsPanel({ 
  limit = 5, 
  onRowClick 
}: TopOutstandingRfpsPanelProps) {
  const [sortBy, setSortBy] = useState<'cost' | 'cost_per_sf'>('cost');

  const { data: rawRfps = [], isLoading } = useQuery<RfpRow[]>({
    queryKey: ["/api/rfp-requests/top-open-by-cost", limit],
    queryFn: async () => {
      const response = await fetch(`/api/rfp-requests/top-open-by-cost?limit=${limit}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth-token')}` }
      });
      if (!response.ok) throw new Error("Failed to fetch top RFPs by cost");
      return response.json();
    },
  });

  // Sort the data based on current toggle
  const topRfps = [...rawRfps].sort((a, b) => {
    if (sortBy === 'cost') {
      return (b.improvement_cost_total || 0) - (a.improvement_cost_total || 0);
    } else {
      return (b.cost_per_sf || 0) - (a.cost_per_sf || 0);
    }
  });

  const formatCurrency = (amount: number | null): string => {
    if (amount === null || amount === undefined) return "—";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number | null): string => {
    if (num === null || num === undefined) return "—";
    return new Intl.NumberFormat('en-US').format(Math.round(num));
  };

  const formatCostPerSf = (cost: number | null, areaSf: number | null): string => {
    // Edge case: area_sf <= 0 → show — for $/SF
    if (cost === null || cost === undefined || areaSf === null || areaSf <= 0) return "—";
    return `$${cost.toFixed(2)}`;
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      'received': { variant: 'secondary' as const, label: 'Received' },
      'in_progress': { variant: 'default' as const, label: 'In Progress' },
    };
    const config = variants[status as keyof typeof variants];
    if (!config) return null;
    
    return (
      <Badge variant={config.variant} className="text-xs">
        {config.label}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="bg-white p-2 rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-900" style={{ fontSize: '9px' }}>Top {limit} RFPs (by Cost)</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-gray-400" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Loading largest open RFPs by cost...</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="space-y-2">
          {[...Array(limit)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
                <div className="flex-1">
                  <div className="h-3 bg-gray-200 rounded w-3/4 mb-1"></div>
                  <div className="h-2 bg-gray-200 rounded w-1/2"></div>
                </div>
                <div className="text-right">
                  <div className="h-3 bg-gray-200 rounded w-16 mb-1"></div>
                  <div className="h-2 bg-gray-200 rounded w-12"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (topRfps.length === 0) {
    return (
      <div className="bg-white p-2 rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-900" style={{ fontSize: '9px' }}>Top {limit} RFPs (by Cost)</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-gray-400" />
              </TooltipTrigger>
              <TooltipContent>
                <p>No RFPs with costs available</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="text-center py-3 text-gray-500 text-xs">
          No RFPs with costs yet.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-2 rounded-lg shadow-sm border border-gray-200" aria-label={`Top ${limit} Outstanding RFPs by Cost`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-900" style={{ fontSize: '9px' }}>Top {limit} RFPs (by Cost)</h3>
        <div className="flex items-center space-x-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex items-center space-x-1 text-xs text-gray-500 hover:text-gray-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded px-1 py-0.5"
                  onClick={() => setSortBy(sortBy === 'cost' ? 'cost_per_sf' : 'cost')}
                  aria-pressed={sortBy === 'cost_per_sf'}
                  aria-label={`Currently sorting by ${sortBy === 'cost' ? 'Total Cost' : 'Cost per Square Foot'}. Click to toggle sorting method.`}
                >
                  {sortBy === 'cost' ? <ToggleLeft className="h-4 w-4" /> : <ToggleRight className="h-4 w-4" />}
                  <span>{sortBy === 'cost' ? 'Total Cost' : '$/SF'}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Click to toggle between Total Cost and $/SF ranking</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-gray-400" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Largest RFPs by {sortBy === 'cost' ? 'total improvement cost' : 'cost per square foot'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200">
              <th scope="col" className="text-left py-1 text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ fontSize: '8px' }}>
                Tenant @ Property
              </th>
              <th scope="col" className="text-center py-1 text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ fontSize: '8px' }}>
                SF
              </th>
              <th scope="col" className="text-center py-1 text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ fontSize: '8px' }}>
                Total Cost
              </th>
              <th scope="col" className="text-center py-1 text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ fontSize: '8px' }}>
                $/SF
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {topRfps.map((rfp) => (
              <tr
                key={rfp.id}
                role="button"
                tabIndex={0}
                className="hover:bg-gray-50 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
                onClick={() => onRowClick?.(rfp.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick?.(rfp.id);
                  }
                }}
                data-testid={`row-rfp-${rfp.id}`}
              >
                <td className="py-1 pr-3">
                  <div className="flex items-center space-x-2 mb-1">
                    <div className="text-xs font-medium text-gray-900 truncate max-w-[120px]" title={`${rfp.tenant_name} @ ${rfp.property_name}`} style={{ fontSize: '8px' }}>
                      {rfp.tenant_name}
                    </div>
                    {getStatusBadge(rfp.status)}
                  </div>
                  <div className="text-xs text-gray-500 truncate max-w-[160px]" title={rfp.property_name} style={{ fontSize: '7px' }}>
                    @ {rfp.property_name}
                  </div>
                </td>
                <td className="py-0.5 text-right text-xs text-gray-900 font-medium" data-testid={`text-area-${rfp.id}`} style={{ fontSize: '8px' }}>
                  {formatNumber(rfp.area_sf)}
                </td>
                <td className="py-0.5 text-right text-xs text-gray-900 font-medium" data-testid={`text-cost-${rfp.id}`} style={{ fontSize: '8px' }}>
                  {formatCurrency(rfp.improvement_cost_total)}
                </td>
                <td className="py-0.5 text-right text-xs text-gray-900 font-medium" data-testid={`text-cost-per-sf-${rfp.id}`} style={{ fontSize: '8px' }}>
                  {formatCostPerSf(rfp.cost_per_sf ?? null, rfp.area_sf)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}