import * as Select from "@radix-ui/react-select";
import { useMemo } from "react";

// Simple chevrons; replace with your icons if you have them
const ChevronDown = () => <span style={{ paddingLeft: 6 }}>▾</span>;
const Check = () => <span style={{ paddingRight: 6 }}>✓</span>;

export default function RadixCustomSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  style,
  width = 280,
}) {
  const items = useMemo(() => options ?? [], [options]);

  return (
    <div style={{ display: "grid", gap: 6, width, ...style }}>
      {label ? <label style={{ fontWeight: 600 }}>{label}</label> : null}

      <Select.Root value={value ?? ""} onValueChange={onChange}>
        <Select.Trigger
          aria-label={label || "Select"}
          style={{
            height: 40,
            padding: "0 10px",
            borderRadius: 6,
            border: "1px solid #ccc",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#fff",
            outline: "none",
          }}
        >
          <Select.Value placeholder={placeholder} />
          <Select.Icon>
            <ChevronDown />
          </Select.Icon>
        </Select.Trigger>

        {/* PORTAL avoids clipping under overflow/positioned parents */}
        <Select.Portal>
          <Select.Content
            position="popper" // prevents clipping; uses floating positioning
            sideOffset={4}
            style={{
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 6,
              boxShadow: "0 8px 24px rgba(0,0,0,.12)",
              zIndex: 9999,
              overflow: "hidden",
            }}
          >
            <Select.Viewport style={{ padding: 4 }}>
              {items.map((opt) => (
                <Select.Item
                  key={String(opt.value)}
                  value={String(opt.value)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: 36,
                    padding: "0 10px",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  <Select.ItemIndicator>
                    <Check />
                  </Select.ItemIndicator>
                  <Select.ItemText>{opt.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
