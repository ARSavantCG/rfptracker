import React, { useState } from "react";

/* ----------------------------- Types & Helpers ---------------------------- */

export type CostBucket = "ACTUALS" | "PIPELINE";

export interface CostItem {
  id: string;
  description: string;
  quantity: number;
  unit: string; // sf, lf, etc.
  unitPrice: number;
  bucket: CostBucket; // ACTUALS = Cost to Date; PIPELINE = Committed/Projected
  originalCommitment?: number; // First committed amount
  addedAmount?: number; // Later adds or COs
  drawCaptured?: boolean; // Checked once included in lender draw
  drawRef?: string; // Optional draw # or ID
  updatedAt?: string;
}

const lineTotal = (c: CostItem) => (c.quantity ?? 0) * (c.unitPrice ?? 0);

const currency = (n: number) =>
  `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/* ----------------------------- Cost Editor Form --------------------------- */

export const CostEditor = ({
  initial,
  onSave,
}: {
  initial?: CostItem;
  onSave: (c: CostItem) => void;
}) => {
  const [form, setForm] = useState<CostItem>(
    initial ?? {
      id: crypto.randomUUID(),
      description: "",
      quantity: 0,
      unit: "sf",
      unitPrice: 0,
      bucket: "PIPELINE",
      originalCommitment: 0,
      addedAmount: 0,
      drawCaptured: false,
    }
  );

  const totalCommitted =
    (form.originalCommitment ?? 0) + (form.addedAmount ?? 0);

  const handleSave = () => {
    const updated: CostItem = {
      ...form,
      updatedAt: new Date().toISOString(),
    };
    onSave(updated);
  };

  return (
    <div className="cost-editor">
      <h3>{initial ? "Edit Cost" : "Add Cost"}</h3>

      <label>Description</label>
      <input
        type="text"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />

      <label>Quantity</label>
      <input
        type="number"
        value={form.quantity}
        onChange={(e) =>
          setForm({ ...form, quantity: parseFloat(e.target.value) })
        }
      />

      <label>Unit</label>
      <input
        type="text"
        value={form.unit}
        onChange={(e) => setForm({ ...form, unit: e.target.value })}
      />

      <label>Unit Price</label>
      <input
        type="number"
        value={form.unitPrice}
        onChange={(e) =>
          setForm({ ...form, unitPrice: parseFloat(e.target.value) })
        }
      />

      <label>Bucket</label>
      <select
        value={form.bucket}
        onChange={(e) =>
          setForm({ ...form, bucket: e.target.value as CostBucket })
        }
      >
        <option value="PIPELINE">Committed / Projected</option>
        <option value="ACTUALS">Cost to Date (Actuals)</option>
      </select>

      {form.bucket === "PIPELINE" && (
        <>
          <div style={{ marginTop: "0.5rem" }}>
            <label>Original Commitment</label>
            <input
              type="number"
              value={form.originalCommitment ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  originalCommitment: parseFloat(e.target.value),
                })
              }
            />
          </div>

          <div>
            <label>Added Amounts</label>
            <input
              type="number"
              value={form.addedAmount ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  addedAmount: parseFloat(e.target.value),
                })
              }
            />
          </div>

          <div>
            <label>
              <input
                type="checkbox"
                checked={form.drawCaptured ?? false}
                onChange={(e) =>
                  setForm({ ...form, drawCaptured: e.target.checked })
                }
              />
              Mark as Captured in Draw
            </label>
          </div>

          {form.drawCaptured && (
            <div>
              <label>Draw Reference (Optional)</label>
              <input
                type="text"
                value={form.drawRef ?? ""}
                onChange={(e) =>
                  setForm({ ...form, drawRef: e.target.value })
                }
              />
            </div>
          )}

          <p style={{ fontSize: "0.9rem", opacity: 0.8 }}>
            <strong>Total Committed:</strong>{" "}
            {currency(totalCommitted)}
          </p>
        </>
      )}

      <button onClick={handleSave} style={{ marginTop: "1rem" }}>
        Save
      </button>
    </div>
  );
};

/* ----------------------------- Report Section ----------------------------- */

export const CostReport = ({ items }: { items: CostItem[] }) => {
  const actuals = items.filter((i) => i.bucket === "ACTUALS");
  const pipeline = items.filter(
    (i) => i.bucket === "PIPELINE" && !i.drawCaptured
  );

  const sum = (arr: CostItem[]) =>
    arr.reduce((t, i) => t + lineTotal(i), 0);

  const totalActuals = sum(actuals);
  const totalPipeline = sum(pipeline);

  return (
    <section style={{ marginTop: 32 }}>
      <h2>Cost Summary</h2>

      <div style={{ marginBottom: 24 }}>
        <h3>Committed / Projected (Pipeline)</h3>
        <p style={{ fontSize: 12, opacity: 0.8 }}>
          Costs not yet included in lender draws.
        </p>
        <table className="cost-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Orig. Commitment</th>
              <th>Added</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {pipeline.map((c) => (
              <tr key={c.id}>
                <td>{c.description}</td>
                <td>{currency(c.originalCommitment ?? 0)}</td>
                <td>{currency(c.addedAmount ?? 0)}</td>
                <td>
                  {currency(
                    (c.originalCommitment ?? 0) + (c.addedAmount ?? 0)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <strong>Total Pipeline</strong>
              </td>
              <td>
                <strong>{currency(totalPipeline)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <h3>Cost to Date (Actuals)</h3>
        <p style={{ fontSize: 12, opacity: 0.8 }}>
          Pulled from lender draws / verified expenditures.
        </p>
        <table className="cost-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Unit Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {actuals.map((c) => (
              <tr key={c.id}>
                <td>{c.description}</td>
                <td>{c.quantity}</td>
                <td>{c.unit}</td>
                <td>{currency(c.unitPrice)}</td>
                <td>{currency(lineTotal(c))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <strong>Total Actuals</strong>
              </td>
              <td>
                <strong>{currency(totalActuals)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Grand Total: </strong>
        {currency(totalActuals + totalPipeline)}
      </div>
    </section>
  );
};

/* ----------------------------- Example Usage ------------------------------ */
// Import this file where needed and use:
// <CostEditor onSave={(newCost) => setCosts([...costs, newCost])} />
// <CostReport items={costs} />
