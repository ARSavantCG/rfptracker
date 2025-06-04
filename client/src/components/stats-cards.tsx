import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

interface Stats {
  total: number;
  received: number;
  inProgress: number;
  completed: number;
  onHold: number;
}

export function StatsCards() {
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["/api/rfp-requests/stats"],
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
      title: "Total RFPs",
      value: stats.total,
      icon: "fas fa-file-invoice",
      bgColor: "bg-blue-100",
      iconColor: "text-blue-600",
      change: "+12%",
      trend: "up"
    },
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
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4 mb-6">
      {/* Compact Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        {cards.map((card, index) => (
          <div key={index} className="bg-white p-3 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center space-x-2">
              <div className={`w-6 h-6 ${card.bgColor} rounded flex items-center justify-center flex-shrink-0`}>
                <i className={`${card.icon} ${card.iconColor} text-xs`}></i>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-600 truncate">{card.title}</p>
                <p className="text-lg font-bold text-gray-900">{card.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Compact Charts Section */}
      {stats.total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Compact Pie Chart */}
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Status Distribution</h3>
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
            </div>
            
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={20}
                    outerRadius={55}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Compact Legend */}
            <div className="grid grid-cols-2 gap-1 mt-2">
              {pieData.map((item, index) => (
                <div key={index} className="flex items-center space-x-1">
                  <div 
                    className="w-2 h-2 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: item.color }}
                  ></div>
                  <span className="text-xs text-gray-600 truncate">{item.name}</span>
                  <span className="text-xs font-medium text-gray-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Compact Bar Chart */}
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Status Overview</h3>
              <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded font-medium">
                Live
              </span>
            </div>
            
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData}
                  margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="2 2" stroke="#f3f4f6" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={20}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar 
                    dataKey="count" 
                    radius={[2, 2, 0, 0]}
                    stroke="none"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
