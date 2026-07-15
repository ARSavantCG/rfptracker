// Occupancy report: leased SF vs rentable SF, per property and portfolio.
//
// Occupancy % = occupied SF / rentable SF. Vacancy % = 100 − occupancy.
// Occupancy rate is the CRE-standard headline; vacancy shown alongside.
//
// Occupied SF = sum of executed-lease rentable SF for the property (any signed
// lease, per current definition — no date filtering). Rentable SF = bay-derived
// total (same helper the Costs-in-Place report uses).

import type { Express } from 'express';
import { storage } from './storage';
import { requireAuthFlexible } from './middleware';
import type { Property, ExecutedLease, BayConfiguration } from '@shared/schema';
import { readFileSync } from 'fs';
import path from 'path';

function getBridgeLogo(): string {
  try {
    const logoPath = path.join(process.cwd(), 'bridge_logo_new_base64.txt');
    const base64 = readFileSync(logoPath, 'utf-8').trim();
    return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
  } catch {
    return '';
  }
}

function derivePropertyRentableSf(property: Property): number {
  const bays = (property.bayConfigurations || []) as BayConfiguration[];
  return bays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
}

// Occupied SF from executed leases. For each lease: prefer the explicit override,
// then the lease's stored rentable SF, then FALL BACK to summing the assigned bays'
// SF from the property's bay config — which is what the lease UI shows live. Many
// leases only store the bay selections, not a separate SF number, so without this
// fallback occupancy reads 0 even when all bays are assigned.
function deriveLeaseOccupiedSf(lease: ExecutedLease, bays: BayConfiguration[]): number {
  const override = lease.rentableAreaOverride;
  if (override != null && override > 0) return override;
  const stored = lease.rentableSquareFootage;
  if (stored != null && stored > 0) return stored;
  // Sum the assigned bays' rentable-or-raw SF.
  const assigned = lease.assignedBays || [];
  return assigned.reduce((sum, bayId) => {
    const bay = bays.find((b) => b.id === bayId);
    return sum + (bay ? (bay.rentableSquareFootage || bay.squareFootage || 0) : 0);
  }, 0);
}

function deriveOccupiedSf(leases: ExecutedLease[], bays: BayConfiguration[]): number {
  return leases.reduce((sum, lease) => sum + deriveLeaseOccupiedSf(lease, bays), 0);
}

function fmtSf(sf: number): string {
  return sf.toLocaleString('en-US');
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface PropertyOccupancyRow {
  name: string;
  rentableSf: number;
  occupiedSf: number;
  vacantSf: number;
  occupancyPct: number;
  vacancyPct: number;
  tenantCount: number;
}

function computeRow(property: Property, leases: ExecutedLease[]): PropertyOccupancyRow {
  const rentableSf = derivePropertyRentableSf(property);
  const bays = (property.bayConfigurations || []) as BayConfiguration[];
  const rawOccupied = deriveOccupiedSf(leases, bays);
  const occupiedSf = Math.min(rawOccupied, rentableSf > 0 ? rentableSf : rawOccupied);
  const vacantSf = Math.max(rentableSf - occupiedSf, 0);
  const occupancyPct = rentableSf > 0 ? (occupiedSf / rentableSf) * 100 : 0;
  const vacancyPct = rentableSf > 0 ? (vacantSf / rentableSf) * 100 : 0;
  return {
    name: property.displayName || property.propertyName,
    rentableSf,
    occupiedSf,
    vacantSf,
    occupancyPct,
    vacancyPct,
    tenantCount: leases.length,
  };
}

function occupancyColor(pct: number): string {
  if (pct >= 90) return '#065f46'; // green
  if (pct >= 70) return '#92400e'; // amber
  return '#991b1b'; // red
}

function renderReportHtml(rows: PropertyOccupancyRow[]): string {
  const totalRentable = rows.reduce((s, r) => s + r.rentableSf, 0);
  const totalOccupied = rows.reduce((s, r) => s + r.occupiedSf, 0);
  const totalVacant = Math.max(totalRentable - totalOccupied, 0);
  const portfolioOcc = totalRentable > 0 ? (totalOccupied / totalRentable) * 100 : 0;
  const portfolioVac = totalRentable > 0 ? (totalVacant / totalRentable) * 100 : 0;

  const bodyRows = rows.map((r, idx) => `
    <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f8f9fa'};">
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${r.rentableSf > 0 ? fmtSf(r.rentableSf) : 'N/A'}</td>
      <td class="num">${fmtSf(r.occupiedSf)}</td>
      <td class="num">${fmtSf(r.vacantSf)}</td>
      <td class="num" style="color: ${occupancyColor(r.occupancyPct)}; font-weight: 600;">${r.rentableSf > 0 ? fmtPct(r.occupancyPct) : '—'}</td>
      <td class="num">${r.rentableSf > 0 ? fmtPct(r.vacancyPct) : '—'}</td>
      <td class="num">${r.tenantCount}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Occupancy Report — Portfolio</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; margin: 20px; color: #333; }
    .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; }
    .document-title { font-size: 24px; font-weight: bold; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; margin-bottom: 10px; }
    .report-subtitle { font-size: 16px; color: #666; text-align: center; }
    .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; display: flex; justify-content: space-around; text-align: center; }
    .summary .metric { font-size: 26px; font-weight: bold; }
    .summary .label { font-size: 12px; color: #666; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 7px 8px; text-align: left; font-size: 12px; overflow-wrap: break-word; }
    th { background-color: #f5f5f5; }
    .num { text-align: right; }
    .total-row td { background: #eef2f9; border-top: 2px solid rgb(0,50,130); font-weight: bold; }
    @media print { body { margin: 10px; } }
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
      <div style="font-size: 12px; color: #999;">Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
    <div class="document-title">Occupancy Report</div>
    <div class="report-subtitle">Portfolio — leased vs. rentable area</div>
  </div>

  <div class="summary">
    <div>
      <div class="metric" style="color: ${occupancyColor(portfolioOcc)};">${totalRentable > 0 ? fmtPct(portfolioOcc) : '—'}</div>
      <div class="label">Occupancy</div>
    </div>
    <div>
      <div class="metric">${totalRentable > 0 ? fmtPct(portfolioVac) : '—'}</div>
      <div class="label">Vacancy</div>
    </div>
    <div>
      <div class="metric">${fmtSf(totalOccupied)}</div>
      <div class="label">Leased SF</div>
    </div>
    <div>
      <div class="metric">${fmtSf(totalRentable)}</div>
      <div class="label">Rentable SF</div>
    </div>
  </div>

  <table>
    <colgroup>
      <col style="width: 28%;"><col style="width: 13%;"><col style="width: 13%;">
      <col style="width: 13%;"><col style="width: 12%;"><col style="width: 11%;"><col style="width: 10%;">
    </colgroup>
    <thead>
      <tr>
        <th>Property</th>
        <th class="num">Rentable SF</th>
        <th class="num">Leased SF</th>
        <th class="num">Vacant SF</th>
        <th class="num">Occupancy</th>
        <th class="num">Vacancy</th>
        <th class="num">Tenants</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="total-row">
        <td>Portfolio Total</td>
        <td class="num">${fmtSf(totalRentable)}</td>
        <td class="num">${fmtSf(totalOccupied)}</td>
        <td class="num">${fmtSf(totalVacant)}</td>
        <td class="num" style="color: ${occupancyColor(portfolioOcc)};">${totalRentable > 0 ? fmtPct(portfolioOcc) : '—'}</td>
        <td class="num">${totalRentable > 0 ? fmtPct(portfolioVac) : '—'}</td>
        <td class="num">${rows.reduce((s, r) => s + r.tenantCount, 0)}</td>
      </tr>
    </tbody>
  </table>
  <script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
</body>
</html>`;
}

export function registerOccupancyReportRoutes(app: Express): void {
  // JSON summary for the property-card badges and portfolio tile.
  app.get('/api/occupancy/summary', requireAuthFlexible, async (_req, res) => {
    try {
      const properties = await storage.getAllProperties();
      const allLeases = await storage.getAllExecutedLeases();
      const byProperty: Record<number, ExecutedLease[]> = {};
      for (const lease of allLeases) {
        (byProperty[lease.propertyId] ||= []).push(lease);
      }
      const perProperty = properties.map((p) => {
        const row = computeRow(p, byProperty[p.id] || []);
        return { propertyId: p.id, ...row };
      });
      const totalRentable = perProperty.reduce((s, r) => s + r.rentableSf, 0);
      const totalOccupied = perProperty.reduce((s, r) => s + r.occupiedSf, 0);
      res.json({
        perProperty,
        portfolio: {
          rentableSf: totalRentable,
          occupiedSf: totalOccupied,
          vacantSf: Math.max(totalRentable - totalOccupied, 0),
          occupancyPct: totalRentable > 0 ? (totalOccupied / totalRentable) * 100 : 0,
          vacancyPct: totalRentable > 0 ? (Math.max(totalRentable - totalOccupied, 0) / totalRentable) * 100 : 0,
        },
      });
    } catch (error) {
      console.error('Occupancy summary error:', error);
      res.status(500).json({ message: 'Failed to compute occupancy' });
    }
  });

  // Printable portfolio report.
  app.get('/api/reports/occupancy', requireAuthFlexible, async (_req, res) => {
    try {
      const properties = await storage.getAllProperties();
      const allLeases = await storage.getAllExecutedLeases();
      const byProperty: Record<number, ExecutedLease[]> = {};
      for (const lease of allLeases) {
        (byProperty[lease.propertyId] ||= []).push(lease);
      }
      const sorted = [...properties].sort((a, b) =>
        (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999) ||
        (a.displayName || a.propertyName).localeCompare(b.displayName || b.propertyName)
      );
      const rows = sorted.map((p) => computeRow(p, byProperty[p.id] || []));
      res.setHeader('Content-Type', 'text/html');
      res.send(renderReportHtml(rows));
    } catch (error) {
      console.error('Occupancy report error:', error);
      res.status(500).json({ message: 'Failed to generate occupancy report' });
    }
  });
}
