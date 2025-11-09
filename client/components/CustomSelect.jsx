import React from "react";

const CustomSelect = ({ label, value, options, onChange }) => {
  return (
    <div className="form-group" style={{ display: "grid", gap: 6 }}>
      {label ? <label style={{ fontWeight: 600 }}>{label}</label> : null}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: 40,
          padding: "0 10px",
          borderRadius: 6,
          border: "1px solid #ccc",
          outline: "none",
        }}
        onFocus={(e) => (e.currentTarget.style.border = "1px solid #2e77d0")}
        onBlur={(e) => (e.currentTarget.style.border = "1px solid #ccc")}
      >
        {(options ?? []).map((opt) => (
          <option key={String(opt.value)} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default CustomSelect;
