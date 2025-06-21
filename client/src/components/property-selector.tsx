import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a property..." />
        </SelectTrigger>
        <SelectContent>
          {isLoading ? (
            <SelectItem value="loading" disabled>Loading properties...</SelectItem>
          ) : properties.length === 0 ? (
            <SelectItem value="empty" disabled>No properties available</SelectItem>
          ) : (
            properties.map((property) => (
              <SelectItem key={property.id} value={property.id.toString()}>
                {property.displayName}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}