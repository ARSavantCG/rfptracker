/**
 * RFP Tracker - Property Routes
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 */
import { getBrandLogo as getBridgeLogo, BRAND_COLOR_PRIMARY } from './lib/branding';
import type { Express } from 'express';
import { storage } from './storage';
import { db } from './db';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { requireAuth, checkPermission, upload, uploadsDir } from './middleware';
import {
  enforceAllPropertiesLegalCompliance,
  autoEnforceLegalComplianceMiddleware,
  fixBIALeaseTotal,
  applySymmetricalLegalCompliance
} from './property-legal-compliance';
import { applyLegalRounding, validateLegalCompliance, LEGAL_TOTALS } from './legal-rounding-system';
import {
  insertPropertySchema,
  updatePropertySchema,
  insertTransformerSchema,
  updateTransformerSchema,
  insertMainPanelSchema,
  updateMainPanelSchema,
  insertBayPanelAssignmentSchema,
  insertElectricalReservationSchema,
  updateElectricalReservationSchema,
  properties,
  rfpRequests,
} from '@shared/schema';


function normalizeBayConfigurations(bayConfigs: any[]): any[] {
  if (!bayConfigs) return [];
  
  return bayConfigs.map(bay => ({
    ...bay,
    // Ensure we use rentableSquareFootage (with mechanical room) for display
    displaySquareFootage: bay.rentableSquareFootage || bay.squareFootage || 0,
    bayDisplayName: bay.bayNumber || bay.bayName || 'Unknown Bay'
  }));
}

// Property print HTML generator
function generatePropertyPrintHtml(property: any, executedLeases: any[], propertyImprovements: any[]): string {
  // Normalize bay configurations to ensure consistent data
  const normalizedBays = normalizeBayConfigurations(property.bayConfigurations || []);
  
  // Calculate total rentable area from normalized bay configurations
  const totalRentableArea = normalizedBays.reduce((sum: number, bay: any) => sum + bay.displaySquareFootage, 0);
  const totalBays = property.bayConfigurations?.length || 0;
  
  // Calculate remaining space after executed leases
  const leasedArea = executedLeases.reduce((sum, lease) => {
    // Use override if available, otherwise calculate from bay configurations
    if (lease.rentableAreaOverride) {
      return sum + lease.rentableAreaOverride;
    }
    const assignedBayConfigs = normalizedBays.filter(
      (bay: any) => lease.assignedBays?.includes(bay.id)
    );
    const leaseArea = assignedBayConfigs.reduce(
      (total: number, bay: any) => total + bay.displaySquareFootage,
      0
    );
    return sum + leaseArea;
  }, 0);
  const remainingArea = totalRentableArea - leasedArea;
  
  // Calculate parking totals
  const totalVehicularParking = (property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0);
  const totalTrailerParking = property.trailerParking || 0;
  
  const leasedVehicularParking = executedLeases.reduce((sum, lease) => sum + ((lease.standardParking || 0) + (lease.accessibleParking || 0) + (lease.evParking || 0)), 0);
  const leasedTrailerParking = executedLeases.reduce((sum, lease) => sum + (lease.trailerParking || 0), 0);
  
  const remainingVehicularParking = totalVehicularParking - leasedVehicularParking;
  const remainingTrailerParking = totalTrailerParking - leasedTrailerParking;

  return `
<!DOCTYPE html>
<html>
<head>
<title>Property Report - ${property.propertyName}</title>
<style>
  @media print {
    .no-print { display: none !important; }
    @page { margin: 0.5in; }
    body { font-size: 11px; }
  }
  body { font-family: 'Segoe UI', sans-serif; font-size: 12px; margin: 0; padding: 20px; line-height: 1.4; }
  .no-print { background: #3b82f6; color: white; padding: 15px; text-align: center; margin-bottom: 20px; border-radius: 8px; }
  .header { border-bottom: 3px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 20px; margin-bottom: 30px; position: relative; }
  .document-title { font-size: 28px; font-weight: bold; color: ${BRAND_COLOR_PRIMARY}; margin-bottom: 10px; background: ${BRAND_COLOR_PRIMARY}; color: white; padding: 10px; border-radius: 5px; text-align: center; }
  .header .subtitle { font-size: 16px; color: #666; margin: 5px 0; text-align: center; }
  .section { margin-bottom: 30px; }
  .section h2 { font-size: 18px; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px; }
  .section h3 { font-size: 14px; color: #374151; margin: 15px 0 10px 0; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  .info-item { background: #f9fafb; padding: 15px; border-radius: 8px; }
  .info-item strong { color: #1f2937; }
  table { width: 100%; border-collapse: collapse; margin-top: 15px; }
  th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
  th { background: #f9fafb; font-weight: 600; color: #374151; }
  .bay-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 15px; }
  .bay-item { background: #f0f9ff; border: 1px solid #bae6fd; padding: 8px; border-radius: 4px; text-align: center; font-size: 11px; }
  .compass { text-align: center; margin: 15px 0; }
  .compass-directions { display: flex; justify-content: space-between; margin: 10px 0; font-size: 11px; color: #6b7280; }
  .existing-improvements { background: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; margin: 10px 0; }
</style>
</head>
<body>
<div class="no-print">
  <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows/Linux) or Cmd+P (Mac), then select "Save as PDF" as your destination.
  <br><small>This banner will not appear in the printed version.</small>
</div>

<div class="header">
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
    <!-- Company logo -->
    <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
  </div>
  <div class="document-title">${property.propertyName}</div>
  <div class="subtitle">Property Report - Generated on ${new Date().toLocaleDateString()}</div>
</div>

<div class="section">
  <h2>Property Overview</h2>
  <div class="info-grid">
    <div class="info-item">
      <strong>Total Rentable Area:</strong> ${totalRentableArea ? totalRentableArea.toLocaleString() + ' SF' : 'N/A'}<br>
      <strong>Bay Count:</strong> ${totalBays}<br>
      <strong>Single Building:</strong> ${property.isSingleBuilding ? 'Yes' : 'No'}
    </div>
    <div class="info-item">
      <strong>Vehicular Parking:</strong> ${totalVehicularParking} spaces<br>
      <strong>Trailer Parking:</strong> ${totalTrailerParking} spaces<br>
      <strong>Parking Ratio:</strong> ${totalRentableArea ? (totalVehicularParking / (totalRentableArea / 1000)).toFixed(2) : '0.00'} per 1,000 SF<br>
      <strong>Trailer Ratio:</strong> ${totalRentableArea ? (totalTrailerParking / (totalRentableArea / 1000)).toFixed(2) : '0.00'} per 1,000 SF
    </div>
  </div>
</div>

${property.bayConfigurations?.length > 0 ? `
<div class="section">
  <h2>Bay Configuration</h2>
  <div class="compass">
    <div class="compass-directions">
      <span>West Side (Street/Entrance)</span>
      <span>East Side (Loading Docks)</span>
    </div>
  </div>
  <!-- Simplified bay configuration display -->
  <div style="margin-top: 15px;">
    ${normalizedBays.map((bay: any, index: number) => `
      <div style="display: inline-block; margin: 5px 15px 5px 0; padding: 4px 8px; background: #f0f9ff; border-radius: 4px; font-size: 11px;">
        ${bay.bayDisplayName} - ${bay.displaySquareFootage.toLocaleString()} sf
      </div>
    `).join('')}
  </div>
  ${property.mechanicalRoomSquareFootage ? `
  <div style="margin-top: 15px;">
    <div class="info-item">
      <strong>Mechanical Room:</strong> ${property.mechanicalRoomSquareFootage.toLocaleString()} SF <em>(prorated across all bays)</em>
    </div>
  </div>
  ` : ''}
</div>
` : ''}

${executedLeases.length > 0 ? `
<div class="section">
  <h2>Executed Leases</h2>
  <table>
    <thead>
      <tr>
        <th>Tenant Name</th>
        <th>Rentable Area</th>
        <th>Vehicular Parking</th>
        <th>Trailer Parking</th>
        <th>Lease Date</th>
      </tr>
    </thead>
    <tbody>
      ${executedLeases.map(lease => {
        // Use override if available, otherwise calculate from bay configurations
        let totalRentableArea;
        if (lease.rentableAreaOverride) {
          totalRentableArea = lease.rentableAreaOverride;
        } else {
          const assignedBayConfigs = normalizedBays.filter(
            (bay: any) => lease.assignedBays?.includes(bay.id)
          );
          totalRentableArea = assignedBayConfigs.reduce(
            (total: number, bay: any) => total + bay.displaySquareFootage,
            0
          );
        }
        
        // Calculate vehicular parking total
        const vehicularParking = (lease.standardParking || 0) + (lease.accessibleParking || 0) + (lease.evParking || 0);
        
        return `
        <tr>
          <td>${lease.tenantName}</td>
          <td>${totalRentableArea.toLocaleString()} SF${lease.rentableAreaOverride ? ' <span style="color: #ea580c; font-size: 10px;">(Override)</span>' : ''}</td>
          <td>${vehicularParking} spaces</td>
          <td>${lease.trailerParking || 0} spaces</td>
          <td>N/A</td>
        </tr>
      `;}).join('')}
    </tbody>
  </table>
</div>
` : ''}

<div class="section">
  <h2>Available Space</h2>
  <div class="info-grid">
    <div class="info-item">
      <strong>Remaining Rentable Area:</strong> ${remainingArea ? remainingArea.toLocaleString() + ' SF' : 'N/A'}<br>
      <strong>Percentage Available:</strong> ${totalRentableArea ? ((remainingArea / totalRentableArea) * 100).toFixed(1) + '%' : 'N/A'}
    </div>
    <div class="info-item">
      <strong>Remaining Vehicular Parking:</strong> ${remainingVehicularParking} spaces<br>
      <strong>Remaining Trailer Parking:</strong> ${remainingTrailerParking} spaces
    </div>
  </div>
</div>

${propertyImprovements.length > 0 ? `
<div class="section">
  <h2>Existing Improvements</h2>
  <table>
    <thead>
      <tr>
        <th>Category</th>
        <th>Description</th>
        <th>Quantity</th>
        <th>Unit</th>
        <th>Unit Price</th>
        <th>Total Cost</th>
      </tr>
    </thead>
    <tbody>
      ${propertyImprovements.map(improvement => {
        const totalCostDollars = (improvement.totalCost || 0) / 100;
        let quantity = 1;
        let unit = 'LS';
        let unitPrice = totalCostDollars;
        
        // Calculate based on allocation type
        if (improvement.allocationType === 'prorated') {
          // For prorated items, show per square foot
          const totalSF = totalRentableArea || 1;
          quantity = totalSF;
          unit = 'SF';
          unitPrice = totalCostDollars / totalSF;
        } else if (improvement.allocationType === 'bay-specific') {
          // For bay-specific items, show per bay
          const applicableBayCount = (improvement.applicableBays || []).length || 1;
          quantity = applicableBayCount;
          unit = 'Bay';
          unitPrice = totalCostDollars / applicableBayCount;
        } else if (improvement.allocationType === 'whole-property') {
          // For whole property items, show as lump sum
          quantity = 1;
          unit = 'LS';
          unitPrice = totalCostDollars;
        }
        
        return `
        <tr>
          <td>${(improvement.category || '').toUpperCase()}</td>
          <td>${improvement.description || ''}</td>
          <td>${quantity.toLocaleString()}</td>
          <td>${unit}</td>
          <td>$${unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td>$${totalCostDollars.toLocaleString()}</td>
        </tr>
      `;}).join('')}
    </tbody>
  </table>
  <div style="margin-top: 15px; text-align: right;">
    <strong>Total Existing Improvements: $${propertyImprovements.reduce((sum, imp) => sum + ((imp.totalCost || 0) / 100), 0).toLocaleString()}</strong>
  </div>
</div>
` : ''}
</body>
</html>
  `;
}

export function registerPropertyRoutes(app: Express): void {
  // Legal compliance enforcement endpoint
  app.post("/api/properties/enforce-legal-compliance", requireAuth, async (req, res) => {
    try {
      console.log('🏛️ Manual legal compliance enforcement requested...');
      const result = await enforceAllPropertiesLegalCompliance();
      
      res.json({
        success: result.success,
        summary: result.summary,
        details: result.results
      });
    } catch (error) {
      console.error("Error enforcing legal compliance:", error);
      res.status(500).json({ message: "Failed to enforce legal compliance" });
    }
  });

  // Fix BIA lease total endpoint
  app.post("/api/properties/fix-bia-lease", requireAuth, async (req, res) => {
    try {
      console.log('🏗️ Fixing BIA lease total to 397,167 SF...');
      const result = await fixBIALeaseTotal();
      
      res.json(result);
    } catch (error) {
      console.error("Error fixing BIA lease total:", error);
      res.status(500).json({ message: "Failed to fix BIA lease total" });
    }
  });

  // Symmetrical legal compliance endpoint
  app.post("/api/properties/:id/symmetrical-compliance", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const { targetBays, targetTotal } = req.body;
      
      if (!targetBays || !targetTotal) {
        return res.status(400).json({ message: "targetBays and targetTotal are required" });
      }
      
      console.log(`🏗️ Applying symmetrical legal compliance to property ${propertyId}...`);
      const result = await applySymmetricalLegalCompliance(propertyId, targetBays, targetTotal);
      
      res.json(result);
    } catch (error) {
      console.error("Error applying symmetrical legal compliance:", error);
      res.status(500).json({ message: "Failed to apply symmetrical legal compliance" });
    }
  });

  // Property routes
  app.get("/api/properties", requireAuth, async (req, res) => {
    try {
      const properties = await storage.getAllProperties();
      // Add cache-busting headers to force fresh data
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('ETag', `"${Date.now()}"`);
      
      res.json(properties);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch properties" });
    }
  });

  app.get("/api/properties/next-id", requireAuth, async (req, res) => {
    try {
      const nextId = await storage.getNextPropertyId();
      res.json({ nextId });
    } catch (error) {
      res.status(500).json({ message: "Failed to get next property ID" });
    }
  });

  app.post("/api/properties", requireAuth, checkPermission('properties.create'), async (req, res) => {
    try {
      const result = insertPropertySchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid input", errors: result.error.issues });
      }

      const property = await storage.createProperty(result.data);
      res.status(201).json(property);
    } catch (error) {
      res.status(500).json({ message: "Failed to create property" });
    }
  });

  app.get("/api/properties/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const property = await storage.getProperty(id);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Add cache-busting headers to force fresh data
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('ETag', `"${Date.now()}"`);


      res.json(property);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch property" });
    }
  });

  app.put("/api/properties/:id", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const result = updatePropertySchema.safeParse({ ...req.body, id });
      if (!result.success) {
        return res.status(400).json({ message: "Invalid input", errors: result.error.issues });
      }

      // Apply legal compliance middleware before saving
      const legallyCompliantData = await autoEnforceLegalComplianceMiddleware(id, result.data);

      const property = await storage.updateProperty(id, legallyCompliantData);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      res.json(property);
    } catch (error) {
      res.status(500).json({ message: "Failed to update property" });
    }
  });

  app.patch("/api/properties/:id", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const result = updatePropertySchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid input", errors: result.error.issues });
      }

      // If changing ID, check if new ID already exists
      if (result.data.id && result.data.id !== id) {
        const existingProperty = await storage.getProperty(result.data.id);
        if (existingProperty) {
          return res.status(400).json({ message: "Property ID already exists" });
        }
      }

      // Apply legal compliance middleware before saving
      const legallyCompliantData = await autoEnforceLegalComplianceMiddleware(id, result.data);

      const property = await storage.updateProperty(id, legallyCompliantData);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      res.json(property);
    } catch (error) {
      console.error('Property update error:', error);
      if (error.code === '23505') { // PostgreSQL unique violation
        return res.status(400).json({ message: "Property ID already exists" });
      }
      res.status(500).json({ message: "Failed to update property" });
    }
  });

  // Dedicated endpoint for updating electrical allocation settings
  app.patch("/api/properties/:id/electrical-allocation", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      // Use partial schema for electrical allocation fields
      const electricalAllocationSchema = updatePropertySchema.pick({ 
        electricalAllocation: true, 
        electricalAllocationIncrement: true,
        electricalAllocationMinimum: true
      });
      
      const result = electricalAllocationSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid input", errors: result.error.issues });
      }

      // Ensure non-negative values
      const { electricalAllocation, electricalAllocationIncrement, electricalAllocationMinimum } = result.data;
      if ((electricalAllocation !== undefined && electricalAllocation < 0) || 
          (electricalAllocationIncrement !== undefined && electricalAllocationIncrement < 0) ||
          (electricalAllocationMinimum !== undefined && electricalAllocationMinimum < 0)) {
        return res.status(400).json({ message: "Electrical allocation values must be non-negative" });
      }

      // Apply legal compliance middleware (consistent with main property update route)
      const legallyCompliantData = await autoEnforceLegalComplianceMiddleware(id, result.data);
      
      const property = await storage.updateProperty(id, legallyCompliantData);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      res.json(property);
    } catch (error) {
      console.error('Electrical allocation update error:', error);
      res.status(500).json({ message: "Failed to update electrical allocation settings" });
    }
  });

  app.delete("/api/properties/:id", requireAuth, checkPermission('properties.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteProperty(id);
      if (!deleted) {
        return res.status(404).json({ message: "Property not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete property" });
    }
  });

  // Property Existing Improvements routes
  app.get("/api/properties/:propertyId/existing-improvements", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const improvements = await storage.getPropertyExistingImprovements(propertyId);
      
      // DEBUG: Log bucket fields to verify data
      console.log('🔍 BACKEND DEBUG: Existing Improvements from DB:', improvements.map(imp => ({
        id: imp.id,
        description: imp.description,
        bucket: imp.bucket
      })));
      
      console.log('Existing improvement applicableBays:', improvements.map(i => ({ desc: i.description, bays: i.applicableBays })));
      
      // CRITICAL: No-cache headers to ensure bucket field is always fresh (cost lifecycle tracking)
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      res.json(improvements);
    } catch (error) {
      console.error('Error fetching property existing improvements:', error);
      res.status(500).json({ message: "Failed to fetch existing improvements" });
    }
  });

  app.post("/api/properties/:propertyId/existing-improvements", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      // Handle costStage -> bucket mapping (form sends costStage, DB expects bucket)
      const bucket = req.body.bucket || req.body.costStage || 'FORECAST';
      
      // Convert totalCost from dollars to cents
      const totalCostCents = req.body.totalCost !== undefined 
        ? Math.round(req.body.totalCost * 100) 
        : 0;
      
      // Convert per-stage cost fields from dollars to cents
      // If per-stage fields are not provided, distribute totalCost to the appropriate stage based on bucket
      let forecastCost = req.body.forecastCost ? Math.round(req.body.forecastCost * 100) : 0;
      let committedCost = req.body.committedCost ? Math.round(req.body.committedCost * 100) : 0;
      let actualsCost = req.body.actualsCost ? Math.round(req.body.actualsCost * 100) : 0;
      
      // If no per-stage costs are provided but totalCost is, distribute to the appropriate stage
      if (forecastCost === 0 && committedCost === 0 && actualsCost === 0 && totalCostCents > 0) {
        if (bucket === 'FORECAST' || bucket === 'PIPELINE') {
          forecastCost = totalCostCents;
        } else if (bucket === 'COMMITTED') {
          committedCost = totalCostCents;
        } else if (bucket === 'ACTUALS') {
          actualsCost = totalCostCents;
        }
      }
      
      // Compute total as sum of all stages (or use the provided total for backward compatibility)
      const computedTotal = forecastCost + committedCost + actualsCost;
      const totalCost = computedTotal > 0 ? computedTotal : totalCostCents;
      
      const improvementData = {
        ...req.body,
        propertyId,
        bucket, // Ensure bucket is always set
        forecastCost,
        committedCost,
        actualsCost,
        totalCost, // Already computed correctly above
        originalCommitment: req.body.originalCommitment ? Math.round(req.body.originalCommitment * 100) : undefined,
        addedAmount: req.body.addedAmount ? Math.round(req.body.addedAmount * 100) : undefined,
      };
      
      // Clean up costStage if it was sent (not a DB field)
      delete improvementData.costStage;

      const improvement = await storage.createPropertyExistingImprovement(improvementData);

      res.status(201).json(improvement);
    } catch (error) {
      console.error('Error creating property existing improvement:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to create existing improvement" 
      });
    }
  });

  app.patch("/api/properties/:propertyId/existing-improvements/:id", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log('📝 PATCH existing-improvements - ID:', id, 'Body:', JSON.stringify(req.body));
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid improvement ID" });
      }

      const updates = { ...req.body };
      
      // Convert per-stage cost fields from dollars to cents if provided
      if (updates.forecastCost !== undefined) {
        console.log('📝 Converting forecastCost from dollars to cents:', updates.forecastCost, '→', Math.round(updates.forecastCost * 100));
        updates.forecastCost = Math.round(updates.forecastCost * 100);
      }
      if (updates.committedCost !== undefined) {
        updates.committedCost = Math.round(updates.committedCost * 100);
      }
      if (updates.actualsCost !== undefined) {
        updates.actualsCost = Math.round(updates.actualsCost * 100);
      }
      
      // If any stage cost is updated, get existing values and recompute total
      if (updates.forecastCost !== undefined || updates.committedCost !== undefined || updates.actualsCost !== undefined) {
        // Get current improvement to compute new total
        const currentImprovement = await storage.getPropertyExistingImprovement(id);
        if (currentImprovement) {
          const forecast = updates.forecastCost !== undefined ? updates.forecastCost : (currentImprovement.forecastCost || 0);
          const committed = updates.committedCost !== undefined ? updates.committedCost : (currentImprovement.committedCost || 0);
          const actuals = updates.actualsCost !== undefined ? updates.actualsCost : (currentImprovement.actualsCost || 0);
          updates.totalCost = forecast + committed + actuals;
        }
      } else if (updates.totalCost !== undefined) {
        // Legacy: If only totalCost provided (backward compatibility)
        updates.totalCost = Math.round(updates.totalCost * 100);
      }
      
      if (updates.originalCommitment !== undefined) {
        updates.originalCommitment = updates.originalCommitment ? Math.round(updates.originalCommitment * 100) : undefined;
      }
      if (updates.addedAmount !== undefined) {
        updates.addedAmount = updates.addedAmount ? Math.round(updates.addedAmount * 100) : undefined;
      }

      const beforeUpdate = await storage.getPropertyExistingImprovement(id).catch(() => null);
      const improvement = await storage.updatePropertyExistingImprovement(id, updates);
      if (!improvement) {
        return res.status(404).json({ message: "Existing improvement not found" });
      }

      res.json(improvement);
    } catch (error) {
      console.error('Error updating property existing improvement:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to update existing improvement" 
      });
    }
  });

  app.delete("/api/properties/:propertyId/existing-improvements/:id", requireAuth, checkPermission('properties.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid improvement ID" });
      }

      const toDelete = await storage.getPropertyExistingImprovement(id).catch(() => null);
      const deleted = await storage.deletePropertyExistingImprovement(id);
      if (!deleted) {
        return res.status(404).json({ message: "Existing improvement not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting property existing improvement:', error);
      res.status(500).json({ message: "Failed to delete existing improvement" });
    }
  });

  // Property renumbering endpoint
  app.post("/api/properties/renumber", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const { mappings } = req.body;
      
      if (!mappings || !Array.isArray(mappings)) {
        return res.status(400).json({ message: "Invalid mappings format" });
      }

      // Validate mappings format
      for (const mapping of mappings) {
        if (!mapping.oldId || !mapping.newId) {
          return res.status(400).json({ message: "Each mapping must have oldId and newId" });
        }
      }

      // Begin transaction
      await db.transaction(async (tx) => {
        const updates = [];
        
        for (const { oldId, newId } of mappings) {
          // Check if old property exists
          const oldProperty = await storage.getProperty(oldId);
          if (!oldProperty) {
            throw new Error(`Property ${oldId} not found`);
          }
          
          // Check if new ID is available (unless it's the same as old ID)
          if (oldId !== newId) {
            const existingProperty = await storage.getProperty(newId);
            if (existingProperty) {
              throw new Error(`Property ID ${newId} already exists`);
            }
          }
          
          updates.push({ oldId, newId, property: oldProperty });
        }
        
        // Create a temporary mapping to avoid conflicts
        const tempMappings = new Map();
        
        // First pass: Update all properties to temporary IDs
        for (const { oldId, newId } of mappings) {
          if (oldId !== newId) {
            const tempId = 90000 + parseInt(oldId); // Use high temp IDs to avoid conflicts
            tempMappings.set(oldId, { tempId, finalId: newId });
            
            await tx.update(properties)
              .set({ id: tempId })
              .where(eq(properties.id, oldId));
          }
        }
        
        // Second pass: Update all RFP requests to use temp IDs
        for (const [oldId, { tempId }] of tempMappings) {
          await tx.update(rfpRequests)
            .set({ property: tempId.toString() })
            .where(eq(rfpRequests.property, oldId.toString()));
        }
        
        // Third pass: Update temp IDs to final IDs
        for (const [oldId, { tempId, finalId }] of tempMappings) {
          await tx.update(properties)
            .set({ id: finalId })
            .where(eq(properties.id, tempId));
            
          await tx.update(rfpRequests)
            .set({ property: finalId.toString() })
            .where(eq(rfpRequests.property, tempId.toString()));
        }
      });
      
      res.json({ success: true, message: "Properties renumbered successfully" });
    } catch (error) {
      console.error('Property renumbering error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to renumber properties" 
      });
    }
  });

  // Print endpoints for property management modals
  app.get('/api/properties/:propertyId/bay-configurations/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Bay Configurations - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; }
            .header { border-bottom: 3px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: ${BRAND_COLOR_PRIMARY}; margin-bottom: 10px; background: ${BRAND_COLOR_PRIMARY}; color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Bay Configurations Report</div>
            <div class="property-name">${property.propertyName}</div>
          </div>
          
          <div class="summary">
            <h3>Property Summary</h3>
            <p><strong>Total Bays:</strong> ${property.bayConfigurations?.length || 0}</p>
            <p><strong>Total Square Footage:</strong> ${(property.bayConfigurations || []).reduce((sum, bay) => sum + bay.squareFootage, 0).toLocaleString()} SF</p>
            <p><strong>Mechanical Room SF:</strong> ${property.mechanicalRoomSquareFootage?.toLocaleString() || 0} SF</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Bay Name</th>
                <th>Square Footage</th>
                <th>Standard Dock Doors</th>
                <th>Oversized Dock Doors</th>
                <th>Grade Level Doors</th>
                <th>Truck Courts</th>
                <th>Car Parking</th>
              </tr>
            </thead>
            <tbody>
              ${(property.bayConfigurations || []).map(bay => `
                <tr>
                  <td>${bay.bayName}</td>
                  <td>${bay.squareFootage.toLocaleString()}</td>
                  <td>${bay.standardDockDoors || 0}</td>
                  <td>${bay.oversizedDockDoors || 0}</td>
                  <td>${bay.gradeLevelDoors || 0}</td>
                  <td>${bay.truckCourts || 0}</td>
                  <td>${bay.carParking || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <p><em>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</em></p>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Bay configurations print error:", error);
      res.status(500).json({ message: "Failed to generate bay configurations report" });
    }
  });

  app.get('/api/properties/:propertyId/executed-leases/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      const leases = await storage.getExecutedLeases(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Executed Leases - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; }
            .header { border-bottom: 3px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: ${BRAND_COLOR_PRIMARY}; margin-bottom: 10px; background: ${BRAND_COLOR_PRIMARY}; color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Executed Leases Report</div>
            <div class="property-name">${property.propertyName}</div>
          </div>
          
          <div class="summary">
            <h3>Leasing Summary</h3>
            <p><strong>Total Leases:</strong> ${leases.length}</p>
            <p><strong>Total Leased SF:</strong> ${leases.reduce((sum, lease) => sum + (lease.rentableAreaOverride || 0), 0).toLocaleString()} SF</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Tenant Name</th>
                <th>Assigned Bays</th>
                <th>Rentable Area (SF)</th>
                <th>Standard Parking</th>
                <th>Accessible Parking</th>
                <th>EV Parking</th>
                <th>Trailer Parking</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${leases.map(lease => `
                <tr>
                  <td>${lease.tenantName}</td>
                  <td>${(lease.assignedBays || []).join(', ')}</td>
                  <td>${(lease.rentableAreaOverride || 0).toLocaleString()}</td>
                  <td>${lease.standardParking || 0}</td>
                  <td>${lease.accessibleParking || 0}</td>
                  <td>${lease.evParking || 0}</td>
                  <td>${lease.trailerParking || 0}</td>
                  <td>${lease.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <p><em>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</em></p>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Executed leases print error:", error);
      res.status(500).json({ message: "Failed to generate executed leases report" });
    }
  });

  app.get('/api/properties/:propertyId/building-specifications/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Building Specifications - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; line-height: 1.6; }
            .header { border-bottom: 3px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: ${BRAND_COLOR_PRIMARY}; margin-bottom: 10px; background: ${BRAND_COLOR_PRIMARY}; color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            .section { margin-bottom: 30px; }
            .section-title { font-size: 18px; font-weight: bold; color: ${BRAND_COLOR_PRIMARY}; margin-bottom: 15px; padding-bottom: 5px; border-bottom: 2px solid #e5e7eb; }
            .spec-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 15px; margin-bottom: 15px; }
            .spec-label { font-weight: 600; color: #374151; }
            .spec-value { color: #1f2937; }
            .empty-value { color: #9ca3af; font-style: italic; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Building Specifications</div>
            <div class="property-name">${property.propertyName}</div>
          </div>

          <div class="section">
            <div class="section-title">Structural Specifications</div>
            <div class="spec-grid">
              <div class="spec-label">Slab Thickness & PSI:</div>
              <div class="spec-value ${!property.slabThickness ? 'empty-value' : ''}">${property.slabThickness || 'Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Clear Height:</div>
              <div class="spec-value ${!property.clearHeight ? 'empty-value' : ''}">${property.clearHeight || 'Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Floor Flatness/Level (FF/FL):</div>
              <div class="spec-value ${!property.floorFlatness ? 'empty-value' : ''}">${property.floorFlatness || 'Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Truck Apron Slab:</div>
              <div class="spec-value ${!property.truckApronSlab ? 'empty-value' : ''}">${property.truckApronSlab || 'Not specified'}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Operational Specifications</div>
            <div class="spec-grid">
              <div class="spec-label">Ramp Capacity:</div>
              <div class="spec-value ${!property.rampCapacity ? 'empty-value' : ''}">${property.rampCapacity || 'No ramps / Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Roof R-Value:</div>
              <div class="spec-value ${!property.roofRValue ? 'empty-value' : ''}">${property.roofRValue || 'Not specified'}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Fire & Safety Systems</div>
            <div class="spec-grid">
              <div class="spec-label">Fire Pump Information:</div>
              <div class="spec-value ${!property.firePumpInfo ? 'empty-value' : ''}">${property.firePumpInfo || 'Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Fire Sprinkler System:</div>
              <div class="spec-value ${!property.fireSprinklerInfo ? 'empty-value' : ''}">${property.fireSprinklerInfo || 'Not specified'}</div>
            </div>
          </div>

          <div class="footer">
            <p><strong>Property Address:</strong> ${property.streetAddress}, ${property.city}, ${property.state} ${property.zip}</p>
            <p><strong>Generated:</strong> ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
            <p><em>This document is intended for lease documentation and RFP purposes.</em></p>
          </div>
        </body>
        </html>
      `;

      // Return HTML content like other PDF generation in this project
      // The browser will handle PDF conversion
      const cleanHtml = html.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '');
      const htmlBuffer = Buffer.from(cleanHtml, 'utf8');

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `inline; filename="Building_Specifications_${property.propertyName.replace(/[^a-zA-Z0-9]/g, '_')}.html"`);
      res.send(htmlBuffer);
    } catch (error) {
      console.error("Building specifications print error:", error);
      res.status(500).json({ message: "Failed to generate building specifications report" });
    }
  });

  app.get('/api/properties/:propertyId/existing-improvements/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      const improvements = await storage.getPropertyExistingImprovements(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const totalValue = improvements.reduce((sum, imp) => sum + imp.totalCost, 0);

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Existing Improvements - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; }
            .header { border-bottom: 3px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: ${BRAND_COLOR_PRIMARY}; margin-bottom: 10px; background: ${BRAND_COLOR_PRIMARY}; color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .currency { text-align: right; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Existing Improvements Report</div>
            <div class="property-name">${property.propertyName}</div>
          </div>
          
          <div class="summary">
            <h3>Investment Summary</h3>
            <p><strong>Total Improvements:</strong> ${improvements.length}</p>
            <p><strong>Total Investment:</strong> $${(totalValue / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            <p><strong>Active Items:</strong> ${improvements.filter(i => i.isActive).length}</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th>Total Cost</th>
                <th>Allocation Type</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${improvements.map(improvement => `
                <tr>
                  <td>${improvement.category}</td>
                  <td>${improvement.description}</td>
                  <td class="currency">$${(improvement.totalCost / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td>${improvement.allocationType}</td>
                  <td>${improvement.isActive ? 'Active' : 'Inactive'}</td>
                  <td>${improvement.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <p><em>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</em></p>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Existing improvements print error:", error);
      res.status(500).json({ message: "Failed to generate existing improvements report" });
    }
  });

  app.get('/api/properties/:propertyId/electrical/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      const transformers = await storage.getTransformersByProperty(propertyId);
      
      // Get all main panels for all transformers at this property
      const allMainPanels = [];
      for (const transformer of transformers) {
        const panels = await storage.getMainPanelsByTransformer(transformer.id);
        allMainPanels.push(...panels);
      }
      
      // Get all electrical reservations for all transformers at this property
      const allReservations = [];
      for (const transformer of transformers) {
        const reservations = await storage.getElectricalReservations(transformer.id);
        allReservations.push(...reservations);
      }
      
      const bayAssignments = await storage.getBayPanelAssignments(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const totalCapacity = transformers.reduce((sum, t) => sum + (t.totalCapacityKva || 0), 0);
      
      // Calculate allocated capacity from panels (not reservations)
      // Use stored capacityAmps if available, otherwise convert from kVA
      const kvaToAmps = (kva: number): number => Math.round(kva * (1000 / (480 * Math.sqrt(3))));
      const ampsToKva = (amps: number): number => parseFloat((amps * (480 * Math.sqrt(3)) / 1000).toFixed(2));
      
      const totalAllocatedKva = allMainPanels.reduce((sum, p) => sum + (p.maxCapacityKva || 0), 0);
      const totalAllocatedAmps = allMainPanels.reduce((sum, p) => sum + (p.capacityAmps || kvaToAmps(p.maxCapacityKva || 0)), 0);
      const availableCapacity = Math.max(0, totalCapacity - totalAllocatedKva);
      const utilizationPercent = totalCapacity > 0 ? ((totalAllocatedKva / totalCapacity) * 100).toFixed(1) : '0.0';

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Electrical Capacity Management - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; }
            .header { border-bottom: 3px solid ${BRAND_COLOR_PRIMARY}; padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: ${BRAND_COLOR_PRIMARY}; margin-bottom: 10px; background: ${BRAND_COLOR_PRIMARY}; color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            h2 { color: #555; margin-top: 30px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .capacity-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
            .capacity-item { text-align: center; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Electrical Capacity Management Report</div>
            <div class="property-name">${property.propertyName}</div>
          </div>
          
          <div class="summary">
            <h3>Capacity Overview</h3>
            <div class="capacity-grid">
              <div class="capacity-item">
                <h4>Total Capacity</h4>
                <p><strong>${totalCapacity} kVA</strong></p>
              </div>
              <div class="capacity-item">
                <h4>Available</h4>
                <p><strong>${availableCapacity} kVA</strong></p>
              </div>
              <div class="capacity-item">
                <h4>Allocated</h4>
                <p><strong>${totalAllocatedAmps.toLocaleString()} AMPS</strong></p>
                <p style="font-size: 12px; color: #666;">(${totalAllocatedKva.toLocaleString()} kVA)</p>
              </div>
              <div class="capacity-item">
                <h4>Utilization</h4>
                <p><strong>${utilizationPercent}%</strong></p>
              </div>
            </div>
          </div>

          <h2>System Status</h2>
          <table>
            <tr><td>Transformers</td><td>${transformers.length}</td></tr>
            <tr><td>Main Panels</td><td>${allMainPanels.length}</td></tr>
            <tr><td>Bay Assignments</td><td>${bayAssignments.length}</td></tr>
            <tr><td>Active Reservations</td><td>${allReservations.length}</td></tr>
          </table>

          ${transformers.length > 0 ? `
          <h2>Transformers</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Capacity (kVA)</th>
                <th>FPL Designation No.</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${transformers.map(transformer => `
                <tr>
                  <td>${transformer.transformerName}</td>
                  <td>${transformer.totalCapacityKva || 0}</td>
                  <td>${transformer.fplId || 'N/A'}</td>
                  <td>${transformer.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : ''}

          ${allMainPanels.length > 0 ? `
          <h2>Main Panels</h2>
          <table>
            <thead>
              <tr>
                <th>Panel Name</th>
                <th>Transformer</th>
                <th>Capacity (AMPS)</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              ${allMainPanels.map(panel => {
                const transformer = transformers.find(t => t.id === panel.transformerId);
                const panelAmps = panel.capacityAmps || kvaToAmps(panel.maxCapacityKva || 0);
                return `
                <tr>
                  <td>${panel.panelName}</td>
                  <td>${transformer?.transformerName || 'N/A'}</td>
                  <td>${panelAmps.toLocaleString()} AMPS</td>
                  <td>${panel.panelLocation || 'N/A'}</td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
          ` : ''}

          ${allReservations.length > 0 ? `
          <h2>Active Reservations</h2>
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Reserved Capacity (kVA)</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${allReservations.map(reservation => `
                <tr>
                  <td>${reservation.tenantName || 'N/A'}</td>
                  <td>${reservation.reservedKva || 0}</td>
                  <td>${reservation.notes || 'N/A'}</td>
                  <td>${reservation.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : ''}
          
          <p><em>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</em></p>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Electrical management print error:", error);
      res.status(500).json({ message: "Failed to generate electrical management report" });
    }
  });

  app.get('/api/properties/:propertyId/executed-leases', requireAuth, async (req, res) => {
    try {
      const { propertyId } = req.params;
      const leases = await storage.getExecutedLeases(parseInt(propertyId));
      console.log(`DEBUG: Executed leases for property ${propertyId}:`, JSON.stringify(leases, null, 2));
      res.json(leases);
    } catch (error) {
      console.error("Error fetching executed leases:", error);
      res.status(500).json({ message: "Failed to fetch executed leases" });
    }
  });

  app.post('/api/properties/:propertyId/executed-leases', requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const { propertyId } = req.params;
      const leaseData = { 
        ...req.body, 
        propertyId: parseInt(propertyId),
        assignedBays: Array.isArray(req.body.assignedBays) ? req.body.assignedBays : [],
      };
      const lease = await storage.createExecutedLease(leaseData);
      res.json(lease);
    } catch (error) {
      console.error("Error creating executed lease:", error);
      res.status(500).json({ message: "Failed to create executed lease" });
    }
  });

  app.get("/api/properties/:id/attachments", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const attachments = await storage.getPropertyAttachments(propertyId);
      res.json(attachments);
    } catch (error) {
      console.error("Error fetching property attachments:", error);
      res.status(500).json({ message: "Failed to fetch property attachments" });
    }
  });

  app.post("/api/properties/:id/attachments", requireAuth, checkPermission('properties.edit'), upload.any(), async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files provided" });
      }

      const savedAttachments = [];
      for (const file of files) {
        const fileType = file.mimetype.includes('pdf') ? 'pdf' : 
                        file.mimetype.includes('dwg') || file.originalname.toLowerCase().endsWith('.dwg') ? 'dwg' : 'other';
        
        const attachment = await storage.createPropertyAttachment({
          propertyId,
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          fileType,
          description: req.body.description || null
        });
        savedAttachments.push(attachment);
      }

      res.json(savedAttachments);
    } catch (error) {
      console.error("Error uploading property attachments:", error);
      res.status(500).json({ message: "Failed to upload property attachments" });
    }
  });

  app.get("/api/properties/:id/attachments/:attachmentId/download", requireAuth, async (req, res) => {
    try {
      console.log(`🔽 Download request: Property ${req.params.id}, Attachment ${req.params.attachmentId}, User: ${req.user?.username}`);
      
      const propertyId = parseInt(req.params.id);
      const attachmentId = parseInt(req.params.attachmentId);
      
      if (isNaN(propertyId) || isNaN(attachmentId)) {
        console.log("❌ Invalid IDs provided");
        return res.status(400).json({ message: "Invalid property or attachment ID" });
      }

      const attachment = await storage.getPropertyAttachment(attachmentId);
      console.log(`📁 Attachment lookup result:`, attachment ? `Found: ${attachment.filename}` : 'Not found');
      
      if (!attachment || attachment.propertyId !== propertyId) {
        console.log(`❌ Attachment not found or property mismatch`);
        return res.status(404).json({ message: "Attachment not found" });
      }

      const filePath = path.join(uploadsDir, attachment.filename);
      console.log(`📂 Checking file path: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found on disk: ${filePath}`);
        return res.status(404).json({ message: "File not found on disk" });
      }

      console.log(`✅ Starting download: ${attachment.originalName}`);
      res.download(filePath, attachment.originalName, (err) => {
        if (err) {
          console.error("❌ Download error:", err);
        } else {
          console.log(`✅ Download completed: ${attachment.originalName}`);
        }
      });
    } catch (error) {
      console.error("❌ Error downloading property attachment:", error);
      res.status(500).json({ message: "Failed to download attachment" });
    }
  });

  app.delete("/api/properties/:id/attachments/:attachmentId", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const attachmentId = parseInt(req.params.attachmentId);
      
      if (isNaN(propertyId) || isNaN(attachmentId)) {
        return res.status(400).json({ message: "Invalid property or attachment ID" });
      }

      const attachment = await storage.getPropertyAttachment(attachmentId);
      if (!attachment || attachment.propertyId !== propertyId) {
        return res.status(404).json({ message: "Attachment not found" });
      }

      // Delete file from disk
      const filePath = path.join(uploadsDir, attachment.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete from database
      const deleted = await storage.deletePropertyAttachment(attachmentId);
      if (!deleted) {
        return res.status(404).json({ message: "Failed to delete attachment" });
      }

      res.json({ message: "Attachment deleted successfully" });
    } catch (error) {
      console.error("Error deleting property attachment:", error);
      res.status(500).json({ message: "Failed to delete attachment" });
    }
  });

  app.get("/api/properties/:id/print", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const executedLeases = await storage.getExecutedLeases(propertyId);
      const propertyImprovements = await storage.getPropertyExistingImprovements(propertyId);

      // Generate HTML for printing
      const html = generatePropertyPrintHtml(property, executedLeases, propertyImprovements);
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="property-${property.propertyName.replace(/\s+/g, '-')}-report.html"`);
      res.send(html);
    } catch (error) {
      console.error("Error generating property print:", error);
      res.status(500).json({ message: "Failed to generate property print" });
    }
  });

  // Legal compliance rounding system
  app.post("/api/properties/:id/apply-legal-rounding", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Get legal total for this property
      let legalTotal: number;
      if (propertyId === 1) {
        legalTotal = LEGAL_TOTALS.BRIDGE_POINT_GRATIGNY;
      } else if (propertyId === 2) {
        legalTotal = LEGAL_TOTALS.BRIDGE_595_BUILDING_2;
      } else {
        return res.status(400).json({ message: "Legal total not defined for this property" });
      }

      // Apply legal rounding
      const { updatedBayConfigs, result } = applyLegalRounding(
        property.bayConfigurations || [], 
        legalTotal
      );

      if (result.success) {
        // Update property with rounded bay configurations
        await storage.updateProperty(propertyId, {
          bayConfigurations: updatedBayConfigs
        });

        res.json({
          success: true,
          message: result.message,
          adjustments: result.adjustedBays,
          originalTotal: result.originalTotal,
          finalTotal: result.finalTotal
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
          originalTotal: result.originalTotal,
          finalTotal: result.finalTotal
        });
      }
    } catch (error) {
      console.error("Error applying legal rounding:", error);
      res.status(500).json({ message: "Failed to apply legal rounding" });
    }
  });

  app.get("/api/properties/:id/legal-compliance", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Get legal total for this property
      let legalTotal: number;
      if (propertyId === 1) {
        legalTotal = LEGAL_TOTALS.BRIDGE_POINT_GRATIGNY;
      } else if (propertyId === 2) {
        legalTotal = LEGAL_TOTALS.BRIDGE_595_BUILDING_2;
      } else {
        return res.status(400).json({ message: "Legal total not defined for this property" });
      }

      // Validate compliance
      const validation = validateLegalCompliance(
        property.bayConfigurations || [], 
        legalTotal
      );

      res.json({
        propertyId,
        propertyName: property.propertyName,
        legalTotal,
        ...validation
      });
    } catch (error) {
      console.error("Error checking legal compliance:", error);
      res.status(500).json({ message: "Failed to check legal compliance" });
    }
  });

  // ELECTRICAL CAPACITY MANAGEMENT API ROUTES
  // ============================================================================

  // Transformers endpoints
  app.get("/api/transformers", requireAuth, async (req, res) => {
    try {
      const transformers = await storage.getTransformers();
      res.json(transformers);
    } catch (error) {
      console.error("Error fetching transformers:", error);
      res.status(500).json({ message: "Failed to fetch transformers" });
    }
  });

  app.get("/api/properties/:propertyId/transformers", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const transformers = await storage.getTransformersByProperty(propertyId);
      res.json(transformers);
    } catch (error) {
      console.error("Error fetching property transformers:", error);
      res.status(500).json({ message: "Failed to fetch property transformers" });
    }
  });

  app.post("/api/transformers", requireAuth, checkPermission('properties.create'), async (req, res) => {
    try {
      const parsed = insertTransformerSchema.parse(req.body);
      const transformer = await storage.createTransformer(parsed);
      res.status(201).json(transformer);
    } catch (error) {
      console.error("Transformer creation error:", error);
      res.status(400).json({ 
        message: "Invalid transformer data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/properties/:propertyId/transformers", requireAuth, checkPermission('properties.create'), async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const parsed = insertTransformerSchema.parse({
        ...req.body,
        propertyId
      });
      const transformer = await storage.createTransformer(parsed);
      res.status(201).json(transformer);
    } catch (error) {
      console.error("Transformer creation error:", error);
      res.status(400).json({ 
        message: "Invalid transformer data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.patch("/api/transformers/:id", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const parsed = updateTransformerSchema.parse(req.body);
      const transformer = await storage.updateTransformer(id, parsed);
      
      if (!transformer) {
        return res.status(404).json({ message: "Transformer not found" });
      }

      res.json(transformer);
    } catch (error) {
      console.error("Transformer update error:", error);
      res.status(400).json({ 
        message: "Failed to update transformer", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.delete("/api/transformers/:id", requireAuth, checkPermission('properties.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const deleted = await storage.deleteTransformer(id);
      if (!deleted) {
        return res.status(404).json({ message: "Transformer not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Transformer deletion error:", error);
      res.status(500).json({ message: "Failed to delete transformer" });
    }
  });

  // Main Panels endpoints
  app.get("/api/transformers/:transformerId/panels", requireAuth, async (req, res) => {
    try {
      const transformerId = parseInt(req.params.transformerId);
      if (isNaN(transformerId)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const panels = await storage.getMainPanelsByTransformer(transformerId);
      res.json(panels);
    } catch (error) {
      console.error("Error fetching main panels:", error);
      res.status(500).json({ message: "Failed to fetch main panels" });
    }
  });

  app.get("/api/properties/:propertyId/main-panels", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const panels = await storage.getMainPanelsByProperty(propertyId);
      res.json(panels);
    } catch (error) {
      console.error("Error fetching property main panels:", error);
      res.status(500).json({ message: "Failed to fetch property main panels" });
    }
  });

  app.post("/api/main-panels", requireAuth, checkPermission('properties.create'), async (req, res) => {
    try {
      const parsed = insertMainPanelSchema.parse(req.body);
      const panel = await storage.createMainPanel(parsed);
      res.status(201).json(panel);
    } catch (error) {
      console.error("Main panel creation error:", error);
      res.status(400).json({ 
        message: "Invalid main panel data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/properties/:propertyId/main-panels", requireAuth, checkPermission('properties.create'), async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      // Get the property to verify it exists
      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const parsed = insertMainPanelSchema.parse(req.body);
      const panel = await storage.createMainPanel(parsed);
      res.status(201).json(panel);
    } catch (error) {
      console.error("Main panel creation error:", error);
      res.status(400).json({ 
        message: "Invalid main panel data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.patch("/api/main-panels/:id", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid main panel ID" });
      }

      const parsed = updateMainPanelSchema.parse(req.body);
      const panel = await storage.updateMainPanel(id, parsed);
      
      if (!panel) {
        return res.status(404).json({ message: "Main panel not found" });
      }

      res.json(panel);
    } catch (error) {
      console.error("Main panel update error:", error);
      res.status(400).json({ 
        message: "Failed to update main panel", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.delete("/api/main-panels/:id", requireAuth, checkPermission('properties.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid main panel ID" });
      }

      const deleted = await storage.deleteMainPanel(id);
      if (!deleted) {
        return res.status(404).json({ message: "Main panel not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Main panel deletion error:", error);
      res.status(500).json({ message: "Failed to delete main panel" });
    }
  });

  // Bay Panel Assignments endpoints
  app.get("/api/properties/:propertyId/bay-panel-assignments", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const assignments = await storage.getBayPanelAssignments(propertyId);
      res.json(assignments);
    } catch (error) {
      console.error("Error fetching bay panel assignments:", error);
      res.status(500).json({ message: "Failed to fetch bay panel assignments" });
    }
  });

  app.post("/api/bay-panel-assignments", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const parsed = insertBayPanelAssignmentSchema.parse(req.body);
      const assignment = await storage.createBayPanelAssignment(parsed);
      res.status(201).json(assignment);
    } catch (error) {
      console.error("Bay panel assignment creation error:", error);
      res.status(400).json({ 
        message: "Invalid bay panel assignment data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.delete("/api/bay-panel-assignments/:id", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const deleted = await storage.deleteBayPanelAssignment(id);
      if (!deleted) {
        return res.status(404).json({ message: "Bay panel assignment not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Bay panel assignment deletion error:", error);
      res.status(500).json({ message: "Failed to delete bay panel assignment" });
    }
  });

  // Active RFP Electrical Allocations for a property
  app.get("/api/properties/:propertyId/active-electrical-allocations", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      // Get all non-published RFPs for this property that have electrical allocations
      const allRfps = await storage.getAllRfpRequests();
      const propertyRfps = allRfps.filter((rfp: any) => {
        // Check if RFP is for this property and not published/archived
        const isForProperty = rfp.propertyId === propertyId || parseInt(rfp.property) === propertyId;
        const isActive = rfp.status !== 'published' && rfp.status !== 'archived';
        return isForProperty && isActive;
      });

      // Get evaluation budgets for these RFPs and extract electrical allocations
      const allocations: Array<{
        rfpId: number;
        rfpNumber: string;
        tenantName: string;
        status: string;
        allocations: Array<{ kva: number; voltage: string; amps: number }>;
        totalKva: number;
      }> = [];

      for (const rfp of propertyRfps) {
        const budget = await storage.getEvaluationBudget(rfp.id);
        if (budget && budget.metadata) {
          const metadata = budget.metadata as { electricalAllocations?: Array<{ kva: number; voltage: string }> };
          if (metadata.electricalAllocations && metadata.electricalAllocations.length > 0) {
            const totalKva = metadata.electricalAllocations.reduce((sum: number, alloc: { kva: number }) => sum + (alloc.kva || 0), 0);
            
            // Calculate AMPS for each allocation
            const allocsWithAmps = metadata.electricalAllocations.map((alloc: { kva: number; voltage: string }) => {
              const voltage = alloc.voltage || "208";
              const multiplier = voltage === "480" ? 480 * Math.sqrt(3) : 208 * Math.sqrt(3);
              const amps = Math.round((alloc.kva * 1000) / multiplier);
              return { kva: alloc.kva, voltage, amps };
            });

            allocations.push({
              rfpId: rfp.id,
              rfpNumber: rfp.rfpNumber || `RFP-${rfp.id}`,
              tenantName: rfp.tenantName || 'Unknown Tenant',
              status: rfp.status || 'unknown',
              allocations: allocsWithAmps,
              totalKva
            });
          }
        }
      }

      res.json(allocations);
    } catch (error) {
      console.error("Error fetching active electrical allocations:", error);
      res.status(500).json({ message: "Failed to fetch active electrical allocations" });
    }
  });

  // Electrical Reservations endpoints
  app.get("/api/transformers/:transformerId/reservations", requireAuth, async (req, res) => {
    try {
      const transformerId = parseInt(req.params.transformerId);
      if (isNaN(transformerId)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const reservations = await storage.getElectricalReservations(transformerId);
      res.json(reservations);
    } catch (error) {
      console.error("Error fetching electrical reservations:", error);
      res.status(500).json({ message: "Failed to fetch electrical reservations" });
    }
  });

  app.get("/api/rfp-requests/:rfpId/electrical-reservation", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const reservation = await storage.getElectricalReservationByRfp(rfpId);
      res.json(reservation);
    } catch (error) {
      console.error("Error fetching RFP electrical reservation:", error);
      res.status(500).json({ message: "Failed to fetch RFP electrical reservation" });
    }
  });

  app.post("/api/electrical-reservations", requireAuth, checkPermission('rfp.create'), async (req, res) => {
    try {
      const parsed = insertElectricalReservationSchema.parse({
        ...req.body,
        createdBy: req.user?.username || 'unknown'
      });
      const reservation = await storage.createElectricalReservation(parsed);
      res.status(201).json(reservation);
    } catch (error) {
      console.error("Electrical reservation creation error:", error);
      res.status(400).json({ 
        message: "Invalid electrical reservation data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.patch("/api/electrical-reservations/:id", requireAuth, checkPermission('rfp.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reservation ID" });
      }

      const parsed = updateElectricalReservationSchema.parse(req.body);
      const reservation = await storage.updateElectricalReservation(id, parsed);
      
      if (!reservation) {
        return res.status(404).json({ message: "Electrical reservation not found" });
      }

      res.json(reservation);
    } catch (error) {
      console.error("Electrical reservation update error:", error);
      res.status(400).json({ 
        message: "Failed to update electrical reservation", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.delete("/api/electrical-reservations/:id", requireAuth, checkPermission('rfp.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reservation ID" });
      }

      const deleted = await storage.deleteElectricalReservation(id);
      if (!deleted) {
        return res.status(404).json({ message: "Electrical reservation not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Electrical reservation deletion error:", error);
      res.status(500).json({ message: "Failed to delete electrical reservation" });
    }
  });

  // Power Bank Dashboard - get capacity summary for a transformer
  app.get("/api/transformers/:transformerId/capacity-summary", requireAuth, async (req, res) => {
    try {
      const transformerId = parseInt(req.params.transformerId);
      if (isNaN(transformerId)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const summary = await storage.getTransformerCapacitySummary(transformerId);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching transformer capacity summary:", error);
      res.status(500).json({ message: "Failed to fetch transformer capacity summary" });
    }
  });

  // Power Bank Dashboard - get capacity overview for all properties
  app.get("/api/electrical-capacity/overview", requireAuth, async (req, res) => {
    try {
      const overview = await storage.getElectricalCapacityOverview();
      res.json(overview);
    } catch (error) {
      console.error("Error fetching electrical capacity overview:", error);
      res.status(500).json({ message: "Failed to fetch electrical capacity overview" });
    }
  });
}
