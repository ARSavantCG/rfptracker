import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AUTH_TOKEN_KEY } from "@/lib/auth-constants";

export interface MasterScopeItem {
  id: number;
  name: string;
  description?: string | null;
  csiCode?: string | null;
  csiDivision?: string | null;
  unit: string;
  unitPrice: string;
}

export interface MasterScopeSelection {
  type: "master" | "other";
  masterItemId?: number;
  snapshot?: {
    description: string;
    csiDivision?: string;
    unit: string;
    unitPrice: string;
  };
  customDescription?: string;
  description: string;
  csiDivision?: string;
  unit?: string;
  unitPrice?: string;
}

interface MasterScopeItemPickerProps {
  searchEndpoint: string;
  value?: string;
  masterItemId?: number | null;
  onSelect: (selection: MasterScopeSelection) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  hideOther?: boolean;
}

export default function MasterScopeItemPicker({
  searchEndpoint,
  value,
  masterItemId,
  onSelect,
  placeholder,
  className,
  disabled,
  autoFocus,
  hideOther = false,
}: MasterScopeItemPickerProps) {
  const [query, setQuery] = useState(value ?? "");
  const [results, setResults] = useState<MasterScopeItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectedMasterItemId, setSelectedMasterItemId] = useState<number | null>(masterItemId ?? null);
  const [isOtherMode, setIsOtherMode] = useState(!masterItemId && !!value);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync controlled value/masterItemId changes from parent
  useEffect(() => {
    setQuery(value ?? "");
    setSelectedMasterItemId(masterItemId ?? null);
    setIsOtherMode(!masterItemId && !!value);
  }, [value, masterItemId]);

  const search = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      const token = localStorage.getItem(AUTH_TOKEN_KEY) ?? "";
      fetch(`${searchEndpoint}?q=${encodeURIComponent(q)}&limit=20`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      })
        .then((r) => r.json())
        .then((data) => {
          setResults(Array.isArray(data) ? data : []);
          setOpen(true);
          setActiveIndex(-1);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    },
    [searchEndpoint]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedMasterItemId(null);
    setIsOtherMode(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 200);
  };

  const selectMaster = (item: MasterScopeItem) => {
    setQuery(item.name);
    setSelectedMasterItemId(item.id);
    setIsOtherMode(false);
    setOpen(false);
    const snapshot = {
      description: item.name,
      csiDivision: item.csiDivision ?? undefined,
      unit: item.unit,
      unitPrice: item.unitPrice,
    };
    onSelect({
      type: "master",
      masterItemId: item.id,
      snapshot,
      description: item.name,
      csiDivision: item.csiDivision ?? undefined,
      unit: item.unit,
      unitPrice: item.unitPrice,
    });
  };

  const selectOther = () => {
    setSelectedMasterItemId(null);
    setIsOtherMode(true);
    setOpen(false);
    onSelect({
      type: "other",
      customDescription: query,
      description: query,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" && query.trim()) {
        search(query);
      }
      return;
    }
    const total = results.length + (hideOther ? 0 : 1);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        selectMaster(results[activeIndex]);
      } else if (!hideOther && activeIndex === results.length) {
        selectOther();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const inputClasses = cn(
    className,
    selectedMasterItemId
      ? "border-green-400 bg-green-50 focus:border-green-500"
      : isOtherMode
      ? "border-amber-300 bg-amber-50 focus:border-amber-400"
      : ""
  );

  const shortCsiLabel = (csi: string) => csi.split(" - ")[0];

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (query.trim() && results.length) setOpen(true);
          else if (query.trim()) search(query);
        }}
        placeholder={placeholder ?? "Type to search scope items…"}
        className={inputClasses}
        disabled={disabled}
        autoFocus={autoFocus}
      />

      {/* Soft enforcement notice — shown only after selecting "Other" */}
      {isOtherMode && (
        <p className="text-xs text-amber-600 mt-1 leading-tight">
          Saving as custom entry. Database update pending review.
        </p>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-sm text-gray-400 italic">Searching…</div>
          )}

          {!loading &&
            results.map((item, i) => (
              <div
                key={item.id}
                className={cn(
                  "px-3 py-2 cursor-pointer flex items-start gap-3 hover:bg-blue-50 transition-colors",
                  activeIndex === i ? "bg-blue-100" : ""
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMaster(item);
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
                  {(item.csiCode || item.csiDivision) && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      {item.csiCode ?? shortCsiLabel(item.csiDivision!)}
                    </div>
                  )}
                </div>
              </div>
            ))}

          {!loading && results.length === 0 && query.trim() && (
            <div className="px-3 py-2 text-sm text-gray-400 italic">No master items matched</div>
          )}

          {/* Visual separator before "Other" — hidden when hideOther=true */}
          {!loading && !hideOther && (
            <>
              <div className="border-t border-gray-100 mx-2" />
              <div
                className={cn(
                  "px-3 py-1.5 cursor-pointer flex items-center gap-2 hover:bg-gray-50 transition-colors",
                  activeIndex === results.length ? "bg-gray-100" : ""
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOther();
                }}
                onMouseEnter={() => setActiveIndex(results.length)}
              >
                <span className="text-xs text-gray-400 italic">
                  Other: &ldquo;{query || "…"}&rdquo; — custom entry
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
