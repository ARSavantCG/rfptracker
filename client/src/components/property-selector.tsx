import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { type Property } from "@shared/schema";

interface PropertySelectorProps {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}

export function PropertySelector({ value, onChange, className }: PropertySelectorProps) {
  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  return (
    <div className={className || ""}>
      <div className="relative">
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
        >
          <option value="">Select a property...</option>
          {isLoading ? (
            <option value="loading" disabled>Loading properties...</option>
          ) : properties.length === 0 ? (
            <option value="empty" disabled>No properties available</option>
          ) : (
            properties.map((property) => (
              <option key={property.id} value={property.id.toString()}>
                {property.displayName}
              </option>
            ))
          )}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
      </div>
    </div>
  );
}