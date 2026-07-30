// Occupancy report: leased SF vs rentable SF, per property and portfolio.
//
// Occupancy % = occupied SF / rentable SF. Vacancy % = 100 − occupancy.
// Occupancy rate is the CRE-standard headline; vacancy shown alongside.
//
// Occupied SF = sum of executed-lease rentable SF for the property (any signed
// lease, per current definition — no date filtering). Rentable SF = bay-derived
// total (same helper the Costs-in-Place report uses).

import { getBrandLogo as getBridgeLogo, BRAND_COLOR_PRIMARY } from './lib/branding';
import type { Express } from 'express';
import { storage } from './storage';
import { requireAuthFlexible } from './middleware';
import type { Property, ExecutedLease, BayConfiguration } from '@shared/schema';
import { readFileSync } from 'fs';
import path from 'path';


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

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

// Lease term as a single cell. Blank when neither date is recorded — many leases
// in the portfolio carry bays only, so an empty term is normal, not an error.
function fmtTerm(lease: ExecutedLease): string {
  const start = fmtDate(lease.leaseStartDate);
  const end = fmtDate(lease.leaseEndDate);
  if (!start && !end) return '—';
  return `${start || '?'} – ${end || '?'}`;
}

const EXPIRING_WINDOW_DAYS = 365;

// Status is derived from the end date only. No end date = 'Recorded': the lease
// exists and its SF counts toward occupancy, but we cannot say whether it is
// current. Do not silently treat that as Active.
function leaseStatus(lease: ExecutedLease): { label: string; color: string } {
  const end = lease.leaseEndDate ? new Date(lease.leaseEndDate) : null;
  if (!end || isNaN(end.getTime())) return { label: 'Recorded', color: '#6b7280' };
  const now = new Date();
  if (end < now) return { label: 'Expired', color: '#991b1b' };
  const days = (end.getTime() - now.getTime()) / 86400000;
  if (days <= EXPIRING_WINDOW_DAYS) return { label: 'Expiring', color: '#92400e' };
  return { label: 'Active', color: '#065f46' };
}

// Human-readable bay identifier: prefer the stored label, fall back to the raw
// assigned-bay ID list.
function bayLabel(lease: ExecutedLease): string {
  const stored = (lease.bayNumbers || '').trim();
  if (stored) return stored;
  const assigned = lease.assignedBays || [];
  return assigned.length ? assigned.join(', ') : '—';
}

interface LeaseDetailRow {
  tenantName: string;
  bays: string;
  leasedSf: number;
  pctOfBuilding: number;
  term: string;
  status: { label: string; color: string };
  // True when the lease resolves to no square footage at all. It still counts
  // toward the property's tenant count, which is how a property can show
  // tenants against 0 leased SF.
  unresolvedSf: boolean;
}

interface PropertyOccupancyRow {
  name: string;
  rentableSf: number;
  occupiedSf: number;
  vacantSf: number;
  occupancyPct: number;
  vacancyPct: number;
  tenantCount: number;
  // Sum of the lease detail rows BEFORE clamping to rentable SF. When this
  // exceeds rentableSf the header's occupiedSf has been clamped and the detail
  // rows will not sum to it — that gap is a data problem and is surfaced, not
  // hidden.
  rawOccupiedSf: number;
  leaseDetail: LeaseDetailRow[];
}

export function computeRow(property: Property, leases: ExecutedLease[]): PropertyOccupancyRow {
  const rentableSf = derivePropertyRentableSf(property);
  const bays = (property.bayConfigurations || []) as BayConfiguration[];
  const rawOccupied = deriveOccupiedSf(leases, bays);
  const occupiedSf = Math.min(rawOccupied, rentableSf > 0 ? rentableSf : rawOccupied);
  const vacantSf = Math.max(rentableSf - occupiedSf, 0);
  const occupancyPct = rentableSf > 0 ? (occupiedSf / rentableSf) * 100 : 0;
  const vacancyPct = rentableSf > 0 ? (vacantSf / rentableSf) * 100 : 0;

  // Detail rows use the SAME per-lease derivation the property total uses, so
  // the children sum to the parent by construction rather than by coincidence.
  const leaseDetail: LeaseDetailRow[] = leases
    .map((lease) => {
      const leasedSf = deriveLeaseOccupiedSf(lease, bays);
      return {
        tenantName: lease.tenantName,
        bays: bayLabel(lease),
        leasedSf,
        pctOfBuilding: rentableSf > 0 ? (leasedSf / rentableSf) * 100 : 0,
        term: fmtTerm(lease),
        status: leaseStatus(lease),
        unresolvedSf: leasedSf <= 0,
      };
    })
    .sort((a, b) => b.leasedSf - a.leasedSf || a.tenantName.localeCompare(b.tenantName));

  return {
    name: property.displayName || property.propertyName,
    rentableSf,
    occupiedSf,
    vacantSf,
    occupancyPct,
    vacancyPct,
    tenantCount: leases.length,
    rawOccupiedSf: rawOccupied,
    leaseDetail,
  };
}

function occupancyColor(pct: number): string {
  if (pct >= 90) return '#065f46'; // green
  if (pct >= 70) return '#92400e'; // amber
  return '#991b1b'; // red
}

export function renderReportHtml(rows: PropertyOccupancyRow[]): string {
  const totalRentable = rows.reduce((s, r) => s + r.rentableSf, 0);
  const totalOccupied = rows.reduce((s, r) => s + r.occupiedSf, 0);
  const totalVacant = Math.max(totalRentable - totalOccupied, 0);
  const portfolioOcc = totalRentable > 0 ? (totalOccupied / totalRentable) * 100 : 0;
  const portfolioVac = totalRentable > 0 ? (totalVacant / totalRentable) * 100 : 0;

  const bodyRows = rows.map((r) => {
    const header = `
    <tr class="property-row">
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${r.rentableSf > 0 ? fmtSf(r.rentableSf) : 'N/A'}</td>
      <td class="num">${fmtSf(r.occupiedSf)}</td>
      <td class="num">${fmtSf(r.vacantSf)}</td>
      <td class="num" style="color: ${occupancyColor(r.occupancyPct)}; font-weight: 600;">${r.rentableSf > 0 ? fmtPct(r.occupancyPct) : '—'}</td>
      <td class="num">${r.rentableSf > 0 ? fmtPct(r.vacancyPct) : '—'}</td>
      <td class="num">${r.tenantCount}</td>
    </tr>`;

    if (r.leaseDetail.length === 0) {
      return header + `
    <tr class="detail-row">
      <td class="detail-name empty">No active leases</td>
      <td colspan="6"></td>
    </tr>`;
    }

    const details = r.leaseDetail.map((l) => `
    <tr class="detail-row">
      <td class="detail-name">${escapeHtml(l.tenantName)}</td>
      <td class="detail-bays">${escapeHtml(l.bays)}</td>
      <td class="num">${l.unresolvedSf ? '<span class="flag">0 — SF unresolved</span>' : fmtSf(l.leasedSf)}</td>
      <td class="num"></td>
      <td class="num">${l.leasedSf > 0 ? fmtPct(l.pctOfBuilding) : '—'}</td>
      <td class="detail-term">${escapeHtml(l.term)}</td>
      <td class="num" style="color: ${l.status.color}; font-weight: 600;">${l.status.label}</td>
    </tr>`).join('');

    // Children must sum to the parent. They will, unless deriveOccupiedSf was
    // clamped to rentable SF — which means the recorded leases claim more space
    // than the building has. Show the gap; do not reconcile it silently.
    const overAllocated = r.rentableSf > 0 && r.rawOccupiedSf > r.rentableSf;
    const variance = overAllocated ? `
    <tr class="detail-row variance">
      <td class="detail-name" colspan="7">
        &#9888; Leases total ${fmtSf(r.rawOccupiedSf)} SF against ${fmtSf(r.rentableSf)} SF rentable
        &mdash; over-allocated by ${fmtSf(r.rawOccupiedSf - r.rentableSf)} SF.
        Occupancy above is capped at 100%; detail rows show the recorded values.
      </td>
    </tr>` : '';

    return header + details + variance;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Occupancy Report — Portfolio</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; margin: 20px; color: #333; }
    .header { border-bottom: 3px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 20px; margin-bottom: 30px; }
    .document-title { font-size: 24px; font-weight: bold; background: ${BRAND_COLOR_PRIMARY}; color: white; padding: 10px; border-radius: 5px; text-align: center; margin-bottom: 10px; }
    .report-subtitle { font-size: 16px; color: #666; text-align: center; }
    .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; display: flex; justify-content: space-around; text-align: center; }
    .summary .metric { font-size: 26px; font-weight: bold; }
    .summary .label { font-size: 12px; color: #666; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 7px 8px; text-align: left; font-size: 12px; overflow-wrap: break-word; }
    th { background-color: #f5f5f5; white-space: nowrap; }
    .num { text-align: right; }
    .property-row td { background: #eef2f9; font-weight: 600; border-top: 2px solid ${BRAND_COLOR_PRIMARY}; }
    .detail-row td { background: #ffffff; font-size: 11px; color: #444; border-top: none; }
    .detail-name { padding-left: 22px !important; position: relative; }
    .detail-name::before { content: '\\21B3'; position: absolute; left: 8px; color: #9ca3af; }
    .detail-name.empty { color: #9ca3af; font-style: italic; }
    .detail-bays, .detail-term { font-size: 10px; color: #666; }
    .flag { color: #991b1b; font-weight: 600; }
    .variance td { background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 600; }
    .variance .detail-name::before { content: ''; }
    .total-row td { background: #eef2f9; border-top: 2px solid ${BRAND_COLOR_PRIMARY}; font-weight: bold; }
    /* Keep a property and its leases together across page breaks where possible. */
    tr { page-break-inside: avoid; }
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
    <div class="report-subtitle">Portfolio — Leased vs. Rentable Area</div>
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
      <col style="width: 25%;"><col style="width: 13%;"><col style="width: 12%;">
      <col style="width: 12%;"><col style="width: 14%;"><col style="width: 13%;"><col style="width: 11%;">
    </colgroup>
    <thead>
      <tr>
        <th>Property / Tenant</th>
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
        // leaseDetail is for the printable report only; the property cards do
        // not need per-tenant rows and the payload should stay small.
        const { leaseDetail, ...row } = computeRow(p, byProperty[p.id] || []);
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
