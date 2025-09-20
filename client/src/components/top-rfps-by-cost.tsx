import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface RfpRow {
  id: string;
  tenant_name: string;
  property_name: string;
  status: 'received' | 'in_progress' | 'completed' | 'archived';
  area_sf: number | null;
  improvement_cost_total: number | null;
  cost_per_sf?: number | null;
}

interface TopRfpsByCostProps {
  onRowClick?: (rfpId: string) => void;
}

export function TopRfpsByCost({ onRowClick }: TopRfpsByCostProps) {
  const { data: topRfps = [], isLoading } = useQuery<RfpRow[]>({
    queryKey: ["/api/rfp-requests/top-open-by-cost"],
    queryFn: async () => {
      const response = await fetch("/api/rfp-requests/top-open-by-cost?limit=5");
      if (!response.ok) throw new Error("Failed to fetch top RFPs by cost");
      return response.json();
    },
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

  const formatCostPerSf = (cost: number | null): string => {
    if (cost === null || cost === undefined) return "—";
    return `$${cost.toFixed(2)}`;
  };

  if (isLoading) {
    return (
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Top 5 Outstanding RFPs (by Cost)</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-gray-400" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Largest open RFPs by total improvement cost</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
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
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Top 5 Outstanding RFPs (by Cost)</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-gray-400" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Largest open RFPs by total improvement cost</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="text-center py-6 text-gray-500 text-sm">
          No open RFPs with costs yet.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200" aria-label="Top 5 Outstanding RFPs by Cost">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Top 5 Outstanding RFPs (by Cost)</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-4 w-4 text-gray-400" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Largest open RFPs by total improvement cost</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th scope="col" className="text-left py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tenant @ Property
              </th>
              <th scope="col" className="text-right py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                SF
              </th>
              <th scope="col" className="text-right py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total Cost
              </th>
              <th scope="col" className="text-right py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
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
                <td className="py-2 pr-3">
                  <div className="font-medium text-gray-900 truncate max-w-[160px]" title={`${rfp.tenant_name} @ ${rfp.property_name}`}>
                    {rfp.tenant_name}
                  </div>
                  <div className="text-xs text-gray-500 truncate max-w-[160px]" title={rfp.property_name}>
                    @ {rfp.property_name}
                  </div>
                </td>
                <td className="py-2 text-right text-gray-900 font-medium" data-testid={`text-area-${rfp.id}`}>
                  {formatNumber(rfp.area_sf)}
                </td>
                <td className="py-2 text-right text-gray-900 font-medium" data-testid={`text-cost-${rfp.id}`}>
                  {formatCurrency(rfp.improvement_cost_total)}
                </td>
                <td className="py-2 text-right text-gray-900 font-medium" data-testid={`text-cost-per-sf-${rfp.id}`}>
                  {formatCostPerSf(rfp.cost_per_sf)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}