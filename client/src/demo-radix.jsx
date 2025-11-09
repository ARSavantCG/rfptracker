import React, { useState } from "react";
import RadixCustomSelect from "../components/RadixCustomSelect";

export default function DemoRadix() {
  const [val, setVal] = useState("");
  const options = [
    { value: "alpha", label: "Alpha" },
    { value: "bravo", label: "Bravo" },
    { value: "charlie", label: "Charlie" },
  ];
  return (
    <div style={{ padding: 24 }}>
      <h2>Radix Custom Select — Demo</h2>
      <RadixCustomSelect
        label="Pick one"
        value={val}
        options={options}
        onChange={setVal}
      />
      <div style={{ marginTop: 12 }}>Value: {val}</div>
    </div>
  );
}
