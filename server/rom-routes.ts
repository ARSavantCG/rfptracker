/**
 * RFP Tracker - ROM Pilot Routes
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 */
import type { Express } from 'express';
import { storage } from './storage';
import { db } from './db';
import { readFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { requireAuth, checkPermission } from './middleware';
import { scopeItemContractorPricing, romScopeItems } from '@shared/schema';
import { eq, desc, and } from 'drizzle-orm';


// Helper function to generate ROM report HTML
// Get Bridge Industrial logo as base64
function getBridgeLogo(): string {
  try {
    const logoBase64 = readFileSync('./bridge_logo_new_base64.txt', 'utf8').trim();
    return `data:image/png;base64,${logoBase64}`;
  } catch (error) {
    console.error('Error reading Bridge logo:', error);
    return '';
  }
}

async function generateRomReportHtml(romPilot: any, lineItems: any[], scopeItems: any[], generatedBy: string = 'Unknown User'): Promise<string> {
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  // Get property details if property ID is provided
  let propertyDetails = null;
  let bayCount = 0;
  let bayCountDisplay = '';
  let doorConfig = 'N/A';
  let vehicularParking = 'N/A';
  let trailerParking = 'N/A';
  let electricalAllocation = 'N/A';
  let existingCosts = [];
  let propertyDisplayName = romPilot.property;
  
  if (romPilot.property && !isNaN(parseInt(romPilot.property))) {
    try {
      propertyDetails = await storage.getProperty(parseInt(romPilot.property));
      if (propertyDetails) {
        // Create property display name with building info
        const buildingInfo = propertyDetails.buildingName ? ` - ${propertyDetails.buildingName}` : '';
        propertyDisplayName = `${propertyDetails.propertyName}${buildingInfo}`;
        
        // Calculate door configuration from selected bays
        if (romPilot.selectedBayConfigurations && Array.isArray(romPilot.selectedBayConfigurations) && romPilot.selectedBayConfigurations.length > 0) {
          console.log('[ROM doorConfig] selectedBayConfigurations count:', romPilot.selectedBayConfigurations.length);
          console.log('[ROM doorConfig] first bay raw data:', JSON.stringify(romPilot.selectedBayConfigurations[0], null, 2));
          bayCount = romPilot.selectedBayConfigurations.length;
          bayCountDisplay = `${bayCount} Bays (Modified Configuration)`;
          const totalStandardDoors = romPilot.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.standardDockDoors || 0), 0);
          const totalOversizedDoors = romPilot.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.oversizedDockDoors || 0), 0);
          console.log('[ROM doorConfig] totalStandardDoors:', totalStandardDoors, '| totalOversizedDoors:', totalOversizedDoors);
          doorConfig = `${totalStandardDoors + totalOversizedDoors} doors total (${totalOversizedDoors} oversized, ${totalStandardDoors} regular)`;
        } else if (!bayCount && romPilot.selectedBayIds && Array.isArray(romPilot.selectedBayIds) && romPilot.selectedBayIds.length > 0) {
          bayCount = romPilot.selectedBayIds.length;
          bayCountDisplay = `${bayCount} Bays (Modified Configuration)`;
        }
        
        // Get parking info
        vehicularParking = propertyDetails.vehicularParking || 'N/A';
        trailerParking = propertyDetails.trailerParking || 'N/A';
        electricalAllocation = propertyDetails.electricalAllocation || 'N/A';
        
        // Get existing improvements from property and calculate proportional costs
        try {
          const allExistingCosts = await storage.getPropertyExistingImprovements(parseInt(romPilot.property));
          
          // Calculate proportional costs based on ROM area vs total property area
          const propertyTotalSF = propertyDetails.totalSquareFootage || totalSquareFootage || 1;
          const romAreaPortion = totalSquareFootage / propertyTotalSF;
          
          existingCosts = allExistingCosts.map(cost => {
            const originalCost = parseFloat(cost.costEstimate) || 0;
            const proportionalCost = originalCost * romAreaPortion;
            return {
              ...cost,
              costEstimate: proportionalCost.toString(),
              originalCostEstimate: originalCost.toString() // Keep original for reference
            };
          });
        } catch (error) {
          console.error('Error fetching existing improvements:', error);
        }
      }
    } catch (error) {
      console.error('Error fetching property details:', error);
    }
  }
  
  // Calculate formulas and update line items with actual quantities
  const processedLineItems = lineItems.map(item => {
    let actualQuantity = parseFloat(item.quantity) || 0;
    
    // Handle formula-based quantities
    if (item.quantity && item.quantity.toString().startsWith('=')) {
      const formula = item.quantity.toString().substring(1);
      const scopeItem = scopeItems.find(si => si.id === item.scopeItemId);
      
      try {
        // Handle demising wall calculation specifically
        if (formula.includes('demising') || scopeItem?.name?.toLowerCase().includes('demising')) {
          actualQuantity = bayCount > 1 ? (bayCount - 1) * 40 : 0; // 40 LF per demising wall between bays
        } else {
          // Replace variables and evaluate
          const processedFormula = formula
            .replace(/totalSquareFootage/g, totalSquareFootage.toString())
            .replace(/bayCount/g, bayCount.toString());
          actualQuantity = eval(processedFormula);
        }
      } catch (error) {
        console.error('Formula evaluation error:', error);
        actualQuantity = 0;
      }
    }
    
    // Recalculate total price with actual quantity
    // Use activePrice from scope item if set, otherwise fall back to line item unitPrice
    const scopeItemForPrice = scopeItems.find((si: any) => si.id === item.scopeItemId);
    const unitPrice = (scopeItemForPrice?.activePrice ? parseFloat(scopeItemForPrice.activePrice) : null) ?? parseFloat(item.unitPrice) ?? 0;
    const newTotalPrice = actualQuantity * unitPrice;
    
    return {
      ...item,
      actualQuantity,
      totalPrice: newTotalPrice.toString()
    };
  });
  
  // Categorize processed line items
  const tenantImprovements = processedLineItems.filter(item => item.category === 'tenant-improvements');
  const designSoftCosts = processedLineItems.filter(item => item.category === 'design-soft-costs');
  
  // Calculate totals
  const calculateCategoryTotal = (items: any[]) => {
    return items.reduce((sum: number, item: any) => sum + (parseFloat(item.totalPrice) || 0), 0);
  };
  
  const formatCurrency = (amount: number) => {
    // Use standard 2 decimal places for all currency amounts
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };
  
  const formatPerSF = (total: number, sf: number) => {
    if (sf === 0) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(total / sf);
  };
  
  const tenantImprovementsTotal = calculateCategoryTotal(tenantImprovements);
  const designSoftCostsTotal = calculateCategoryTotal(designSoftCosts);
  const grandTotal = tenantImprovementsTotal + designSoftCostsTotal;
  
  // Calculate total square footage from selected bay configurations FIRST
  let totalSquareFootage = 51094;
  console.log('ROM Pilot data:', JSON.stringify(romPilot, null, 2));
  console.log('Total square footage:', totalSquareFootage);
  
  if (romPilot.selectedBayConfigurations && Array.isArray(romPilot.selectedBayConfigurations)) {
    console.log('[ROM totalSF] selectedBayConfigurations count:', romPilot.selectedBayConfigurations.length);
    console.log('[ROM totalSF] first bay raw data:', JSON.stringify(romPilot.selectedBayConfigurations[0], null, 2));
    const calculatedSF = romPilot.selectedBayConfigurations.reduce((sum: number, bay: any) => {
      console.log('[ROM totalSF] bay id:', bay.id, '| rentableSquareFootage:', bay.rentableSquareFootage, '| squareFootage:', bay.squareFootage);
      return sum + (bay.rentableSquareFootage || bay.squareFootage || 0);
    }, 0);
    if (calculatedSF > 0) {
      totalSquareFootage = calculatedSF;
    }
    console.log('[ROM totalSF] calculatedSF:', calculatedSF, '| final totalSquareFootage:', totalSquareFootage);
  }
  
  const renderCategorySection = (title: string, items: any[], categoryTotal: number) => {
    if (items.length === 0) return '';
    
    const categoryPerSF = totalSquareFootage > 0 ? categoryTotal / totalSquareFootage : 0;
    
    return `
      <div style="margin-bottom: 30px;">
        <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600; color: #333; display: flex; justify-content: space-between; align-items: center;">
          <span>${title}</span>
          <span style="color: #065f46; font-size: 16px;">${formatCurrency(categoryTotal)} <span style="font-size: 11px; color: #999;">(${formatPerSF(categoryTotal, totalSquareFootage)}/sf)</span></span>
        </h3>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600;">DESCRIPTION</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">QUANTITY</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">UNIT</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">UNIT PRICE</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">TOTAL PRICE</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">$/RSF</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => {
              const scopeItem = scopeItems.find(si => si.id === item.scopeItemId);
              const itemTotal = parseFloat(item.totalPrice) || 0;
              const perSF = totalSquareFootage > 0 ? itemTotal / totalSquareFootage : 0;
              // Use activePrice from scope item if set (quarterly pricing intelligence)
              const effectiveUnitPrice = (scopeItem?.activePrice ? parseFloat(scopeItem.activePrice) : null) ?? parseFloat(item.unitPrice) ?? 0;
              
              return `
                <tr>
                  <td style="border: 1px solid #e5e7eb; padding: 6px;">${scopeItem?.name || 'Custom Item'}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${new Intl.NumberFormat('en-US').format(item.actualQuantity || parseFloat(item.quantity) || 0)}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${scopeItem?.unit || 'ea'}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatCurrency(effectiveUnitPrice)}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatCurrency(itemTotal)}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatPerSF(itemTotal, totalSquareFootage)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>ROM Budget Report</title>
      <style>
        @page { size: A4; margin: 0.75in; }
        @media print { 
          .no-print { display: none !important; }
          body { font-size: 11px; }
          .document-title {
            background: rgb(59, 88, 152) !important;
            color: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
          font-size: 12px; 
          margin: 0; 
          color: #1f2937;
          line-height: 1.4;
        }
        .no-print { 
          background: #3b82f6; 
          color: white; 
          padding: 15px; 
          text-align: center; 
          margin-bottom: 20px; 
          border-radius: 8px; 
          font-weight: 600;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 25px;
          padding-bottom: 15px;
        }
        .logo {
          max-width: 120px;
          height: auto;
        }
        .generated-info {
          text-align: right;
          font-size: 11px;
          color: #666;
        }
        .document-title {
          background: rgb(59, 88, 152);
          color: white;
          padding: 15px;
          text-align: center;
          font-size: 20px;
          font-weight: bold;
          margin: 20px 0;
          border-radius: 5px;
        }
        .project-info {
          text-align: center;
          margin-bottom: 20px;
          padding: 10px;
          border-bottom: 2px solid #e5e7eb;
        }
        .project-info h2 {
          margin: 5px 0;
          font-size: 16px;
          color: #333;
        }
        .project-info .rfp-number {
          font-size: 14px;
          color: #666;
          margin: 5px 0;
        }
        .property-summary {
          background: #f8f9fa;
          padding: 15px;
          margin-bottom: 25px;
          border-radius: 5px;
          border-left: 4px solid rgb(59, 88, 152);
        }
        .property-summary h3 {
          margin: 0 0 10px 0;
          font-size: 16px;
          font-weight: 600;
          color: #333;
        }
        .property-details {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
        }
        .property-left, .property-right {
          flex: 1;
        }
        .property-left {
          margin-right: 20px;
        }
        .grand-total {
          margin-top: 30px;
          text-align: center;
          font-size: 24px;
          font-weight: bold;
          color: #065f46;
          border-top: 3px solid #e5e7eb;
          padding-top: 20px;
        }
        .watermark {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-45deg);
          font-size: 72px;
          font-weight: bold;
          color: rgba(59, 88, 152, 0.1);
          z-index: 9999;
          pointer-events: none;
          white-space: nowrap;
          user-select: none;
        }
        @media print {
          .watermark {
            color: rgba(59, 88, 152, 0.15) !important;
            z-index: 9999 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="watermark">ROM PILOT</div>
      <div class="no-print">
        <p>ROM Budget Report - Use your browser's print function to save as PDF or print this report</p>
      </div>
      
      <div class="header">
        <img src="${getBridgeLogo()}" alt="Kurv Industrial" class="logo" />
        <div class="generated-info">
          Generated: ${currentDate}
        </div>
      </div>
      
      <div class="document-title">ROM Budget Report</div>
      
      <div class="project-info">
        <h2>Project: ${romPilot.projectName} @ ${propertyDisplayName}</h2>
        <div class="rfp-number">${romPilot.romNumber || 'ROM-2025-001'}</div>
      </div>
      
      <div class="property-summary">
        <h3>Property Summary</h3>
        <div class="property-details">
          <div class="property-left">
            <div><strong>Rentable Area:</strong> ${totalSquareFootage > 0 ? new Intl.NumberFormat('en-US').format(totalSquareFootage) + ' sf' : 'N/A'}</div>
            <div><strong>Bay Count:</strong> ${bayCountDisplay || `${bayCount || (romPilot.selectedBayConfigurations ? romPilot.selectedBayConfigurations.length : 0)} bays`}</div>
            <div><strong>Door Configuration:</strong> ${doorConfig}</div>
          </div>
          <div class="property-right">
            <div><strong>Vehicular Parking:</strong> ${vehicularParking} spaces</div>
            <div><strong>Trailer Parking:</strong> ${trailerParking} spaces</div>
            <div><strong>Electrical Allocation:</strong> ${electricalAllocation} AMPS</div>
            <div><strong>Generated by:</strong> ${generatedBy}</div>
          </div>
        </div>
      </div>

      ${renderCategorySection("Tenant Improvements", tenantImprovements, tenantImprovementsTotal)}
      ${renderCategorySection("Design / Soft Costs / Other Fees", designSoftCosts, designSoftCostsTotal)}
      
      <div style="margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 5px; border-left: 4px solid #6b7280;">
        <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #666;">* Existing improvements tracked separately for financial modeling</h3>
      </div>
      
      ${existingCosts.length > 0 ? `
      <div style="margin-top: 20px;">
        <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600; color: #333; display: flex; justify-content: space-between; align-items: center;">
          <span>Existing Costs</span>
          <span style="color: #065f46; font-size: 16px;">${formatCurrency(existingCosts.reduce((sum, cost) => sum + (parseFloat(cost.costEstimate) || 0), 0))} <span style="font-size: 11px; color: #999;">(${formatPerSF(existingCosts.reduce((sum, cost) => sum + (parseFloat(cost.costEstimate) || 0), 0), totalSquareFootage)}/sf)</span></span>
        </h3>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600;">DESCRIPTION</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">TYPE</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">STATUS</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">COST ESTIMATE</th>
              <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">$/RSF</th>
            </tr>
          </thead>
          <tbody>
            ${existingCosts.map(cost => {
              const costAmount = parseFloat(cost.costEstimate) || 0;
              return `
                <tr>
                  <td style="border: 1px solid #e5e7eb; padding: 6px;">${cost.description || 'N/A'}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${cost.improvementType || 'N/A'}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${cost.status || 'N/A'}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatCurrency(costAmount)}</td>
                  <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatPerSF(costAmount, totalSquareFootage)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}

      <div class="grand-total" style="display: flex; align-items: baseline; justify-content: center; gap: 4px;">
        <span style="font-size: 24px; font-weight: bold; color: #065f46;">Grand Total: ${formatCurrency(grandTotal)}</span>
        <span style="font-size: 10px; font-style: italic; font-weight: normal; color: #999;">(${formatCurrency(totalSquareFootage > 0 ? grandTotal / totalSquareFootage : 0)} / sf)</span>
      </div>
    </body>
    </html>
  `;
}

export function registerRomRoutes(app: Express): void {
  // ROM Pilot routes
  app.get("/api/rom-pilots", async (req, res) => {
    try {
      const pilots = await storage.getAllRomPilots();
      res.json(pilots);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ROM pilots" });
    }
  });

  app.get("/api/rom-pilots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const pilot = await storage.getRomPilot(id);
      if (!pilot) {
        return res.status(404).json({ message: "ROM pilot not found" });
      }

      res.json(pilot);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ROM pilot" });
    }
  });

  app.post("/api/rom-pilots", async (req, res) => {
    try {
      // Generate ROM number
      const currentYear = new Date().getFullYear();
      const existingRoms = await storage.getAllRomPilots();
      const currentYearRoms = existingRoms.filter(rom => 
        rom.createdAt && new Date(rom.createdAt).getFullYear() === currentYear
      );
      const romCount = currentYearRoms.length + 1;
      const romNumber = `ROM-${currentYear}-${romCount.toString().padStart(3, '0')}`;
      
      const pilot = await storage.createRomPilot({
        ...req.body,
        romNumber
      });
      res.status(201).json(pilot);
    } catch (error) {
      res.status(400).json({ message: "Invalid ROM pilot data" });
    }
  });

  app.put("/api/rom-pilots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const pilot = await storage.updateRomPilot(id, req.body);
      if (!pilot) {
        return res.status(404).json({ message: "ROM pilot not found" });
      }

      res.json(pilot);
    } catch (error) {
      res.status(400).json({ message: "Invalid ROM pilot data" });
    }
  });

  app.delete("/api/rom-pilots/:id", requireAuth, checkPermission('rom.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteRomPilot(id);
      if (!deleted) {
        return res.status(404).json({ message: "ROM pilot not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete ROM pilot" });
    }
  });

  // ROM Scope Items endpoints
  app.get("/api/rom-scope-items", async (req, res) => {
    try {
      const scopeItems = await storage.getAllRomScopeItems();
      res.json(scopeItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch scope items" });
    }
  });

  app.post("/api/rom-scope-items", async (req, res) => {
    try {
      // Handle date conversion for lastUpdated field
      const createData = { ...req.body };
      if (createData.lastUpdated && createData.lastUpdated !== '') {
        createData.lastUpdated = new Date(createData.lastUpdated);
      } else if (createData.lastUpdated === '') {
        createData.lastUpdated = null;
      }

      const scopeItem = await storage.createRomScopeItem(createData);
      res.status(201).json(scopeItem);
    } catch (error) {
      console.error("ROM scope item creation error:", error);
      res.status(400).json({ message: "Invalid scope item data", error: error.message });
    }
  });

  app.put("/api/rom-scope-items/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      console.log("🔥 ROM UPDATE ATTEMPT - ID:", id);
      console.log("🔥 ROM UPDATE DATA:", JSON.stringify(req.body, null, 2));

      // Handle date conversion for lastUpdated field
      const updateData = { ...req.body };
      if (updateData.lastUpdated && updateData.lastUpdated !== '') {
        updateData.lastUpdated = new Date(updateData.lastUpdated);
      } else if (updateData.lastUpdated === '') {
        updateData.lastUpdated = null;
      }

      const scopeItem = await storage.updateRomScopeItem(id, updateData);
      if (!scopeItem) {
        return res.status(404).json({ message: "Scope item not found" });
      }

      console.log("Successfully updated ROM scope item:", scopeItem);
      res.json(scopeItem);
    } catch (error) {
      console.error("🚨 ROM SCOPE ITEM UPDATE ERROR:", error);
      console.error("🚨 ERROR STACK:", error.stack);
      res.status(500).json({ message: "Failed to update scope item", error: error.message });
    }
  });

  app.delete("/api/rom-scope-items/:id", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteRomScopeItem(id);
      if (!deleted) {
        return res.status(404).json({ message: "Scope item not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete scope item" });
    }
  });

  // ROM Scope Items file download endpoint
  app.get("/api/rom-scope-items/download/:fileName", async (req, res) => {
    try {
      const { fileName } = req.params;
      const { path: filePath } = req.query;
      
      console.log("ROM download request:", { fileName, filePath });
      
      if (!fileName || !filePath) {
        console.log("Missing fileName or filePath");
        return res.status(400).json({ message: "File name and path are required" });
      }

      // Construct the full path - files are stored in uploads directory
      const fullPath = path.join(process.cwd(), 'uploads', filePath as string);
      
      console.log("Looking for file at:", fullPath);
      
      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        console.log("File not found at:", fullPath);
        return res.status(404).json({ message: "File not found" });
      }

      // Set appropriate headers for download
      res.setHeader('Content-Disposition', `attachment; filename="${decodeURIComponent(fileName)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      
      // Stream the file
      const fileStream = fs.createReadStream(fullPath);
      fileStream.on('error', (error) => {
        console.error("File stream error:", error);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error streaming file" });
        }
      });
      fileStream.pipe(res);
      
    } catch (error) {
      console.error("ROM scope items file download error:", error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // ROM Scope Items file view endpoint (opens in browser without forcing download)
  app.get("/api/rom-scope-items/view/:fileName", async (req, res) => {
    try {
      const { fileName } = req.params;
      const { path: filePath } = req.query;
      
      console.log("ROM view request:", { fileName, filePath });
      
      if (!fileName || !filePath) {
        console.log("Missing fileName or filePath");
        return res.status(400).json({ message: "File name and path are required" });
      }

      // Construct the full path - files are stored in uploads directory
      const fullPath = path.join(process.cwd(), 'uploads', filePath as string);
      
      console.log("Looking for file at:", fullPath);
      
      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        console.log("File not found at:", fullPath);
        return res.status(404).json({ message: "File not found" });
      }

      // Determine content type based on file extension
      const ext = path.extname(fileName).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.txt': 'text/plain',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      
      // Set headers for inline viewing (not download)
      res.setHeader('Content-Disposition', `inline; filename="${decodeURIComponent(fileName)}"`);
      res.setHeader('Content-Type', contentType);
      
      // Stream the file
      const fileStream = fs.createReadStream(fullPath);
      fileStream.on('error', (error) => {
        console.error("File stream error:", error);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error streaming file" });
        }
      });
      fileStream.pipe(res);
      
    } catch (error) {
      console.error("ROM scope items file view error:", error);
      res.status(500).json({ message: "Failed to view file" });
    }
  });

  // ROM Pilot Line Items endpoints
  app.get("/api/rom-pilots/:id/line-items", async (req, res) => {
    try {
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const lineItems = await storage.getRomPilotLineItems(romPilotId);
      res.json(lineItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch line items" });
    }
  });

  app.post("/api/rom-pilots/:id/line-items", async (req, res) => {
    try {
      console.log("ROM line items save request received");
      console.log("User from auth:", req.user?.username);
      console.log("Request headers:", req.headers.authorization);
      
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const { lineItems } = req.body;
      console.log("Saving ROM line items:", { romPilotId, lineItems });
      console.log("Line items details:", lineItems.map(item => ({
        scopeItemId: item.scopeItemId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        tenantShare: item.tenantShare,
        category: item.category
      })));
      
      const savedLineItems = await storage.saveRomPilotLineItems(romPilotId, lineItems);
      
      // Calculate and update total estimate
      const total = lineItems.reduce((sum: number, item: any) => sum + (parseFloat(item.totalPrice) || 0), 0);
      await storage.updateRomPilot(romPilotId, { totalEstimate: total.toString() });
      
      res.json(savedLineItems);
    } catch (error) {
      console.error("ROM line items save error:", error);
      res.status(500).json({ message: "Failed to save line items" });
    }
  });

  // Individual line item save endpoint
  app.post("/api/rom-pilots/:id/line-items/individual", async (req, res) => {
    try {
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const { lineItem } = req.body;
      console.log("Saving individual ROM line item:", { romPilotId, lineItem });
      
      // Get existing line items
      const existingLineItems = await storage.getRomPilotLineItems(romPilotId);
      
      // Update or add the specific line item
      let updatedLineItems;
      if (lineItem.id) {
        // Update existing item
        updatedLineItems = existingLineItems.map(item => 
          item.id === lineItem.id ? { ...item, ...lineItem } : item
        );
      } else {
        // Add new item
        updatedLineItems = [...existingLineItems, lineItem];
      }
      
      const savedLineItems = await storage.saveRomPilotLineItems(romPilotId, updatedLineItems);
      
      // Calculate and update total estimate
      const total = updatedLineItems.reduce((sum: number, item: any) => sum + (parseFloat(item.totalPrice) || 0), 0);
      await storage.updateRomPilot(romPilotId, { totalEstimate: total.toString() });
      
      res.json({ success: true, lineItem: savedLineItems.find(item => 
        item.scopeItemId === lineItem.scopeItemId && 
        item.category === lineItem.category
      )});
    } catch (error) {
      console.error("Individual ROM line item save error:", error);
      res.status(500).json({ message: "Failed to save line item" });
    }
  });

  app.delete("/api/rom-pilots/:id/line-items", requireAuth, checkPermission('rom.delete'), async (req, res) => {
    try {
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      await storage.saveRomPilotLineItems(romPilotId, []);
      await storage.updateRomPilot(romPilotId, { totalEstimate: "0" });
      
      res.status(200).json({ message: "Line items cleared successfully" });
    } catch (error) {
      console.error("ROM line items delete error:", error);
      res.status(500).json({ message: "Failed to clear line items" });
    }
  });

  // ROM Report generation
  app.get("/api/rom-pilots/:id/report", requireAuth, async (req: any, res) => {
    try {
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const romPilot = await storage.getRomPilot(romPilotId);
      if (!romPilot) {
        return res.status(404).json({ message: "ROM Pilot not found" });
      }

      const lineItems = await storage.getRomPilotLineItems(romPilotId);
      const scopeItems = await storage.getAllRomScopeItems();
      
      // Get user info for the report
      const user = req.user;
      const generatedBy = user?.firstName && user?.lastName 
        ? `${user.firstName} ${user.lastName}` 
        : user?.username || user?.email || 'Unknown User';
      
      // Generate HTML report
      const html = await generateRomReportHtml(romPilot, lineItems, scopeItems, generatedBy);
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(html);
    } catch (error) {
      console.error("ROM report generation error:", error);
      res.status(500).json({ message: "Failed to generate ROM report" });
    }
  });

  // ── Quarterly Contractor Pricing Routes ──────────────────────────────────

  // GET /api/scope-items/:id/contractor-pricing
  app.get("/api/scope-items/:id/contractor-pricing", requireAuth, async (req, res) => {
    try {
      const scopeItemId = parseInt(req.params.id);
      if (isNaN(scopeItemId)) return res.status(400).json({ message: "Invalid scope item ID" });
      const records = await db
        .select()
        .from(scopeItemContractorPricing)
        .where(eq(scopeItemContractorPricing.scopeItemId, scopeItemId))
        .orderBy(desc(scopeItemContractorPricing.quotedDate));
      res.json(records);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contractor pricing" });
    }
  });

  // POST /api/scope-items/:id/contractor-pricing
  app.post("/api/scope-items/:id/contractor-pricing", requireAuth, async (req, res) => {
    try {
      const scopeItemId = parseInt(req.params.id);
      if (isNaN(scopeItemId)) return res.status(400).json({ message: "Invalid scope item ID" });
      const { contractorName, contractorId, price, unit, quotedDate, quarter, notes } = req.body;
      if (!contractorName || !price || !unit || !quarter) {
        return res.status(400).json({ message: "contractorName, price, unit, and quarter are required" });
      }
      const [record] = await db
        .insert(scopeItemContractorPricing)
        .values({
          scopeItemId,
          contractorId: contractorId ? parseInt(contractorId) : null,
          contractorName,
          price: String(price),
          unit,
          quotedDate: quotedDate ? new Date(quotedDate) : new Date(),
          quarter,
          notes: notes || null,
          isActive: true,
        })
        .returning();
      res.json(record);
    } catch (error) {
      res.status(500).json({ message: "Failed to create contractor pricing record" });
    }
  });

  // DELETE /api/scope-items/:scopeItemId/contractor-pricing/:id
  app.delete("/api/scope-items/:scopeItemId/contractor-pricing/:id", requireAuth, async (req, res) => {
    try {
      const pricingId = parseInt(req.params.id);
      if (isNaN(pricingId)) return res.status(400).json({ message: "Invalid pricing record ID" });
      await db.delete(scopeItemContractorPricing).where(eq(scopeItemContractorPricing.id, pricingId));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete contractor pricing record" });
    }
  });

  // PATCH /api/scope-items/:id/pricing-mode — update mode and recalculate activePrice
  app.patch("/api/scope-items/:id/pricing-mode", requireAuth, async (req, res) => {
    try {
      const scopeItemId = parseInt(req.params.id);
      if (isNaN(scopeItemId)) return res.status(400).json({ message: "Invalid scope item ID" });
      const { pricingMode, selectedContractorName, manualOverridePrice, manualOverrideReason } = req.body;

      // Fetch all active quotes for this item
      const quotes = await db
        .select()
        .from(scopeItemContractorPricing)
        .where(and(eq(scopeItemContractorPricing.scopeItemId, scopeItemId), eq(scopeItemContractorPricing.isActive, true)));

      const prices = quotes.map(q => parseFloat(q.price)).filter(n => !isNaN(n));

      // Calculate activePrice based on mode
      let activePrice: string | null = null;
      if (pricingMode === 'average' && prices.length > 0) {
        activePrice = (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2);
      } else if (pricingMode === 'contractor' && selectedContractorName) {
        const contractorQuotes = quotes
          .filter(q => q.contractorName === selectedContractorName)
          .sort((a, b) => new Date(b.quotedDate).getTime() - new Date(a.quotedDate).getTime());
        if (contractorQuotes.length > 0) {
          activePrice = contractorQuotes[0].price;
        }
      } else if (pricingMode === 'manual' && manualOverridePrice) {
        activePrice = String(manualOverridePrice);
      }

      // Calculate price spread
      let priceSpreadPercent: string | null = null;
      if (prices.length >= 2) {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        if (avg > 0) {
          priceSpreadPercent = (((max - min) / avg) * 100).toFixed(1);
        }
      }

      const [updated] = await db
        .update(romScopeItems)
        .set({
          pricingMode: pricingMode || 'average',
          selectedContractorName: selectedContractorName || null,
          manualOverridePrice: manualOverridePrice || null,
          manualOverrideReason: manualOverrideReason || null,
          activePrice,
          priceSpreadPercent,
          lastQuarterlyUpdate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(romScopeItems.id, scopeItemId))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Pricing mode update error:", error);
      res.status(500).json({ message: "Failed to update pricing mode" });
    }
  });
}
