import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Building, Building2, Check } from "lucide-react";
import { type Property } from "@shared/schema";
import { describePropertyScope } from "@shared/property-scope";

interface HierarchicalPropertySelectorProps {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
  isMultiBuilding?: boolean;

  /**
   * MULTI-SELECT MODE. Same dropdown, same hierarchy; clicking toggles instead
   * of choosing, and the menu stays open so several can be picked in a row.
   *
   * Deliberately NOT ctrl-click. A modifier key does not exist on a phone, and
   * this app gets used on one — the report filter would have been unusable
   * there. Click-to-toggle in an open menu does the same job on every device.
   */
  multiple?: boolean;
  /** Selected property ids, in multi mode. */
  values?: string[];
  onChangeMultiple?: (ids: string[]) => void;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
}

interface PropertyGroup {
  propertyName: string;
  properties: Property[];
  isSingleBuilding: boolean;
}

export function HierarchicalPropertySelector({
  value, onChange, className, isMultiBuilding = false,
  multiple = false, values, onChangeMultiple, placeholder,
}: HierarchicalPropertySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const submenuRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const { data: properties = [], isLoading, error } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    retry: 3,
    retryDelay: 1000,
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

  const selectedIds = new Set((values || []).map(String));

  // Selection helpers for multi mode.
  const commit = (next: Set<string>) => onChangeMultiple?.(Array.from(next));
  const toggleIds = (ids: string[], on: boolean) => {
    const next = new Set(selectedIds);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    commit(next);
  };

  // Get display value for selected property
  const selectedProperty = properties.find(p => p.id.toString() === value);
  const multiDisplay = selectedIds.size === 0
    ? (placeholder || "All properties")
    : describePropertyScope(Array.from(selectedIds), properties as any);
  const displayValue = multiple ? multiDisplay : selectedProperty 
    ? isMultiBuilding
      ? `${selectedProperty.propertyName} (Multiple Buildings)`
      : selectedProperty.isSingleBuilding 
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

    // Only add listener if dropdown is open
    if (isOpen) {
      // Add slight delay to prevent immediate closure from the same click that opened it
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  const handlePropertySelect = (propertyId: string) => {
    if (multiple) {
      // Stay open: picking several in a row is the whole point.
      toggleIds([propertyId], !selectedIds.has(propertyId));
      return;
    }
    onChange(propertyId);
    setIsOpen(false);
    setExpandedProperty(null);
  };

  const handlePropertyGroupClick = (group: PropertyGroup) => {
    if (multiple) {
      // The whole park in one click — every building under this name.
      const ids = group.properties.map((p) => p.id.toString());
      const allOn = ids.every((id) => selectedIds.has(id));
      toggleIds(ids, !allOn);
      return;
    }
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
          {multiple && selectedIds.size > 0 && (
            <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{selectedIds.size} selected</span>
              <button type="button" className="text-primary hover:underline" onClick={() => commit(new Set())}>
                Clear
              </button>
            </div>
          )}
          <div className="max-h-96 overflow-auto p-1">
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
                    {/* Selection state, in multi mode. A tick on the park row
                        means every building under it is selected; a dash means
                        some are. */}
                    {multiple && (() => {
                      const ids = group.properties.map((p) => p.id.toString());
                      const all = ids.every((id) => selectedIds.has(id));
                      const some = !all && ids.some((id) => selectedIds.has(id));
                      return (
                        <span className={`mr-2 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                          all ? 'border-primary bg-primary text-primary-foreground'
                          : some ? 'border-primary bg-primary/20'
                          : 'border-input'
                        }`}>
                          {all && <Check className="h-3 w-3" />}
                          {some && <span className="h-0.5 w-2 rounded bg-primary" />}
                        </span>
                      );
                    })()}

                    {/* Property icon */}
                    {group.isSingleBuilding ? (
                      <Building className="mr-2 h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
                    )}
                    
                    {/* Property name */}
                    <span className="flex-1">{group.propertyName}</span>
                    
                    {/* Expansion indicator. In multi mode clicking the ROW
                        toggles the whole park, so expanding has to be its own
                        target or there would be no way to reach one building. */}
                    {!group.isSingleBuilding && (
                      <span
                        role="button"
                        aria-label={`Show buildings in ${group.propertyName}`}
                        onClick={(e) => {
                          if (!multiple) return;
                          e.stopPropagation();
                          setExpandedProperty(
                            expandedProperty === group.propertyName ? null : group.propertyName);
                        }}
                        className={multiple ? "rounded p-0.5 hover:bg-muted" : ""}
                      >
                        <ChevronRight
                          className={`h-4 w-4 transition-transform ${
                            expandedProperty === group.propertyName ? "rotate-90" : ""
                          }`}
                        />
                      </span>
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
                              !multiple && value === property.id.toString() ? "bg-accent text-accent-foreground font-medium" : ""
                            }`}
                            onClick={() => handlePropertySelect(property.id.toString())}
                          >
                            {multiple && (
                              <span className={`mr-2 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                                selectedIds.has(property.id.toString())
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-input'
                              }`}>
                                {selectedIds.has(property.id.toString()) && <Check className="h-3 w-3" />}
                              </span>
                            )}
                            <Building className="mr-2 h-3 w-3 text-muted-foreground" />
                            <span>{property.propertyName} - Building {property.building}</span>
                            {!multiple && value === property.id.toString() && (
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