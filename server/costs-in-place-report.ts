// Costs-in-Place report: dollar-per-SF view of existing improvements, per property
// or rolled up across the whole portfolio.
//
// $/SF resolution per improvement:
//   1. Demising walls (allocationType === 'demising-wall'): dash — $/SF is meaningless.
//   2. areaSf entered on the improvement: (totalCost cents / 100) / areaSf.
//      Used for area-specific items like office buildouts (lump sum + known SF).
//   3. Otherwise: (totalCost cents / 100) / property derived rentable SF.
//      Used for whole-property items (lighting, fire alarm). Dash if property SF
//      is unavailable or zero — never divide by zero.
//
// Costs in property_existing_improvements are stored in CENTS. All display math
// divides by 100 exactly once, here, at the edge.

import type { Express } from 'express';
import { storage } from './storage';
import { requireAuth } from './middleware';
import { EXISTING_IMPROVEMENT_CATEGORIES, resolveDenominatorBasis, DENOMINATOR_BASES } from '@shared/schema';
import type { Property, PropertyExistingImprovement, BayConfiguration, DenominatorBasis } from '@shared/schema';
import { readFileSync } from 'fs';
import path from 'path';

// Same logo helper pattern as property-routes.ts.
function getBridgeLogo(): string {
  try {
    const logoPath = path.join(process.cwd(), 'bridge_logo_new_base64.txt');
    const base64 = readFileSync(logoPath, 'utf-8').trim();
    return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
  } catch {
    return '';
  }
}

// Established derivation pattern (see property-summary-report.ts): a property's
// rentable SF is the sum of its bays' rentable SF, falling back to raw bay SF.
export function derivePropertyRentableSf(property: Property): number {
  const bays = (property.bayConfigurations || []) as BayConfiguration[];
  return bays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
}

// Total office SF across the property's bays — the single source of truth for
// office area, entered per-bay in bay config. Warehouse-net denominators subtract
// this from rentable SF.
export function derivePropertyOfficeSf(property: Property): number {
  const bays = (property.bayConfigurations || []) as BayConfiguration[];
  return bays.reduce((sum, bay) => {
    // A split bay's office SF lives on its halves; a non-split bay's on the bay itself.
    if (bay.canBeSplit) {
      const north = bay.splitNorthOffice ? (bay.splitNorthOfficeSquareFootage || 0) : 0;
      const south = bay.splitSouthOffice ? (bay.splitSouthOfficeSquareFootage || 0) : 0;
      return sum + north + south;
    }
    return sum + (bay.officeSquareFootage || 0);
  }, 0);
}

function categoryLabel(category: string): string {
  return (EXISTING_IMPROVEMENT_CATEGORIES as Record<string, string>)[category] || category;
}

function fmtCurrency(dollars: number): string {
  return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSf(sf: number): string {
  return sf.toLocaleString('en-US');
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface ImprovementRow {
  category: string;
  description: string;
  costDollars: number;
  sfBasis: string;   // e.g. "2,400 sf (entered)" | "51,094 sf (property)" | "—"
  perSf: string;     // e.g. "$12.34" | "—"
}

export function buildImprovementRow(
  imp: PropertyExistingImprovement,
  propertyRentableSf: number,
  propertyOfficeSf: number,
): ImprovementRow {
  const costDollars = (imp.totalCost || 0) / 100;
  const areaSf = (imp as any).areaSf as number | null | undefined;
  const override = (imp as any).denominatorBasis as string | null | undefined;
  const basis: DenominatorBasis = resolveDenominatorBasis(imp.category, override, imp.allocationType);

  const warehouseNetSf = Math.max(propertyRentableSf - propertyOfficeSf, 0);

  let denomSf = 0;
  let basisLabel = '—';

  switch (basis) {
    case 'none':
      // Demising walls: no meaningful $/SF.
      break;
    case 'own-area':
      if (areaSf != null && areaSf > 0) {
        denomSf = areaSf;
        basisLabel = `${fmtSf(areaSf)} sf (entered)`;
      } else if (imp.category === 'spec-office' && propertyOfficeSf > 0) {
        // No SF entered on the office cost line — fall back to the total office
        // SF from bay config, so the office $/SF still computes instead of dashing.
        denomSf = propertyOfficeSf;
        basisLabel = `${fmtSf(propertyOfficeSf)} sf (office)`;
      }
      break;
    case 'warehouse-net':
      if (propertyOfficeSf > 0 && warehouseNetSf > 0) {
        denomSf = warehouseNetSf;
        basisLabel = `${fmtSf(warehouseNetSf)} sf (warehouse)`;
      } else if (propertyRentableSf > 0) {
        // Office SF unknown (0) or ≥ rentable — can't net cleanly; fall back to
        // full rentable and flag the basis (*) so the number is never silently
        // presented as a true warehouse rate.
        denomSf = propertyRentableSf;
        basisLabel = `${fmtSf(propertyRentableSf)} sf (rentable*)`;
      }
      break;
    case 'whole-property':
    default:
      if (propertyRentableSf > 0) {
        denomSf = propertyRentableSf;
        basisLabel = `${fmtSf(propertyRentableSf)} sf (rentable)`;
      }
      break;
  }

  const perSf = denomSf > 0 ? fmtCurrency(costDollars / denomSf) : '—';

  return {
    category: categoryLabel(imp.category),
    description: imp.description,
    costDollars,
    sfBasis: basisLabel,
    perSf,
  };
}

// One property's report section (used by both modes).
function renderPropertySection(property: Property, improvements: PropertyExistingImprovement[]): string {
  const rentableSf = derivePropertyRentableSf(property);
  const officeSf = derivePropertyOfficeSf(property);
  const warehouseNetSf = Math.max(rentableSf - officeSf, 0);
  const activeImprovements = improvements.filter((imp) => imp.isActive !== false);
  const rows = activeImprovements.map((imp) => buildImprovementRow(imp, rentableSf, officeSf));
  const sectionTotal = rows.reduce((sum, r) => sum + r.costDollars, 0);

  const bodyRows = rows.length > 0
    ? rows.map((r, idx) => `
        <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f8f9fa'};">
          <td>${escapeHtml(r.category)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td class="currency">${fmtCurrency(r.costDollars)}</td>
          <td class="sf">${escapeHtml(r.sfBasis)}</td>
          <td class="currency">${r.perSf}</td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="text-align: center; color: #999; font-style: italic;">No costs-in-place recorded</td></tr>`;

  const areaMeta = [
    `Rentable: ${rentableSf > 0 ? fmtSf(rentableSf) + ' sf' : 'N/A'}`,
    officeSf > 0 ? `Office: ${fmtSf(officeSf)} sf` : null,
    officeSf > 0 ? `Warehouse: ${fmtSf(warehouseNetSf)} sf` : null,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  return `
    <div class="property-section">
      <div class="property-header">
        <div class="property-title">${escapeHtml(property.displayName || property.propertyName)}</div>
        <div class="property-meta">${areaMeta}</div>
      </div>
      <table>
        <colgroup>
          <col style="width: 14%;">
          <col style="width: 40%;">
          <col style="width: 15%;">
          <col style="width: 18%;">
          <col style="width: 13%;">
        </colgroup>
        <thead>
          <tr>
            <th>Category</th>
            <th>Description</th>
            <th class="currency">Cost in Place</th>
            <th class="sf">Area (SF)</th>
            <th class="currency">$/SF</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="total-row">
            <td colspan="2"><strong>Property Total</strong></td>
            <td class="currency"><strong>${fmtCurrency(sectionTotal)}</strong></td>
            <td class="sf"></td>
            <td class="currency"></td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function renderReportHtml(title: string, subtitle: string, sections: string[], portfolioSummary?: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; margin: 20px; color: #333; }
    .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; }
    .document-title { font-size: 24px; font-weight: bold; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; margin-bottom: 10px; }
    .report-subtitle { font-size: 16px; color: #666; text-align: center; }
    .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .property-section { margin-bottom: 34px; page-break-inside: avoid; }
    .property-header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #eee; padding-bottom: 6px; margin-bottom: 8px; }
    .property-title { font-size: 17px; font-weight: bold; color: rgb(0,50,130); }
    .property-meta { font-size: 13px; color: #666; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 7px 8px; text-align: left; font-size: 12px; overflow-wrap: break-word; }
    th { background-color: #f5f5f5; }
    .currency { text-align: right; }
    .sf { text-align: right; }
    .total-row td { background: #eef2f9; border-top: 2px solid rgb(0,50,130); }
    @media print {
      body { margin: 10px; }
      .property-section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
      <div style="font-size: 12px; color: #999;">Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
    <div class="document-title">${escapeHtml(title)}</div>
    <div class="report-subtitle">${escapeHtml(subtitle)}</div>
  </div>
  ${portfolioSummary || ''}
  ${sections.join('\n')}
  <script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
</body>
</html>`;
}

export function registerCostsInPlaceReportRoutes(app: Express): void {
  // GET /api/reports/costs-in-place?propertyId=X  → single-property report
  // GET /api/reports/costs-in-place                → portfolio roll-up
  app.get('/api/reports/costs-in-place', requireAuth, async (req, res) => {
    try {
      const propertyIdRaw = req.query.propertyId as string | undefined;

      if (propertyIdRaw) {
        // ---- Single-property mode ----
        const propertyId = parseInt(propertyIdRaw);
        if (isNaN(propertyId)) {
          return res.status(400).json({ message: 'Invalid property ID' });
        }
        const property = await storage.getProperty(propertyId);
        if (!property) {
          return res.status(404).json({ message: 'Property not found' });
        }
        const improvements = await storage.getPropertyExistingImprovements(propertyId);
        const section = renderPropertySection(property, improvements);
        const html = renderReportHtml(
          'Costs-in-Place Report',
          property.displayName || property.propertyName,
          [section],
        );
        res.setHeader('Content-Type', 'text/html');
        return res.send(html);
      }

      // ---- Portfolio roll-up mode ----
      const properties = await storage.getAllProperties();
      const sorted = [...properties].sort((a, b) =>
        (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999) ||
        (a.displayName || a.propertyName).localeCompare(b.displayName || b.propertyName)
      );

      let portfolioCostCents = 0;
      let portfolioRentableSf = 0;
      let portfolioOfficeSf = 0;
      let propertiesWithCosts = 0;
      const sections: string[] = [];

      for (const property of sorted) {
        const improvements = await storage.getPropertyExistingImprovements(property.id);
        const active = improvements.filter((imp) => imp.isActive !== false);
        // Portfolio doc packages ALL properties, including ones without costs, so
        // the roll-up is a complete portfolio picture — but track the count.
        portfolioCostCents += active.reduce((sum, imp) => sum + (imp.totalCost || 0), 0);
        portfolioRentableSf += derivePropertyRentableSf(property);
        portfolioOfficeSf += derivePropertyOfficeSf(property);
        if (active.length > 0) propertiesWithCosts++;
        sections.push(renderPropertySection(property, improvements));
      }

      const portfolioCostDollars = portfolioCostCents / 100;
      const portfolioWarehouseSf = Math.max(portfolioRentableSf - portfolioOfficeSf, 0);

      // No portfolio "blended $/SF": summing costs with different denominators
      // (office SF, warehouse-net SF, full SF) over one area figure isn't a
      // meaningful rate. Report the honest facts — total cost and the area
      // breakdown — and let the per-item $/SF carry the rate detail.
      const portfolioSummary = `
        <div class="summary">
          <h3 style="margin-top: 0;">Portfolio Summary</h3>
          <p><strong>Properties:</strong> ${sorted.length} (${propertiesWithCosts} with costs-in-place)</p>
          <p><strong>Total Costs in Place:</strong> ${fmtCurrency(portfolioCostDollars)}</p>
          <p><strong>Total Rentable Area:</strong> ${portfolioRentableSf > 0 ? fmtSf(portfolioRentableSf) + ' sf' : 'N/A'}${portfolioOfficeSf > 0 ? ` &nbsp;·&nbsp; Office: ${fmtSf(portfolioOfficeSf)} sf &nbsp;·&nbsp; Warehouse: ${fmtSf(portfolioWarehouseSf)} sf` : ''}</p>
        </div>`;

      const html = renderReportHtml(
        'Costs-in-Place Report — Portfolio',
        'All Properties',
        sections,
        portfolioSummary,
      );
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      console.error('Costs-in-Place report error:', error);
      return res.status(500).json({ message: 'Failed to generate Costs-in-Place report' });
    }
  });
}
