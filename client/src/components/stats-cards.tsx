import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

interface Stats {
  total: number;
  received: number;
  inProgress: number;
  completed: number;
  onHold: number;
}

interface StatsCardsProps {
  onStatusFilter?: (status: string) => void;
}

export function StatsCards({ onStatusFilter }: StatsCardsProps) {
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["/api/rfp-requests/stats"],
  });

  const { data: rfpRequests = [] } = useQuery({
    queryKey: ["/api/rfp-requests"],
    queryFn: async () => {
      const response = await fetch("/api/rfp-requests");
      if (!response.ok) throw new Error("Failed to fetch RFP requests");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
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
  ];

  // Prepare data for charts
  const pieData = [
    { name: "Received", value: stats.received, color: "#8B5CF6" },
    { name: "In Progress", value: stats.inProgress, color: "#F59E0B" },
    { name: "Completed", value: stats.completed, color: "#10B981" },
    { name: "On Hold", value: stats.onHold, color: "#EF4444" },
  ].filter(item => item.value > 0);

  const barData = [
    { name: "Received", count: stats.received, fill: "#8B5CF6" },
    { name: "In Progress", count: stats.inProgress, fill: "#F59E0B" },
    { name: "Completed", count: stats.completed, fill: "#10B981" },
    { name: "On Hold", count: stats.onHold, fill: "#EF4444" },
  ];

  const COLORS = ["#8B5CF6", "#F59E0B", "#10B981", "#EF4444"];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border">
          <p className="font-medium">{payload[0].name}</p>
          <p className="text-sm text-gray-600">
            Count: <span className="font-semibold text-gray-900">{payload[0].value}</span>
          </p>
          <p className="text-xs text-blue-600 mt-1">Click to view project</p>
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
      'On Hold': 'on-hold'
    };
    
    return rfpRequests.filter((rfp: any) => rfp.status === statusMap[status]);
  };

  const handlePieClick = (data: any) => {
    if (onStatusFilter) {
      const statusMap: Record<string, string> = {
        'Received': 'received',
        'In Progress': 'in-progress', 
        'Completed': 'completed',
        'On Hold': 'on-hold'
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
        'On Hold': 'on-hold'
      };
      onStatusFilter(statusMap[data.name]);
    }
  };

  const handleCardClick = (cardTitle: string) => {
    if (onStatusFilter) {
      const statusMap: Record<string, string> = {
        'Received': 'received',
        'In Progress': 'in-progress',
        'Completed': 'completed'
      };
      
      const targetStatus = statusMap[cardTitle];
      if (targetStatus) {
        onStatusFilter(targetStatus);
      }
    }
  };

  return (
    <div className="mb-6">
      {/* Single Row Layout: Combined Stats + Status Distribution + Status Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Box: Combined Stats */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Project Status</h3>
          <div className="space-y-3">
            {cards.map((card, index) => (
              <div 
                key={index} 
                className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                onClick={() => handleCardClick(card.title)}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 ${card.bgColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <i className={`${card.icon} ${card.iconColor} text-sm`}></i>
                  </div>
                  <span className="text-sm font-medium text-gray-700">{card.title}</span>
                </div>
                <span className="text-xl font-bold text-gray-900">{card.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Middle Box: Status Distribution Chart */}
        {stats.total > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Status Distribution</h3>
              <div className="flex items-center space-x-1">
                <span className="text-xs text-gray-500">Click to view project</span>
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
              </div>
            </div>
            
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                    onClick={handlePieClick}
                    className="cursor-pointer"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} className="hover:opacity-80" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Interactive Legend */}
            <div className="grid grid-cols-2 gap-2 mt-4">
              {pieData.map((item, index) => (
                <div 
                  key={index} 
                  className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 rounded p-1 transition-colors"
                  onClick={() => handlePieClick(item)}
                >
                  <div 
                    className="w-3 h-3 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: item.color }}
                  ></div>
                  <span className="text-xs text-gray-600 truncate">{item.name}</span>
                  <span className="text-xs font-medium text-gray-900 ml-auto">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Right Box: Status Overview Chart */}
        {stats.total > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Status Overview</h3>
              <div className="flex items-center space-x-1">
                <span className="text-xs text-gray-500">Click to view project</span>
                <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded font-medium">
                  Live
                </span>
              </div>
            </div>
            
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData}
                  margin={{ top: 20, right: 20, left: 20, bottom: 5 }}
                  onClick={handleBarClick}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={25}
                    allowDecimals={false}
                    domain={[0, 'dataMax']}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar 
                    dataKey="count" 
                    radius={[4, 4, 0, 0]}
                    stroke="none"
                    className="cursor-pointer"
                    onClick={handleBarClick}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
