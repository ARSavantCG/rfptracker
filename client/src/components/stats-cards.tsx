import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { TopOutstandingRfpsPanel } from "./top-rfps-by-cost";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

interface Stats {
  total: number;
  received: number;
  inProgress: number;
  completed: number;
  onHold: number;
  archived: number;
  cancelled: number;
}

interface StatsCardsProps {
  onStatusFilter?: (status: string) => void;
  onRfpClick?: (rfpId: string) => void;
}

export function StatsCards({ onStatusFilter, onRfpClick }: StatsCardsProps) {
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["/api/rfp-requests/stats"],
  });

  const { data: rfpRequests = [] } = useQuery({
    queryKey: ["/api/rfp-requests"],
    queryFn: async () => {
      const response = await fetch("/api/rfp-requests", {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem(AUTH_TOKEN_KEY)}` }
      });
      if (!response.ok) throw new Error("Failed to fetch RFP requests");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 animate-pulse">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-gray-200 rounded-lg"></div>
              <div className="ml-4 flex-1">
                <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-12"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const cards = [
    {
      title: "Received",
      value: stats.received,
      icon: "fas fa-inbox",
      bgColor: "bg-purple-100",
      iconColor: "text-purple-600",
      change: "+5%",
      trend: "up"
    },
    {
      title: "In Progress",
      value: stats.inProgress,
      icon: "fas fa-clock",
      bgColor: "bg-orange-100",
      iconColor: "text-orange-600",
      change: "+8%",
      trend: "up"
    },
    {
      title: "Completed",
      value: stats.completed,
      icon: "fas fa-check-circle",
      bgColor: "bg-green-100",
      iconColor: "text-green-600",
      change: "+15%",
      trend: "up"
    },
    {
      title: "Archived",
      value: stats.archived,
      icon: "fas fa-archive",
      bgColor: "bg-gray-100",
      iconColor: "text-gray-600",
      change: "0%",
      trend: "neutral"
    },
    {
      title: "Cancelled",
      value: stats.cancelled ?? 0,
      icon: "fas fa-ban",
      bgColor: "bg-rose-100",
      iconColor: "text-rose-600",
      change: "0%",
      trend: "neutral"
    },
  ];

  // Prepare data for charts - always show all three main statuses
  const pieData = [
    { name: "Received", value: stats.received, color: "#8B5CF6" },
    { name: "In Progress", value: stats.inProgress, color: "#F59E0B" },
    { name: "Completed", value: stats.completed, color: "#10B981" },
  ];

  const barData = [
    { name: "Received", count: stats.received, fill: "#8B5CF6" },
    { name: "In Progress", count: stats.inProgress, fill: "#F59E0B" },
    { name: "Completed", count: stats.completed, fill: "#10B981" },
  ];

  const COLORS = ["#8B5CF6", "#F59E0B", "#10B981", "#EF4444"];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-2 rounded-lg shadow-lg border text-xs">
          <p className="font-medium">{payload[0].name}</p>
          <p className="text-gray-600">
            Count: <span className="font-semibold text-gray-900">{payload[0].value}</span>
          </p>
          <p className="text-blue-600 mt-1">Click to filter</p>
        </div>
      );
    }
    return null;
  };

  const getProjectsByStatus = (status: string) => {
    const statusMap: Record<string, string> = {
      'Received': 'received',
      'In Progress': 'in-progress', 
      'Completed': 'completed',
      'Archived': 'archived',
      'Cancelled': 'cancelled',
    };
    
    return rfpRequests.filter((rfp: any) => rfp.status === statusMap[status]);
  };

  const handlePieClick = (data: any) => {
    if (onStatusFilter) {
      const statusMap: Record<string, string> = {
        'Received': 'received',
        'In Progress': 'in-progress', 
        'Completed': 'completed',
        'Archived': 'archived',
        'Cancelled': 'cancelled',
      };
      onStatusFilter(statusMap[data.name]);
    }
  };

  const handleBarClick = (data: any) => {
    if (onStatusFilter) {
      const statusMap: Record<string, string> = {
        'Received': 'received',
        'In Progress': 'in-progress', 
        'Completed': 'completed',
        'Archived': 'archived',
        'Cancelled': 'cancelled',
      };
      onStatusFilter(statusMap[data.name]);
    }
  };

  const handleCardClick = (cardTitle: string) => {
    if (onStatusFilter) {
      const statusMap: Record<string, string> = {
        'Received': 'received',
        'In Progress': 'in-progress',
        'Completed': 'completed',
        'Archived': 'archived',
        'Cancelled': 'cancelled',
      };
      
      const targetStatus = statusMap[cardTitle];
      if (targetStatus) {
        onStatusFilter(targetStatus);
      }
    }
  };

  return (
    <div className="mb-6 w-full max-w-full overflow-hidden">
      {/* Dashboard Grid with 4 Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1 w-full">
        
        {/* Project Status - Compact */}
        <div className="bg-white p-2 rounded-lg shadow-sm border border-gray-200">
          <div className="space-y-2">
            {cards.map((card, index) => (
              <div 
                key={index} 
                className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                onClick={() => handleCardClick(card.title)}
              >
                <div className="flex items-center space-x-2">
                  <div className={`w-4 h-4 ${card.bgColor} rounded flex items-center justify-center flex-shrink-0`}>
                    <i className={`${card.icon} ${card.iconColor} text-xs`}></i>
                  </div>
                  <span className="text-xs font-medium text-gray-700 truncate" style={{ fontSize: '10px' }}>{card.title}</span>
                </div>
                <span className="text-sm font-bold text-gray-900" style={{ fontSize: '12px' }}>{card.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status Distribution - Compact */}
        {stats.total > 0 && (
          <div className="bg-white p-2 rounded-lg shadow-sm border border-gray-200">
            <div className="h-20">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={12}
                    outerRadius={35}
                    fill="#8884d8"
                    dataKey="value"
                    onClick={handlePieClick}
                    className="cursor-pointer"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} className="hover:opacity-80" />
                    ))}
                  </Pie>
                  <Tooltip 
                    content={<CustomTooltip />} 
                    offset={15}
                    position={{ x: 100, y: 40 }}
                    allowEscapeViewBox={{ x: false, y: false }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Compact Legend - Show All Items */}
            <div className="space-y-1 mt-2">
              {pieData.map((item, index) => (
                <div 
                  key={index} 
                  className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 transition-colors"
                  onClick={() => handlePieClick(item)}
                >
                  <div 
                    className="w-2 h-2 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: item.color }}
                  ></div>
                  <span className="text-xs text-gray-600 truncate flex-1" style={{ fontSize: '10px' }}>
                    {item.name}
                  </span>
                  <span className="text-xs font-medium text-gray-900" style={{ fontSize: '10px' }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status Overview - Compact */}
        {stats.total > 0 && (
          <div className="bg-white p-2 rounded-lg shadow-sm border border-gray-200">
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData}
                  margin={{ top: 5, right: 8, left: 15, bottom: 25 }}
                  onClick={handleBarClick}
                  reverseStackOrder={false}
                >
                  <CartesianGrid strokeDasharray="1 1" stroke="#f3f4f6" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-45}
                    textAnchor="end"
                    height={25}
                  />
                  <YAxis 
                    tick={{ fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    width={20}
                    allowDecimals={false}
                    domain={[0, 'dataMax']}
                    type="number"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar 
                    dataKey="count" 
                    radius={[2, 2, 0, 0]}
                    stroke="none"
                    className="cursor-pointer"
                    onClick={handleBarClick}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Top Outstanding RFPs by Cost Panel */}
        <TopOutstandingRfpsPanel 
          limit={3} 
          onRowClick={onRfpClick} 
        />
        
      </div>
    </div>
  );
}
