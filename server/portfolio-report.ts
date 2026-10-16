/**
 * Portfolio report — every building on one page.
 *
 * WHY THIS EXISTS: the property print button is per-card. It renders ONE
 * building, and the "All" selector on a multi-building property only un-stacks
 * the cards — each still prints alone. Anyone asked "how much parking do we
 * have across the portfolio" had to print each building and add it up by hand.
 *
 * Parking leads, because that is what gets asked: vehicular, trailer, and the
 * ratios per 1,000 SF. Area, bays and dock doors sit alongside it so the follow-up
 * questions are answered on the same sheet.
 *
 * ONE SOURCE OF TRUTH FOR SF: rentable area and leased area come from
 * derivePropertyRentableSf / deriveOccupiedSf in occupancy-report.ts — the same
 * two functions behind the Occupancy report and the occupancy badges on the
 * property cards. A third local reduce() here would be a third answer to the
 * same question; there are already enough of those in this codebase.
 *
 * ?building=<id> prints one building only, which is what the per-card print
 * button should eventually call too.
 */
import type { Express } from 'express';
import { storage } from './storage';
import { requireAuthFlexible } from './middleware';
import type { Property, ExecutedLease, BayConfiguration } from '@shared/schema';
import { getBrandLogo as getBridgeLogo, BRAND_COLOR_PRIMARY, COMPANY_NAME } from './lib/branding';
import { derivePropertyRentableSf, deriveOccupiedSf } from './occupancy-report';

function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fmtSf = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtNum = (n: number) => Number(n || 0).toLocaleString('en-US');

/** Spaces per 1,000 SF. Blank when there is no area to divide by. */
export function ratio(spaces: number, sf: number): string {
  if (!(sf > 0)) return '—';
  return (spaces / (sf / 1000)).toFixed(2);
}

interface BuildingRow {
  id: number;
  propertyName: string;
  building: string;
  label: string;
  address: string;
  clearHeight: string;

  rentableSf: number;
  leasedSf: number;
  availableSf: number;
  bayCount: number;
  dockDoors: number;
  oversizedDoors: number;

  standardParking: number;
  accessibleParking: number;
  evParking: number;
  vehicularParking: number;
  trailerParking: number;

  leasedVehicular: number;
  leasedTrailer: number;
  availableVehicular: number;
  availableTrailer: number;

  tenantCount: number;
  temporaryCount: number;
}

export function buildRow(property: Property, leases: ExecutedLease[]): BuildingRow {
  const bays = (property.bayConfigurations || []) as BayConfiguration[];

  const rentableSf = derivePropertyRentableSf(property);
  const rawLeased = deriveOccupiedSf(leases, bays);
  // Clamped the same way the occupancy report clamps it, so the two reports
  // cannot disagree about how much of a building is spoken for.
  const leasedSf = Math.min(rawLeased, rentableSf > 0 ? rentableSf : rawLeased);

  const standardParking = property.standardParking || 0;
  const accessibleParking = property.accessibleParking || 0;
  const evParking = property.evParking || 0;
  const vehicularParking = standardParking + accessibleParking + evParking;
  const trailerParking = property.trailerParking || 0;

  const leasedVehicular = leases.reduce(
    (sum, l) => sum + ((l.standardParking || 0) + (l.accessibleParking || 0) + (l.evParking || 0)), 0);
  const leasedTrailer = leases.reduce((sum, l) => sum + (l.trailerParking || 0), 0);

  return {
    id: property.id,
    propertyName: property.propertyName,
    building: property.building || '',
    label: property.building ? `${property.propertyName} — Bldg. ${property.building}` : property.propertyName,
    address: [property.streetAddress, property.city, property.state, property.zip].filter(Boolean).join(', '),
    clearHeight: property.clearHeight || '',

    rentableSf,
    leasedSf,
    availableSf: Math.max(rentableSf - leasedSf, 0),
    bayCount: bays.length,
    dockDoors: bays.reduce((s, b) => s + (b.standardDockDoors || 0), 0),
    oversizedDoors: bays.reduce((s, b) => s + (b.oversizedDockDoors || 0), 0),

    standardParking,
    accessibleParking,
    evParking,
    vehicularParking,
    trailerParking,

    leasedVehicular,
    leasedTrailer,
    availableVehicular: Math.max(vehicularParking - leasedVehicular, 0),
    availableTrailer: Math.max(trailerParking - leasedTrailer, 0),

    tenantCount: leases.length,
    temporaryCount: leases.filter((l) => l.leaseType === 'temporary').length,
  };
}

/** Sum a set of building rows into one. Used for property subtotals and the portfolio total. */
export function totalOf(rows: BuildingRow[]) {
  const sum = (pick: (r: BuildingRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  return {
    rentableSf: sum((r) => r.rentableSf),
    leasedSf: sum((r) => r.leasedSf),
    availableSf: sum((r) => r.availableSf),
    bayCount: sum((r) => r.bayCount),
    dockDoors: sum((r) => r.dockDoors),
    oversizedDoors: sum((r) => r.oversizedDoors),
    standardParking: sum((r) => r.standardParking),
    accessibleParking: sum((r) => r.accessibleParking),
    evParking: sum((r) => r.evParking),
    vehicularParking: sum((r) => r.vehicularParking),
    trailerParking: sum((r) => r.trailerParking),
    leasedVehicular: sum((r) => r.leasedVehicular),
    leasedTrailer: sum((r) => r.leasedTrailer),
    availableVehicular: sum((r) => r.availableVehicular),
    availableTrailer: sum((r) => r.availableTrailer),
    tenantCount: sum((r) => r.tenantCount),
    temporaryCount: sum((r) => r.temporaryCount),
  };
}

type Totals = ReturnType<typeof totalOf>;

export function renderHtml(groups: Array<{ name: string; rows: BuildingRow[] }>, scopeNote: string): string {
  const allRows = groups.flatMap((g) => g.rows);
  const grand = totalOf(allRows);
  const multi = allRows.length > 1;

  // ---- Table 1: area and parking at a glance -------------------------------
  const areaCells = (label: string, address: string, t: Totals, cls: string, clear = '') => `
    <tr class="${cls}">
      <td class="name">${escapeHtml(label)}${address ? `<div class="addr">${escapeHtml(address)}</div>` : ''}</td>
      <td class="num">${t.rentableSf > 0 ? fmtSf(t.rentableSf) : '—'}</td>
      <td class="num">${fmtNum(t.bayCount)}</td>
      <td class="num">${fmtNum(t.dockDoors)}${t.oversizedDoors ? ` <span class="sub">+${fmtNum(t.oversizedDoors)} OS</span>` : ''}</td>
      <td class="num">${escapeHtml(clear || '—')}</td>
      <td class="num strong">${fmtNum(t.vehicularParking)}</td>
      <td class="num strong">${fmtNum(t.trailerParking)}</td>
      <td class="num">${ratio(t.vehicularParking, t.rentableSf)}</td>
      <td class="num">${ratio(t.trailerParking, t.rentableSf)}</td>
    </tr>`;

  const areaBody = groups.map((g) => {
    const rows = g.rows.map((r) => areaCells(r.label, r.address, totalOf([r]), 'bldg', r.clearHeight)).join('');
    if (g.rows.length < 2) return rows;
    return rows + areaCells(`${g.name} — all buildings`, '', totalOf(g.rows), 'subtotal');
  }).join('');

  // ---- Table 2: parking detail and what is still unallocated ---------------
  const parkCells = (label: string, t: Totals, cls: string) => `
    <tr class="${cls}">
      <td class="name">${escapeHtml(label)}</td>
      <td class="num">${fmtNum(t.standardParking)}</td>
      <td class="num">${fmtNum(t.accessibleParking)}</td>
      <td class="num">${fmtNum(t.evParking)}</td>
      <td class="num strong">${fmtNum(t.vehicularParking)}</td>
      <td class="num">${fmtNum(t.leasedVehicular)}</td>
      <td class="num avail">${fmtNum(t.availableVehicular)}</td>
      <td class="num strong">${fmtNum(t.trailerParking)}</td>
      <td class="num">${fmtNum(t.leasedTrailer)}</td>
      <td class="num avail">${fmtNum(t.availableTrailer)}</td>
    </tr>`;

  const parkBody = groups.map((g) => {
    const rows = g.rows.map((r) => parkCells(r.label, totalOf([r]), 'bldg')).join('');
    if (g.rows.length < 2) return rows;
    return rows + parkCells(`${g.name} — all buildings`, totalOf(g.rows), 'subtotal');
  }).join('');

  // ---- Table 3: space availability ----------------------------------------
  const spaceRow = (label: string, t: Totals, cls: string) => {
    const pct = t.rentableSf > 0 ? (t.availableSf / t.rentableSf) * 100 : 0;
    return `
    <tr class="${cls}">
      <td class="name">${escapeHtml(label)}</td>
      <td class="num">${t.rentableSf > 0 ? fmtSf(t.rentableSf) : '—'}</td>
      <td class="num">${fmtSf(t.leasedSf)}</td>
      <td class="num avail">${fmtSf(t.availableSf)}</td>
      <td class="num">${t.rentableSf > 0 ? pct.toFixed(1) + '%' : '—'}</td>
      <td class="num">${fmtNum(t.tenantCount)}${t.temporaryCount ? ` <span class="sub">(${t.temporaryCount} temp)</span>` : ''}</td>
    </tr>`;
  };

  const spaceBody = groups.map((g) => {
    const rows = g.rows.map((r) => spaceRow(r.label, totalOf([r]), 'bldg')).join('');
    if (g.rows.length < 2) return rows;
    return rows + spaceRow(`${g.name} — all buildings`, totalOf(g.rows), 'subtotal');
  }).join('');

  const anyTemporary = grand.temporaryCount > 0;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Portfolio Report — ${COMPANY_NAME}</title>
<style>
  @media print {
    .no-print { display: none !important; }
    @page { margin: 0.4in; size: landscape; }
    body { font-size: 10px; }
  }
  body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; font-size: 12px; color: #222; margin: 0; padding: 20px; line-height: 1.4; }
  .no-print { background: ${BRAND_COLOR_PRIMARY}; color: #fff; padding: 12px; text-align: center; margin-bottom: 20px; border-radius: 8px; font-size: 13px; }
  .header { border-bottom: 3px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 18px; margin-bottom: 24px; }
  .document-title { font-size: 26px; font-weight: bold; background: ${BRAND_COLOR_PRIMARY}; color: #fff; padding: 10px; border-radius: 5px; text-align: center; }
  .subtitle { font-size: 15px; color: #666; margin: 6px 0 0; text-align: center; }
  .cards { display: flex; gap: 10px; margin-bottom: 26px; flex-wrap: wrap; }
  .card { flex: 1; min-width: 120px; border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; background: #f9fafb; }
  .card .label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .03em; }
  .card .value { font-size: 20px; font-weight: bold; color: #1f2937; }
  .card .unit { font-size: 11px; font-weight: normal; color: #6b7280; }
  h2 { font-size: 16px; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin: 26px 0 10px; }
  h2 .hint { font-size: 11px; font-weight: normal; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #eef2f9; border: 1px solid #ccc; padding: 6px; font-size: 11px; text-align: right; color: #374151; }
  th.name, td.name { text-align: left; }
  td { border: 1px solid #e5e7eb; padding: 6px; }
  td.num { text-align: right; white-space: nowrap; }
  td.strong { font-weight: 600; }
  td.avail { font-weight: 600; color: #065f46; }
  td .addr { font-size: 10px; color: #6b7280; font-weight: normal; }
  td .sub { font-size: 10px; color: #6b7280; font-weight: normal; }
  tr.subtotal td { background: #f3f4f6; font-weight: 600; }
  tr.total td { background: ${BRAND_COLOR_PRIMARY}; color: #fff; font-weight: bold; border-color: ${BRAND_COLOR_PRIMARY}; }
  tr.total td.avail { color: #d1fae5; }
  tr.total td .sub { color: #c7d2fe; }
  tr { page-break-inside: avoid; }
  .note { font-size: 10px; color: #6b7280; margin-top: 8px; }
</style></head><body>

<div class="no-print">
  <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows) or Cmd+P (Mac), then choose "Save as PDF".
  <br><small>Set the layout to Landscape. This banner will not appear in the printed version.</small>
</div>

<div class="header">
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px;">
    <img src="${getBridgeLogo()}" alt="${COMPANY_NAME}" style="height: 30px; width: auto;" />
    <div style="font-size: 12px; color: #999;">Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>
  <div class="document-title">Portfolio Report</div>
  <div class="subtitle">${escapeHtml(scopeNote)}</div>
</div>

<div class="cards">
  <div class="card"><div class="label">Rentable Area</div><div class="value">${fmtSf(grand.rentableSf)} <span class="unit">SF</span></div></div>
  <div class="card"><div class="label">Buildings</div><div class="value">${allRows.length}</div></div>
  <div class="card"><div class="label">Bays</div><div class="value">${fmtNum(grand.bayCount)}</div></div>
  <div class="card"><div class="label">Vehicular Parking</div><div class="value">${fmtNum(grand.vehicularParking)}</div></div>
  <div class="card"><div class="label">Trailer Parking</div><div class="value">${fmtNum(grand.trailerParking)}</div></div>
  <div class="card"><div class="label">Vehicular / 1,000 SF</div><div class="value">${ratio(grand.vehicularParking, grand.rentableSf)}</div></div>
  <div class="card"><div class="label">Trailer / 1,000 SF</div><div class="value">${ratio(grand.trailerParking, grand.rentableSf)}</div></div>
</div>

<h2>Area &amp; Parking <span class="hint">— ratios are spaces per 1,000 rentable SF</span></h2>
<table>
  <thead><tr>
    <th class="name" style="width:24%">Building</th>
    <th style="width:11%">Rentable SF</th>
    <th style="width:6%">Bays</th>
    <th style="width:10%">Dock Doors</th>
    <th style="width:9%">Clear Ht.</th>
    <th style="width:10%">Vehicular</th>
    <th style="width:9%">Trailer</th>
    <th style="width:10%">Veh. / 1,000</th>
    <th style="width:11%">Trlr. / 1,000</th>
  </tr></thead>
  <tbody>
    ${areaBody}
    ${multi ? areaCells('PORTFOLIO TOTAL', '', grand, 'total') : ''}
  </tbody>
</table>

<h2>Parking Detail <span class="hint">— allocated figures come from executed leases</span></h2>
<table>
  <thead><tr>
    <th class="name" style="width:24%">Building</th>
    <th style="width:8%">Standard</th>
    <th style="width:7%">ADA</th>
    <th style="width:6%">EV</th>
    <th style="width:10%">Vehicular Total</th>
    <th style="width:9%">Allocated</th>
    <th style="width:9%">Available</th>
    <th style="width:9%">Trailer Total</th>
    <th style="width:9%">Allocated</th>
    <th style="width:9%">Available</th>
  </tr></thead>
  <tbody>
    ${parkBody}
    ${multi ? parkCells('PORTFOLIO TOTAL', grand, 'total') : ''}
  </tbody>
</table>

<h2>Space Availability</h2>
<table>
  <thead><tr>
    <th class="name" style="width:34%">Building</th>
    <th style="width:14%">Rentable SF</th>
    <th style="width:14%">Leased SF</th>
    <th style="width:14%">Available SF</th>
    <th style="width:12%">% Available</th>
    <th style="width:12%">Tenants</th>
  </tr></thead>
  <tbody>
    ${spaceBody}
    ${multi ? spaceRow('PORTFOLIO TOTAL', grand, 'total') : ''}
  </tbody>
</table>

<div class="note">
  Rentable area and leased area are the same figures reported on the Occupancy report.
  Parking availability is the building total less what is allocated under recorded leases.
  &ldquo;OS&rdquo; in the dock door column is oversized doors, counted separately from the standard count beside it.
  ${anyTemporary ? 'Temporary access and licence agreements are counted as allocated and flagged in the tenant column.' : ''}
</div>

</body></html>`;
}

export function registerPortfolioReportRoutes(app: Express): void {
  app.get('/api/reports/portfolio', requireAuthFlexible, async (req, res) => {
    try {
      const properties = await storage.getAllProperties();
      const allLeases = await storage.getAllExecutedLeases();

      const leasesByProperty: Record<number, ExecutedLease[]> = {};
      for (const lease of allLeases) {
        (leasesByProperty[lease.propertyId] ||= []).push(lease);
      }

      // ?building=<id> narrows to one building; ?property=<name> to one property.
      const buildingId = req.query.building ? parseInt(String(req.query.building), 10) : NaN;
      const propertyName = req.query.property ? String(req.query.property).trim().toLowerCase() : '';

      let scoped = properties;
      let scopeNote = 'All Buildings — Area, Parking and Availability';
      if (!isNaN(buildingId)) {
        scoped = properties.filter((p) => p.id === buildingId);
        scopeNote = scoped.length
          ? `${scoped[0].propertyName}${scoped[0].building ? ` — Bldg. ${scoped[0].building}` : ''}`
          : 'Building not found';
      } else if (propertyName) {
        scoped = properties.filter((p) => (p.propertyName || '').trim().toLowerCase() === propertyName);
        scopeNote = scoped.length ? `${scoped[0].propertyName} — All Buildings` : 'Property not found';
      }

      const rows = scoped.map((p) => buildRow(p, leasesByProperty[p.id] || []));

      // Grouped by property name, buildings in order within each, so a
      // multi-building property reads as one block with its own subtotal.
      const byName = new Map<string, BuildingRow[]>();
      for (const row of rows) {
        const list = byName.get(row.propertyName) || [];
        list.push(row);
        byName.set(row.propertyName, list);
      }
      const groups = Array.from(byName.entries())
        .map(([name, list]) => ({
          name,
          rows: list.sort((a, b) => a.building.localeCompare(b.building, undefined, { numeric: true })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (req.query.format === 'json') {
        return res.json({
          scope: scopeNote,
          buildings: rows,
          portfolio: totalOf(rows),
        });
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderHtml(groups, scopeNote));
    } catch (error) {
      console.error('[portfolio-report] failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Failed to generate portfolio report: ${message}` });
    }
  });
}
