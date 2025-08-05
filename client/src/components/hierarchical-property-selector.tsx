import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Building, Building2 } from "lucide-react";
import { type Property } from "@shared/schema";

interface HierarchicalPropertySelectorProps {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}

interface PropertyGroup {
  propertyName: string;
  properties: Property[];
  isSingleBuilding: boolean;
}

export function HierarchicalPropertySelector({ value, onChange, className }: HierarchicalPropertySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const submenuRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Group properties by propertyName
  const propertyGroups: PropertyGroup[] = properties.reduce((groups, property) => {
    const existingGroup = groups.find(g => g.propertyName === property.propertyName);
    if (existingGroup) {
      existingGroup.properties.push(property);
    } else {
      groups.push({
        propertyName: property.propertyName,
        properties: [property],
        isSingleBuilding: property.isSingleBuilding || false
      });
    }
    return groups;
  }, [] as PropertyGroup[]);

  // Get display value for selected property
  const selectedProperty = properties.find(p => p.id.toString() === value);
  const displayValue = selectedProperty 
    ? selectedProperty.isSingleBuilding 
      ? selectedProperty.propertyName 
      : `${selectedProperty.propertyName} - Building ${selectedProperty.building}`
    : "Select a property...";

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setExpandedProperty(null);

      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePropertySelect = (propertyId: string) => {
    onChange(propertyId);
    setIsOpen(false);
    setExpandedProperty(null);

  };

  const handlePropertyGroupClick = (group: PropertyGroup) => {
    if (group.isSingleBuilding) {
      // Direct selection for single building properties
      handlePropertySelect(group.properties[0].id.toString());
    } else {
      // Toggle expansion for multi-building properties
      setExpandedProperty(expandedProperty === group.propertyName ? null : group.propertyName);
    }
  };



  return (
    <div className={`relative ${className || ""}`} ref={dropdownRef}>
      {/* Main dropdown trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={value ? "text-foreground" : "text-muted-foreground"}>
          {displayValue}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
          <div className="max-h-60 overflow-auto p-1">
            {isLoading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading properties...</div>
            ) : propertyGroups.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No properties available</div>
            ) : (
              propertyGroups.map((group) => (
                <div key={group.propertyName} className="relative">
                  {/* Property group item */}
                  <div
                    className="flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                    onClick={() => handlePropertyGroupClick(group)}
                  >
                    {/* Property icon */}
                    {group.isSingleBuilding ? (
                      <Building className="mr-2 h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
                    )}
                    
                    {/* Property name */}
                    <span className="flex-1">{group.propertyName}</span>
                    
                    {/* Expansion indicator for multi-building properties */}
                    {!group.isSingleBuilding && (
                      <ChevronRight 
                        className={`h-4 w-4 transition-transform ${
                          expandedProperty === group.propertyName ? "rotate-90" : ""
                        }`} 
                      />
                    )}
                    
                    {/* Building count badge for multi-building properties */}
                    {!group.isSingleBuilding && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {group.properties.length}
                      </span>
                    )}
                  </div>

                  {/* Building submenu for multi-building properties */}
                  {!group.isSingleBuilding && expandedProperty === group.propertyName && (
                    <div 
                      className="ml-6 border-l border-border"
                      ref={(el) => {
                        submenuRefs.current[group.propertyName] = el;
                      }}
                    >
                      {group.properties
                        .sort((a, b) => a.building.localeCompare(b.building, undefined, { numeric: true }))
                        .map((property) => (
                          <div
                            key={property.id}
                            className={`flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground ${
                              value === property.id.toString() ? "bg-accent text-accent-foreground font-medium" : ""
                            }`}
                            onClick={() => handlePropertySelect(property.id.toString())}
                          >
                            <Building className="mr-2 h-3 w-3 text-muted-foreground" />
                            <span>{property.propertyName} - Building {property.building}</span>
                            {value === property.id.toString() && (
                              <div className="ml-auto h-2 w-2 rounded-full bg-primary" />
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}